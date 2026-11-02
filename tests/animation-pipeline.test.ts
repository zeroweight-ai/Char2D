import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { eq } from "drizzle-orm";
const state=vi.hoisted(()=>({config:{dataDir:""},generate:vi.fn(),chat:vi.fn()}));
vi.mock("../src/server/config",()=>({config:state.config}));
vi.mock("../src/server/ai",()=>({provider:{generate:state.generate,chat:state.chat}}));
import { getDatabase,openDatabase } from "../src/server/db";
import { characters,characterSheets,jobs,actionVersions } from "../src/server/db/schema";
import { saveAsset,readAsset } from "../src/server/storage/assets";
import { FakeProvider } from "../src/server/ai/fake";
import { acceptAndAnimate,retryAnimations,regenerateAction } from "../src/server/characters/animations";
import { planCustomAction,createCustomAction } from "../src/server/characters/custom-action";
import { JobQueue } from "../src/server/jobs/queue";
import { runAnimationJob } from "../src/server/pipeline/animations";
import { manifestSchema } from "../src/lib/manifest";
import { removeChroma } from "../src/server/pixel/chroma";
import { getCharacter,queueSheet } from "../src/server/characters/repository";
const globalDb=globalThis as typeof globalThis & {char2dDb?:ReturnType<typeof openDatabase>};
let previous:ReturnType<typeof openDatabase>|undefined;
let original:Buffer;
beforeEach(async()=>{
  state.config.dataDir=mkdtempSync(join(tmpdir(),"char2d-animation-"));previous=globalDb.char2dDb;globalDb.char2dDb=openDatabase(state.config.dataDir);
  const fixture=await readFile("tests/fixtures/demo-sheet.png");original=fixture;
  const decoded=await sharp(fixture).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const keyed=removeChroma(decoded.data,decoded.info.width,decoded.info.height,"#FF00FF");
  const png=await sharp(keyed.rgba,{raw:{width:decoded.info.width,height:decoded.info.height,channels:4}}).png().toBuffer();
  const {db}=getDatabase();
  db.insert(characters).values({id:"char",name:"Knight",description:"green knight",viewType:"side_scroller",sheetId:"sheet",styleJson:JSON.stringify({chromaKey:"#FF00FF",logicalHeight:48}),createdAt:1,updatedAt:1}).run();
  const source=await saveAsset(fixture,{characterId:"char",kind:"source",mime:"image/png"});
  db.update(characters).set({sourceAssetId:source.id}).where(eq(characters.id,"char")).run();
  const asset=await saveAsset(png,{characterId:"char",kind:"sheet_transparent",mime:"image/png"});
  db.insert(characterSheets).values({id:"sheet",characterId:"char",version:1,status:"ready",processedAssetId:asset.id,prompt:"accepted pixel character",createdAt:1}).run();
  state.generate.mockReset().mockImplementation(request=>new FakeProvider().generate(request));
});
afterEach(()=>{globalDb.char2dDb?.sqlite.close();globalDb.char2dDb=previous;rmSync(state.config.dataDir,{recursive:true,force:true});});
async function drain(){const queue=new JobQueue();let count=0;for(let job=queue.claim("test");job;job=queue.claim("test")){await runAnimationJob(job,queue);queue.complete(job.id);if(++count>50)throw new Error("Job loop did not terminate");}}
for(const view of ["side_scroller","top_down","three_quarter"] as const) {
  it(`accepts a ${view} sheet once and generates valid aligned frames and an atlas`,async()=>{
    getDatabase().db.update(characters).set({viewType:view}).where(eq(characters.id,"char")).run();
    const first=acceptAndAnimate("char","sheet");
    expect(acceptAndAnimate("char","sheet")).toEqual({...first,alreadyQueued:true});
    expect(()=>queueSheet("char","new sheet",true)).toThrow(/already/);
    await drain();
    expect(state.generate).toHaveBeenCalledTimes(view==="side_scroller"?4:6);
    for(const [request] of state.generate.mock.calls){expect([2,3]).toContain(request.references.length);expect(Number(request.prompt.match(/Frame count: (\d+)/)[1])).toBeLessThanOrEqual(4);expect(request.references[0].equals(original)).toBe(false);expect(request.prompt).toMatch(/animate in place/i);}
    const character=getDatabase().db.select().from(characters).where(eq(characters.id,"char")).get()!;
    expect(character.status).toBe("ready");
    const manifest=manifestSchema.parse(JSON.parse(character.manifestJson!));
    expect(Object.keys(manifest.actions)).toEqual(view==="side_scroller"?["idle","walk","jump","crouch"]:["idle","walk"]);
    expect(manifest.actions.walk.directions.left).toEqual({mirrorOf:"right"});
    expect(manifest.actions.walk.directions.right?.frames).toHaveLength(4);
    for(const action of Object.values(manifest.actions))for(const direction of Object.values(action.directions))for(const frame of direction.frames??[]){expect(frame.anchorY).toBeLessThanOrEqual(frame.h+16);expect(frame.w).toBeLessThan(64);expect(frame.h).toBeLessThan(80);expect(frame.durationMs).toBeGreaterThan(0);}
    const atlas=await readAsset(character.atlasAssetId!);expect((await sharp(atlas!.bytes).metadata()).hasAlpha).toBe(true);
    const pixels=await sharp(atlas!.bytes).ensureAlpha().raw().toBuffer();
    const sourceColors=["#19326e","#ffd2a1","#09bfd7","#1740b4"];
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+3])expect(sourceColors).toContain("#"+[pixels[i],pixels[i+1],pixels[i+2]].map(c=>c.toString(16).padStart(2,"0")).join(""));
    expect(acceptAndAnimate("char","sheet").alreadyQueued).toBe(true);
    expect(getDatabase().db.select().from(jobs).all()).toHaveLength(10);
  });
}
it("reuses raw strip checkpoints after an interrupted job",async()=>{
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const strip=queue.claim("test")!;await runAnimationJob(strip,queue);
  getDatabase().db.update(actionVersions).set({framesJson:"{}"}).where(eq(actionVersions.id,strip.actionVersionId!)).run();
  await runAnimationJob(strip,queue);expect(state.generate).toHaveBeenCalledTimes(1);
});
it("continues legacy multi-strip action plans",async()=>{
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const strip=queue.claim("test")!;const version=getDatabase().db.select().from(actionVersions).where(eq(actionVersions.id,strip.actionVersionId!)).get()!;
  const plan=JSON.parse(version.planJson);plan.frames=8;plan.poses=[...plan.poses,...plan.poses];plan.durationsMs=[...plan.durationsMs,...plan.durationsMs];
  getDatabase().db.update(actionVersions).set({planJson:JSON.stringify(plan)}).where(eq(actionVersions.id,version.id)).run();
  await runAnimationJob(strip,queue);expect(state.generate).toHaveBeenCalledTimes(2);expect(state.generate.mock.calls[1][0].references).toHaveLength(4); // + frame 1 of this action for scale/leg continuity
});
it("retains completed work when retrying failed jobs",async()=>{
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const bad=queue.claim("test")!;queue.fail(bad.id,new Error("Temporary failure"));queue.recoverStale();queue.recoverStale();
  expect(retryAnimations("char")).toEqual({ok:true});expect(queue.get(prepare.id)?.status).toBe("done");
  await drain();expect(getDatabase().db.select().from(characters).where(eq(characters.id,"char")).get()?.status).toBe("ready");
});
it("rejects stale sheets and does not spend image calls before acceptance",()=>{
  expect(()=>acceptAndAnimate("char","not-current")).toThrow(/replaced/);expect(state.generate).not.toHaveBeenCalled();expect(getDatabase().db.select().from(jobs).all()).toHaveLength(0);
});

