import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/server/db";
import { JobQueue } from "../src/server/jobs/queue";
let directory:string;
let connection:ReturnType<typeof openDatabase>;
let queue:JobQueue;
beforeEach(() => {directory=mkdtempSync(join(tmpdir(),"char2d-test-"));connection=openDatabase(directory);queue=new JobQueue(connection);});
afterEach(() => {connection.sqlite.close();rmSync(directory,{recursive:true,force:true});});
describe("persistent job queue",() => {
  it("applies migrations repeatedly and coordinates claims between connections",() => {
    const id=queue.enqueue("demo");
    const other=openDatabase(directory);
    try {expect(queue.claim("worker-a")?.id).toBe(id);expect(new JobQueue(other).claim("worker-b")).toBeUndefined();}
    finally {other.sqlite.close();}
    expect(queue.get(id)?.attempts).toBe(1);
  });
  it("waits for prerequisites and releases a dependent job after completion",() => {
    const first=queue.enqueue("demo");const second=queue.enqueue("demo",{},{dependsOn:[first]});
    expect(queue.claim("worker")?.id).toBe(first);expect(queue.claim("worker")).toBeUndefined();
    queue.complete(first);expect(queue.claim("worker")?.id).toBe(second);
  });
  it("retries within the budget and marks exhausted jobs as failed",() => {
    const id=queue.enqueue("demo",{},{maxAttempts:1});queue.claim("worker");queue.fail(id,new Error("broken"));
    expect(queue.get(id)?.status).toBe("error");
    expect(connection.sqlite.prepare("SELECT kind FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT 1").get(id)).toEqual({kind:"error"});
  });
  it("recovers stale locks but preserves active workers",() => {
    const id=queue.enqueue("demo");queue.claim("worker");queue.recoverStale();expect(queue.get(id)?.status).toBe("running");
    queue.recoverStale(Date.now()+301_000);expect(queue.get(id)?.status).toBe("queued");
  });
  it("propagates failed prerequisites",() => {
    const first=queue.enqueue("demo",{},{maxAttempts:1});const second=queue.enqueue("demo",{},{dependsOn:[first]});
    queue.claim("worker");queue.fail(first,new Error("broken"));queue.recoverStale();expect(queue.get(second)?.status).toBe("error");
  });
});
