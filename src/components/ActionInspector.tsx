"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActionGameplay,Manifest } from "@/lib/manifest";
import type { CharacterAction } from "@/lib/character";
type Playback=Manifest["actions"][string]["playback"];
export type TimingDraft={key:string;durations:number[];playback:Playback};
const MIN_MS=20,MAX_MS=2000,SNAP=10;
const clamp=(ms:number)=>Math.min(MAX_MS,Math.max(MIN_MS,Math.round(ms/SNAP)*SNAP));
const playbackLabels:Record<Playback,string>={loop:"Loop",once:"Play once",once_hold:"Play once, hold last frame"};
const triggerLabels:Record<ActionGameplay["trigger"],string>={press:"Press — play once",hold:"Hold — loop while held",toggle:"Toggle — on / off"};
function baseDurations(manifest:Manifest,key:string){
  const entry=manifest.actions[key];if(!entry)return [];
  const concrete=Object.values(entry.directions).find(direction=>direction?.frames?.length);
  return concrete?.frames?.map(frame=>frame.durationMs)??[];
}
export function ActionInspector({characterId,manifest,actionKey,action,locked,activeFrame,onDraft}:{characterId:string;manifest:Manifest;actionKey:string;action:CharacterAction;locked:boolean;activeFrame:number;onDraft:(draft:TimingDraft|null)=>void}) {
  const client=useQueryClient();
  const entry=manifest.actions[actionKey];
  const savedDurations=useMemo(()=>baseDurations(manifest,actionKey),[manifest,actionKey]);
  const [durations,setDurations]=useState(savedDurations);
  const [playback,setPlayback]=useState<Playback>(entry?.playback??"loop");
  const [gameplay,setGameplay]=useState<ActionGameplay>(entry?.gameplay??{trigger:"press",lockMovement:false,interruptible:true});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const bar=useRef<HTMLDivElement>(null);
  const timingDirty=durations.some((ms,i)=>ms!==savedDurations[i])||playback!==entry?.playback;
  const dirty=timingDirty||JSON.stringify(gameplay)!==JSON.stringify(entry?.gameplay);
  useEffect(()=>{onDraft(timingDirty?{key:actionKey,durations,playback}:null);},[durations,playback,timingDirty,actionKey,onDraft]);
  useEffect(()=>()=>onDraft(null),[onDraft]);
  const ready=(action.versions??[]).filter(version=>version.status==="ready");
  const activeIndex=ready.findIndex(version=>version.id===action.activeVersionId);
  const previous=activeIndex>0?ready[activeIndex-1]:null,next=activeIndex>=0&&activeIndex<ready.length-1?ready[activeIndex+1]:null;
  const total=durations.reduce((sum,ms)=>sum+ms,0);
  async function request(url:string,init:RequestInit,success:string){
    setBusy(true);setError("");setNotice("");
    try{const response=await fetch(url,init);const value=await response.json();if(!response.ok)throw new Error(value.error??"Request failed");
      await client.invalidateQueries({queryKey:["character",characterId]});await client.invalidateQueries({queryKey:["characters"]});setNotice(success);}
    catch(error){setError(error instanceof Error?error.message:"Request failed");}
    finally{setBusy(false);}
  }
  const base=`/api/characters/${encodeURIComponent(characterId)}/actions/${encodeURIComponent(actionKey)}`;
  const save=()=>request(base,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({...(timingDirty?{durationsMs:durations,playback}:{}),gameplay})},"Saved — no AI call used.");
  const activate=(id:string,label:string)=>request(`${base}/versions/${encodeURIComponent(id)}/activate`,{method:"POST"},`Restoring ${label}… the atlas rebuilds without an AI call.`);
  const reset=()=>{setDurations(savedDurations);setPlayback(entry?.playback??"loop");if(entry)setGameplay(entry.gameplay);setError("");};
  function drag(index:number,event:React.PointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    const width=bar.current?.getBoundingClientRect().width??1,start=event.clientX,startMs=durations[index],msPerPx=Math.max(total,1)/width;
    const target=event.currentTarget;target.setPointerCapture(event.pointerId);
    const move=(e:PointerEvent)=>setDurations(list=>list.map((ms,i)=>i===index?clamp(startMs+(e.clientX-start)*msPerPx*1.5):ms));
    const up=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",up);};
    target.addEventListener("pointermove",move);target.addEventListener("pointerup",up);
  }
  function nudge(index:number,event:React.KeyboardEvent){
    if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();
    const step=(event.shiftKey?100:SNAP)*(event.key==="ArrowRight"?1:-1);
    setDurations(list=>list.map((ms,i)=>i===index?clamp(ms+step):ms));
  }
  const scale=(factor:number)=>setDurations(list=>list.map(ms=>clamp(ms*factor)));
  const set=<K extends keyof ActionGameplay>(key:K,value:ActionGameplay[K])=>setGameplay(current=>{const copy={...current};if(value===undefined)delete copy[key];else copy[key]=value;return copy;});
  const locomotion=["idle","walk","jump","crouch"].includes(actionKey);
  const disabled=busy||locked;
  if(!entry)return null;
  return <aside className="inspector" data-keys-ignore aria-label={`Inspector: ${entry.label}`}>
    <header className="inspector-head"><h3>Edit {entry.label}</h3></header>
    <p className="fine-print">Changes here are free (no AI calls). Pick another move above to edit it.</p>

    {ready.length>1&&<section className="inspector-block" aria-label="Versions">
      <h4>Version</h4>
      <div className="version-nav">
        <button className="secondary small" disabled={disabled||!previous} aria-label={previous?`Undo to v${previous.version}`:"Undo"} onClick={()=>previous&&activate(previous.id,`v${previous.version}`)}>◂ Undo</button>
        <select aria-label="Active version" value={action.activeVersionId??""} disabled={disabled||ready.length<2} onChange={event=>{const version=ready.find(item=>item.id===event.target.value);if(version)void activate(version.id,`v${version.version}`);}}>
          {!action.activeVersionId&&<option value="">—</option>}
          {ready.map(version=><option key={version.id} value={version.id}>v{version.version} · {version.createdBy==="default"?"original":version.createdBy==="chat"?"chat":"re-roll"}</option>)}
        </select>
        <button className="secondary small" disabled={disabled||!next} aria-label={next?`Redo to v${next.version}`:"Redo"} onClick={()=>next&&activate(next.id,`v${next.version}`)}>Redo ▸</button>
      </div>
      <p className="fine-print">Switch back to an earlier version at any time.</p>
    </section>}

    <section className="inspector-block" aria-label="Timing">
      <h4>Speed <span className="muted">{total} ms · {(1000*durations.length/Math.max(total,1)).toFixed(1)} fps</span></h4>
      <div className="timing-bar" ref={bar}>{durations.map((ms,i)=><div key={i} className={`timing-frame${i===activeFrame?" active":""}`} style={{flexGrow:ms}}>
        <span className="timing-no">{i+1}</span>
        <span className="timing-handle" role="slider" tabIndex={0} aria-label={`Frame ${i+1} duration`} aria-valuemin={MIN_MS} aria-valuemax={MAX_MS} aria-valuenow={ms} aria-valuetext={`${ms} milliseconds`} onPointerDown={event=>drag(i,event)} onKeyDown={event=>nudge(i,event)}/>
      </div>)}</div>
      <div className="timing-inputs">{durations.map((ms,i)=><label key={i}><span className="sr-only">Frame {i+1} duration in milliseconds</span><input type="number" min={MIN_MS} max={MAX_MS} step={SNAP} value={ms} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))setDurations(list=>list.map((old,j)=>j===i?Math.min(MAX_MS,Math.max(1,Math.round(value))):old));}} onBlur={()=>setDurations(list=>list.map(clamp))}/><small>ms</small></label>)}</div>
      <div className="button-row"><button className="secondary small" onClick={()=>scale(0.8)}>Faster</button><button className="secondary small" onClick={()=>scale(1.25)}>Slower</button><button className="secondary small" onClick={()=>setDurations(list=>list.map(()=>clamp(total/list.length)))}>Even out</button></div>
      <label className="inspector-field">Playback<select value={playback} onChange={event=>setPlayback(event.target.value as Playback)}>{Object.entries(playbackLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    </section>

    <details className="inspector-block" aria-label="Gameplay">
      <summary><h4>Gameplay settings</h4></summary>
      {actionKey!=="idle"&&actionKey!=="walk"&&<label className="inspector-field">Trigger<select value={gameplay.trigger} onChange={event=>set("trigger",event.target.value as ActionGameplay["trigger"])}>{Object.entries(triggerLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      <div className="inspector-checks">
        <label><input type="checkbox" checked={gameplay.lockMovement} onChange={event=>set("lockMovement",event.target.checked)}/> Lock movement</label>
        <label><input type="checkbox" checked={gameplay.interruptible} onChange={event=>set("interruptible",event.target.checked)}/> Interruptible</label>
      </div>
      {actionKey==="walk"&&<Slider label="Walk speed" unit="px/s" min={20} max={400} step={5} value={gameplay.moveSpeed??100} onChange={value=>set("moveSpeed",value)}/>}
      {actionKey==="jump"&&<><Slider label="Jump power" unit="" min={100} max={700} step={10} value={-(gameplay.jumpVelocity??-280)} onChange={value=>set("jumpVelocity",-value)}/><Slider label="Gravity" unit="×" min={0.3} max={2} step={0.05} value={gameplay.gravityScale??1} onChange={value=>set("gravityScale",value)} hint="Lower = floatier"/></>}
      {actionKey==="crouch"&&<Slider label="Crouch speed" unit="×" min={0} max={1} step={0.05} value={gameplay.crouchSpeedMultiplier??0.4} onChange={value=>set("crouchSpeedMultiplier",value)}/>}
      {!locomotion&&<><Slider label="Cooldown" unit="ms" min={0} max={3000} step={50} value={gameplay.cooldownMs??0} onChange={value=>set("cooldownMs",value||undefined)}/><Slider label="Dash distance" unit="px" min={-300} max={300} step={10} value={gameplay.rootMotion?.dx??0} onChange={value=>set("rootMotion",value?{dx:value,dy:0,overMs:Math.max(1,total)}:undefined)} hint="Moves the hero during the move in the Playground"/></>}
    </details>

    {error&&<p className="error" role="alert">{error}</p>}
    {notice&&!dirty&&<p className="fine-print" role="status">{notice}</p>}
    {locked&&<p className="fine-print">Editing unlocks when generation finishes.</p>}
    <div className="button-row inspector-save"><button disabled={disabled||!dirty} onClick={save}>{busy?"Saving…":"Save changes"}</button><button className="secondary" disabled={busy||!dirty} onClick={reset}>Reset</button></div>
  </aside>;
}
function Slider({label,unit,min,max,step,value,onChange,hint}:{label:string;unit:string;min:number;max:number;step:number;value:number;onChange:(value:number)=>void;hint?:string}) {
  return <label className="inspector-field slider">
    <span className="slider-head"><span>{label}</span><output>{Number.isInteger(step)?value:value.toFixed(2)}{unit&&` ${unit}`}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={event=>onChange(Number(event.target.value))}/>
    {hint&&<small className="muted">{hint}</small>}
  </label>;
}
