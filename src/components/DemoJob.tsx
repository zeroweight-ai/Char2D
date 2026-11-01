"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
export function DemoJob() {
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [message,setMessage]=useState("Run a free demo to check the worker and live progress.");
  const [assetId,setAssetId]=useState<string>();
  const source=useRef<EventSource|null>(null);
  useEffect(() => () => source.current?.close(),[]);
  async function start() {
    setBusy(true);setProgress(0);setAssetId(undefined);setMessage("Queueing demo…");source.current?.close();
    try {
      const response=await fetch("/api/jobs/demo",{method:"POST"});
      if (!response.ok) throw new Error("Could not queue demo");
      const {jobId}=await response.json();
      const events=new EventSource(`/api/events?jobId=${encodeURIComponent(jobId)}`);source.current=events;
      events.onmessage=event => {
        const data=JSON.parse(event.data);
        if (typeof data.progress==="number") setProgress(data.progress);
        if (data.message) setMessage(data.message);
        if (data.assetId) setAssetId(data.assetId);
        if (data.kind==="done" || data.kind==="error") {setBusy(false);events.close();}
      };
      events.onerror=() => setMessage("Reconnecting to live progress…");
    } catch(error) {setMessage(error instanceof Error ? error.message:"Demo failed");setBusy(false);}
  }
  return <section className="panel"><span className="badge">Free development demo</span><h2>Check your workspace</h2><p>No API key or paid image calls needed.</p><button onClick={start} disabled={busy}>{busy ? "Running demo…":"Run demo job"}</button><p role="status" aria-live="polite">{message}</p><progress value={progress} max={100} aria-label="Demo job progress" />{assetId && <div className="checker"><Image unoptimized className="pixel-preview" src={`/api/assets/${assetId}`} alt="Demo pixel character sheet" width={384} height={128} /></div>}</section>;
}
