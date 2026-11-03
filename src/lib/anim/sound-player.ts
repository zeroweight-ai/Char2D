// Browser-only Web Audio playback for move sound effects. One shared context,
// decoded buffers cached per URL, overlapping plays allowed (footsteps).
type Decoded={buffer:AudioBuffer;offset:number};
let context:AudioContext|null=null;
const cache=new Map<string,Promise<Decoded|null>>();
// The instance of each sound that is still playing. A new cue of the same sound
// cuts it off, so fast footsteps (every 200 ms) never pile up into a smear.
const playing=new Map<string,{source:AudioBufferSourceNode;gain:GainNode}>();
function audio() {
  if(typeof window==="undefined")return null;
  if(!context){const Context=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Context)return null;context=new Context();}
  return context;
}
/** Browsers start audio suspended until a user gesture; call from one. */
export function unlockAudio(){const ctx=audio();if(ctx?.state==="suspended")void ctx.resume().catch(()=>{});}
// Generated effects often start with a few ms of near-silence. Skipping it
// keeps the audible hit on the animation frame it is cued to.
function leadingSilence(buffer:AudioBuffer) {
  const data=buffer.getChannelData(0);let peak=0;
  for(let i=0;i<data.length;i++)peak=Math.max(peak,Math.abs(data[i]));
  if(!peak)return 0;
  const threshold=peak*0.08;let first=0;
  while(first<data.length&&Math.abs(data[first])<threshold)first++;
  return Math.max(0,first/buffer.sampleRate-0.004);
}
export function loadSound(url:string) {
  let entry=cache.get(url);
  if(!entry){
    const ctx=audio();
    entry=ctx?fetch(url).then(response=>{if(!response.ok)throw new Error("sound fetch failed");return response.arrayBuffer();}).then(bytes=>ctx.decodeAudioData(bytes)).then(buffer=>({buffer,offset:leadingSilence(buffer)})).catch(()=>{cache.delete(url);return null;}):Promise.resolve(null);
    cache.set(url,entry);
  }
  return entry;
}
/** Plays immediately if audio is unlocked; silently does nothing otherwise. */
export async function playSound(url:string,volume=0.8,{force=false}:{force?:boolean}={}) {
  const ctx=audio();if(!ctx)return;
  if(force)unlockAudio();
  else if(ctx.state!=="running")return;
  const decoded=await loadSound(url);if(!decoded)return;
  const source=ctx.createBufferSource(),gain=ctx.createGain();
  const previous=playing.get(url);
  if(previous){const now=ctx.currentTime;previous.gain.gain.setTargetAtTime(0,now,0.008);previous.source.stop(now+0.025);}
  source.buffer=decoded.buffer;gain.gain.value=volume;
  source.connect(gain).connect(ctx.destination);source.start(0,decoded.offset);
  const entry={source,gain};playing.set(url,entry);
  source.onended=()=>{if(playing.get(url)===entry)playing.delete(url);};
}