it("retries an extract-mismatch strip once and retains both raw attempts",async()=>{
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const strip=queue.claim("test")!;
  state.generate.mockImplementationOnce(request=>new FakeProvider().generate({...request,prompt:request.prompt.replace(/Frame count: \d+/,"Frame count: 2")}));
  await runAnimationJob(strip,queue);
  expect(state.generate).toHaveBeenCalledTimes(2);
  const version=getDatabase().db.select().from(actionVersions).where(eq(actionVersions.id,strip.actionVersionId!)).get()!;
  const refs=JSON.parse(version.stripsJson).right;
  expect(refs).toHaveLength(2);expect(refs[0].invalid).toBe(true);expect(refs[1].invalid).not.toBe(true);
});
it("can start animations on a sheet accepted before animation support existed",()=>{
  getDatabase().db.update(characterSheets).set({status:"accepted"}).where(eq(characterSheets.id,"sheet")).run();
  expect(acceptAndAnimate("char","sheet").alreadyQueued).toBe(false);
  expect(getDatabase().db.select().from(jobs).all()).toHaveLength(10);
});

for(const view of ["side_scroller","top_down","three_quarter"] as const) {
  it(`regenerates only walk for ${view}, preserving the active atlas until publication`,async()=>{
    const {db}=getDatabase();db.update(characters).set({viewType:view}).where(eq(characters.id,"char")).run();
    acceptAndAnimate("char","sheet");await drain();
    const {actions,inputBindings}=await import("../src/server/db/schema");
    const before=db.select().from(characters).where(eq(characters.id,"char")).get()!;
    const previous=db.select().from(actions).all();const bindings=db.select().from(inputBindings).all();
    const walk=previous.find(action=>action.key==="walk")!;
    const calls=state.generate.mock.calls.length;
    const result=regenerateAction("char","walk");expect(result.imageCalls).toBe(view==="side_scroller"?1:3);
    expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.manifestJson).toBe(before.manifestJson);
    expect(db.select().from(actions).where(eq(actions.id,walk.id)).get()!.activeVersionId).toBe(walk.activeVersionId);
    expect(()=>regenerateAction("char","walk")).toThrow(/in progress/);
    await drain();expect(state.generate).toHaveBeenCalledTimes(calls+result.imageCalls);
    const after=db.select().from(actions).all();
    for(const old of previous)expect(after.find(action=>action.id===old.id)!.activeVersionId).toBe(old.key==="walk"?result.versionId:old.activeVersionId);
    expect(db.select().from(inputBindings).all()).toEqual(bindings);
    const newVersion=db.select().from(actionVersions).where(eq(actionVersions.id,result.versionId)).get()!;
    expect(newVersion.parentVersionId).toBe(walk.activeVersionId);expect(newVersion.version).toBe(2);expect(newVersion.createdBy).toBe("manual");
    expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.atlasVersion).toBe(before.atlasVersion+1);
  });
}
it("keeps the previous animation when regeneration fails and supports retrying the new version",async()=>{
  acceptAndAnimate("char","sheet");await drain();
  const {db}=getDatabase();const before=db.select().from(characters).where(eq(characters.id,"char")).get()!;
  const result=regenerateAction("char","walk"),queue=new JobQueue();
  const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const strip=queue.claim("test")!;state.generate.mockRejectedValueOnce(new Error("Backend temporarily unavailable"));
  await expect(runAnimationJob(strip,queue)).rejects.toThrow("temporarily unavailable");queue.fail(strip.id,new Error("Backend temporarily unavailable"));
  expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.manifestJson).toBe(before.manifestJson);
  queue.recoverStale();queue.recoverStale();retryAnimations("char");await drain();
  expect(db.select().from(actionVersions).where(eq(actionVersions.id,result.versionId)).get()!.status).toBe("ready");
  expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.status).toBe("ready");
});
it("validates action ownership and current sheet acceptance before regenerating",async()=>{
  expect(()=>regenerateAction("missing","walk")).toThrow("Character not found");
  expect(()=>regenerateAction("char","walk")).toThrow("Action not found");
  acceptAndAnimate("char","sheet");await drain();
  getDatabase().db.update(characterSheets).set({status:"ready"}).where(eq(characterSheets.id,"sheet")).run();
  expect(()=>regenerateAction("char","walk")).toThrow("Accept the current sheet");
});

