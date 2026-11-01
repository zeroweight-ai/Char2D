import { z } from "zod";
import { getDatabase } from "@/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request:Request) {
  const url = new URL(request.url);
  const parsed = z.object({ characterId:z.string().min(1).max(64).optional(),jobId:z.string().min(1).max(64).optional(),after:z.coerce.number().int().min(0).default(0) }).safeParse({characterId:url.searchParams.get("characterId") ?? undefined,jobId:url.searchParams.get("jobId") ?? undefined,after:request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? undefined});
  if (!parsed.success) return Response.json({error:"Invalid event cursor or filter"},{status:400});
  const { jobId,characterId } = parsed.data;
  let cursor = parsed.data.after;
  let cleanup = () => {};
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed=false;
      const send = (text:string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const poll = () => {
        try {
          const rows = getDatabase().sqlite.prepare(`SELECT * FROM job_events WHERE id>? ${jobId ? "AND job_id=?":""} ${characterId ? "AND character_id=?":""} ORDER BY id LIMIT 100`).all(cursor,...(jobId ? [jobId]:[]),...(characterId ? [characterId]:[])) as {id:number;job_id:string;kind:string;data_json:string}[];
          for (const row of rows) { send(`id: ${row.id}\ndata: ${JSON.stringify({jobId:row.job_id,kind:row.kind,...JSON.parse(row.data_json)})}\n\n`); cursor=row.id; }
        } catch { cleanup(); controller.error(new Error("Could not read job events")); }
      };
      const timer=setInterval(poll,500);
      const keepAlive=setInterval(() => send(": heartbeat\n\n"),15_000);
      const abort = () => { cleanup(); controller.close(); };
      cleanup=() => { closed=true; clearInterval(timer); clearInterval(keepAlive); request.signal.removeEventListener("abort",abort); };
      request.signal.addEventListener("abort",abort,{once:true});
      if (request.signal.aborted) { abort(); return; }
      send("retry: 1500\n\n"); poll();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform",Connection:"keep-alive","X-Accel-Buffering":"no"}});
}
