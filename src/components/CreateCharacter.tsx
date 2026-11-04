"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PixelIcon } from "./PixelIcon";
import { MAX_CHARACTER_ZIP_BYTES } from "@/lib/character-archive";
const ACCEPTED=["image/png","image/jpeg","image/webp"];
export function CreateCharacter() {
  const router=useRouter();
  const [mode,setMode]=useState<"upload"|"prompt"|"zip">("upload");
  const [file,setFile]=useState<File|null>(null);
  const [archive,setArchive]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  const [dragging,setDragging]=useState(false);
  const [name,setName]=useState(""),[description,setDescription]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const health=useQuery<{mode:string;keyPresent:boolean}>({queryKey:["health"],enabled:mode!=="zip",queryFn:async()=>{const r=await fetch("/api/settings/health");if(!r.ok)throw new Error("Could not check AI connection");return r.json();}});
  useEffect(()=>{
    if(!file) {setPreview("");return;}
    const url=URL.createObjectURL(file);setPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[file]);
  function pick(next:File|undefined|null){
    setError("");if(!next)return;
    if(!ACCEPTED.includes(next.type)){setError("Use a PNG, JPEG, or WebP image.");return;}
    if(next.size>10*1024*1024){setError("Images must be 10 MB or smaller.");return;}
    setFile(next);
  }
  function pickArchive(next:File|undefined|null){
    setError("");if(!next)return;
    if(!next.name.toLowerCase().endsWith(".zip")){setError("Choose a character ZIP downloaded from Char2D.");return;}
    if(next.size>MAX_CHARACTER_ZIP_BYTES){setError("Character ZIPs must be 100 MB or smaller.");return;}
    setArchive(next);
  }
  const missing=[mode==="upload"&&!file?"an image":mode==="prompt"&&!description.trim()?"a description":mode==="zip"&&!archive?"a ZIP file":null,mode!=="zip"&&!name.trim()?"a name":null].filter(Boolean) as string[];
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");
    if(missing.length){setError(`Add ${missing.join(" and ")} first.`);return;}
    const form=new FormData(event.currentTarget);form.set("mode",mode);form.delete("creation-mode");form.delete("image-picker");
    form.delete("archive-picker");
    if(mode==="upload"&&file){form.set("image",file);form.set("description","");}
    if(mode==="zip"&&archive){form.delete("mode");form.set("archive",archive);}
    setBusy(true);
    try {
      const response=await fetch(mode==="zip"?"/api/characters/import":"/api/characters",{method:"POST",body:form});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error ?? "Could not create character");
      router.push(`/characters/${result.id}`);
    } catch(error) {setError(error instanceof Error ? error.message:"Could not create character");setBusy(false);}
  }
  const cost=health.data?.mode==="fake" ? "Fake AI mode: free test run.":health.data?.mode==="muse" ? "Uses one Muse image generation.":"";
  return <form className="panel create-form character-form" onSubmit={submit} noValidate>
    <fieldset disabled={busy}>
      <section className="form-step" aria-labelledby="step-source">
        <div className="step-head"><span className="step-no">1</span><h2 id="step-source">Choose how to start</h2></div>
        <fieldset className="creation-options three"><legend className="sr-only">How would you like to start?</legend>
          <label className={`option-card row ${mode==="upload" ? "selected":""}`}><input type="radio" name="creation-mode" checked={mode==="upload"} onChange={()=>{setMode("upload");setError("");}} /><PixelIcon name="upload" className="option-icon"/><span><strong>Upload an image</strong><small>A photo, drawing or sprite</small></span></label>
          <label className={`option-card row ${mode==="prompt" ? "selected":""}`}><input type="radio" name="creation-mode" checked={mode==="prompt"} onChange={()=>{setMode("prompt");setError("");}} /><PixelIcon name="quill" className="option-icon"/><span><strong>Describe a character</strong><small>Write what it looks like</small></span></label>
          <label className={`option-card row ${mode==="zip" ? "selected":""}`}><input type="radio" name="creation-mode" checked={mode==="zip"} onChange={()=>{setMode("zip");setError("");}} /><PixelIcon name="upload" className="option-icon"/><span><strong>Upload a ZIP</strong><small>Restore exported frames</small></span></label>
        </fieldset>
        {mode==="upload" ? <>
          <label className={`dropzone${dragging?" dragging":""}${preview?" has-file":""}`} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);pick(event.dataTransfer.files?.[0]);}}>
            <input id="character-image" name="image-picker" aria-label="Character image" className="sr-only" type="file" accept={ACCEPTED.join(",")} onChange={event=>pick(event.target.files?.[0])} />
            {preview ? <><Image src={preview} alt="Source image preview" width={240} height={200} unoptimized className="upload-preview" /><span className="dropzone-text"><strong>{file?.name}</strong><small>Click or drop to replace</small></span></>
              :<><PixelIcon name="upload" className="dropzone-icon"/><span className="dropzone-text"><strong>Drop an image here, or click to choose</strong><small>PNG, JPEG or WebP, up to 10 MB</small></span></>}
          </label>
        </>:mode==="zip"?<label className={`dropzone${dragging?" dragging":""}${archive?" has-file":""}`} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);pickArchive(event.dataTransfer.files?.[0]);}}>
          <input name="archive-picker" aria-label="Character ZIP" className="sr-only" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={event=>pickArchive(event.target.files?.[0])}/>
          <PixelIcon name="upload" className="dropzone-icon"/><span className="dropzone-text"><strong>{archive?.name??"Drop a character ZIP here, or click to choose"}</strong><small>{archive?"Click or drop to replace":"ZIP exported from Char2D, up to 100 MB"}</small></span>
        </label>:<>
          <label className="field-label" htmlFor="character-description">Describe your character</label>
          <textarea id="character-description" name="description" maxLength={2000} rows={4} value={description} onChange={event=>setDescription(event.target.value)} placeholder="A knight in a forest-green tunic and cape, steel armor, brown boots, carrying a sword" />
        </>}
      </section>
      <section className="form-step" aria-labelledby="step-name">
        <div className="step-head"><span className="step-no">2</span><h2 id="step-name">{mode==="zip"?"Rename it (optional)":"Give it a name"}</h2></div>
        <label className="sr-only" htmlFor="character-name">{mode==="zip"?"Character name (optional)":"Character name"}</label>
        <input id="character-name" name="name" maxLength={80} placeholder={mode==="zip"?"Leave blank to keep the exported name":"e.g. Rowan the Green Knight"} value={name} onChange={event=>setName(event.target.value)} />
      </section>
      <div className="submit-row">
        <button type="submit" className="big">{mode==="zip"?(busy?"Importing…":"Import character"):(busy?"Starting…":"Generate character sheet")}</button>
        <p className="fine-print" aria-live="polite">{missing.length?`Add ${missing.join(" and ")} to continue.`:mode==="zip"?"Restores your frames, moves and controls. No AI generation.":`${cost} Takes a minute or two.`.trim()}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  </form>;
}
