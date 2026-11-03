"use client";
import { CustomAction } from "./CustomAction";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteButton } from "./DeleteButton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AnimationPreview } from "./AnimationPreview";
import { ControlsPanel } from "./ControlsPanel";
import { heroStatus } from "./CharacterGallery";
import { keyLabel } from "@/lib/bindings";
import type { CharacterAction,CharacterDetail } from "@/lib/character";
import { playSound } from "@/lib/anim/sound-player";
const soundPending=(move:CharacterAction)=>move.sound?.status==="queued"||move.sound?.status==="generating";
const TIPS=[
  "Tip: after this, you’ll review the sheet before any animation is made.",
  "Tip: a short note like “shorter cape” edits the sheet instead of starting over.",
  "Tip: you can describe new moves in plain words, like “a spinning kick”.",
  "Tip: exports include a sprite atlas and a manifest for your game engine.",
];
const STEPS=["Create","Review","Animate","Play"];
type Tab="play"|"moves"|"controls"|"sheet";
const TABS:{key:Tab;label:string}[]=[{key:"play",label:"Play"},{key:"moves",label:"Moves"},{key:"controls",label:"Controls"},{key:"sheet",label:"Character sheet"}];
export function CharacterSheet({id}:{id:string}) {
  const client=useQueryClient();
  const router=useRouter();
  const [progress,setProgress]=useState(0);
  const [stage,setStage]=useState("Waiting for the worker…");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("");
  const [tip,setTip]=useState(0);
  const [tab,setTab]=useState<Tab>("play");
  const [editing,setEditing]=useState(false);
  const focusComposer=useRef(false);
  const query=useQuery<CharacterDetail>({queryKey:["character",id],queryFn:async()=>{
    const response=await fetch(`/api/characters/${encodeURIComponent(id)}`);
    if(!response.ok) throw new Error(response.status===404 ? "Character not found":"Could not load character");
    return response.json();
  },refetchInterval:query=>query.state.data?.status==="generating" || (query.state.data?.animation?.running??0)>0 || query.state.data?.animation?.actions.some(soundPending) ? 1000:false});
  const jobId=query.data?.job?.id;
  const jobStatus=query.data?.job?.status;
  useEffect(()=>{
    setProgress(0);setStage("Waiting for the worker…");
    if(!jobId || jobStatus==="done" || jobStatus==="error") return;
    const source=new EventSource(`/api/events?jobId=${encodeURIComponent(jobId)}`);
    source.onmessage=event=>{
      const data=JSON.parse(event.data);
      if(typeof data.progress==="number") setProgress(data.progress);
      if(data.message) setStage(data.message);
      if(data.kind==="done" || data.kind==="error") {source.close();void client.invalidateQueries({queryKey:["character",id]});}
    };
    return ()=>source.close();
  },[id,jobId,jobStatus,client]);
  const watchAnimations=!!query.data?.animation?.running;
  useEffect(()=>{
    if(!watchAnimations)return;
    const source=new EventSource(`/api/events?characterId=${encodeURIComponent(id)}`);
    source.onmessage=event=>{
      const data=JSON.parse(event.data);
      if(data.message)setStage(data.message);
      if(data.kind==="done"||data.kind==="error"||data.kind==="qa")void client.invalidateQueries({queryKey:["character",id]});
    };
    return ()=>source.close();
  },[id,watchAnimations,client]);
  const busyWorld=query.data?.status==="generating";
  useEffect(()=>{if(!busyWorld)return;const timer=setInterval(()=>setTip(value=>(value+1)%TIPS.length),6000);return ()=>clearInterval(timer);},[busyWorld]);
  useEffect(()=>{if(tab==="moves"&&focusComposer.current){focusComposer.current=false;document.getElementById("custom-action-prompt")?.focus();}},[tab]);
  async function refresh(){await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});}
  async function action(kind:"accept"|"regenerate"|"reprocess") {
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/characters/${id}/sheet/${kind}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(kind==="accept" ? {sheetId:query.data?.sheet?.id}:{note})});
      const result=await response.json();if(!response.ok) throw new Error(result.error ?? "Could not update sheet");
      if(kind==="regenerate")setNote("");
      await refresh();
    } catch(error) {setError(error instanceof Error ? error.message:"Could not update sheet");}
    finally {setBusy(false);}
  }
  async function actionRequest(path:string,fallback:string,method:"POST"|"DELETE"="POST"){
    setBusy(true);setError("");
    try{const response=await fetch(`/api/characters/${id}/${path}`,{method});const value=await response.json();if(!response.ok)throw new Error(value.error??fallback);await refresh();}
    catch(error){setError(error instanceof Error?error.message:fallback);}finally{setBusy(false);}
  }
  if(query.isPending) return <section className="panel"><p role="status">Loading character…</p><progress aria-label="Loading character"/></section>;
  if(query.isError) return <section className="panel"><h1>Could not open character</h1><p className="error" role="alert">{query.error.message}</p><Link className="button" href="/">◂ Back to my characters</Link></section>;
  const character=query.data, sheet=character.sheet;
  const generating=character.status==="generating" && sheet?.status!=="accepted";
  const animating=sheet?.status==="accepted" && character.status==="generating";
  const accepted=sheet?.status==="accepted";
  const anim=character.animation;
  const moves=anim?.actions.length??0;
  const workspace=accepted&&!!character.manifest;
  const step=generating||!sheet?.processedAssetId?0:!accepted?1:!workspace||animating?2:3;
  const animationsLocked=busy||(anim?.running??0)>0;
  const status=heroStatus(character);
  const fileName=character.name.replace(/[^a-z0-9_-]/gi,"-");
  const canRevise=!generating && !animating && !anim?.running;

  const reprocessButton=canRevise && sheet?.rawAssetId && (sheet.status==="error"||!sheet.fullResolution) && <p className="fine-print"><button className="secondary small" disabled={busy} onClick={()=>action("reprocess")}>{sheet.status==="error"?"Retry saved sheet processing":"Restore full-resolution sheet"}</button> Reuses the saved image, no new Muse call.</p>;
  const revision=(title:string,hint:string)=>canRevise && <div className="revision"><h3>{title}</h3><label htmlFor="revision-note">Revision note (optional)</label><div className="revision-row"><input id="revision-note" value={note} maxLength={1000} placeholder="e.g. Keep the helmet, make the cape shorter" onChange={event=>setNote(event.target.value)} /><button className="secondary" disabled={busy} onClick={()=>action("regenerate")}>{busy ? "Saving…":"Regenerate sheet"}</button></div><p className="fine-print">{hint}</p></div>;
  const strategy=character.job?.revision && <p className="muted" data-testid="revision-strategy"><strong>{character.job.revision.path==="edit_latest" ? "Editing latest sheet":"Generating a fresh sheet"}:</strong> {character.job.revision.reason}</p>;
  const sheetImage=sheet?.processedAssetId && <div className="checker sheet-stage"><Image src={`/api/assets/${sheet.processedAssetId}`} alt={`${character.name} transparent character sheet`} width={960} height={640} unoptimized className="pixel-preview" /></div>;

  // Step 1: drawing the sheet.
  const drawingPanel=<section className="panel" aria-labelledby="sheet-title"><div className="summoning">
    {/* eslint-disable-next-line @next/next/no-img-element -- decorative pixel sprite */}
    <img className="sprite bob" src="/game/sprite-fairy.png" alt="" width={120} height={111} />
    <div><h2 id="sheet-title">Drawing your character…</h2><p role="status" aria-live="polite">{stage}</p><progress max={100} value={progress} aria-label="Character generation progress" /><p className="muted">This usually takes a minute or two. You can leave this page and come back.</p><p className="tip">{TIPS[tip]}</p></div>
  </div></section>;

  const errorPanel=<section className="panel" aria-labelledby="sheet-title"><h2 id="sheet-title">The sheet couldn’t be finished</h2><p className="error" role="alert">{character.job?.error ?? "Could not finish the character sheet."}</p>{reprocessButton}{revision("Try again","Add a note to steer the next attempt, or leave it empty for a fresh try.")}</section>;

  // Step 2: review. One primary action, revising is secondary.
  const reviewPanel=<section className="panel" aria-labelledby="sheet-title">
    <h2 id="sheet-title">Your transparent character sheet</h2>
    <p className="muted">Check the side, front and back views. The checkerboard shows see-through areas.</p>
    {sheet?.warnings?.map(warning=><p className="muted" key={warning}>{warning}</p>)}
    {strategy}
    {sheetImage}
    <div className="review-actions"><button className="big" disabled={busy} onClick={()=>action("accept")}>Looks good — accept sheet</button><p className="fine-print">Next, Muse animates idle, walk, jump and crouch. That uses about 4–8 image calls.</p></div>
    {reprocessButton}
    {revision("Not quite right?","Describe a fix to edit this sheet, or leave it empty for a fresh variation. Uses one image generation.")}
  </section>;

  // Step 3 (first time): default moves are being made.
  const animatingPanel=accepted&&<section className="panel" aria-labelledby="moves-title">
    {anim?<><div className="summoning">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative pixel sprite */}
      <img className="sprite bob" src="/game/sprite-fairy.png" alt="" width={120} height={111} />
      <div><h2 id="moves-title">{anim.error?"Animation needs attention":"Animating your character…"}</h2>
        <progress value={anim.done} max={anim.total} aria-label="Animation generation progress"/>
        <p role="status" className="muted">{anim.running?stage:`${anim.done}/${anim.total} steps done`}</p>
        <ul className="move-status">{anim.actions.map(move=><li key={move.key}><span>{move.label}</span><span className={`pill ${move.status==="ready"?"ready":move.status==="error"?"error":"running"}`}>{move.status==="ready"?"✓ Done":move.status==="error"?"Failed":"Working…"}</span></li>)}</ul>
        {anim.error?<><p className="error" role="alert">{anim.error}</p><button disabled={animationsLocked} onClick={()=>actionRequest("animations/retry","Could not retry animations")}>Retry failed animations</button></>:<p className="muted">You can leave this page and come back.</p>}
      </div>
    </div></>:<><h2 id="moves-title">Sheet accepted</h2><p className="muted">Animations haven’t been made yet.</p><button className="big" disabled={busy} onClick={()=>action("accept")}>Generate default animations</button></>}
  </section>;

  const movesPanel=anim&&<section className="panel" aria-labelledby="moves-list-title">
    <div className="panel-title"><h2 id="moves-list-title">Your moves</h2></div>
    <p className="muted">Regenerate redraws a move with Muse. Earlier versions are kept: switch back from Play → Edit move. Walk, jump and crouch come with built-in sounds; new moves get one from the AI when they need it.{character.soundAvailable?" Use Add sound / New sound to make a different one.":""}</p>
    {!character.soundAvailable&&<p className="fine-print">Making new sounds is off. Add ELEVENLABS_API_KEY to .env and restart to generate sounds for new moves.</p>}
    <ul className="move-rows">{anim.actions.map(move=>{
      const keys=character.bindings?.p1[move.key]??[];
      const count=move.versions?.filter(version=>version.status==="ready").length??1;
      const sound=move.sound,pending=soundPending(move),soundPath=`actions/${encodeURIComponent(move.key)}/sound`;
      const soundNote=!sound?null:pending?<span className="pill running">♪ Making sound…</span>
        :sound.url?<span className="sound-note" title={sound.prompt??undefined}>♪ {sound.requestedBy==="user"?"Sound added":sound.requestedBy==="default"?"Built-in sound":"Sound"}{sound.frames.length?` on frame ${sound.frames.map(f=>f+1).join(" & ")}`:""}</span>
        :sound.status==="none"?<span className="sound-note muted">No sound{sound.reason?`: ${sound.reason}`:""}</span>:null;
      const soundButtons=sound&&!pending&&move.activeVersionId&&<>
        {sound.url&&<button className="quiet-button" aria-label={`Play ${move.label} sound`} onClick={()=>void playSound(sound.url!,0.8,{force:true})}>▶ Sound</button>}
        {character.soundAvailable&&<button className="quiet-button" disabled={busy} aria-label={`${sound.url?"Regenerate":"Generate"} ${move.label} sound`} title="Uses one ElevenLabs sound generation." onClick={()=>actionRequest(soundPath,"Could not make the sound")}>{sound.url?"New sound":"Add sound"}</button>}
        {sound.url&&<button className="quiet-button" disabled={busy} aria-label={`Remove ${move.label} sound`} onClick={()=>actionRequest(soundPath,"Could not remove the sound","DELETE")}>Mute</button>}
      </>;
      return <li className="move-row" key={move.key}>
        <div className="move-name"><h3>{move.label}</h3><span className="move-meta">{keys.length>0&&<span>{keys.map(code=><span className="key" key={code}>{keyLabel(code)}</span>)}</span>}<span>Version {move.activeVersion??move.version}{count>1?` · ${count} saved`:""}</span>{move.status!=="ready"&&<span className={`pill ${move.status==="error"?"error":"running"}`}>{move.status==="error"?"Failed":"Working…"}</span>}{soundNote}</span>{move.error&&<span className="error">{move.error}</span>}{sound?.error&&!pending&&<span className="error">Sound: {sound.error}</span>}</div>
        <div className="move-row-actions">
          {soundButtons}
          {!move.nativeResolution && <button className="quiet-button" disabled={animationsLocked} aria-label={`Restore native frames: ${move.label} (no AI call)`} title="Re-extract the saved frames at full resolution. No AI call." onClick={()=>actionRequest(`actions/${encodeURIComponent(move.key)}/reprocess`,"Could not restore action frames")}>Fix resolution</button>}
          <button className="secondary small" disabled={animationsLocked} aria-label={`Regenerate ${move.label}`} onClick={()=>actionRequest(`actions/${encodeURIComponent(move.key)}/regenerate`,"Could not regenerate action")}>Regenerate</button>
          <DeleteButton quiet text="Delete" label={`Delete ${move.label}`} title={`Delete ${move.label}?`} description="This removes the move, all its versions and its keys. The sprite atlas is rebuilt without an AI call." endpoint={`/api/characters/${id}/actions/${encodeURIComponent(move.key)}`} disabled={animationsLocked} onDeleted={refresh}/>
        </div>
      </li>;})}</ul>
    {anim.warnings.length>0&&<details className="warnings"><summary>{anim.warnings.length} quality note{anim.warnings.length===1?"":"s"}</summary>{anim.warnings.map(warning=><p className="muted" key={warning}>{warning}</p>)}</details>}
  </section>;

  const sheetTab=<section className="panel" aria-labelledby="sheet-title">
    <div className="panel-title"><h2 id="sheet-title">Character sheet</h2><a className="button secondary small" href={`/api/assets/${sheet?.processedAssetId}`} download={`${fileName}-sheet.png`}>Download PNG</a></div>
    <p className="muted">Every animation is drawn from this sheet.</p>
    {accepted && character.job?.status==="error" && <p className="error" role="alert">Sheet processing failed: {character.job.error}. Your accepted sheet is still in use.</p>}
    {sheetImage}
    {reprocessButton}
    {revision("Redraw the sheet","You’ll review the new sheet before it replaces this one. Uses one image generation.")}
  </section>;

  const runningBanner=workspace&&anim&&(anim.running>0||anim.error)&&<div className={`status-banner${anim.error?" error":""}`} role="status">
    {anim.error?<><span><strong>Some moves failed.</strong> {anim.error}</span><button className="small" disabled={animationsLocked} onClick={()=>actionRequest("animations/retry","Could not retry animations")}>Retry failed animations</button></>
      :<><span><strong>Updating moves…</strong> {stage}</span><progress value={anim.done} max={anim.total} aria-label="Animation generation progress"/></>}
  </div>;

  function onTabKey(event:React.KeyboardEvent){
    if(event.key!=="ArrowRight"&&event.key!=="ArrowLeft")return;event.preventDefault();
    const index=TABS.findIndex(item=>item.key===tab),next=TABS[(index+(event.key==="ArrowRight"?1:TABS.length-1))%TABS.length].key;
    setTab(next);document.getElementById(`tab-${next}`)?.focus();
  }

  return <>
    <Link className="back-link" href="/#party">◂ My characters</Link>
    <section className="hud" aria-label="Character">
      <div className="hud-portrait">{sheet?.processedAssetId&&!generating?<Image src={`/api/assets/${sheet.processedAssetId}`} alt="" width={96} height={96} unoptimized/>:<span aria-hidden="true">?</span>}</div>
      <div>
        <h1>{character.name}</h1>
        <div className="hud-stats"><span className={`pill ${status.tone}`} data-testid="hero-status">{status.label}</span>{moves>0&&<span className="badge">{moves} move{moves===1?"":"s"}</span>}</div>
      </div>
      <div className="hud-actions">
        {character.manifest&&<details className="menu"><summary className="button small">Export ▾</summary><div className="menu-list" onClick={event=>{const menu=event.currentTarget.closest("details");if(menu)menu.open=false;}}>
          <a href={character.manifest.atlas.url} download={`${fileName}-atlas.png`}>Sprite atlas (PNG)</a>
          <button type="button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(character.manifest,null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download=`${fileName}-manifest.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Animation manifest (JSON)</button>
          {sheet?.processedAssetId&&<a href={`/api/assets/${sheet.processedAssetId}`} download={`${fileName}-sheet.png`}>Character sheet (PNG)</a>}
        </div></details>}
        <DeleteButton quiet label="Delete character" title={`Delete ${character.name}?`} description="This permanently deletes this character, its sheets, moves, keys and saved images. This cannot be undone." endpoint={`/api/characters/${id}`} onDeleted={async()=>{client.removeQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});router.push("/");}}/>
      </div>
    </section>
    {!workspace&&<ol className="quest-track" aria-label="Progress">{STEPS.map((label,index)=><li key={label} className={index<step?"done":index===step?"current":""} aria-current={index===step?"step":undefined}>{label}</li>)}</ol>}
    {error && <p role="alert" className="panel error">{error}</p>}
    {generating?drawingPanel
      :character.status==="error"&&!accepted?errorPanel
      :!accepted?(sheet?.processedAssetId?reviewPanel:drawingPanel)
      :!workspace?animatingPanel
      :<>
        {runningBanner}
        <div className="tabs" role="tablist" aria-label="Character workspace" data-keys-ignore onKeyDown={onTabKey}>
          {TABS.map(item=><button key={item.key} type="button" role="tab" id={`tab-${item.key}`} className="tab" aria-selected={tab===item.key} aria-controls={`panel-${item.key}`} tabIndex={tab===item.key?0:-1} onClick={()=>setTab(item.key)}>{item.label}</button>)}
        </div>
        <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab==="play"&&character.manifest&&<AnimationPreview key={character.manifest.atlas.version} manifest={character.manifest} characterId={id} actions={anim?.actions} bindings={character.bindings} locked={animationsLocked||character.status==="generating"} onNewMove={()=>{focusComposer.current=true;setTab("moves");}} editing={editing} onEditingChange={setEditing}/>}
          {tab==="moves"&&<>{sheet&&<CustomAction key={sheet.id} id={id} sheetId={sheet.id} running={!!anim?.running}/>}{movesPanel}</>}
          {tab==="controls"&&character.manifest&&character.bindings&&<ControlsPanel characterId={id} manifest={character.manifest} bindings={character.bindings}/>}
          {tab==="sheet"&&sheetTab}
        </div>
      </>}
  </>;
}
