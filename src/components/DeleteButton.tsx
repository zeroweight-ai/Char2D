"use client";
import { useId,useRef,useState } from "react";
// `label` is the accessible name; `text` (optional) is a shorter visible label. `quiet` renders a low-key text button.
export function DeleteButton({label,text,title,description,endpoint,onDeleted,disabled=false,small=false,quiet=false}:{label:string;text?:string;title:string;description:string;endpoint:string;onDeleted:()=>void|Promise<void>;disabled?:boolean;small?:boolean;quiet?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),titleId=useId(),descriptionId=useId();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function confirm() {
    setBusy(true);setError("");
    try {
      const response=await fetch(endpoint,{method:"DELETE"});
      if(!response.ok){const value=await response.json();throw new Error(value.error??"Could not delete item");}
      dialog.current?.close();await onDeleted();
    }catch(error){setError(error instanceof Error?error.message:"Could not delete item");}
    finally{setBusy(false);}
  }
  return <><button className={quiet?"quiet-button danger":`danger-button${small?" small":""}`} aria-label={text&&text!==label?label:undefined} disabled={disabled} onClick={()=>{setError("");dialog.current?.showModal();}}>{text??label}</button>
    <dialog ref={dialog} className="delete-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{if(busy)event.preventDefault();}}><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>{error&&<p role="alert" className="error">{error}</p>}<div className="button-row"><button autoFocus className="secondary" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button className="danger-button" disabled={busy} onClick={confirm}>{busy?"Deleting…":"Delete permanently"}</button></div></dialog>
  </>;
}
