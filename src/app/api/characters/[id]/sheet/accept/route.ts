import { z } from "zod";
import { acceptAndAnimate,AnimationError } from "@/server/characters/animations";
import { config } from "@/server/config";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const input=z.object({sheetId:z.string().min(1)}).safeParse(await request.json().catch(()=>null));
  if(!input.success)return Response.json({error:"Provide the sheet ID you reviewed."},{status:400});
  if(!config.fakeAI&&!config.apiKey)return Response.json({error:"Configure your Muse API key before generating animations."},{status:503});
  try {return Response.json({ok:true,...acceptAndAnimate(id,input.data.sheetId)},{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not queue animations"},{status:error instanceof AnimationError?error.status:500});}
}
