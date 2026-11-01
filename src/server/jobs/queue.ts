import "server-only";
import { nanoid } from "nanoid";
import type { openDatabase } from "../db";
import { getDatabase } from "../db";
import { jobs } from "../db/schema";
import { eq } from "drizzle-orm";
type Connection = ReturnType<typeof openDatabase>;
export type Job = typeof jobs.$inferSelect;
export class JobQueue {
  constructor(private connection: Connection = getDatabase()) {}
  enqueue(type: Job["type"], payload: Record<string, unknown> = {}, options: { characterId?: string; actionVersionId?:string; dependsOn?: string[]; maxAttempts?: number } = {}) {
    const now = Date.now();
    const id = nanoid();
    const deps = options.dependsOn ?? [];
    for (const dependency of deps) if (!this.get(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
    this.connection.db.insert(jobs).values({ id, type, payloadJson: JSON.stringify(payload), characterId: options.characterId, actionVersionId:options.actionVersionId, dependsOnJson: JSON.stringify(deps), maxAttempts: options.maxAttempts ?? 3, createdAt: now, updatedAt: now, runAfter: now }).run();
    this.event(id, "queued", { progress: 0, message: "Waiting for worker" });
    return id;
  }
  get(id: string) { return this.connection.db.select().from(jobs).where(eq(jobs.id,id)).get(); }
  claim(workerId: string): Job | undefined {
    const { sqlite, db } = this.connection;
    return sqlite.transaction(() => {
      const candidate = sqlite.prepare(`SELECT j.id FROM jobs j WHERE j.status='queued' AND j.run_after<=? AND NOT EXISTS (
        SELECT 1 FROM json_each(j.depends_on_json) d LEFT JOIN jobs parent ON parent.id=d.value WHERE parent.status IS NULL OR parent.status!='done'
      ) ORDER BY j.created_at,j.rowid LIMIT 1`).get(Date.now()) as { id: string } | undefined;
      if (!candidate) return;
      db.update(jobs).set({ status: "running", lockedBy: workerId, lockedAt: Date.now(), attempts: (this.get(candidate.id)?.attempts ?? 0) + 1, updatedAt: Date.now() }).where(eq(jobs.id,candidate.id)).run();
      return this.get(candidate.id);
    }).immediate();
  }
  recoverStale(now = Date.now()) {
    this.connection.sqlite.prepare("UPDATE jobs SET status='queued',locked_by=NULL,locked_at=NULL,updated_at=? WHERE status='running' AND locked_at<?").run(now,now-300_000);
    // A failed prerequisite must not leave dependent jobs queued forever.
    this.connection.sqlite.prepare(`UPDATE jobs SET status='error',error='Dependency failed',updated_at=? WHERE status='queued' AND EXISTS (
      SELECT 1 FROM json_each(jobs.depends_on_json) d JOIN jobs parent ON parent.id=d.value WHERE parent.status IN ('error','cancelled')
    )`).run(now);
  }
  heartbeat(id: string, workerId: string) {
    this.connection.sqlite.prepare("UPDATE jobs SET locked_at=? WHERE id=? AND status='running' AND locked_by=?").run(Date.now(),id,workerId);
  }
  complete(id: string) {
    this.connection.db.update(jobs).set({ status: "done", lockedBy: null, lockedAt: null, error: null, updatedAt: Date.now() }).where(eq(jobs.id,id)).run();
    this.event(id,"done",{ progress: 100, message: "Ready" });
  }
  fail(id: string, error: Error) {
    const job = this.get(id);
    if (!job) return;
    const retry = job.attempts < job.maxAttempts;
    this.connection.db.update(jobs).set({ status: retry ? "queued" : "error", error: error.message, lockedBy: null, lockedAt: null, runAfter: Date.now() + 1000 * 2 ** job.attempts, updatedAt: Date.now() }).where(eq(jobs.id,id)).run();
    this.event(id,retry ? "retry" : "error",{ message: error.message });
  }
  event(jobId: string, kind: string, data: Record<string, unknown>) {
    const job = this.get(jobId);
    if (!job) throw new Error("Job not found");
    this.connection.sqlite.prepare("INSERT INTO job_events (job_id,character_id,kind,data_json,created_at) VALUES (?,?,?,?,?)").run(jobId,job.characterId,kind,JSON.stringify(data),Date.now());
  }
}
