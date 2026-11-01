import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { mkdtempSync,rmSync,unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { removeChroma } from "../src/server/pixel/chroma";
import { FakeProvider } from "../src/server/ai/fake";
import { eq } from "drizzle-orm";
const state=vi.hoisted(()=>({
  config:{dataDir:""},
  chat:vi.fn(),generate:vi.fn(),
}));
vi.mock("../src/server/config",()=>({config:state.config}));
vi.mock("../src/server/ai",()=>({provider:{chat:state.chat,generate:state.generate}}));
import { getDatabase,openDatabase } from "../src/server/db";
import { characters,characterSheets,jobs } from "../src/server/db/schema";
import { saveAsset,readAsset,assetPath } from "../src/server/storage/assets";
import { queueSheet,getCharacter } from "../src/server/characters/repository";
import { JobQueue } from "../src/server/jobs/queue";
import { generateSheet } from "../src/server/pipeline/sheet";
let previous:ReturnType<typeof openDatabase>|undefined;
const globalDb=globalThis as typeof globalThis & {char2dDb?:ReturnType<typeof openDatabase>};
let original:Buffer,latest:Buffer,latestId:string,sourceId:string;
beforeEach(async()=>{
  state.config.dataDir=mkdtempSync(join(tmpdir(),"char2d-revision-"));
  previous=globalDb.char2dDb;globalDb.char2dDb=openDatabase(state.config.dataDir);
  state.chat.mockReset();state.generate.mockReset();
  const fixture=await readFile("tests/fixtures/demo-sheet.png");
  original=Buffer.concat([fixture]);
  const decoded=await sharp(fixture).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const keyed=removeChroma(decoded.data,decoded.info.width,decoded.info.height,"#FF00FF");
  latest=await sharp(keyed.rgba,{raw:{width:decoded.info.width,height:decoded.info.height,channels:4}}).png().toBuffer();
  const {db}=getDatabase();
  db.insert(characters).values({id:"char",name:"Knight",description:"green knight",viewType:"side_scroller",styleJson:JSON.stringify({chromaKey:"#FF00FF"}),createdAt:1,updatedAt:1}).run();
  sourceId=(await saveAsset(original,{kind:"source",mime:"image/png",characterId:"char"})).id;
  latestId=(await saveAsset(latest,{kind:"sheet_transparent",mime:"image/png",characterId:"char"})).id;
  db.update(characters).set({sourceAssetId:sourceId,sheetId:"sheet-old"}).where(eq(characters.id,"char")).run();
  db.insert(characterSheets).values({id:"sheet-old",characterId:"char",version:1,processedAssetId:latestId,prompt:"old prompt",status:"ready",createdAt:1}).run();
  state.generate.mockImplementation(request=>new FakeProvider().generate(request));
});
afterEach(()=>{globalDb.char2dDb?.sqlite.close();globalDb.char2dDb=previous;rmSync(state.config.dataDir,{recursive:true,force:true});});
for(const path of ["edit_latest","new_sheet"] as const) {
  it(`passes the correct reference bytes for ${path} and checkpoints the decision`,async()=>{
    state.chat.mockResolvedValue({text:JSON.stringify({path,reason:"User request"})});
    const id=queueSheet("char","Make the cape shorter",true);
    const queue=new JobQueue();const job=queue.claim("test")!;
    await generateSheet(job,queue);
    expect(state.generate.mock.calls[0][0].references).toEqual([path==="edit_latest" ? latest:original]);
    const payload=JSON.parse(queue.get(id)!.payloadJson);
    expect(payload.generation.referenceAssetId).toBe(path==="edit_latest" ? latestId:sourceId);
    expect(getCharacter("char")?.job?.revision?.path).toBe(path);
    expect(getCharacter("char")?.sheet?.status).toBe("ready");
    // A resumed job reuses both raw output and its saved plan without another
    // chat or image call.
    await generateSheet(queue.get(id)!,queue);
    expect(state.chat).toHaveBeenCalledTimes(1);expect(state.generate).toHaveBeenCalledTimes(1);
  });
}
it("does not invoke image generation after an invalid plan",async()=>{
  state.chat.mockResolvedValue({text:"not a decision"});
  queueSheet("char","Make the cape shorter",true);
  const queue=new JobQueue();
  await expect(generateSheet(queue.claim("test")!,queue)).rejects.toThrow("valid revision strategy");
  expect(state.generate).not.toHaveBeenCalled();
  expect(getCharacter("char")?.status).toBe("error");
});
it("starts a prompt-only fresh sheet without sending a previous generated image",async()=>{
  getDatabase().db.update(characters).set({sourceAssetId:null}).where(eq(characters.id,"char")).run();
  state.chat.mockResolvedValue({text:JSON.stringify({path:"new_sheet",reason:"Start over"})});
  queueSheet("char","Start over with a new character",true);
  const queue=new JobQueue();await generateSheet(queue.claim("test")!,queue);
  expect(state.generate.mock.calls[0][0].references).toBeUndefined();
});
it("snapshots the last usable sheet even if the most recent attempt failed",()=>{
  getDatabase().db.insert(characterSheets).values({id:"failed",characterId:"char",version:2,status:"error",prompt:"bad",createdAt:2}).run();
  const jobId=queueSheet("char","Fix the cape",true);
  const row=getDatabase().db.select().from(jobs).where(eq(jobs.id,jobId)).get()!;
  expect(JSON.parse(row.payloadJson).revision.latestAssetId).toBe(latestId);
});

it("reprocesses a failed saved sheet without chat or image calls",async()=>{
  const {reprocessSheet}=await import("../src/server/characters/reprocess");
  const {db}=getDatabase(),queue=new JobQueue();
  db.update(characterSheets).set({status:"error",rawAssetId:sourceId}).where(eq(characterSheets.id,"sheet-old")).run();
  db.update(characters).set({status:"error"}).where(eq(characters.id,"char")).run();
  const oldId=queue.enqueue("sheet",{sheetId:"sheet-old"},{characterId:"char",maxAttempts:1});queue.claim("test");queue.fail(oldId,new Error("extract_mismatch"));
  const {jobId}=reprocessSheet("char");
  expect(()=>reprocessSheet("char")).toThrow();
  const job=queue.claim("test")!;expect(job.id).toBe(jobId);await generateSheet(job,queue);queue.complete(job.id);
  expect(getCharacter("char")?.sheet?.status).toBe("ready");expect(state.chat).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
});
it("never generates a replacement if a saved reprocessing image disappears",async()=>{
  const {reprocessSheet}=await import("../src/server/characters/reprocess");
  getDatabase().db.update(characterSheets).set({status:"error",rawAssetId:sourceId}).where(eq(characterSheets.id,"sheet-old")).run();
  reprocessSheet("char");
  const source=await readAsset(sourceId);unlinkSync(assetPath(source!.asset.path));
  const queue=new JobQueue();await expect(generateSheet(queue.claim("test")!,queue)).rejects.toThrow("missing");
  expect(state.chat).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
});

it("preserves the generated sheet dimensions and opaque source colors for review",async()=>{
  state.chat.mockResolvedValue({text:JSON.stringify({path:"new_sheet",reason:"Fresh sheet"})});
  queueSheet("char","Start over",true);const queue=new JobQueue();await generateSheet(queue.claim("test")!,queue);
  const character=getCharacter("char")!;const asset=await readAsset(character.sheet!.processedAssetId!);
  const originalMeta=await sharp(original).metadata(),meta=await sharp(asset!.bytes).metadata();
  expect(meta.width).toBe(originalMeta.width);expect(meta.height).toBe(originalMeta.height);expect(character.sheet!.fullResolution).toBe(true);
  const pixels=await sharp(asset!.bytes).ensureAlpha().raw().toBuffer();const source=await sharp(original).ensureAlpha().raw().toBuffer();
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===255)expect([...pixels.slice(i,i+4)]).toEqual([...source.slice(i,i+4)]);
});
it("restores an accepted sheet locally using its original key and preserves the active manifest",async()=>{
  const {reprocessSheet}=await import("../src/server/characters/reprocess"),{db}=getDatabase();
  db.update(characterSheets).set({status:"accepted",rawAssetId:sourceId,prompt:"Background key: #FF00FF"}).where(eq(characterSheets.id,"sheet-old")).run();
  const manifest=JSON.stringify({version:1,characterId:"char",viewType:"side_scroller",atlas:{url:"/api/assets/old",width:1,height:1,version:1},pixelScale:2,actions:{}});
  db.update(characters).set({status:"ready",manifestJson:manifest,styleJson:JSON.stringify({chromaKey:"#00FF00",logicalHeight:128})}).where(eq(characters.id,"char")).run();
  reprocessSheet("char");const queue=new JobQueue();await generateSheet(queue.claim("test")!,queue);
  const updated=getCharacter("char")!;expect(updated.sheet?.status).toBe("accepted");expect(updated.status).toBe("ready");expect(updated.sheet?.fullResolution).toBe(true);
  expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.manifestJson).toBe(manifest);
  expect(state.chat).not.toHaveBeenCalled();expect(state.generate).not.toHaveBeenCalled();
});
