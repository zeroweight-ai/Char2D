"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { frameAtTime } from "@/lib/anim/timeline";
import type { Direction,Manifest } from "@/lib/manifest";
import { SpritePlayer } from "./SpritePlayer";
export function AnimationPreview({manifest}:{manifest:Manifest}) {
  const fallback=manifest.actions.idle?"idle":Object.keys(manifest.actions)[0]??"";
  const [action,setAction]=useState(fallback);
  const actionKey=manifest.actions[action]?action:fallback;
  const [direction,setDirection]=useState<Direction>(manifest.viewType!=="side_scroller"?"down":"right");
  const [playing,setPlaying]=useState(true),[speed,setSpeed]=useState(1),[frame,setFrame]=useState(0),[flip,setFlip]=useState(false);
  const [zoom,setZoom]=useState<"fit"|"native">("fit");
  const [background,setBackground]=useState("checker");
  const elapsed=useRef(0);
  const selected=manifest.actions[actionKey];
  const playback=selected?.playback??"loop";
  const frames=useMemo(()=>{if(!selected)return [];const directional=selected.directions[direction];return (directional?.mirrorOf?selected.directions[directional.mirrorOf]?.frames:directional?.frames)??[];},[selected,direction]);
  useEffect(()=>{elapsed.current=0;setFrame(0);},[action,direction,manifest.atlas.version]);
  useEffect(()=>{
    if(!playing||!frames.length)return;
    let request=0,last:number|undefined;
    const tick=(now:number)=>{
      if(last!==undefined)elapsed.current+=Math.min(100,now-last)*speed;
      last=now;
      const current=frameAtTime(frames.map(f=>f.durationMs),elapsed.current,playback);
      setFrame(current.index);
      request=window.requestAnimationFrame(tick);
    };
    request=window.requestAnimationFrame(tick);return ()=>window.cancelAnimationFrame(request);
  },[playing,speed,frames,playback]);
  const choose=(key:string)=>{if(!manifest.actions[key])return;setAction(key);setPlaying(true);elapsed.current=0;setFrame(0);};
  function keyDown(event:React.KeyboardEvent) {
    if((event.target as HTMLElement).tagName!=="DIV")return;
    if(event.repeat){event.preventDefault();return;}
    const moves:Record<string,Direction>={KeyA:"left",ArrowLeft:"left",KeyD:"right",ArrowRight:"right",KeyW:"up",ArrowUp:"up",KeyS:"down",ArrowDown:"down"};
    if(manifest.viewType==="side_scroller"&&["Space","KeyW","ArrowUp"].includes(event.code)){event.preventDefault();if(!event.repeat)choose("jump");return;}
    if(manifest.viewType==="side_scroller"&&["KeyS","ArrowDown"].includes(event.code)){event.preventDefault();choose("crouch");return;}
    if(moves[event.code]){event.preventDefault();setDirection(moves[event.code]);choose("walk");}
  }
  if(!selected)return <section className="panel"><h2>No actions remaining</h2></section>;
  return <section className="panel"><h2>Animation preview</h2><p className="muted">Choose an action, or focus the stage and use {manifest.viewType==="side_scroller"?"A/D to walk, W or Space to jump, S to crouch":"WASD or arrow keys to walk"}. Movement stays in place.</p>
    <div className="action-chips" aria-label="Animation actions">{Object.entries(manifest.actions).map(([key,value])=><button key={key} aria-pressed={actionKey===key} className={actionKey===key?"":"secondary"} onClick={()=>choose(key)}>{value.label}</button>)}</div>
    <div className={`animation-stage ${background==="checker"?"checker":background}`} tabIndex={0} role="group" aria-label="Animation stage, keyboard controls" onKeyDown={keyDown} onKeyUp={event=>{if((event.target as HTMLElement).tagName==="DIV"){setAction(fallback);elapsed.current=0;}}} onBlur={()=>setAction(fallback)}><SpritePlayer manifest={manifest} action={actionKey} direction={direction} frame={frame} flip={flip} zoom={zoom}/></div>
    <div className="preview-controls"><button onClick={()=>setPlaying(value=>!value)}>{playing?"Pause":"Play"}</button><label>Zoom <select aria-label="Preview zoom" value={zoom} onChange={e=>setZoom(e.target.value as "fit"|"native")}><option value="fit">Fit stage</option><option value="native">100% source pixels</option></select></label><label>Facing <select aria-label="Animation direction" value={direction} onChange={e=>setDirection(e.target.value as Direction)}>{Object.keys(selected.directions).map(dir=><option key={dir} value={dir}>{dir}</option>)}</select></label><label>Speed <select aria-label="Animation speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><label><input type="checkbox" checked={flip} onChange={e=>setFlip(e.target.checked)}/> Flip</label><label>Background <select value={background} onChange={e=>setBackground(e.target.value)}><option value="checker">Checkerboard</option><option value="dark">Dark</option><option value="grass">Grass</option></select></label></div>
    <label className="frame-scrubber">Frame {frame+1}/{frames.length}<input aria-label="Animation frame" type="range" min={0} max={Math.max(0,frames.length-1)} value={frame} onChange={event=>{const value=Number(event.target.value);setPlaying(false);setFrame(value);elapsed.current=frames.slice(0,value).reduce((sum,f)=>sum+f.durationMs,0);}}/></label>
    <a className="button secondary" href={manifest.atlas.url} download="atlas.png">Download atlas PNG</a><button className="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="manifest.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download manifest</button>
  </section>;
}
