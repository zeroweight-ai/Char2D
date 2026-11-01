import "server-only";
import { and,desc,eq,inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import { characters,characterSheets,jobs,assets } from "../db/schema";
import { JobQueue } from "../jobs/queue";
import { sheetJobPayloadSchema } from "../ai/revision";
export class ReprocessError extends Error {constructor(message:string,public status=409){super(message);}}
export function reprocessSheet(characterId:string) {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
    if(!character)throw new ReprocessError("Character not found",404);
    const sheet=character.sheetId?db.select().from(characterSheets).where(and(eq(characterSheets.id,character.sheetId),eq(characterSheets.characterId,characterId))).get():null;
    if(!sheet?.rawAssetId||!["error","ready","accepted"].includes(sheet.status))throw new ReprocessError("There is no saved sheet to process.");
    if(!db.select().from(assets).where(and(eq(assets.id,sheet.rawAssetId),eq(assets.characterId,characterId))).get())throw new ReprocessError("The saved sheet image is missing.");
    if(db.select().from(jobs).where(and(eq(jobs.characterId,characterId),inArray(jobs.status,["queued","running"]))).get())throw new ReprocessError("Generation is already in progress.");
    const old=db.select().from(jobs).where(and(eq(jobs.characterId,characterId),eq(jobs.type,"sheet"))).orderBy(desc(jobs.createdAt)).all().find(job=>JSON.parse(job.payloadJson).sheetId===sheet.id);
    const payload=sheetJobPayloadSchema.parse(old?JSON.parse(old.payloadJson):{sheetId:sheet.id});
    const processingKey=payload.processingKey??payload.generation?.chromaKey??sheet.prompt.match(/background key:\s*(#[0-9a-f]{6})/i)?.[1]??JSON.parse(character.styleJson).chromaKey;
    // All needed context is already baked into the saved prompt/raw image.
    // Omitting revision planning prevents any model call when processing it.
    const jobId=new JobQueue().enqueue("sheet",{sheetId:payload.sheetId,reprocess:true,processingKey,keepAccepted:sheet.status==="accepted",...(payload.generation?{generation:payload.generation}:{})},{characterId,maxAttempts:1});
    db.update(characterSheets).set({status:"queued"}).where(eq(characterSheets.id,sheet.id)).run();
    db.update(characters).set({status:"generating",updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
    return {jobId};
  }).immediate();
}
