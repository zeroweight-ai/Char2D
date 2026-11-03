import "server-only";
import { SHEET_RESOLUTION } from "@/lib/resolution";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { characters, characterSheets, jobs } from "../db/schema";
import { provider } from "../ai";
import { JobQueue, type Job } from "../jobs/queue";
import { readAsset, saveAsset } from "../storage/assets";
import { planRevision, referenceForRevision, sheetJobPayloadSchema } from "../ai/revision";
import { revisionSheetPrompt } from "./prompts/sheet";
import { chooseChromaKey, sampleColors, removeChroma, cleanSpriteAlpha } from "../pixel/chroma";
import { extractPoses } from "./frames";
import { styleSchema } from "@/lib/character";
export async function generateSheet(job:Job,queue:JobQueue) {
  const payload=sheetJobPayloadSchema.parse(JSON.parse(job.payloadJson));
  const {sheetId}=payload;
  const {db}=getDatabase();
  const sheet=db.select().from(characterSheets).where(eq(characterSheets.id,sheetId)).get();
  if(!sheet || sheet.characterId!==job.characterId) throw new Error("Sheet not found");
  const character=db.select().from(characters).where(eq(characters.id,sheet.characterId)).get();
  if(!character) throw new Error("Character not found");
  const style=styleSchema.parse(JSON.parse(character.styleJson));
  try {
    if(payload.reprocess&&(!sheet.rawAssetId||!await readAsset(sheet.rawAssetId)))throw new Error("The saved raw sheet is missing. Reprocessing cannot generate a replacement image.");
    if(payload.generation)style.chromaKey=payload.generation.chromaKey;
    if(payload.processingKey)style.chromaKey=payload.processingKey;
    let prompt=sheet.prompt;
    let referenceAssetId=character.sourceAssetId;
    if(payload.revision) {
      if(!payload.generation) {
        queue.event(job.id,"progress",{progress:5,message:"Choosing how to apply your revision"});
        const decision=await planRevision(provider,{description:character.description,note:payload.revision.note,hasLatest:!!payload.revision.latestAssetId,hasOriginalUpload:!!character.sourceAssetId});
        referenceAssetId=referenceForRevision(decision.path,payload.revision.latestAssetId,character.sourceAssetId);
        let samples:ReturnType<typeof sampleColors>=style.colorSamples ?? [];
        if(decision.path==="edit_latest") {
          const latest=await readAsset(referenceAssetId!);
          if(!latest || latest.asset.characterId!==character.id) throw new Error("Latest sheet reference not found for this character");
          // Include all colors retained by earlier revisions when choosing a new key.
          samples=sampleColors(await sharp(latest.bytes).resize(128,128,{fit:"inside"}).ensureAlpha().raw().toBuffer());
        }
        const key=chooseChromaKey(samples,`${character.description} ${payload.revision.note}`);
        prompt=revisionSheetPrompt(character.description,key,payload.revision.note,decision.path,!!referenceAssetId,style.logicalHeight);
        payload.generation={...decision,referenceAssetId,chromaKey:key};
        // Persist the decision, reference and prompt before image generation. A
        // restarted worker must not switch reference images or choose a new path.
        getDatabase().sqlite.transaction(()=>{
          db.update(jobs).set({payloadJson:JSON.stringify(payload)}).where(eq(jobs.id,job.id)).run();
          db.update(characterSheets).set({prompt}).where(eq(characterSheets.id,sheetId)).run();
          db.update(characters).set({styleJson:JSON.stringify({...style,chromaKey:key}),updatedAt:Date.now()}).where(eq(characters.id,character.id)).run();
        }).immediate();
      }
      referenceAssetId=payload.generation.referenceAssetId;
      style.chromaKey=payload.generation.chromaKey;
      queue.event(job.id,"revision_plan",{progress:10,path:payload.generation.path,message:payload.generation.path==="edit_latest" ? "Editing your latest sheet":"Generating a fresh sheet",reason:payload.generation.reason});
    }
    queue.event(job.id,"progress",{progress:15,message:"Choosing a contrasting background"});
    db.update(characterSheets).set({status:"generating"}).where(eq(characterSheets.id,sheetId)).run();
    let raw=sheet.rawAssetId ? await readAsset(sheet.rawAssetId):null;
    if(payload.reprocess&&!raw)throw new Error("The saved raw sheet is missing; no new image was generated.");
    if(!raw) {
      const source=referenceAssetId ? await readAsset(referenceAssetId):null;
      if(referenceAssetId && (!source || source.asset.characterId!==character.id)) throw new Error("Generation reference image not found for this character");
      queue.event(job.id,"progress",{progress:25,message:"Generating pixel-art character sheet"});
      const generated=await provider.generate({prompt,references:source ? [source.bytes]:undefined,size:[SHEET_RESOLUTION.width,SHEET_RESOLUTION.height]});
      const metadata=await sharp(generated.png,{limitInputPixels:24_000_000}).metadata();
      const asset=await saveAsset(generated.png,{characterId:character.id,kind:"sheet_raw",mime:"image/png",width:metadata.width,height:metadata.height});
      db.update(characterSheets).set({rawAssetId:asset.id}).where(eq(characterSheets.id,sheetId)).run();
      await saveAsset(Buffer.from(JSON.stringify(generated.raw)),{characterId:character.id,kind:"sheet_response",mime:"application/json"});
      raw={asset:{...asset,characterId:character.id,width:metadata.width ?? null,height:metadata.height ?? null},bytes:generated.png};
    }
    queue.event(job.id,"progress",{progress:70,message:"Removing the background"});
    const {data,info}=await sharp(raw.bytes,{limitInputPixels:24_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const result=removeChroma(data,info.width,info.height,style.chromaKey);
    const png=await sharp(cleanSpriteAlpha(result.rgba),{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
    queue.event(job.id,"progress",{progress:85,message:"Validating the full-resolution transparent sheet"});
    const extracted=await extractPoses(png,3);
    if(extracted.warnings.length)queue.event(job.id,"qa",{warnings:extracted.warnings});
    // Review and identity images retain the provider's dimensions and colors.
    // Action references and extracted frames also retain native pixels.
    const processed=await saveAsset(png,{characterId:character.id,kind:"sheet_transparent",mime:"image/png",width:info.width,height:info.height});
    const views={...JSON.parse(sheet.viewsJson),_sheetProcessing:{version:2,fullResolution:true,width:info.width,height:info.height}};
    delete views._design;delete views._runtimeAnchors;
    db.update(characterSheets).set({processedAssetId:processed.id,viewsJson:JSON.stringify(views),anchorsJson:"{}",status:payload.keepAccepted?"accepted":"ready"}).where(eq(characterSheets.id,sheetId)).run();
    db.update(characters).set({status:payload.keepAccepted&&character.manifestJson?"ready":"draft",updatedAt:Date.now()}).where(eq(characters.id,character.id)).run();
    queue.event(job.id,"result",{progress:95,message:"Transparent sheet ready for review",assetId:processed.id});
  } catch(error) {
    const preserveAccepted=payload.keepAccepted&&!!sheet.processedAssetId;
    db.update(characterSheets).set({status:preserveAccepted?"accepted":"error"}).where(eq(characterSheets.id,sheetId)).run();
    db.update(characters).set({status:preserveAccepted?(character.manifestJson?"ready":"draft"):"error",updatedAt:Date.now()}).where(eq(characters.id,character.id)).run();
    throw error;
  }
}
