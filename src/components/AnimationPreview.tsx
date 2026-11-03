"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { frameAtTime } from "@/lib/anim/timeline";
import type { Direction,Manifest } from "@/lib/manifest";
import { PROFILES,keyLabel,movementKeys,type Bindings } from "@/lib/bindings";
import type { CharacterAction } from "@/lib/character";
import { SpritePlayer } from "./SpritePlayer";
import { ActionInspector,type TimingDraft } from "./ActionInspector";
import { loadSound,playSound,unlockAudio } from "@/lib/anim/sound-player";
const MUTE_KEY="char2d.preview.muted";
// Where each stage backdrop's ground surface is, as a fraction of stage height,
// so the character stands on it. Meadow: arena.png grass top is at 90.6% of the
// image, drawn at 105% of the stage height (globals.css). Grass strip: 86%.
const GROUND:Record<string,number>={arena:0.951,grass:0.86};
type KeyTarget={action:string;direction?:Direction};
export function AnimationPreview({manifest,characterId,actions=[],bindings,locked=false,onNewMove,editing=false,onEditingChange}:{manifest:Manifest;characterId?:string;actions?:CharacterAction[];bindings?:Bindings;locked?:boolean;onNewMove?:()=>void;editing?:boolean;onEditingChange?:(editing:boolean)=>void}) {
  const fallback=manifest.actions.idle?"idle":Object.keys(manifest.actions)[0]??"";
  const [action,setAction]=useState(fallback);
  const [inspected,setInspected]=useState(fallback);
  const actionKey=manifest.actions[action]?action:fallback;
  const [direction,setDirection]=useState<Direction>("right");
  const [playing,setPlaying]=useState(true),[speed,setSpeed]=useState(1),[frame,setFrame]=useState(0),[flip,setFlip]=useState(false);
  const [zoom,setZoom]=useState<"fit"|"native">("fit");
  const [background,setBackground]=useState("arena");
  const [draft,setDraft]=useState<TimingDraft|null>(null);
  const elapsed=useRef(0),toggled=useRef<string|null>(null);
  // Sound: cue = loop cycle + frame index, so a sound fires once per frame entry.
  const [muted,setMuted]=useState(false);
  const lastCue=useRef(""),soundRef=useRef<{url:string;frames:number[];volume?:number}|null>(null);
  // Controller state: keys currently held, and a press move that must finish.
  const held=useRef<string[]>([]),pressing=useRef<string|null>(null),resolveRef=useRef<()=>void>(()=>{});
  const selected=manifest.actions[actionKey];
  const playback=draft?.key===actionKey?draft.playback:selected?.playback??"loop";
  soundRef.current=muted?null:selected?.sound??null;
  const hasSounds=Object.values(manifest.actions).some(item=>item.sound);
  useEffect(()=>{try{setMuted(window.localStorage.getItem(MUTE_KEY)==="1");}catch{}},[]);
  const toggleMute=()=>{unlockAudio();setMuted(value=>{try{window.localStorage.setItem(MUTE_KEY,value?"0":"1");}catch{}return !value;});};
  // Decode every move's sound up front so the first cue is not late.
  useEffect(()=>{for(const item of Object.values(manifest.actions))if(item.sound)void loadSound(item.sound.url);},[manifest]);
  // Audio may only start after a user gesture.
  useEffect(()=>{window.addEventListener("pointerdown",unlockAudio);window.addEventListener("keydown",unlockAudio);return ()=>{window.removeEventListener("pointerdown",unlockAudio);window.removeEventListener("keydown",unlockAudio);};},[]);
  const frames=useMemo(()=>{
    if(!selected)return [];
    const directional=selected.directions[direction];
    const list=(directional?.mirrorOf?selected.directions[directional.mirrorOf]?.frames:directional?.frames)??[];
    // Draft timing from the inspector previews live before it is saved.
    return draft?.key===actionKey&&draft.durations.length===list.length?list.map((f,i)=>({...f,durationMs:draft.durations[i]})):list;
  },[selected,direction,draft,actionKey]);
  // Key → action map built from both players' bindings (PLAN §6.5).
  const keymap=useMemo(()=>{
    const map=new Map<string,KeyTarget>();
    for(const profile of PROFILES) {
      if(manifest.actions.walk)for(const [code,dir] of Object.entries(movementKeys(profile)))map.set(code,{action:"walk",direction:dir});
      for(const [key,codes] of Object.entries(bindings?.[profile]??{}))if(manifest.actions[key])for(const code of codes)map.set(code,{action:key});
    }
    return map;
  },[bindings,manifest]);
  const p1Keys=(key:string)=>key==="walk"?Object.keys(movementKeys("p1")).map(keyLabel).join("/"):(bindings?.p1[key]??[]).map(keyLabel).join(" ");
  const triggerOf=(key:string)=>manifest.actions[key]?.gameplay.trigger??"press";
  // Turning (e.g. mid-jump or mid-walk) keeps the current timing.
  useEffect(()=>{elapsed.current=0;lastCue.current="";setFrame(0);},[action,manifest.atlas.version]);
  useEffect(()=>{
    if(!playing||!frames.length)return;
    let request=0,last:number|undefined,returned=false;
    const tick=(now:number)=>{
      if(last!==undefined)elapsed.current+=Math.min(100,now-last)*speed;
      last=now;
      const durations=frames.map(f=>f.durationMs),current=frameAtTime(durations,elapsed.current,playback);
      setFrame(current.index);
      const cycle=playback==="loop"?Math.floor(elapsed.current/durations.reduce((sum,ms)=>sum+ms,0)):0,cue=`${cycle}:${current.index}`;
      if(cue!==lastCue.current){lastCue.current=cue;const sound=soundRef.current;if(sound?.frames.includes(current.index))void playSound(sound.url,sound.volume);}
      // A press move started from the keyboard plays through, then the
      // controller resumes whatever is still held (walk, crouch) or idle.
      if(current.finished&&!returned&&pressing.current===actionKey){returned=true;setTimeout(()=>{pressing.current=null;resolveRef.current();},120);}
      request=window.requestAnimationFrame(tick);
    };
    request=window.requestAnimationFrame(tick);return ()=>window.cancelAnimationFrame(request);
  },[playing,speed,frames,playback,actionKey]);
  // A chip click behaves like its key: a "press" move (jump) plays once and
  // then returns to idle (or whatever is still held); others keep playing.
  const choose=(key:string)=>{if(!manifest.actions[key])return;pressing.current=triggerOf(key)==="press"?key:null;toggled.current=null;lastCue.current="";setAction(key);setInspected(key);setPlaying(true);elapsed.current=0;setFrame(0);};
  // Switching action restarts it (see the reset effect); same action keeps playing.
  const play=(key:string)=>{if(!manifest.actions[key])return;setAction(key);setPlaying(true);};
  // Pick the animation implied by the keys still held: a toggled move, then the
  // most recent held "hold" move (crouch), then movement (walk), else idle.
  resolveRef.current=()=>{
    if(toggled.current&&manifest.actions[toggled.current]){play(toggled.current);return;}
    for(const code of [...held.current].reverse()){const target=keymap.get(code);if(target&&!target.direction&&triggerOf(target.action)==="hold"){play(target.action);return;}}
    for(const code of [...held.current].reverse()){const target=keymap.get(code);if(target?.direction){setDirection(target.direction);play("walk");return;}}
    play(fallback);
  };
  useEffect(()=>{
    const ignored=(event:KeyboardEvent)=>{
      if(event.ctrlKey||event.metaKey||event.altKey)return true;
      const target=event.target as HTMLElement|null;
      if(document.querySelector("dialog[open]"))return true;
      return !!target?.closest?.("input,textarea,select,[contenteditable=true],[data-keys-ignore]");
    };
    const down=(event:KeyboardEvent)=>{
      const target=keymap.get(event.code);if(!target||ignored(event))return;
      event.preventDefault();if(event.repeat)return;
      held.current=[...held.current.filter(code=>code!==event.code),event.code];
      if(target.direction){setDirection(target.direction);if(!pressing.current)resolveRef.current();return;}
      const trigger=triggerOf(target.action);
      if(trigger==="toggle"){toggled.current=toggled.current===target.action?null:target.action;pressing.current=null;resolveRef.current();return;}
      if(trigger==="press"){pressing.current=target.action;toggled.current=null;elapsed.current=0;setFrame(0);setAction(target.action);setPlaying(true);return;}
      if(!pressing.current)resolveRef.current();
    };
    const up=(event:KeyboardEvent)=>{
      if(!held.current.includes(event.code))return;
      held.current=held.current.filter(code=>code!==event.code);
      if(!pressing.current)resolveRef.current();
    };
    const reset=()=>{held.current=[];pressing.current=null;resolveRef.current();};
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);window.addEventListener("blur",reset);
    return ()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);window.removeEventListener("blur",reset);};
  // eslint-disable-next-line react-hooks/exhaustive-deps -- triggerOf reads manifest; keymap covers bindings
  },[keymap,manifest]);
  if(!selected)return <section className="panel"><h2>No moves left</h2><p className="muted">Add a move from the Moves tab.</p></section>;
  const inspectedKey=manifest.actions[inspected]?inspected:actionKey;
  const inspectedAction=actions.find(item=>item.key===inspectedKey);
  const facing=Object.keys(selected.directions);
  return <section className="panel" aria-labelledby="preview-title">
    <h2 id="preview-title" className="sr-only">Animation preview</h2>
    <div className={`training${editing&&characterId&&inspectedAction?" editing":""}`}>
      <div className="training-main">
        <div className="action-chips" aria-label="Animation actions">{Object.entries(manifest.actions).map(([key,value])=><button key={key} aria-label={value.label} aria-pressed={actionKey===key} onClick={()=>choose(key)}>{value.label}{p1Keys(key)&&<span className="key" aria-hidden="true">{p1Keys(key)}</span>}</button>)}{onNewMove&&<button className="chip-add" onClick={onNewMove}>+ New move</button>}</div>
        <div className={`animation-stage ${background==="checker"?"checker":background}`} tabIndex={0} role="group" aria-label="Animation stage, keyboard controls"><div className="stage-hud" aria-hidden="true"><span>{selected.label}{selected.sound&&!muted?" ♪":""}</span><span className="live">Keyboard on</span></div><SpritePlayer manifest={manifest} action={actionKey} direction={direction} frame={frame} flip={flip} zoom={zoom} ground={GROUND[background]??null}/></div>
        <p className="key-hint">Try your keyboard: <span className="key">A</span><span className="key">D</span> walk, other moves use the key shown on their button.</p>
        <div className="preview-controls">
          <button className="secondary" onClick={()=>setPlaying(value=>!value)}>{playing?"Pause":"Play"}</button>
          {hasSounds&&<button className="secondary small" aria-pressed={!muted} aria-label={muted?"Unmute sound":"Mute sound"} title={muted?"Sound effects are off":"Sound effects are on"} onClick={toggleMute}>{muted?"🔇 Sound off":"🔊 Sound on"}</button>}
          <label className="frame-scrubber">Frame {frame+1}/{frames.length}<input aria-label="Animation frame" type="range" min={0} max={Math.max(0,frames.length-1)} value={frame} onChange={event=>{const value=Number(event.target.value);setPlaying(false);setFrame(value);elapsed.current=frames.slice(0,value).reduce((sum,f)=>sum+f.durationMs,0);}}/></label>
          {facing.length>1&&<label>Facing <select aria-label="Animation direction" value={direction} onChange={e=>setDirection(e.target.value as Direction)}>{facing.map(dir=><option key={dir} value={dir}>{dir}</option>)}</select></label>}
          <details className="menu view-options"><summary className="button secondary small">View ▾</summary><div className="menu-list form">
            <label>Zoom <select aria-label="Preview zoom" value={zoom} onChange={e=>setZoom(e.target.value as "fit"|"native")}><option value="fit">Fit stage</option><option value="native">100% source pixels</option></select></label>
            <label>Speed <select aria-label="Animation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
            <label>Background <select aria-label="Stage background" value={background} onChange={e=>setBackground(e.target.value)}><option value="arena">Meadow</option><option value="checker">Checkerboard</option><option value="dark">Dark</option><option value="grass">Grass strip</option></select></label>
            <label><input type="checkbox" checked={flip} onChange={e=>setFlip(e.target.checked)}/> Flip horizontally</label>
          </div></details>
          {characterId&&inspectedAction&&onEditingChange&&<button className={editing?"small":"secondary small"} aria-pressed={editing} onClick={()=>onEditingChange(!editing)}>{editing?"Done editing":"Edit move"}</button>}
        </div>
      </div>
      {editing&&characterId&&inspectedAction&&<ActionInspector key={`${inspectedKey}:${inspectedAction.activeVersionId}`} characterId={characterId} manifest={manifest} actionKey={inspectedKey} action={inspectedAction} locked={locked} activeFrame={inspectedKey===actionKey?frame:-1} onDraft={setDraft}/>}
    </div>
  </section>;
}
