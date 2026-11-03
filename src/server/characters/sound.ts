import "server-only";
import { and,desc,eq,inArray,sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db";
import { actions,actionVersions,characters,jobs } from "../db/schema";
import { JobQueue,type Job } from "../jobs/queue";
import { provider } from "../ai";
import { generateSoundEffect,planSound,soundAvailable } from "../ai/sound";
import { saveAsset } from "../storage/assets";
import { manifestSchema,storedActionPlanSchema } from "@/lib/manifest";
import { manifestSound,parseSoundState,type SoundState } from "@/lib/sound";
import { DEFAULT_SOUNDS,SILENT_DEFAULTS } from "@/lib/default-sounds";
export class SoundError extends Error {constructor(message:string,public status=409){super(message);}}
const payloadSchema=z.object({actionId:z.string().min(1),force:z.boolean().optional()});
const DEFAULT_VOLUME=0.8;

// Sound jobs never block animation work (see the busy checks that exclude
// type "sound"), so every write here re-reads the latest rows.
function activeSoundJob(characterId:string,actionId:string) {
  return getDatabase().db.select().from(jobs).where(and(eq(jobs.characterId,characterId),eq(jobs.type,"sound"),inArray(jobs.status,["queued","running"]),sql`json_extract(${jobs.payloadJson}, '$.actionId') = ${actionId}`)).get();
}
function writeState(actionId:string,state:SoundState){getDatabase().db.update(actions).set({soundJson:JSON.stringify({...state,updatedAt:Date.now()})}).where(eq(actions.id,actionId)).run();}
/** Patch one action's sound in the published manifest in place (atlas unchanged). */
function patchManifest(characterId:string,key:string,state:SoundState) {
  const {db}=getDatabase();
  const character=db.select().from(characters).where(eq(characters.id,characterId)).get();
  if(!character?.manifestJson)return;
  const manifest=manifestSchema.parse(JSON.parse(character.manifestJson)),entry=manifest.actions[key];
  if(!entry)return;
  const first=Object.values(entry.directions).find(direction=>direction?.frames)?.frames?.length??0;
  const sound=manifestSound(state,first);
  if(sound)entry.sound=sound;else delete entry.sound;
  db.update(characters).set({manifestJson:JSON.stringify(manifestSchema.parse(manifest)),updatedAt:Date.now()}).where(eq(characters.id,characterId)).run();
}
function enqueue(characterId:string,actionId:string,force:boolean,previous:SoundState) {
  writeState(actionId,{...previous,status:"queued",error:undefined});
  return new JobQueue().enqueue("sound",{actionId,force},{characterId,maxAttempts:1});
}

/** Player asked for a sound (Generate / Regenerate sound). Always makes one. */
export function requestSound(characterId:string,key:string) {
  if(!soundAvailable())throw new SoundError("Add ELEVENLABS_API_KEY to .env (and restart) to generate sound effects.",503);
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const action=db.select().from(actions).where(and(eq(actions.characterId,characterId),eq(actions.key,key))).get();
    if(!action)throw new SoundError("Action not found",404);
    if(activeSoundJob(characterId,action.id))throw new SoundError("A sound for this move is already being made.");
    if(!action.activeVersionId)throw new SoundError("Wait for this move's animation to finish first.");
    return {jobId:enqueue(characterId,action.id,true,parseSoundState(action.soundJson)),soundCalls:1};
  }).immediate();
}
/** Silence a move. The decision sticks: it is not re-decided automatically. */
export function removeSound(characterId:string,key:string) {
  const {db,sqlite}=getDatabase();
  return sqlite.transaction(()=>{
    const action=db.select().from(actions).where(and(eq(actions.characterId,characterId),eq(actions.key,key))).get();
    if(!action)throw new SoundError("Action not found",404);
    if(activeSoundJob(characterId,action.id))throw new SoundError("Wait for the sound being made to finish first.");
    const state:SoundState={status:"none",reason:"You removed this sound.",requestedBy:"user"};
    writeState(action.id,state);patchManifest(characterId,key,state);
    return {ok:true};
  }).immediate();
}
/**
 * Default moves get the bundled sounds (walk/jump/crouch) or stay silent
 * (idle) with no API call. Call inside the compose transaction, before
 * publishedSounds. Only undecided moves are touched, so a regenerated or
 * removed sound is kept.
 */
