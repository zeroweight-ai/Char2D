import { JobQueue } from "@/server/jobs/queue";
export const runtime = "nodejs";
export async function POST() {
  const jobId = new JobQueue().enqueue("demo");
  return Response.json({jobId},{status:202});
}
