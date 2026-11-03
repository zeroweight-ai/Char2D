import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDatabase } from "../db";
import { characters, characterSheets, jobs, actions, actionVersions, assets } from "../db/schema";
import { JobQueue } from "../jobs/queue";
import { estimateStripCalls } from "../pipeline/estimate";
import { limitActionPlan,directionSchema } from "@/lib/manifest";
import { z } from "zod";
import { gameplaySchema,manifestSchema } from "@/lib/manifest";
import { getBindings } from "./controls";
import { framesSchema } from "../pipeline/animation-types";
import { styleSchema } from "@/lib/character";
import { sheetJobPayloadSchema } from "../ai/revision";
import { chooseChromaKey } from "../pixel/chroma";
import { sheetPrompt } from "../pipeline/prompts/sheet";
import { parseSoundState } from "@/lib/sound";
import { soundAvailable } from "../ai/sound";
export function getCharacter(id:string) {
  const {db}=getDatabase();
  const character=db.select().from(characters).where(eq(characters.id,id)).get();
  if(!character) return null;
  const sheet=character.sheetId ? db.select().from(characterSheets).where(and(eq(characterSheets.id,character.sheetId),eq(characterSheets.characterId,id))).get() : null;
  const rawMeta=sheet?.rawAssetId?db.select({width:assets.width,height:assets.height}).from(assets).where(eq(assets.id,sheet.rawAssetId)).get():null;
  const processedMeta=sheet?.processedAssetId?db.select({width:assets.width,height:assets.height}).from(assets).where(eq(assets.id,sheet.processedAssetId)).get():null;
  const fullResolution=!!sheet?.processedAssetId&&(rawMeta?.width&&rawMeta.height&&processedMeta?.width&&processedMeta.height ? rawMeta.width===processedMeta.width&&rawMeta.height===processedMeta.height : JSON.parse(sheet.viewsJson)._sheetProcessing?.fullResolution===true);
  const job=db.select().from(jobs).where(and(eq(jobs.characterId,id),eq(jobs.type,"sheet"))).orderBy(desc(jobs.createdAt)).get();
  const sheetWarnings=job?(getDatabase().sqlite.prepare("SELECT data_json FROM job_events WHERE job_id=? AND kind='qa'").all(job.id) as {data_json:string}[]).flatMap(row=>{const value=JSON.parse(row.data_json);return Array.isArray(value.warnings)?value.warnings.filter((w:unknown)=>typeof w==="string"):[];}):[];
  const payload=job ? sheetJobPayloadSchema.safeParse(JSON.parse(job.payloadJson)):null;
  const animationJobs=sheet?db.select().from(jobs).where(and(eq(jobs.characterId,id),inArray(jobs.type,["strip","process_action","compose_atlas"]),sql`json_extract(${jobs.payloadJson}, '$.sheetId') = ${sheet.id}`,sql`coalesce(json_extract(${jobs.payloadJson}, '$.retired'), 0) = 0`)).all():[];
  const actionList=db.select().from(actions).where(eq(actions.characterId,id)).orderBy(actions.sortOrder,actions.createdAt).all().map(action=>{
    const version=db.select().from(actionVersions).where(eq(actionVersions.actionId,action.id)).orderBy(desc(actionVersions.version)).get();
    const history=db.select({id:actionVersions.id,version:actionVersions.version,status:actionVersions.status,createdBy:actionVersions.createdBy,createdAt:actionVersions.createdAt}).from(actionVersions).where(eq(actionVersions.actionId,action.id)).orderBy(actionVersions.version).all();
    const active=history.find(item=>item.id===action.activeVersionId);
    const sound=parseSoundState(action.soundJson);
    return {sound:{status:sound.status??"undecided",reason:sound.reason??null,prompt:sound.prompt??null,url:sound.status==="none"?null:sound.builtin??(sound.assetId?`/api/assets/${sound.assetId}`:null),frames:sound.frames??[],error:sound.error??null,requestedBy:sound.requestedBy??null},activeVersionId:action.activeVersionId,activeVersion:active?.version??null,versions:history,gameplay:gameplaySchema.parse(JSON.parse(action.gameplayJson)),nativeResolution:version?Object.values(framesSchema.parse(JSON.parse(version.framesJson))).flat().every(frame=>frame.scale!==undefined)&&Object.keys(JSON.parse(version.framesJson)).length>0:false,imageCalls:version&&sheet?estimateStripCalls(sheet,limitActionPlan(JSON.parse(version.planJson)).frames,z.array(directionSchema).parse(JSON.parse(action.directionsJson)),limitActionPlan(JSON.parse(version.planJson)).canvas):0,key:action.key,label:action.label,status:version?.status??"queued",version:version?.version??0,error:version?.error??null,frames:version?framesSchema.parse(JSON.parse(version.framesJson)):{} };
  });
  const warnings=animationJobs.flatMap(job=>getDatabase().sqlite.prepare("SELECT data_json FROM job_events WHERE job_id=? AND kind='qa'").all(job.id) as {data_json:string}[]).flatMap(row=>{const value=JSON.parse(row.data_json);return Array.isArray(value.warnings)?value.warnings.filter((w:unknown)=>typeof w==="string"):[];});
  return {id:character.id,name:character.name,description:character.description,status:character.status,sourceAssetId:character.sourceAssetId,
    sheet:sheet ? {fullResolution,warnings:sheetWarnings as string[],id:sheet.id,status:sheet.status,rawAssetId:sheet.rawAssetId,processedAssetId:sheet.processedAssetId,version:sheet.version}:null,
    manifest:character.manifestJson?manifestSchema.parse(JSON.parse(character.manifestJson)):null,
    animation:animationJobs.length?{total:animationJobs.length,done:animationJobs.filter(j=>j.status==="done").length,running:animationJobs.filter(j=>j.status==="running"||j.status==="queued").length,error:animationJobs.find(j=>j.error&&j.error!=="Dependency failed")?.error??animationJobs.find(j=>j.status==="error")?.error??null,warnings:[...new Set(warnings)] as string[],actions:actionList}:null,
    bindings:actionList.length?getBindings(id):{p1:{},p2:{}},
    soundAvailable:soundAvailable(),
    job:job ? {id:job.id,status:job.status,error:job.error,revision:payload?.success ? payload.data.generation ?? null:null}:null};
}
export function queueSheet(characterId:string,note="",isRevision=false) {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(() => {
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character) throw new Error("Character not found");
    const busy=db.select().from(jobs).where(and(eq(jobs.characterId,characterId),ne(jobs.type,"sound"),inArray(jobs.status,["queued","running"]))).get();
    if(busy) throw new Error("A sheet is already being generated");
    const last=db.select().from(characterSheets).where(eq(characterSheets.characterId,characterId)).orderBy(desc(characterSheets.version)).get();
    const latest=isRevision ? db.select().from(characterSheets).where(and(eq(characterSheets.characterId,characterId),isNotNull(characterSheets.processedAssetId),inArray(characterSheets.status,["ready","accepted"]))).orderBy(desc(characterSheets.version)).get():undefined;
    const style=styleSchema.parse(JSON.parse(character.styleJson));
    style.chromaKey=chooseChromaKey(style.colorSamples ?? [],`${character.description} ${note}`);
    const id=nanoid();
    const prompt=sheetPrompt(character.description,style.chromaKey,!!character.sourceAssetId,note,style.logicalHeight);
    db.insert(characterSheets).values({id,characterId,version:(last?.version ?? 0)+1,prompt,status:"queued",createdAt:Date.now()}).run();
    db.update(characters).set({sheetId:id,styleJson:JSON.stringify(style),status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return new JobQueue().enqueue("sheet",{sheetId:id,...(isRevision ? {revision:{note,latestSheetId:latest?.id ?? null,latestAssetId:latest?.processedAssetId ?? null}}:{})},{characterId,maxAttempts:1});
  }).immediate();
}
