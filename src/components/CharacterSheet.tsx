"use client";
import { CustomAction } from "./CustomAction";
import { viewLabels } from "@/lib/manifest";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteButton } from "./DeleteButton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AnimationPreview } from "./AnimationPreview";
import type { CharacterDetail } from "@/lib/character";
export function CharacterSheet({id}:{id:string}) {
  const client=useQueryClient();
  const router=useRouter();
  const [progress,setProgress]=useState(0);
  const [stage,setStage]=useState("Waiting for the worker…");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("");
  const query=useQuery<CharacterDetail>({queryKey:["character",id],queryFn:async()=>{
    const response=await fetch(`/api/characters/${encodeURIComponent(id)}`);
    if(!response.ok) throw new Error(response.status===404 ? "Character not found":"Could not load character");
    return response.json();
  },refetchInterval:query=>query.state.data?.status==="generating" || (query.state.data?.animation?.running??0)>0 ? 1000:false});
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
  async function action(kind:"accept"|"regenerate"|"reprocess") {
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/characters/${id}/sheet/${kind}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(kind==="accept" ? {sheetId:query.data?.sheet?.id}:{note})});
      const result=await response.json();if(!response.ok) throw new Error(result.error ?? "Could not update sheet");
      await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});
    } catch(error) {setError(error instanceof Error ? error.message:"Could not update sheet");}
    finally {setBusy(false);}
  }
  if(query.isPending) return <p role="status">Loading character…</p>;
  if(query.isError) return <section className="panel"><h1>Could not open character</h1><p className="error" role="alert">{query.error.message}</p><Link href="/">Back to characters</Link></section>;
  const character=query.data, sheet=character.sheet;
  const generating=character.status==="generating" && sheet?.status!=="accepted";
  const animating=sheet?.status==="accepted" && character.status==="generating";
  const accepted=sheet?.status==="accepted";
  return <><Link href="/">← Your characters</Link><p className="eyebrow">Character Maker · Review your sheet</p><h1>{character.name}</h1><DeleteButton label="Delete character" title={`Delete ${character.name}?`} description="This permanently deletes this character and its sheets, actions, bindings, chat history, and saved assets. This cannot be undone." endpoint={`/api/characters/${id}`} onDeleted={async()=>{client.removeQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});router.push("/");}}/><span className="badge">{viewLabels[character.viewType]}</span>
    <section className="panel">
      {generating ? <><h2>Creating your pixel-art character</h2><p role="status" aria-live="polite">{stage}</p><progress max={100} value={progress} aria-label="Character generation progress" /><p className="muted">Generation can take a few minutes. You can leave this page and return later.</p></>:character.status==="error" && sheet?.status!=="accepted" ? <><h2>Generation needs another try</h2><p className="error" role="alert">{character.job?.error ?? "Could not finish the character sheet."}</p></>:<><h2>{accepted ? "Character sheet accepted":"Your transparent character sheet"}</h2><p>{accepted ? "Your accepted sheet is the reference for every animation.":"Check the character’s appearance in all three views. The checkerboard shows transparent areas."}</p></>}
      {accepted && character.job?.status==="error" && <p className="error" role="alert">Sheet processing failed: {character.job.error}. Your previous accepted sheet is still available.</p>}
      {sheet?.warnings?.map(warning=><p className="muted" key={warning}>{warning}</p>)}
      {character.job?.revision && <p className="muted" data-testid="revision-strategy"><strong>{character.job.revision.path==="edit_latest" ? "Editing latest sheet":"Generating a fresh sheet"}:</strong> {character.job.revision.reason}</p>}
      {!generating && sheet?.processedAssetId && <div className="checker sheet-stage"><Image src={`/api/assets/${sheet.processedAssetId}`} alt={`${character.name} transparent character sheet`} width={960} height={640} unoptimized className="pixel-preview" /></div>}
      {!generating && sheet?.processedAssetId && <div className="sheet-actions">{(!accepted || !character.animation) && <button disabled={busy} onClick={()=>action("accept")}>{accepted?"Generate default animations":"Looks good — accept sheet"}</button>}<a className="button secondary" href={`/api/assets/${sheet.processedAssetId}`} download={`${character.name.replace(/[^a-z0-9_-]/gi,"-")}-sheet.png`}>Download transparent PNG</a></div>}
      {!generating && !animating && !(character.animation?.running) && <div className="revision"><label htmlFor="revision-note">Revision note (optional)</label><input id="revision-note" value={note} maxLength={1000} placeholder="e.g. Keep the helmet, make the cape shorter" onChange={event=>setNote(event.target.value)} /><button className="secondary" disabled={busy} onClick={()=>action("regenerate")}>{busy ? "Saving…":"Regenerate sheet"}</button><p className="muted">Muse chooses whether to edit the latest sheet or start fresh based on your note. A revision uses a small planning call and one image generation; an empty note requests a fresh variation. Previous versions are retained.</p></div>}
      {!generating && !animating && !character.animation?.running && sheet?.rawAssetId && (sheet.status==="error"||!sheet.fullResolution) && <><button disabled={busy} onClick={()=>action("reprocess")}>{sheet.status==="error"?"Retry saved sheet processing":"Restore full-resolution sheet"}</button><p className="muted">Uses the saved image. No new Muse generation or charge.</p></>}
      {error && <p role="alert" className="error">{error}</p>}
      {(!accepted || !character.animation) && sheet?.processedAssetId && <p className="muted">Accepting starts at least {character.viewType==="side_scroller"?"4":"6"} default animation image calls when Muse is enabled. Each action uses a maximum of 4 frames. Large native-resolution poses may need more batches; malformed strips may need a retry.</p>}
    </section>
    {accepted && character.animation && <section className="panel"><h2>{!character.animation.actions.length?"No actions remaining":character.status==="ready"?"Animations ready":character.animation.error?"Animation generation needs attention":"Generating animations"}</h2><progress value={character.animation.done} max={character.animation.total} aria-label="Animation generation progress"/><p role="status">{character.animation.done}/{character.animation.total} processing steps complete{animating?` · ${stage}`:""}</p><div className="action-management">{character.animation.actions.map(action=><div className="action-management-row" key={action.key}><span className="badge">{action.label} · v{action.version} · {action.status}</span><button className="secondary" disabled={busy||character.animation!.running>0} onClick={async()=>{
      setBusy(true);setError("");
      try{const response=await fetch(`/api/characters/${id}/actions/${encodeURIComponent(action.key)}/regenerate`,{method:"POST"});const value=await response.json();if(!response.ok)throw new Error(value.error??"Could not regenerate action");await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});}
      catch(error){setError(error instanceof Error?error.message:"Could not regenerate action");}finally{setBusy(false);}
    }}>Regenerate {action.label}</button><small className="muted">{action.imageCalls??1} image call{action.imageCalls===1?"":"s"}</small>{!action.nativeResolution && <button className="secondary" disabled={busy||character.animation!.running>0} onClick={async()=>{
      setBusy(true);setError("");try{const response=await fetch(`/api/characters/${id}/actions/${encodeURIComponent(action.key)}/reprocess`,{method:"POST"});const value=await response.json();if(!response.ok)throw new Error(value.error??"Could not restore action frames");await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});}catch(error){setError(error instanceof Error?error.message:"Could not restore action frames");}finally{setBusy(false);}
    }}>Restore native frames: {action.label} (no AI call)</button>}<DeleteButton label={`Delete ${action.label}`} title={`Delete ${action.label}?`} description="This permanently removes the action, all its versions, and its key bindings. The remaining atlas will be rebuilt without an AI call." endpoint={`/api/characters/${id}/actions/${encodeURIComponent(action.key)}`} disabled={busy||character.animation!.running>0} onDeleted={async()=>{await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});}}/></div>)}</div>{character.animation.error && <><p className="error" role="alert">{character.animation.error}</p><button disabled={busy||character.animation.running>0} onClick={async()=>{setBusy(true);setError("");try{const response=await fetch(`/api/characters/${id}/animations/retry`,{method:"POST"});const value=await response.json();if(!response.ok)throw new Error(value.error);await client.invalidateQueries({queryKey:["character",id]});}catch(error){setError(error instanceof Error?error.message:"Could not retry animations");}finally{setBusy(false);}}}>Retry failed animations</button></>}{character.animation.warnings.map(warning=><p className="muted" key={warning}>{warning}</p>)}</section>}
    {accepted && sheet && <CustomAction key={sheet.id} id={id} sheetId={sheet.id} running={!!character.animation?.running}/>}
    {accepted && character.manifest && <AnimationPreview key={character.manifest.atlas.version} manifest={character.manifest}/>}
  </>;
}
