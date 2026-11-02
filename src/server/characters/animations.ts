import "server-only";
import { and,desc,eq,inArray,sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDatabase } from "../db";
import { actions,actionVersions,characters,characterSheets,jobs } from "../db/schema";
import { JobQueue } from "../jobs/queue";
import { storedActionPlanSchema,limitActionPlan,directionSchema } from "@/lib/manifest";
import { z } from "zod";
import { defaultPresets } from "../pipeline/presets";
import { stripsSchema } from "../pipeline/animation-types";
import { estimateStripCalls } from "../pipeline/estimate";
import { styleSchema } from "@/lib/character";
export class AnimationError extends Error {constructor(message:string,public status=409){super(message);}}
export function acceptAndAnimate(characterId:string,sheetId:string) {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character)throw new AnimationError("Character not found",404);
    const sheet=db.select().from(characterSheets).where(and(eq(characterSheets.id,sheetId),eq(characterSheets.characterId,characterId))).get();
    if(character.sheetId!==sheetId||!sheet?.processedAssetId||!["ready","accepted"].includes(sheet.status))throw new AnimationError("This sheet is not ready or has been replaced. Refresh and review the latest sheet.");
    const existing=db.select().from(jobs).where(and(eq(jobs.characterId,characterId),eq(jobs.type,"compose_atlas"),sql`json_extract(${jobs.payloadJson}, '$.sheetId') = ${sheetId}`)).get();
    if(existing)return {jobId:existing.id,alreadyQueued:true};
    const busy=db.select().from(jobs).where(and(eq(jobs.characterId,characterId),inArray(jobs.status,["queued","running"]))).get();
    if(busy)throw new AnimationError("Character generation is still in progress.");
    const style=styleSchema.parse(JSON.parse(character.styleJson));
    const queue=new JobQueue();
    const prepare=queue.enqueue("process_action",{sheetId,stage:"prepare"},{characterId,maxAttempts:1});
    const done:string[]=[],versionIds:string[]=[];
    let idleVersionId:string|undefined,idleFinished:string|undefined;
    const defaults=defaultPresets(character.viewType,style.mirrorLeft);
    defaults.forEach((preset,order)=>{
      let action=db.select().from(actions).where(and(eq(actions.characterId,characterId),eq(actions.key,preset.key))).get();
      if(!action){const id=nanoid();db.insert(actions).values({id,characterId,key:preset.key,label:preset.label,isDefault:true,directionsJson:JSON.stringify(preset.directions),gameplayJson:JSON.stringify(preset.gameplay),sortOrder:order,createdAt:Date.now(),updatedAt:Date.now()}).run();action=db.select().from(actions).where(eq(actions.id,id)).get()!;}
      db.update(actions).set({directionsJson:JSON.stringify(preset.directions)}).where(eq(actions.id,action.id)).run();
      const previous=db.select().from(actionVersions).where(eq(actionVersions.actionId,action.id)).orderBy(desc(actionVersions.version)).get();
      const versionId=nanoid();versionIds.push(versionId);
      db.insert(actionVersions).values({id:versionId,actionId:action.id,version:(previous?.version??0)+1,parentVersionId:action.activeVersionId,planJson:JSON.stringify(preset.plan),status:"queued",createdBy:"default",createdAt:Date.now()}).run();
      const strips=preset.directions.map(direction=>queue.enqueue("strip",{sheetId,versionId,direction,idleVersionId},{characterId,actionVersionId:versionId,dependsOn:[prepare,...(idleFinished?[idleFinished]:[])],maxAttempts:1}));
      done.push(queue.enqueue("process_action",{sheetId,versionId,stage:"finish"},{characterId,actionVersionId:versionId,dependsOn:strips,maxAttempts:1}));
      if(preset.key==="idle"){idleVersionId=versionId;idleFinished=done[done.length-1];}
    });
    const jobId=queue.enqueue("compose_atlas",{sheetId,versionIds},{characterId,dependsOn:done,maxAttempts:1});
    db.update(characterSheets).set({status:"accepted"}).where(eq(characterSheets.id,sheetId)).run();
    db.update(characters).set({status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return {jobId,alreadyQueued:false};
  }).immediate();
}
export function retryAnimations(characterId:string) {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character)throw new AnimationError("Character not found",404);
    const sheet=character.sheetId?db.select().from(characterSheets).where(eq(characterSheets.id,character.sheetId)).get():null;
    if(sheet?.status!=="accepted")throw new AnimationError("Accept a sheet first.");
    const graph=db.select().from(jobs).where(and(eq(jobs.characterId,characterId),sql`json_extract(${jobs.payloadJson}, '$.sheetId') = ${sheet.id}`,inArray(jobs.type,["strip","process_action","compose_atlas"]))).all().filter(job=>JSON.parse(job.payloadJson).retired!==true);
    if(graph.some(job=>job.status==="running"))throw new AnimationError("Animation jobs are still running. Wait for them to finish before retrying.");
    const failed=graph.filter(job=>job.status==="error"||job.status==="cancelled");
    if(!failed.length)throw new AnimationError("There are no failed animation jobs to retry.");
    for(const job of failed) {
      db.update(jobs).set({status:"queued",error:null,lockedAt:null,lockedBy:null,attempts:0,runAfter:Date.now(),updatedAt:Date.now()}).where(eq(jobs.id,job.id)).run();
      if(job.actionVersionId)db.update(actionVersions).set({status:"queued",error:null}).where(eq(actionVersions.id,job.actionVersionId)).run();
    }
    db.update(characters).set({status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return {ok:true};
  }).immediate();
}

