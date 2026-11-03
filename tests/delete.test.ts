import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync,symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { eq } from "drizzle-orm";
const state=vi.hoisted(()=>({config:{dataDir:""},generate:vi.fn()}));
vi.mock("../src/server/config",()=>({config:state.config}));
vi.mock("../src/server/ai",()=>({provider:{generate:state.generate}}));
import { getDatabase,openDatabase } from "../src/server/db";
import { characters,characterSheets,actions,actionVersions,inputBindings,assets,jobs,chatMessages } from "../src/server/db/schema";
import { saveAsset,readAsset,assetPath,pruneEmptyAssetDirectories } from "../src/server/storage/assets";
import { FakeProvider } from "../src/server/ai/fake";
import { acceptAndAnimate } from "../src/server/characters/animations";
import { JobQueue } from "../src/server/jobs/queue";
import { runAnimationJob } from "../src/server/pipeline/animations";
import { deleteCharacter,deleteAction,DeleteError } from "../src/server/characters/delete";
import { manifestSchema } from "../src/lib/manifest";
import { removeChroma } from "../src/server/pixel/chroma";
const globalDb=globalThis as typeof globalThis & {char2dDb?:ReturnType<typeof openDatabase>};
let previous:ReturnType<typeof openDatabase>|undefined;
let fixture:Buffer;
beforeEach(async()=>{
  state.config.dataDir=mkdtempSync(join(tmpdir(),"char2d-delete-"));previous=globalDb.char2dDb;globalDb.char2dDb=openDatabase(state.config.dataDir);
  fixture=await readFile("tests/fixtures/demo-sheet.png");
  getDatabase().db.insert(characters).values({id:"char",name:"Knight",description:"green knight",viewType:"side_scroller",sheetId:"sheet",styleJson:JSON.stringify({chromaKey:"#FF00FF"}),createdAt:1,updatedAt:1}).run();
  const source=await saveAsset(fixture,{characterId:"char",kind:"source",mime:"image/png"});
  const decoded=await sharp(fixture).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const keyed=removeChroma(decoded.data,decoded.info.width,decoded.info.height,"#FF00FF");
  const png=await sharp(keyed.rgba,{raw:{width:decoded.info.width,height:decoded.info.height,channels:4}}).png().toBuffer();
  const sheet=await saveAsset(png,{characterId:"char",kind:"sheet_transparent",mime:"image/png"});
  getDatabase().db.update(characters).set({sourceAssetId:source.id}).where(eq(characters.id,"char")).run();
  getDatabase().db.insert(characterSheets).values({id:"sheet",characterId:"char",version:1,status:"ready",processedAssetId:sheet.id,prompt:"accepted",createdAt:1}).run();
  state.generate.mockReset().mockImplementation(request=>new FakeProvider().generate(request));
});
afterEach(()=>{globalDb.char2dDb?.sqlite.close();globalDb.char2dDb=previous;rmSync(state.config.dataDir,{recursive:true,force:true});});
async function drain(){const queue=new JobQueue();for(let job=queue.claim("test");job;job=queue.claim("test")){await runAnimationJob(job,queue);queue.complete(job.id);}}
async function ready(){acceptAndAnimate("char","sheet");await drain();}
it("deletes character rows and unique files while preserving content-addressed files shared by another character",async()=>{
  await ready();const {db,sqlite}=getDatabase();
  db.insert(characters).values({id:"other",name:"Other",viewType:"side_scroller",createdAt:1,updatedAt:1}).run();
  const shared=await saveAsset(fixture,{characterId:"other",kind:"source",mime:"image/png"});
  const original=getDatabase().db.select().from(assets).where(eq(assets.id,db.select().from(characters).where(eq(characters.id,"char")).get()!.sourceAssetId!)).get()!;
  expect(shared.path).toBe(original.path);
  const files=db.select().from(assets).where(eq(assets.characterId,"char")).all();
  db.insert(chatMessages).values({id:"message",characterId:"char",role:"user",content:"hello",createdAt:1}).run();
  new JobQueue().enqueue("demo",{},{characterId:"char"}); // queued work is removed too
  deleteCharacter("char");
  expect(db.select().from(characters).where(eq(characters.id,"char")).get()).toBeUndefined();
  for(const table of [actions,actionVersions,inputBindings,characterSheets,jobs,chatMessages])expect(db.select().from(table).all()).toHaveLength(0);
  expect(sqlite.prepare("SELECT count(*) as n FROM job_events").get()).toEqual({n:0});
  expect((await readAsset(shared.id))?.bytes).toEqual(fixture);
  for(const file of files)if(file.path!==shared.path)expect(existsSync(assetPath(file.path))).toBe(false);
  expect(sqlite.pragma("foreign_key_check")).toEqual([]);
});
it("rejects character deletion while a worker owns a running job",()=>{
  const queue=new JobQueue();queue.enqueue("demo",{},{characterId:"char"});queue.claim("worker");
  expect(()=>deleteCharacter("char")).toThrow(/running/);
  expect(getDatabase().db.select().from(characters).all()).toHaveLength(1);
});
it("deletes action versions/bindings/assets and rebuilds the atlas without an AI call",async()=>{
  await ready();const {db}=getDatabase();const character=db.select().from(characters).where(eq(characters.id,"char")).get()!;
  const oldAtlas=character.atlasAssetId!;
  const walk=db.select().from(actions).where(eq(actions.key,"walk")).get()!;
  const versions=db.select().from(actionVersions).where(eq(actionVersions.actionId,walk.id)).all();
  const frameId=JSON.parse(versions[0].framesJson).right[0].assetId;
  const responseId=JSON.parse(versions[0].stripsJson).right[0].responseAssetId;
  const calls=state.generate.mock.calls.length;
  const result=deleteAction("char","walk");expect(result.jobId).toBeTruthy();
  expect(db.select().from(actions).where(eq(actions.id,walk.id)).get()).toBeUndefined();
  expect(db.select().from(actionVersions).where(eq(actionVersions.actionId,walk.id)).all()).toHaveLength(0);
  expect(db.select().from(inputBindings).where(eq(inputBindings.actionId,walk.id)).all()).toHaveLength(0);
  expect(await readAsset(frameId)).toBeNull();expect(await readAsset(responseId)).toBeNull();expect(await readAsset(oldAtlas)).toBeNull();
  await drain();expect(state.generate).toHaveBeenCalledTimes(calls);
  const updated=db.select().from(characters).where(eq(characters.id,"char")).get()!;
  const manifest=manifestSchema.parse(JSON.parse(updated.manifestJson!));
  expect(Object.keys(manifest.actions)).toEqual(["idle","jump","crouch"]);
  for(const job of db.select().from(jobs).all())for(const id of JSON.parse(job.dependsOnJson))expect(db.select().from(jobs).where(eq(jobs.id,id)).get()).toBeTruthy();
});
it("allows deleting idle and the final remaining action without removing the sheet",async()=>{
  await ready();
  for(const key of ["idle","walk","jump","crouch"]){deleteAction("char",key);await drain();}
  const character=getDatabase().db.select().from(characters).where(eq(characters.id,"char")).get()!;
  expect(character.manifestJson).toBeNull();expect(character.atlasAssetId).toBeNull();expect(character.status).toBe("draft");
  expect(getDatabase().db.select().from(characterSheets).where(eq(characterSheets.id,"sheet")).get()?.processedAssetId).toBeTruthy();
});
it("preserves asset IDs still referenced by another action",async()=>{
  await ready();const {db}=getDatabase();
  const walk=db.select().from(actions).where(eq(actions.key,"walk")).get()!;
  const idle=db.select().from(actions).where(eq(actions.key,"idle")).get()!;
  const walkFrames=JSON.parse(db.select().from(actionVersions).where(eq(actionVersions.id,walk.activeVersionId!)).get()!.framesJson);
  const version=db.select().from(actionVersions).where(eq(actionVersions.id,idle.activeVersionId!)).get()!;
  const frames=JSON.parse(version.framesJson);frames.right[0]=walkFrames.right[0];db.update(actionVersions).set({framesJson:JSON.stringify(frames)}).where(eq(actionVersions.id,version.id)).run();
  deleteAction("char","walk");expect(await readAsset(walkFrames.right[0].assetId)).toBeTruthy();
});
it("rejects missing resources and action deletion during queued generation",()=>{
  expect(()=>deleteCharacter("missing")).toThrow(DeleteError);
  expect(()=>deleteAction("char","missing")).toThrow("Action not found");
  acceptAndAnimate("char","sheet");expect(()=>deleteAction("char","walk")).toThrow(/in progress/);
});

