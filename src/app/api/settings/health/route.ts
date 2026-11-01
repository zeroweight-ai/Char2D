import { config } from "@/server/config";
import { getDatabase } from "@/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  getDatabase().sqlite.prepare("SELECT 1").get();
  return Response.json({ ok:true,mode:config.fakeAI ? "fake":"muse",keyPresent:!!config.apiKey,chatModel:config.chatModel,imageModel:config.imageModel },{ headers:{"Cache-Control":"no-store"} });
}
