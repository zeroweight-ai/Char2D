import { setTimeout as sleep } from "node:timers/promises";
import { nanoid } from "nanoid";
import { config } from "../server/config";
import { getDatabase } from "../server/db";
import { JobQueue, type Job } from "../server/jobs/queue";
import { FakeProvider } from "../server/ai/fake";
import { saveAsset } from "../server/storage/assets";
import { runAnimationJob } from "../server/pipeline/animations";
import { characters,actionVersions } from "../server/db/schema";
import { eq } from "drizzle-orm";
import { generateSheet } from "../server/pipeline/sheet";
import { runSoundJob } from "../server/characters/sound";
const queue = new JobQueue();
const workerId = `worker-${process.pid}-${nanoid(6)}`;
let stopping = false;
process.on("SIGINT",() => { stopping=true; });
process.on("SIGTERM",() => { stopping=true; });
async function run(job:Job) {
  const heartbeat = setInterval(() => queue.heartbeat(job.id,workerId),30_000);
  try {
    if (job.type==="sheet") { await generateSheet(job,queue); queue.complete(job.id); return; }
    if (["strip","process_action","compose_atlas"].includes(job.type)) {await runAnimationJob(job,queue);queue.complete(job.id);return;}
    if (job.type==="sound") {await runSoundJob(job,queue);queue.complete(job.id);return;}
    if (job.type!=="demo") throw new Error(`Handler for ${job.type} is not implemented yet.`);
    queue.event(job.id,"progress",{progress:20,message:"Preparing fixture"});
    await sleep(400);
    const result = await new FakeProvider().generate();
    queue.event(job.id,"progress",{progress:65,message:"Saving preview"});
    const asset = await saveAsset(result.png,{kind:"demo",mime:"image/png"});
    await sleep(400);
    queue.event(job.id,"result",{progress:95,message:"Preview saved",assetId:asset.id});
    queue.complete(job.id);
  } catch (error) {
    const failure=error instanceof Error?error:new Error("Worker failed");
    queue.fail(job.id,failure);
    if(["strip","process_action","compose_atlas"].includes(job.type)) {
      if(job.characterId)getDatabase().db.update(characters).set({status:"error",updatedAt:Date.now()}).where(eq(characters.id,job.characterId)).run();
      if(job.actionVersionId)getDatabase().db.update(actionVersions).set({status:"error",error:failure.message}).where(eq(actionVersions.id,job.actionVersionId)).run();
    }
  }
  finally { clearInterval(heartbeat); }
}
async function main() {
  queue.recoverStale();
  console.log(`Char2D worker ready (${config.fakeAI ? "fake AI":"Muse"}); data: ${config.dataDir}`);
  const running = new Set<Promise<void>>();
  while (!stopping) {
    queue.recoverStale();
    if (running.size<config.maxParallelImageJobs) {
      const job = queue.claim(workerId);
      if (job) { const task=run(job).finally(() => running.delete(task)); running.add(task); continue; }
    }
    await sleep(250);
  }
  await Promise.allSettled(running);
  getDatabase().sqlite.close();
}
main().catch(error => { console.error(error); process.exitCode=1; });