it("removes all empty asset subfolders, including nested leftovers, and preserves files and the root",()=>{
  const root=join(state.config.dataDir,"assets");
  mkdirSync(join(root,"old-empty","nested"),{recursive:true});
  mkdirSync(join(root,"keep"),{recursive:true});writeFileSync(join(root,"keep","file.txt"),"keep");
  expect(pruneEmptyAssetDirectories()).toBe(2);
  expect(existsSync(join(root,"old-empty"))).toBe(false);
  expect(existsSync(join(root,"keep","file.txt"))).toBe(true);expect(existsSync(root)).toBe(true);
  expect(pruneEmptyAssetDirectories()).toBe(0);
});
it("automatically sweeps empty leftovers after character deletion",()=>{
  const empty=join(state.config.dataDir,"assets","leftover","nested");mkdirSync(empty,{recursive:true});
  deleteCharacter("char");
  expect(existsSync(join(state.config.dataDir,"assets","leftover"))).toBe(false);
  expect(existsSync(join(state.config.dataDir,"assets"))).toBe(true);
});
it("does not follow symlinks outside the asset tree",()=>{
  const outside=join(state.config.dataDir,"outside");mkdirSync(join(outside,"empty"),{recursive:true});
  const link=join(state.config.dataDir,"assets","external");symlinkSync(outside,link,"dir");
  pruneEmptyAssetDirectories();expect(existsSync(join(outside,"empty"))).toBe(true);expect(existsSync(link)).toBe(true);
});