export function regenerateAction(characterId:string,key:string,mode:"generate"|"reprocess"="generate") {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character)throw new AnimationError("Character not found",404);
    const action=db.select().from(actions).where(and(eq(actions.characterId,characterId),eq(actions.key,key))).get();
    if(!action)throw new AnimationError("Action not found",404);
    const sheet=character.sheetId?db.select().from(characterSheets).where(and(eq(characterSheets.id,character.sheetId),eq(characterSheets.characterId,characterId))).get():null;
    if(sheet?.status!=="accepted"||!sheet.processedAssetId)throw new AnimationError("Accept the current sheet before regenerating actions.");
    if(db.select().from(jobs).where(and(eq(jobs.characterId,characterId),inArray(jobs.status,["queued","running"]))).get())throw new AnimationError("Generation is already in progress. Wait for it to finish.");
    const latest=db.select().from(actionVersions).where(eq(actionVersions.actionId,action.id)).orderBy(desc(actionVersions.version)).get();
    const active=action.activeVersionId?db.select().from(actionVersions).where(and(eq(actionVersions.id,action.activeVersionId),eq(actionVersions.actionId,action.id),eq(actionVersions.status,"ready"))).get():null;
    const previous=active??latest;
    if(!previous)throw new AnimationError("This action has no generation plan.");
    const savedPlan=JSON.parse(previous.planJson);
    const plan=mode==="reprocess"?storedActionPlanSchema.parse(savedPlan):key==="walk"?defaultPresets(character.viewType).find(preset=>preset.key==="walk")!.plan:limitActionPlan(savedPlan);
    const directions=z.array(directionSchema).min(1).parse(JSON.parse(action.directionsJson));
    if(mode==="reprocess") {
      const saved=stripsSchema.parse(JSON.parse(previous.stripsJson));
      for(const direction of directions)if(!saved[direction]?.some(strip=>!strip.invalid))throw new AnimationError(`No saved ${direction} strips are available for local processing.`);
    }
    const historicalIds=new Set(db.select().from(actionVersions).where(eq(actionVersions.actionId,action.id)).all().map(v=>v.id));
    for(const job of db.select().from(jobs).where(eq(jobs.characterId,characterId)).all()) {
      if(job.status!=="error"&&job.status!=="cancelled")continue;
      if(job.type!=="compose_atlas"&&(!job.actionVersionId||!historicalIds.has(job.actionVersionId)))continue;
      const payload=JSON.parse(job.payloadJson);payload.retired=true;
      db.update(jobs).set({payloadJson:JSON.stringify(payload)}).where(eq(jobs.id,job.id)).run();
    }
    const versionId=nanoid();
    db.insert(actionVersions).values({id:versionId,actionId:action.id,version:(latest?.version??0)+1,parentVersionId:previous.id,planJson:JSON.stringify(plan),stripsJson:mode==="reprocess"?previous.stripsJson:"{}",status:"queued",createdBy:"manual",createdAt:Date.now()}).run();
    const queue=new JobQueue();
    const prepare=queue.enqueue("process_action",{sheetId:sheet.id,stage:"prepare"},{characterId,maxAttempts:1});
    const strips=[...new Set(directions)].map(direction=>queue.enqueue("strip",{sheetId:sheet.id,versionId,direction,rawOnly:mode==="reprocess"},{characterId,actionVersionId:versionId,dependsOn:[prepare],maxAttempts:1}));
    const finish=queue.enqueue("process_action",{sheetId:sheet.id,versionId,stage:"finish"},{characterId,actionVersionId:versionId,dependsOn:strips,maxAttempts:1});
    const versionIds=db.select().from(actions).where(eq(actions.characterId,characterId)).orderBy(actions.sortOrder,actions.createdAt).all().flatMap(item=>{
      if(item.id===action.id)return [versionId];
      const ready=item.activeVersionId?db.select().from(actionVersions).where(and(eq(actionVersions.id,item.activeVersionId),eq(actionVersions.actionId,item.id),eq(actionVersions.status,"ready"))).get():null;
      const fallback=ready??db.select().from(actionVersions).where(and(eq(actionVersions.actionId,item.id),eq(actionVersions.status,"ready"))).orderBy(desc(actionVersions.version)).get();
      return fallback?[fallback.id]:[];
    });
    const jobId=queue.enqueue("compose_atlas",{sheetId:sheet.id,versionIds},{characterId,dependsOn:[finish],maxAttempts:1});
    // Keep the current manifest and active pointer intact until publication.
    db.update(characters).set({status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return {jobId,versionId,imageCalls:mode==="reprocess"?0:estimateStripCalls(sheet,plan.frames,directions,plan.canvas)};
  }).immediate();
}
