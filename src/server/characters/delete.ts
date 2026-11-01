import "server-only";
import { and,desc,eq,inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import { actions,actionVersions,assets,characters,characterSheets,jobs } from "../db/schema";
import { JobQueue } from "../jobs/queue";
import { pruneUnreferencedPaths } from "../storage/assets";
export class DeleteError extends Error {constructor(message:string,public status=409){super(message);}}
function collectAssetIds(value:unknown,result=new Set<string>()):Set<string> {
  if(Array.isArray(value)){for(const item of value)collectAssetIds(item,result);}
  else if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)) {
    if(["assetId","rawAssetId","responseAssetId","processedAssetId"].includes(key)&&typeof item==="string")result.add(item);
    else collectAssetIds(item,result);
  }
  return result;
}
function liveAssetIds() {
  const {db}=getDatabase(),live=new Set<string>();
  for(const character of db.select().from(characters).all())for(const id of [character.sourceAssetId,character.atlasAssetId])if(id)live.add(id);
  for(const sheet of db.select().from(characterSheets).all()){
    for(const id of [sheet.rawAssetId,sheet.processedAssetId])if(id)live.add(id);
    for(const id of Object.values(JSON.parse(sheet.anchorsJson)))if(typeof id==="string")live.add(id);
    for(const id of Object.values(JSON.parse(sheet.viewsJson)._runtimeAnchors??{}))if(typeof id==="string")live.add(id);
  }
  for(const version of db.select().from(actionVersions).all()){
    collectAssetIds(JSON.parse(version.framesJson),live);collectAssetIds(JSON.parse(version.stripsJson),live);
  }
  return live;
}
export function deleteCharacter(characterId:string) {
  const {db,sqlite}=getDatabase();
  const paths=sqlite.transaction(()=>{
    if(!db.select().from(characters).where(eq(characters.id,characterId)).get())throw new DeleteError("Character not found",404);
    if(db.select().from(jobs).where(and(eq(jobs.characterId,characterId),eq(jobs.status,"running"))).get())throw new DeleteError("Generation is running. Wait for it to finish before deleting this character.");
    const paths=db.select({path:assets.path}).from(assets).where(eq(assets.characterId,characterId)).all().map(a=>a.path);
    // Remove sheet references first; the character cascade removes assets,
    // actions, versions, bindings, messages, queued jobs, and job events.
    db.delete(characterSheets).where(eq(characterSheets.characterId,characterId)).run();
    db.delete(characters).where(eq(characters.id,characterId)).run();
    return paths;
  }).immediate();
  pruneUnreferencedPaths(paths);
}
export function deleteAction(characterId:string,key:string) {
  const {db,sqlite}=getDatabase();
  const result=sqlite.transaction(()=>{
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character)throw new DeleteError("Character not found",404);
    const action=db.select().from(actions).where(and(eq(actions.characterId,characterId),eq(actions.key,key))).get();
    if(!action)throw new DeleteError("Action not found",404);
    if(db.select().from(jobs).where(and(eq(jobs.characterId,characterId),inArray(jobs.status,["queued","running"]))).get())throw new DeleteError("Generation is in progress. Wait for it to finish before deleting an action.");
    const versions=db.select().from(actionVersions).where(eq(actionVersions.actionId,action.id)).all();
    const versionIds=new Set(versions.map(v=>v.id)),candidateIds=new Set<string>();
    for(const version of versions){collectAssetIds(JSON.parse(version.framesJson),candidateIds);collectAssetIds(JSON.parse(version.stripsJson),candidateIds);}
    // Old atlas/manifest snapshots contain the deleted action too. Retire them
    // and rebuild from remaining frame assets, with no model request.
    for(const asset of db.select().from(assets).where(and(eq(assets.characterId,characterId),inArray(assets.kind,["atlas","manifest"]))).all())candidateIds.add(asset.id);
    const removedJobIds=new Set(db.select().from(jobs).where(eq(jobs.characterId,characterId)).all().filter(job=>job.actionVersionId&&versionIds.has(job.actionVersionId)).map(job=>job.id));
    db.delete(actions).where(eq(actions.id,action.id)).run();
    for(const job of db.select().from(jobs).where(eq(jobs.characterId,characterId)).all()){
      const payload=JSON.parse(job.payloadJson);
      if(Array.isArray(payload.versionIds))payload.versionIds=payload.versionIds.filter((id:string)=>!versionIds.has(id));
      const retired=job.type==="compose_atlas";
      if(retired)payload.retired=true;
      db.update(jobs).set({payloadJson:JSON.stringify(payload),dependsOnJson:JSON.stringify((JSON.parse(job.dependsOnJson) as string[]).filter(id=>!removedJobIds.has(id))),...(retired?{status:"cancelled" as const,error:null}:{})}).where(eq(jobs.id,job.id)).run();
    }
    const remaining=db.select().from(actions).where(eq(actions.characterId,characterId)).orderBy(actions.sortOrder,actions.createdAt).all();
    const activeIds=remaining.flatMap(item=>{
      const active=item.activeVersionId?db.select().from(actionVersions).where(and(eq(actionVersions.id,item.activeVersionId),eq(actionVersions.status,"ready"))).get():null;
      const fallback=active??db.select().from(actionVersions).where(and(eq(actionVersions.actionId,item.id),eq(actionVersions.status,"ready"))).orderBy(desc(actionVersions.version)).get();
      return fallback?[fallback.id]:[];
    });
    db.update(characters).set({manifestJson:null,atlasAssetId:null,status:activeIds.length?"generating":"draft",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    const live=liveAssetIds(),paths:string[]=[];
    for(const id of candidateIds)if(!live.has(id)) {
      const asset=db.select().from(assets).where(and(eq(assets.id,id),eq(assets.characterId,characterId))).get();
      if(asset){paths.push(asset.path);db.delete(assets).where(eq(assets.id,id)).run();}
    }
    const jobId=activeIds.length&&character.sheetId?new JobQueue().enqueue("compose_atlas",{sheetId:character.sheetId,versionIds:activeIds},{characterId,maxAttempts:1}):null;
    return {paths,jobId};
  }).immediate();
  pruneUnreferencedPaths(result.paths);
  return {jobId:result.jobId};
}