export function applyDefaultSounds(characterId:string,actionIds:string[]) {
  const {db}=getDatabase();
  for(const id of actionIds) {
    const action=db.select().from(actions).where(and(eq(actions.id,id),eq(actions.characterId,characterId))).get();
    if(!action||parseSoundState(action.soundJson).status)continue;
    const preset=DEFAULT_SOUNDS[action.key],silent=SILENT_DEFAULTS[action.key];
    if(preset)writeState(id,{status:"ready",builtin:preset.url,prompt:preset.prompt,reason:preset.reason,frames:preset.frames,durationSeconds:preset.durationSeconds,volume:preset.volume,requestedBy:"default"});
    else if(silent)writeState(id,{status:"none",reason:silent,requestedBy:"default"});
  }
}
/**
 * After an atlas is published, let the AI decide sounds for moves that are
 * still undecided (custom moves). Call inside the compose transaction.
 */
export function enqueueAutoSounds(characterId:string,actionIds:string[]) {
  if(!soundAvailable())return [];
  const {db}=getDatabase(),queued:string[]=[];
  for(const id of actionIds) {
    const action=db.select().from(actions).where(and(eq(actions.id,id),eq(actions.characterId,characterId))).get();
    if(!action)continue;
    const state=parseSoundState(action.soundJson);
    if(state.status||activeSoundJob(characterId,id))continue;
    queued.push(enqueue(characterId,id,false,state));
  }
  return queued;
}
/** Sound entries to publish in a freshly composed manifest. */
export function publishedSounds(actionIds:string[]) {
  const {db}=getDatabase(),result=new Map<string,SoundState>();
  for(const id of actionIds){const action=db.select().from(actions).where(eq(actions.id,id)).get();if(action)result.set(action.key,parseSoundState(action.soundJson));}
  return result;
}

export async function runSoundJob(job:Job,queue:JobQueue) {
  const {actionId,force=false}=payloadSchema.parse(JSON.parse(job.payloadJson));
  const {db,sqlite}=getDatabase();
  const event=(message:string,progress:number)=>queue.event(job.id,"progress",{message,progress});
  const load=()=>db.select().from(actions).where(and(eq(actions.id,actionId),eq(actions.characterId,job.characterId!))).get();
  const action=load(),character=db.select().from(characters).where(eq(characters.id,job.characterId!)).get();
  if(!action||!character){event("The move was deleted; no sound made",100);return;}
  const previous=parseSoundState(action.soundJson);
  try {
    const version=(action.activeVersionId?db.select().from(actionVersions).where(and(eq(actionVersions.id,action.activeVersionId),eq(actionVersions.status,"ready"))).get():undefined)
      ??db.select().from(actionVersions).where(and(eq(actionVersions.actionId,action.id),eq(actionVersions.status,"ready"))).orderBy(desc(actionVersions.version)).get();
    if(!version)throw new Error("This move has no finished animation yet.");
    const plan=storedActionPlanSchema.parse(JSON.parse(version.planJson));
    writeState(action.id,{...previous,status:"generating",error:undefined});
    event(`Choosing a sound for ${action.label}`,20);
    const decision=await planSound(provider,{force,character:{name:character.name,description:character.description},
      action:{key:action.key,label:action.label,summary:plan.summary,poses:plan.poses,durationsMs:plan.durationsMs,playback:plan.playback,airborneFrames:plan.airborneFrames,events:plan.events}});
    if(!decision.needed) {
      sqlite.transaction(()=>{const current=load();if(!current)return;const state:SoundState={status:"none",reason:decision.reason,requestedBy:"ai"};writeState(actionId,state);patchManifest(character.id,current.key,state);}).immediate();
      event(`${action.label} stays silent: ${decision.reason}`,100);return;
    }
    event(`Recording the ${action.label} sound`,55);
    const audio=await generateSoundEffect({text:decision.prompt,durationSeconds:decision.durationSeconds});
    const asset=await saveAsset(audio.bytes,{characterId:character.id,kind:"action_sound",mime:audio.mime});
    sqlite.transaction(()=>{
      const current=load();if(!current)return;
      const state:SoundState={status:"ready",reason:decision.reason,prompt:decision.prompt,assetId:asset.id,frames:decision.frames,durationSeconds:decision.durationSeconds,volume:previous.builtin?DEFAULT_VOLUME:previous.volume??DEFAULT_VOLUME,requestedBy:force?"user":"ai"};
      writeState(actionId,state);patchManifest(character.id,current.key,state);
    }).immediate();
    event(`${action.label} sound ready`,100);
  } catch(error) {
    const message=error instanceof Error?error.message:"Could not make the sound";
    // A failed regeneration keeps the sound that was already published.
    if(load())writeState(actionId,(previous.assetId||previous.builtin)&&previous.status!=="none"?{...previous,status:"ready",error:message}:{...previous,status:"error",error:message});
    throw error;
  }
}
