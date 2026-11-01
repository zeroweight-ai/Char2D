"use client";
import { viewLabels, type ViewType } from "@/lib/manifest";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
export function CreateCharacter() {
  const router=useRouter();
  const [viewType,setViewType]=useState<ViewType>("side_scroller");
  const [mode,setMode]=useState<"upload"|"prompt">("upload");
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const health=useQuery<{mode:string;keyPresent:boolean}>({queryKey:["health"],queryFn:async()=>{const r=await fetch("/api/settings/health");if(!r.ok)throw new Error("Could not check AI connection");return r.json();}});
  useEffect(()=>{
    if(!file) {setPreview("");return;}
    const url=URL.createObjectURL(file);setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");
    const form=new FormData(event.currentTarget);form.set("mode",mode);
    if(mode==="upload") {
      if(!file) {setError("Choose an image to convert.");return;}
      if(file.size>10*1024*1024) {setError("Upload must be 10 MB or smaller.");return;}
      form.set("image",file);
    }
    setBusy(true);
    try {
      const response=await fetch("/api/characters",{method:"POST",body:form});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error ?? "Could not create character");
      router.push(`/characters/${result.id}`);
    } catch(error) {setError(error instanceof Error ? error.message:"Could not create character");setBusy(false);}
  }
  return <>
    <fieldset className="creation-options" disabled={busy}><legend>How would you like to start?</legend>
      <label className={`option-card ${mode==="upload" ? "selected":""}`}><input type="radio" name="creation-mode" checked={mode==="upload"} onChange={()=>{setMode("upload");setError("");}} /><span><strong>Upload an image</strong><small>Turn your photo or drawing into a pixel-art character.</small></span></label>
      <label className={`option-card ${mode==="prompt" ? "selected":""}`}><input type="radio" name="creation-mode" checked={mode==="prompt"} onChange={()=>{setMode("prompt");setError("");}} /><span><strong>Describe a character</strong><small>Give Muse an idea and create an original character.</small></span></label>
    </fieldset>
    <form className="panel character-form" onSubmit={submit}><fieldset disabled={busy}>
      <fieldset className="creation-options"><legend>Choose your character view</legend>
        {(Object.keys(viewLabels) as ViewType[]).map(view=><label key={view} className={`option-card ${viewType===view?"selected":""}`}><input type="radio" name="viewType" value={view} checked={viewType===view} onChange={()=>setViewType(view)}/><span><strong>{viewLabels[view]}</strong><small>{view==="side_scroller"?"Eye-level perspective for side-scrolling games.":view==="top_down"?"Steep overhead perspective for top-down games.":"An elevated 45° perspective showing front and side depth."}</small></span></label>)}
      </fieldset>
      {mode==="upload" && <div className="upload-box"><label htmlFor="character-image">Character image</label><input id="character-image" type="file" accept="image/png,image/jpeg,image/webp" required onChange={event=>setFile(event.target.files?.[0] ?? null)} /><p className="muted">PNG, JPEG, or WebP · up to 10 MB</p>{preview && <Image src={preview} alt="Source image preview" width={240} height={200} unoptimized className="upload-preview" />}</div>}
      <label htmlFor="character-name">Character name</label><input id="character-name" name="name" required maxLength={80} placeholder="e.g. Rowan the Green Knight" />
      <label htmlFor="character-description">{mode==="prompt" ? "Describe your character":"Appearance notes (optional)"}</label><textarea id="character-description" name="description" required={mode==="prompt"} maxLength={2000} rows={5} placeholder={mode==="prompt" ? "A male knight wearing a forest-green tunic and cape, steel armor, brown boots, and a sword…":"Describe details you want to preserve or adjust…"} />
      <p className="muted">We’ll generate a three-view pixel-art sheet, choose a contrasting background, and remove it. You can review the transparent result before accepting it.</p>
      <p className="badge">{health.data?.mode==="fake" ? "Fake AI is enabled — this will use a test fixture.":health.data?.mode==="muse" ? "Muse Image — one paid image generation.":"Checking AI connection…"}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div><button type="submit">{busy ? "Starting generation…":"Generate character sheet"}</button></div>
    </fieldset></form>
  </>;
}