it("uses full-resolution identity and guide images without a logical-height runtime anchor",async()=>{
  const {db}=getDatabase();const current=db.select().from(characterSheets).where(eq(characterSheets.id,"sheet")).get()!;
  const old=await readAsset(current.processedAssetId!);const full=await sharp(old!.bytes).resize(1536,512,{kernel:"nearest"}).png().toBuffer();
  const source=await saveAsset(full,{characterId:"char",kind:"sheet_transparent",mime:"image/png",width:1536,height:512});
  db.update(characterSheets).set({processedAssetId:source.id}).where(eq(characterSheets.id,"sheet")).run();
  db.update(characters).set({styleJson:JSON.stringify({chromaKey:"#FF00FF",logicalHeight:128})}).where(eq(characters.id,"char")).run();
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const job=queue.claim("test")!;await runAnimationJob(job,queue);queue.complete(job.id);
  const sheet=db.select().from(characterSheets).where(eq(characterSheets.id,"sheet")).get()!;
  const identities=JSON.parse(sheet.anchorsJson);
  expect(JSON.parse(sheet.viewsJson)._runtimeAnchors).toBeUndefined();
  const identity=await readAsset(identities.right);
  expect((await sharp(identity!.bytes).metadata()).height).toBe(400);
  await runAnimationJob(queue.claim("test")!,queue);
  expect(state.generate.mock.calls[0][0].references[0]).toEqual(identity!.bytes);const guide=await sharp(state.generate.mock.calls[0][0].references[1]).metadata();expect(guide.height).toBe(Math.ceil(400/0.88));
});

