import "server-only";
import sharp from "sharp";
import { and,desc,eq } from "drizzle-orm";
import { z } from "zod";
import { storedActionPlanSchema,gameplaySchema,manifestSchema,type Direction,type Manifest } from "@/lib/manifest";
import { styleSchema } from "@/lib/character";
import { getDatabase } from "../db";
import { actions,actionVersions,characters,characterSheets } from "../db/schema";
import { JobQueue,type Job } from "../jobs/queue";
import { readAsset,saveAsset } from "../storage/assets";
import { provider } from "../ai";
import { chooseChromaKey,removeChroma,cleanSpriteAlpha,sampleColors } from "../pixel/chroma";
import { alignCharacterScale } from "./character-scale";
import { extractPoses,extractSlotPoses } from "./frames";
import { sameLegOrder } from "./pose-checks";
import { preserveNativeFrames,type NativePose } from "./native-frames";
import { stripGuide,stripLayout,nativeBatchSize } from "./guides";
import { sheetAnchorOrder } from "./prompts/sheet";
import { stripPrompt } from "./prompts/strip";
import { animationPayloadSchema,framesSchema,stripsSchema,type FrameRef } from "./animation-types";
const anchorsSchema=z.partialRecord(z.enum(["down","up","right","left"]),z.string());
export async function runAnimationJob(job:Job,queue:JobQueue) {
  const payload=animationPayloadSchema.parse(JSON.parse(job.payloadJson));
  const {db,sqlite}=getDatabase();
  const character=db.select().from(characters).where(eq(characters.id,job.characterId!)).get();
  const sheet=db.select().from(characterSheets).where(and(eq(characterSheets.id,payload.sheetId),eq(characterSheets.characterId,job.characterId!))).get();
  if(!character||!sheet||character.sheetId!==sheet.id||sheet.status!=="accepted")throw new Error("The accepted sheet has changed; animation jobs cannot use it.");
  const style=styleSchema.parse(JSON.parse(character.styleJson));
  const savePng=(png:Buffer,kind:string,width?:number,height?:number)=>saveAsset(png,{characterId:character.id,kind,mime:"image/png",width,height});
  const load=async(id:string)=>{const result=await readAsset(id);if(!result||result.asset.characterId!==character.id)throw new Error("Animation reference asset is missing");return result.bytes;};
  const event=(message:string,progress:number)=>queue.event(job.id,"progress",{message,progress});
  if(job.type==="process_action"&&payload.stage==="prepare") {
    if(Object.keys(anchorsSchema.parse(JSON.parse(sheet.anchorsJson))).length&&JSON.parse(sheet.viewsJson)._design?.version===5)return;
    event("Extracting direction anchors from the accepted sheet",10);
    const extracted=await extractPoses(await load(sheet.processedAssetId!),3);
    const colors=sampleColors(await sharp(await load(sheet.processedAssetId!)).ensureAlpha().raw().toBuffer());
    const order=sheetAnchorOrder(sheet.prompt,character.viewType);
    const anchors:Partial<Record<Direction,string>>={},views:Record<string,unknown>={...JSON.parse(sheet.viewsJson)};
    for(let i=0;i<3;i++) {
      const pose=extracted.poses[i];
      const anchor=await savePng(pose.png,"sheet_identity_anchor",pose.rect.w,pose.rect.h);
      anchors[order[i]]=anchor.id;views[order[i]]=pose.rect;
    }
    if(!style.mirrorLeft) {
      const right=await load(anchors.right!);
      // The mirrored anchor is a layout/pose reference only. Muse still renders
      // separate left strips and is instructed to preserve asymmetric details.
      anchors.left=(await savePng(await sharp(right).flop().png().toBuffer(),"sheet_identity_anchor_left")).id;
    }
    delete views._runtimeAnchors;
    views._design={version:5,identitySource:"full_resolution",actionResolution:"native",sourceAssetId:sheet.processedAssetId};
    const chromaKey=chooseChromaKey(colors);
    sqlite.transaction(()=>{
      db.update(characterSheets).set({anchorsJson:JSON.stringify(anchors),viewsJson:JSON.stringify(views)}).where(eq(characterSheets.id,sheet.id)).run();
      db.update(characters).set({styleJson:JSON.stringify({...style,chromaKey}),updatedAt:Date.now()}).where(eq(characters.id,character.id)).run();
    }).immediate();
    event("Native-resolution direction anchors ready",100);return;
  }
  if(job.type==="strip") {
    if(!payload.versionId||!payload.direction)throw new Error("Strip job is missing its action or direction");
    const direction=payload.direction,versionId=payload.versionId;
    const version=db.select().from(actionVersions).where(eq(actionVersions.id,versionId)).get();
    const action=version?db.select().from(actions).where(and(eq(actions.id,version.actionId),eq(actions.characterId,character.id))).get():null;
    if(!version||!action)throw new Error("Action version not found");
    const plan=storedActionPlanSchema.parse(JSON.parse(version.planJson));
    const priorFrames=framesSchema.parse(JSON.parse(version.framesJson));
    if(priorFrames[direction]?.length===plan.frames)return;
    db.update(actionVersions).set({status:"generating"}).where(eq(actionVersions.id,versionId)).run();
    const anchors=anchorsSchema.parse(JSON.parse(sheet.anchorsJson));
    if(!anchors[direction])throw new Error(`Missing ${direction} anchor`);
    const anchor=await load(anchors[direction]!);
    const isCustom=!["idle","walk","jump","crouch"].includes(action.key);
    let idleReference:Buffer|undefined;
    let idleSize:{width:number;height:number}|undefined;
    let idleNative:Buffer|undefined;
    let idleNativeScale=1;
    if((!payload.rawOnly&&["walk","jump","crouch"].includes(action.key))||isCustom) {
      const idle=db.select().from(actions).where(and(eq(actions.characterId,character.id),eq(actions.key,"idle"))).get();
      const idleVersion=idle?(payload.idleVersionId
        ? db.select().from(actionVersions).where(and(eq(actionVersions.id,payload.idleVersionId),eq(actionVersions.actionId,idle.id),eq(actionVersions.status,"ready"))).get()
        : db.select().from(actionVersions).where(and(eq(actionVersions.actionId,idle.id),eq(actionVersions.status,"ready"))).orderBy(desc(actionVersions.version)).get()):undefined;
      if(!idleVersion&&!isCustom)throw new Error("Generate Idle before generating Walk, Jump or Crouch.");
      const idleFrame=idleVersion?framesSchema.parse(JSON.parse(idleVersion.framesJson))[direction]?.[0]:undefined;
      if(!idleFrame&&!isCustom)throw new Error(`Idle is missing its ${direction} reference frame. Regenerate Idle first.`);
      if(idleFrame){
        idleReference=await load(idleFrame.assetId);
        if(isCustom){
          idleNative=await sharp(idleReference).extract({left:1,top:1,width:idleFrame.w-2,height:idleFrame.h-2}).png().toBuffer();
          idleNativeScale=idleFrame.scale??1;
          // Idle's logical dimensions are the same units used by Preview.
          // Canvas expansion reserves reach; it must not redefine body size.
          idleSize={width:Math.max(1,Math.round((idleFrame.w-2)*(idleFrame.scale??1))),height:Math.max(1,Math.round((idleFrame.h-2)*(idleFrame.scale??1)))};
          idleReference=await sharp(idleReference).extract({left:1,top:1,width:idleFrame.w-2,height:idleFrame.h-2}).resize(idleSize.width,idleSize.height,{kernel:"nearest"}).png().toBuffer();
        }
      }
    }
    const metadata=await sharp(anchor).metadata();
    const reference=idleSize??{width:metadata.width!,height:metadata.height!};
    const sheetMeta=await sharp(await load(sheet.processedAssetId!)).metadata();
    const batchSize=nativeBatchSize(reference,sheetMeta.width!,plan.canvas);
    const strips=stripsSchema.parse(JSON.parse(version.stripsJson))[direction]??[];
    const allPoses:NativePose[]=[];
    const warnings:string[]=[];
    let previous:Buffer|undefined;
    let actionReference:Buffer|undefined;
    const batches:{segment:number;offset:number;count:number}[]=[];
    if(payload.rawOnly) {
      const saved=new Map<number,typeof strips[number]>();for(const item of strips)if(!item.invalid)saved.set(item.segment,item);
      let offset=0;
      for(const [segment,item] of [...saved.entries()].sort((a,b)=>a[0]-b[0])){
        const count=item.frames??Number(item.prompt.match(/Frame count:\s*(\d+)/i)?.[1]);
        if(!Number.isInteger(count)||count<1||offset+count>plan.frames)throw new Error("Saved strip frame counts are incomplete; no image was generated.");
        batches.push({segment,offset,count});offset+=count;
      }
      if(offset!==plan.frames)throw new Error("Saved strips are incomplete; no image was generated.");
    } else for(let offset=0;offset<plan.frames;offset+=batchSize)batches.push({segment:offset/batchSize,offset,count:Math.min(batchSize,plan.frames-offset)});
    for(const {segment,offset,count} of batches) {
      const poses=plan.poses.slice(offset,offset+count);
      const cached=payload.rawOnly?[...strips].reverse().find(item=>item.segment===segment&&!item.invalid):undefined;
      const prompt=cached?.prompt??stripPrompt({actionReference:!!actionReference,canvas:plan.canvas,viewType:character.viewType,label:action.label,actionKey:action.key,idleReference:!!idleReference,direction,poses,playback:plan.playback,key:style.chromaKey,segment,total:plan.frames,referenceWidth:reference.width,referenceHeight:reference.height,startFrame:offset+1});
      const key=cached?.prompt.match(/background key:\s*(#[0-9a-f]{6})/i)?.[1]??style.chromaKey;
      let layout=stripLayout(Math.min(poses.length,4),reference,plan.canvas,direction);
      let retryFeedback="";
      let sourceHeight=0;
      let extracted:Awaited<ReturnType<typeof extractPoses>>|undefined;
      for(let attempt=0;attempt<2;attempt++) {
        const safetyScale=plan.canvas!=="standard"&&(attempt>0||cached?.prompt.includes("CORRECTION REQUIRED:"))?1.25:1;
        layout=stripLayout(Math.min(poses.length,4),reference,plan.canvas,direction,safetyScale);
        const generationPrompt=retryFeedback?`${prompt}\n\nCORRECTION REQUIRED: The previous image failed validation: ${retryFeedback}. The canvas and each slot now have extra space. Keep the original reference character size, NOT 85–90% of this expanded slot height. Follow the body box in the new SECOND reference. Keep all body parts, complete weapon tips and VFX at least 10% away from each slot edge. Do not enlarge the character to fill the extra space.`:prompt;
        let stored=cached??strips.find(s=>s.segment===segment&&!s.invalid&&s.prompt===generationPrompt);
        // Raw-strip checkpoints survive worker crashes and processing failures.
        let raw=stored?await load(stored.rawAssetId):undefined;
        if(!raw&&payload.rawOnly)throw new Error("A saved raw strip is missing. No new image was generated.");
        if(!raw) {
          event(`Generating ${action.label} · ${direction} · strip ${segment+1}`,20);
          const guide=await stripGuide(poses.length,style.chromaKey,reference,plan.canvas,direction,safetyScale);
          const generated=await provider.generate({prompt:generationPrompt,references:[anchor,guide,...(previous?[previous]:[]),...(actionReference?[actionReference]:[]),...(idleReference?[idleReference]:[])],size:[layout.width,layout.height]});
          raw=generated.png;
          const meta=await sharp(raw).metadata();const asset=await savePng(raw,"strip_raw",meta.width,meta.height);
          stored={rawAssetId:asset.id,frames:poses.length,segment,prompt:generationPrompt};strips.push(stored);
          sqlite.transaction(()=>{
            const current=db.select().from(actionVersions).where(eq(actionVersions.id,versionId)).get()!;
            const merged=stripsSchema.parse(JSON.parse(current.stripsJson));merged[direction]=strips;
            db.update(actionVersions).set({stripsJson:JSON.stringify(merged)}).where(eq(actionVersions.id,versionId)).run();
          }).immediate();
          const responseAsset=await saveAsset(Buffer.from(JSON.stringify(generated.raw)),{characterId:character.id,kind:"strip_response",mime:"application/json"});
          stored.responseAssetId=responseAsset.id;
          sqlite.transaction(()=>{const current=db.select().from(actionVersions).where(eq(actionVersions.id,versionId)).get()!;const merged=stripsSchema.parse(JSON.parse(current.stripsJson));merged[direction]=strips;db.update(actionVersions).set({stripsJson:JSON.stringify(merged)}).where(eq(actionVersions.id,versionId)).run();}).immediate();
        }
        try {
          event(`Removing background and extracting ${action.label} frames`,65);
          const decoded=await sharp(raw,{limitInputPixels:24_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
          const keyed=removeChroma(decoded.data,decoded.info.width,decoded.info.height,key);
          const transparent=await sharp(cleanSpriteAlpha(keyed.rgba),{raw:{width:decoded.info.width,height:decoded.info.height,channels:4}}).png().toBuffer();
          extracted=await (plan.canvas==="standard"?extractPoses(transparent,poses.length):extractSlotPoses(transparent,poses.length,{retryEdgeContact:attempt===0&&!payload.rawOnly}));
          // Post-extraction QA. A first failure retries with the reason fed back
          // to Muse; a repeat failure is kept with a warning.
          const strict=attempt===0&&!payload.rawOnly;
          const flag=(message:string)=>{if(strict)throw new Error(`extract_mismatch: ${message}`);warnings.push(`${action.label} ${direction}: ${message}`);};
          if(offset>0&&["idle","walk"].includes(action.key)&&allPoses.length){
            // Muse fills the canvas height even when it zooms in (cutting off
            // the feet), so height alone can't see it; width can. Idle is
            // static, so its width is tight; a walk stride varies more.
            const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
            const batchScale=stripLayout(Math.min(poses.length,4),reference,plan.canvas,direction).height/decoded.info.height;
            const batch=extracted.poses,size=(key:"w"|"h")=>median(batch.map(pose=>pose.rect[key]*batchScale))/median(allPoses.map(pose=>pose.rect[key]*pose.scale));
            const ratio=[size("h"),size("w")].reduce((worst,value)=>Math.abs(Math.log(value))>Math.abs(Math.log(worst))?value:worst);
            const tolerance=action.key==="idle"?0.12:0.2;
            if(Math.abs(ratio-1)>tolerance)flag(`frames ${offset+1}–${offset+poses.length} are drawn at ${Math.round(ratio*100)}% of frame 1's size (zoomed or cropped). Draw the full body at frame 1's exact size, feet included`);
          }
          if(action.key==="walk"&&(direction==="right"||direction==="left")&&offset<=2&&offset+extracted.poses.length>2){
            const first=offset===0?extracted.poses[0].png:allPoses[0]?.png;
            if(first&&await sameLegOrder(first,extracted.poses[2-offset].png,direction))flag("walk frame 3 repeats frame 1's leg order. In frame 3 the leg that was in FRONT in frame 1 must be BEHIND, and the back leg must be in front");
          }
          sourceHeight=decoded.info.height;break;
        } catch(error) {
          stored!.invalid=true;
          sqlite.transaction(()=>{const current=db.select().from(actionVersions).where(eq(actionVersions.id,versionId)).get()!;const merged=stripsSchema.parse(JSON.parse(current.stripsJson));merged[direction]=strips;db.update(actionVersions).set({stripsJson:JSON.stringify(merged)}).where(eq(actionVersions.id,versionId)).run();}).immediate();
          if(error instanceof Error&&error.message.startsWith("extract_mismatch")&&attempt===0&&!payload.rawOnly) {
            retryFeedback=error.message;
            event("Frame extraction failed; retrying with corrective guidance and extra space for wide/tall actions",30);continue;
          }
          throw error;
        }
      }
      if(!extracted)throw new Error("Could not extract generated strip");
      const grounded=extracted.poses.filter((_,i)=>!plan.airborneFrames?.includes(offset+i));
      const baseline=grounded.length?Math.max(...grounded.map(p=>p.rect.y+p.rect.h)):(layout.top+layout.poseHeight)*sourceHeight/layout.height;
      // Safety padding must not magnify retry frames in the Preview. Use the
      // original guide height as the common logical space for every batch.
      const scale=stripLayout(Math.min(poses.length,4),reference,plan.canvas,direction).height/sourceHeight;
      allPoses.push(...extracted.poses.map((pose,i)=>({...pose,scale,baseline,airborne:!!plan.airborneFrames?.includes(offset+i)})));
      warnings.push(...extracted.warnings);
      if(action.key!=="crouch"&&Math.max(...extracted.poses.map(p=>p.rect.h))/sourceHeight<0.7)warnings.push(`${action.label} ${direction}: Muse drew the character smaller than the guide; review its scale.`);
      if(Math.max(...extracted.poses.map(p=>p.rect.h))<reference.height*0.8)warnings.push(`${action.label} ${direction}: returned pixels are below the sheet reference resolution. Local processing preserved them without resampling.`);
      // Keep frame 1 as an immutable scale reference. Never resize later poses
      // by their total silhouette: weapon reach and VFX change those bounds.
      // Frame 1 anchors scale (and walk leg order) for every later strip.
      if(!actionReference)actionReference=extracted.poses[0].png;
      previous=extracted.poses[extracted.poses.length-1].png;
    }
    event(`Preserving native ${action.label} frame pixels`,80);
    const calibrated=isCustom&&idleNative?await alignCharacterScale(allPoses,idleNative,idleNativeScale):{poses:allPoses,warnings:[]};
    warnings.push(...calibrated.warnings);
    const normalized=await preserveNativeFrames(calibrated.poses);
    const refs:FrameRef[]=[];
    for(let i=0;i<normalized.length;i++){const frame=normalized[i];const asset=await savePng(frame.png,"animation_frame",frame.w,frame.h);refs.push({assetId:asset.id,w:frame.w,h:frame.h,anchorX:frame.anchorX,anchorY:frame.anchorY,scale:frame.scale,durationMs:plan.durationsMs[i]});}
    const hashes=normalized.map(frame=>frame.png.toString("base64"));
    if(new Set(hashes).size<hashes.length)warnings.push("Near-duplicate or identical frames; inspect the animation.");
    sqlite.transaction(()=>{const current=db.select().from(actionVersions).where(eq(actionVersions.id,versionId)).get()!;const frames=framesSchema.parse(JSON.parse(current.framesJson));frames[direction]=refs;db.update(actionVersions).set({framesJson:JSON.stringify(frames),status:"processing"}).where(eq(actionVersions.id,versionId)).run();}).immediate();
    queue.event(job.id,"qa",{warnings});event(`${action.label} · ${direction} ready`,100);return;
  }
  if(job.type==="process_action"&&payload.stage==="finish") {
    const version=db.select().from(actionVersions).where(eq(actionVersions.id,payload.versionId!)).get();
    if(!version)throw new Error("Action version not found");
    const action=db.select().from(actions).where(and(eq(actions.id,version.actionId),eq(actions.characterId,character.id))).get();if(!action)throw new Error("Action not found");
    const plan=storedActionPlanSchema.parse(JSON.parse(version.planJson)),frames=framesSchema.parse(JSON.parse(version.framesJson));
    const directions=z.array(z.enum(["down","up","left","right"])).parse(JSON.parse(action.directionsJson));
    for(const direction of directions)if(frames[direction]?.length!==plan.frames)throw new Error(`Incomplete ${action.label} frames for ${direction}`);
    db.update(actionVersions).set({status:"ready",error:null}).where(eq(actionVersions.id,version.id)).run();return;
  }
  if(job.type==="compose_atlas") {
    event("Composing animation atlas",20);
    const manifests:Manifest["actions"]={},composites:{input:Buffer;left:number;top:number}[]=[],rows:{frames:FrameRef[];direction:Direction;key:string}[]=[];
    const activated:{actionId:string;versionId:string}[]=[];
    let width=1,height=0;
    for(const id of payload.versionIds??[]) {
      const version=db.select().from(actionVersions).where(eq(actionVersions.id,id)).get();if(!version||version.status!=="ready")throw new Error("Cannot compose unfinished action versions");
      const action=db.select().from(actions).where(and(eq(actions.id,version.actionId),eq(actions.characterId,character.id))).get();if(!action)throw new Error("Action not found");
      const plan=storedActionPlanSchema.parse(JSON.parse(version.planJson));const frames=framesSchema.parse(JSON.parse(version.framesJson));
      manifests[action.key]={label:action.label,playback:plan.playback,directions:{},gameplay:gameplaySchema.parse(JSON.parse(action.gameplayJson)),events:plan.events};
      for(const [direction,list] of Object.entries(frames)){if(!list?.length)continue;rows.push({frames:list,direction:direction as Direction,key:action.key});width=Math.max(width,list.reduce((sum,f)=>sum+f.w,0));height+=Math.max(...list.map(f=>f.h));}
      if(style.mirrorLeft)manifests[action.key].directions.left={mirrorOf:"right"};
      activated.push({actionId:action.id,versionId:id});
    }
    if(!height||!activated.length)throw new Error("No animation frames to compose");
    let y=0;
    for(const row of rows){let x=0;const absolute=[];for(const frame of row.frames){composites.push({input:await load(frame.assetId),left:x,top:y});absolute.push({x,y,w:frame.w,h:frame.h,anchorX:frame.anchorX,anchorY:frame.anchorY,scale:frame.scale,durationMs:frame.durationMs});x+=frame.w;}manifests[row.key].directions[row.direction]={frames:absolute};y+=Math.max(...row.frames.map(f=>f.h));}
    const png=await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(composites).png().toBuffer();
    const asset=await savePng(png,"atlas",width,height);
    const manifest=manifestSchema.parse({version:1,characterId:character.id,viewType:character.viewType,atlas:{url:`/api/assets/${asset.id}`,width,height,version:character.atlasVersion+1},pixelScale:1,actions:manifests});
    await saveAsset(Buffer.from(JSON.stringify(manifest,null,2)),{characterId:character.id,kind:"manifest",mime:"application/json"});
    sqlite.transaction(()=>{for(const active of activated)db.update(actions).set({activeVersionId:active.versionId,updatedAt:Date.now()}).where(eq(actions.id,active.actionId)).run();db.update(characters).set({atlasAssetId:asset.id,atlasVersion:manifest.atlas.version,manifestJson:JSON.stringify(manifest),status:"ready",updatedAt:Date.now()}).where(eq(characters.id,character.id)).run();}).immediate();
    event("Animations ready",100);return;
  }
  throw new Error("Unknown animation job stage");
}
