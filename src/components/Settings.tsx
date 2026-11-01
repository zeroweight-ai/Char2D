"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
type Health = { mode:"fake"|"muse";keyPresent:boolean;chatModel:string;imageModel:string };
export function Settings() {
  const health=useQuery<Health>({queryKey:["health"],queryFn:async () => { const r=await fetch("/api/settings/health");if(!r.ok)throw new Error("Could not read workspace status");return r.json(); }});
  const [testing,setTesting]=useState(false);
  const [message,setMessage]=useState("");
  async function test() {
    setTesting(true);setMessage("");
    try {const r=await fetch("/api/settings/test",{method:"POST"});const result=await r.json();setMessage(result.message);}
    catch {setMessage("Could not reach the server.");}
    finally {setTesting(false);}
  }
  return <section className="panel"><h2>AI connection</h2>{health.isPending ? <p>Loading settings…</p>:health.isError ? <p className="error">{health.error.message}</p>:<><p><strong>Mode:</strong> {health.data.mode==="fake" ? "Fake AI — no paid calls":"Muse API"}</p><p><strong>API key:</strong> {health.data.keyPresent ? "Detected":"Not configured"}</p><p className="muted">Chat: {health.data.chatModel}<br />Image: {health.data.imageModel}</p><p>Edit <code>.env.local</code> and restart to change settings. Your key stays on the server.</p><button onClick={test} disabled={testing || (health.data.mode==="muse" && !health.data.keyPresent)}>{testing ? "Testing…":"Test connection"}</button>{health.data.mode==="muse" && <p className="muted">Testing makes one small chat request to Muse.</p>}</>}<p role="status">{message}</p></section>;
}