it("stores high-detail strip pixels unchanged and carries their native dimensions into the atlas",async()=>{
  acceptAndAnimate("char","sheet");const queue=new JobQueue();const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const strip=queue.claim("test")!;const width=640,height=256,data=new Uint8Array(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set([255,0,255,255],i);
  for(let f=0;f<4;f++)for(let y=18;y<238;y++)for(let x=f*160+40;x<f*160+120;x++)data.set([20+(x%80),150+(y%100),20,255],(y*width+x)*4);
  const raw=await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();
  state.generate.mockResolvedValueOnce({png:raw,raw:{native:true}});await runAnimationJob(strip,queue);queue.complete(strip.id);
  const version=getDatabase().db.select().from(actionVersions).where(eq(actionVersions.id,strip.actionVersionId!)).get()!;
  const frames=JSON.parse(version.framesJson).right;
  expect(frames[0].w).toBe(82);expect(frames[0].h).toBe(222);
  const asset=await readAsset(frames[0].assetId);const decoded=await sharp(asset!.bytes).ensureAlpha().raw().toBuffer();
  const colors=new Set<string>();
  for(let y=0;y<220;y++)for(let x=0;x<80;x++){
    const target=((y+1)*82+x+1)*4,source=((y+18)*640+x+40)*4;
    expect([...decoded.slice(target,target+4)]).toEqual([...data.slice(source,source+4)]);colors.add(decoded.slice(target,target+3).toString());
  }
  expect(colors.size).toBeGreaterThan(24);await drain();
  const manifest=manifestSchema.parse(JSON.parse(getDatabase().db.select().from(characters).where(eq(characters.id,"char")).get()!.manifestJson!));
  expect(manifest.actions.idle.directions.right!.frames![0].h).toBe(222);expect(manifest.actions.idle.directions.right!.frames![0].scale).toBeGreaterThan(0);
});

it("restores saved raw strips into a new native version without any model call",async()=>{
  acceptAndAnimate("char","sheet");await drain();
  const {db}=getDatabase();const before=db.select().from(characters).where(eq(characters.id,"char")).get()!;
  const style=JSON.parse(before.styleJson);style.chromaKey="#00FF00";db.update(characters).set({styleJson:JSON.stringify(style)}).where(eq(characters.id,"char")).run();
  const calls=state.generate.mock.calls.length;
  const result=regenerateAction("char","walk","reprocess");expect(result.imageCalls).toBe(0);
  await drain();expect(state.generate).toHaveBeenCalledTimes(calls);
  const version=db.select().from(actionVersions).where(eq(actionVersions.id,result.versionId)).get()!;
  expect(JSON.parse(version.framesJson).right.every((frame:{scale?:number})=>frame.scale!==undefined)).toBe(true);
  expect(db.select().from(characters).where(eq(characters.id,"char")).get()!.atlasVersion).toBe(before.atlasVersion+1);
});
it("never calls the model if a cached-only strip image is missing",async()=>{
  acceptAndAnimate("char","sheet");await drain();const calls=state.generate.mock.calls.length;
  const result=regenerateAction("char","walk","reprocess"),queue=new JobQueue();
  const prepare=queue.claim("test")!;await runAnimationJob(prepare,queue);queue.complete(prepare.id);
  const version=getDatabase().db.select().from(actionVersions).where(eq(actionVersions.id,result.versionId)).get()!;
  const raw=await readAsset(JSON.parse(version.stripsJson).right[0].rawAssetId);
  const {unlinkSync}=await import("node:fs"),{assetPath}=await import("../src/server/storage/assets");unlinkSync(assetPath(raw!.asset.path));
  await expect(runAnimationJob(queue.claim("test")!,queue)).rejects.toThrow(/missing/);expect(state.generate).toHaveBeenCalledTimes(calls);
});

it("reads legacy plans and limits their regenerated versions to four frames",async()=>{
  acceptAndAnimate("char","sheet");await drain();
  const {db}=getDatabase();
  const {actions}=await import("../src/server/db/schema");
  const walk=db.select().from(actions).all().find(action=>action.key==="walk")!;
  const version=db.select().from(actionVersions).where(eq(actionVersions.id,walk.activeVersionId!)).get()!;
  const plan=JSON.parse(version.planJson);plan.frames=6;plan.poses.push("extra pose","last pose");plan.durationsMs.push(100,100);
  db.update(actionVersions).set({planJson:JSON.stringify(plan)}).where(eq(actionVersions.id,version.id)).run();
  expect(()=>getCharacter("char")).not.toThrow();
  const result=regenerateAction("char","walk");
  const next=db.select().from(actionVersions).where(eq(actionVersions.id,result.versionId)).get()!;
  expect(JSON.parse(next.planJson).frames).toBe(4);
  expect(JSON.parse(db.select().from(actionVersions).where(eq(actionVersions.id,version.id)).get()!.planJson).frames).toBe(6);
  await drain();
});

it("plans only after acceptance and adds a custom action while preserving default animations",async()=>{
  state.chat.mockImplementation(request=>new FakeProvider().chat(request));
  await expect(planCustomAction("char","spin with a sword")).rejects.toThrow(/Accept/);
  expect(state.chat).not.toHaveBeenCalled();
  acceptAndAnimate("char","sheet");await drain();
  const before=getCharacter("char")!;
  const preview=await planCustomAction("char","spin with a sword");
  expect(preview.action.plan.summary).toBe("spin with a sword");expect(preview.imageCalls).toBe(1);
  expect(()=>createCustomAction("char","stale",preview.action)).toThrow(/Refresh/);
  const result=createCustomAction("char",preview.sheetId,preview.action);
  expect(()=>createCustomAction("char",preview.sheetId,preview.action)).toThrow(/progress/);
  await drain();
  const after=getCharacter("char")!;
  expect(after.manifest!.actions[result.key].directions.right?.frames).toHaveLength(4);
  expect(after.manifest!.actions.walk).toEqual(before.manifest!.actions.walk);
  expect(after.animation!.actions.find(action=>action.key===result.key)?.status).toBe("ready");
  expect(()=>createCustomAction("char",preview.sheetId,preview.action)).toThrow(/already exists/);
});

it("finishes Idle first and supplies its matching frame to every basic movement",async()=>{
  acceptAndAnimate("char","sheet");
  await drain();
  const {actions}=await import("../src/server/db/schema");
  const {db}=getDatabase();
  const idle=db.select().from(actions).all().find(action=>action.key==="idle")!;
  const version=db.select().from(actionVersions).where(eq(actionVersions.id,idle.activeVersionId!)).get()!;
  const idleAsset=await readAsset(JSON.parse(version.framesJson).right[0].assetId);
  expect(state.generate.mock.calls[0][0].prompt).toContain("performing Idle");
  for(const [request] of state.generate.mock.calls){
    expect(request.prompt).toContain("NO WEAPON USE");
    if(request.prompt.includes("performing Idle"))continue;
    expect(request.prompt).toContain("IDLE FOUNDATION");
    expect(request.references.at(-1)).toEqual(idleAsset!.bytes);
  }
  const firstWalk=state.generate.mock.calls.find(([request])=>request.prompt.includes("performing a smooth, continuous Walk cycle"))![0];
  expect(firstWalk.prompt).toContain("ANTI-STUTTER RULE");
  expect(firstWalk.prompt).toContain("Contact A — NEAR-SIDE LEG IN FRONT");
  const walk=db.select().from(actions).all().find(action=>action.key==="walk")!;
  const oldVersion=db.select().from(actionVersions).where(eq(actionVersions.id,walk.activeVersionId!)).get()!;
  const oldPlan=JSON.parse(oldVersion.planJson);
  db.update(actionVersions).set({planJson:JSON.stringify({...oldPlan,frames:2,poses:["old pose A","old pose B"],durationsMs:[100,100]})}).where(eq(actionVersions.id,oldVersion.id)).run();
  const calls=state.generate.mock.calls.length;
  regenerateAction("char","walk");await drain();
  const regenerated=state.generate.mock.calls[calls][0];
  expect(regenerated.references.at(-1)).toEqual(idleAsset!.bytes);
  expect(regenerated.prompt).toContain("Frame count: 4");
  expect(regenerated.prompt).toContain("ANTI-STUTTER RULE");
  expect(regenerated.prompt).toContain("Contact A — NEAR-SIDE LEG IN FRONT");
  expect(regenerated.prompt).not.toContain("old pose A");
});

it("passes wide canvas dimensions and two-frame batches through generation to the manifest",async()=>{
  acceptAndAnimate("char","sheet");await drain();
  state.chat.mockImplementation(async request=>{
    const result=await new FakeProvider().chat(request);
    const action=JSON.parse(result.text);action.plan.canvas="wide";
    return {text:JSON.stringify(action)};
  });
  const preview=await planCustomAction("char","horizontal sword slash");
  expect(preview.imageCalls).toBe(2);
  state.generate.mockClear();
  const result=createCustomAction("char",preview.sheetId,preview.action);await drain();
  expect(state.generate).toHaveBeenCalledTimes(2);
  for(const [request] of state.generate.mock.calls){
    expect(request.prompt).toContain("CANVAS: wide");
    expect(request.prompt).toContain("BASIC-ACTION SIZE FOUNDATION");
    const idle=getCharacter("char")!.manifest!.actions.idle.directions.right!.frames![0];
    const sizeReference=await sharp(request.references[request.references.length-1]).metadata();
    expect(sizeReference.width).toBe(Math.round((idle.w-2)*(idle.scale??1)));
    expect(sizeReference.height).toBe(Math.round((idle.h-2)*(idle.scale??1)));
    expect(request.prompt).toContain("Frame count: 2");
    const guide=await sharp(request.references[1]).metadata();
    expect(request.size).toEqual([guide.width,guide.height]);
  }
  const character=getCharacter("char")!;
  expect(character.manifest!.actions[result.key].directions.right?.frames).toHaveLength(4);
});

it("retries edge-clipped wide strips and accepts persistent contact with a QA warning",async()=>{
  acceptAndAnimate("char","sheet");await drain();
  state.chat.mockImplementation(async request=>{
    const result=await new FakeProvider().chat(request),action=JSON.parse(result.text);
    action.plan.canvas="wide";return {text:JSON.stringify(action)};
  });
  const preview=await planCustomAction("char","sword slash");
  state.generate.mockClear();
  let generated=0;
  state.generate.mockImplementation(async request=>{
    const result=await new FakeProvider().generate(request);
    if(++generated>1){
      const {data,info}=await sharp(result.png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      data.set([0,0,0,255],(30*info.width)*4);
      result.png=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
    }
    return result;
  });
  const result=createCustomAction("char",preview.sheetId,preview.action);await drain();
  const [,initial,retry]=state.generate.mock.calls.map(call=>call[0]);
  expect(retry.size[0]).toBeGreaterThan(initial.size[0]);
  expect(retry.size[1]).toBeGreaterThan(initial.size[1]);
  expect(retry.prompt).toContain("CORRECTION REQUIRED");
  expect(retry.prompt).toContain("touches a slot edge");
  const guide=await sharp(retry.references[1]).metadata();
  expect(retry.size).toEqual([guide.width,guide.height]);
  const frames=getCharacter("char")!.manifest!.actions[result.key].directions.right!.frames!;
  expect(new Set(frames.map(frame=>frame.scale)).size).toBe(1);
  state.generate.mockClear();
  regenerateAction("char",result.key,"reprocess");await drain();
  expect(state.generate).not.toHaveBeenCalled();
  const reprocessed=getCharacter("char")!.manifest!.actions[result.key].directions.right!.frames!;
  expect(reprocessed.map(frame=>frame.scale)).toEqual(frames.map(frame=>frame.scale));
});
