import { provider } from "@/server/ai";
export const runtime = "nodejs";
export async function POST(request:Request) {
  try { const result = await provider.chat({system:"Reply briefly.",messages:[{role:"user",content:"Say connection successful."}],signal:request.signal}); return Response.json({ok:true,message:result.text}); }
  catch (error) { return Response.json({ok:false,message:error instanceof Error ? error.message:"Connection failed"},{status:502}); }
}
