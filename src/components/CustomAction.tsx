"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function CustomAction({id,sheetId,running}:{id:string;sheetId:string;running:boolean}) {
  const client=useQueryClient();
  const [prompt,setPrompt]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit() {
    setBusy(true);setError("");
    try {
      const endpoint=`/api/characters/${encodeURIComponent(id)}/actions`;
      const planned=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"plan",prompt})});
      const plan=await planned.json();
      if(!planned.ok)throw new Error(plan.error??"Could not plan action");
      if(plan.sheetId!==sheetId)throw new Error("The character sheet has changed. Refresh before generating an action.");
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"generate",sheetId:plan.sheetId,action:plan.action})});
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Could not create action");
      setPrompt("");await client.invalidateQueries({queryKey:["character",id]});await client.invalidateQueries({queryKey:["characters"]});
    } catch(error){setError(error instanceof Error?error.message:"Could not create action");}
    finally {setBusy(false);}
  }
  return <section className="panel custom-action" aria-labelledby="forge-title"><div className="custom-action-header"><div><h2 id="forge-title">Add a new move</h2><p>Describe an attack, dance, emote, anything. Muse plans the poses and draws them from your character sheet.</p></div></div>
    <form className="action-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
      <label htmlFor="custom-action-prompt">What should your character do?</label>
      <div className="action-composer-box"><textarea id="custom-action-prompt" required rows={3} maxLength={2000} value={prompt} disabled={busy} aria-describedby="action-composer-hint" placeholder="A spinning sword slash with a blue trail, then a confident return to idle…" onChange={event=>setPrompt(event.target.value)}/>
        <div className="action-composer-toolbar"><span id="action-composer-hint">Uses a few Muse image calls</span><div className="action-composer-submit"><span className="action-character-count">{prompt.length.toLocaleString()} / 2,000</span><button disabled={busy||running||!prompt.trim()}>{busy?"Creating…":"Create move"}</button></div></div>
      </div>
      {<div className="action-suggestions"><span>Ideas:</span>{["Spinning sword slash","A cheerful wave","Quick forward dash"].map(idea=><button type="button" key={idea} disabled={busy} onClick={()=>{setPrompt(idea);document.getElementById("custom-action-prompt")?.focus();}}>{idea}</button>)}</div>}
    </form>
    {running && <p className="custom-action-notice" role="status">Wait for the current moves to finish before adding another.</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
