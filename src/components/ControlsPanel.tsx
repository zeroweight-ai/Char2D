"use client";
import { useRef,useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Manifest } from "@/lib/manifest";
import { MAX_CODES_PER_ACTION,PROFILES,RESERVED_CODES,codeOwner,isBindable,keyLabel,movementKeys,profileLabels,type Bindings,type Profile } from "@/lib/bindings";
type Capture={profile:Profile;action:string;replacing:string|null};
type Pending={code:string;owner:{profile:Profile;action:string}};
export function ControlsPanel({characterId,manifest,bindings}:{characterId:string;manifest:Manifest;bindings:Bindings}) {
  const client=useQueryClient();
  const dialog=useRef<HTMLDialogElement>(null);
  const [capture,setCapture]=useState<Capture|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const label=(key:string)=>manifest.actions[key]?.label??key;
  const actionKeys=Object.keys(manifest.actions).filter(key=>key!=="idle"&&key!=="walk");
  function open(next:Capture){setCapture(next);setPending(null);setError("");setMessage("");dialog.current?.showModal();}
  function close(){dialog.current?.close();}
  async function save(steps:{profile:Profile;bindings:Record<string,string[]>}[],success:string){
    setBusy(true);setError("");
    try{
      // Steps run in order so the server never sees the same key twice.
      for(const step of steps){
        const response=await fetch(`/api/characters/${encodeURIComponent(characterId)}/bindings`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(step)});
        const value=await response.json();if(!response.ok)throw new Error(value.error??"Could not save controls");
      }
      await client.invalidateQueries({queryKey:["character",characterId]});
      setMessage(success);close();
    }catch(error){setError(error instanceof Error?error.message:"Could not save controls");}
    finally{setBusy(false);}
  }
  const clone=():Bindings=>({p1:Object.fromEntries(Object.entries(bindings.p1).map(([k,v])=>[k,[...v]])),p2:Object.fromEntries(Object.entries(bindings.p2).map(([k,v])=>[k,[...v]]))});
  function place(next:Bindings,{profile,action,replacing}:Capture,code:string){
    const list=next[profile][action]??=[];
    const at=replacing?list.indexOf(replacing):-1;
    if(at>=0)list[at]=code;else list.push(code);
  }
  function assign(code:string,swap=false){
    if(!capture)return;
    const next=clone(),success=`${keyLabel(code)} now triggers ${label(capture.action)} for ${profileLabels[capture.profile]}.`;
    if(!(swap&&pending)){place(next,capture,code);void save([{profile:capture.profile,bindings:next[capture.profile]}],success);return;}
    const owner=pending.owner,owned=next[owner.profile][owner.action]??[];
    // True swap: the other action takes the key being replaced, if any.
    const giveBack=capture.replacing&&!owned.includes(capture.replacing)?capture.replacing:null;
    owned.splice(owned.indexOf(code),1,...(giveBack?[giveBack]:[]));
    place(next,capture,code);
    if(owner.profile===capture.profile){void save([{profile:capture.profile,bindings:next[capture.profile]}],success);return;}
    // Across players: free our old key, hand keys over, then take the new one.
    const freed=clone();freed[capture.profile][capture.action]=(freed[capture.profile][capture.action]??[]).filter(c=>c!==capture.replacing);
    void save([{profile:capture.profile,bindings:freed[capture.profile]},{profile:owner.profile,bindings:next[owner.profile]},{profile:capture.profile,bindings:next[capture.profile]}],success);
  }
  function clear(){
    if(!capture?.replacing){close();return;}
    const next=clone();next[capture.profile][capture.action]=(next[capture.profile][capture.action]??[]).filter(code=>code!==capture.replacing);
    void save([{profile:capture.profile,bindings:next[capture.profile]}],`Removed ${keyLabel(capture.replacing)} from ${label(capture.action)}.`);
  }
  function onKey(event:React.KeyboardEvent<HTMLDialogElement>){
    if(!capture||busy||pending)return;
    if(event.code==="Escape")return; // native dialog cancel
    if(event.code==="Tab")return;
    event.preventDefault();
    if(event.code==="Backspace"){clear();return;}
    if(RESERVED_CODES.has(event.code)||!/^[A-Za-z0-9]{1,32}$/.test(event.code)){setError("That key can’t be bound.");return;}
    if(event.code===capture.replacing){close();return;}
    const owner=codeOwner(manifest.viewType,bindings,event.code);
    if(!owner){assign(event.code);return;}
    if(!owner.action){setError(`${keyLabel(event.code)} is a ${profileLabels[owner.profile]} movement key and can’t be reassigned.`);return;}
    if(owner.action===capture.action&&owner.profile===capture.profile){setError(`${keyLabel(event.code)} is already bound to ${label(capture.action)}.`);return;}
    setError("");setPending({code:event.code,owner:{profile:owner.profile,action:owner.action}});
  }
  return <section className="panel" data-keys-ignore aria-labelledby="controls-title">
    <h2 id="controls-title">Controls</h2>
    <p className="muted">Click a key to change it, or <strong>+</strong> to add one. Player 2 is for two-player games. Walking keys are fixed.</p>
    <div className="controls-table" role="table" aria-label="Key bindings">
      <div className="controls-row head" role="row"><span role="columnheader">Move</span>{PROFILES.map(profile=><span role="columnheader" key={profile}>{profileLabels[profile]}</span>)}</div>
      <div className="controls-row" role="row"><span role="rowheader">Walk</span>{PROFILES.map(profile=><span role="cell" key={profile} data-label={profileLabels[profile]} className="key-list">{Object.entries(movementKeys(manifest.viewType,profile)).map(([code,dir])=><span key={code} className="key locked" title={`Move ${dir} (fixed)`}>{keyLabel(code)}</span>)}</span>)}</div>
      {actionKeys.map(key=><div className="controls-row" role="row" key={key}><span role="rowheader">{label(key)}</span>{PROFILES.map(profile=>{
        const codes=bindings[profile][key]??[];
        if(!isBindable(key))return <span role="cell" key={profile} data-label={profileLabels[profile]} className="muted fine-print">Follows move keys</span>;
        return <span role="cell" key={profile} data-label={profileLabels[profile]} className="key-list">
          {codes.map(code=><button key={code} className="keycap" aria-label={`Change ${keyLabel(code)} for ${label(key)} (${profileLabels[profile]})`} onClick={()=>open({profile,action:key,replacing:code})}>{keyLabel(code)}</button>)}
          {codes.length<MAX_CODES_PER_ACTION&&<button className="keycap add" aria-label={`Add key for ${label(key)} (${profileLabels[profile]})`} onClick={()=>open({profile,action:key,replacing:null})}>+</button>}
          {!codes.length&&<span className="fine-print muted">Unbound</span>}
        </span>;
      })}</div>)}
    </div>
    {message&&<p className="fine-print" role="status">{message}</p>}
    <dialog ref={dialog} className="delete-dialog capture-dialog" aria-labelledby="capture-title" onKeyDown={onKey} onClose={()=>{setCapture(null);setPending(null);}}>
      {capture&&<>
        <span className="fine-print">{profileLabels[capture.profile]}</span>
        <h2 id="capture-title">{pending?"Key already in use":`Press a key for ${label(capture.action)}`}</h2>
        {pending?<><p><strong>{keyLabel(pending.code)}</strong> is already used by <strong>{label(pending.owner.action)}</strong> ({profileLabels[pending.owner.profile]}). Swap?</p>
          <div className="button-row"><button autoFocus disabled={busy} onClick={()=>assign(pending.code,true)}>{busy?"Saving…":"Swap keys"}</button><button className="secondary" disabled={busy} onClick={()=>setPending(null)}>Pick another</button></div></>
        :<><div className="capture-key blink" aria-hidden="true">{capture.replacing?keyLabel(capture.replacing):"?"}</div>
          <p className="muted"><span className="key">Esc</span> cancels{capture.replacing&&<> · <span className="key">Backspace</span> clears this key</>}</p>
          <div className="button-row"><button className="secondary" autoFocus onClick={close}>Cancel</button>{capture.replacing&&<button className="danger-button" disabled={busy} onClick={clear}>Clear key</button>}</div></>}
        {error&&<p className="error" role="alert">{error}</p>}
      </>}
    </dialog>
  </section>;
}
