import { z } from "zod";
import { config } from "@/server/config";
import { getCharacter, queueSheet } from "@/server/characters/repository";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!getCharacter(id)) return Response.json({error:"Character not found"},{status:404});
  if(!config.fakeAI && !config.apiKey) return Response.json({error:"Muse API key is missing."},{status:503});
  const input=z.object({note:z.string().trim().max(1000).default("")}).safeParse(await request.json().catch(()=>null));
  if(!input.success) return Response.json({error:"Invalid revision note"},{status:400});
  try {return Response.json({jobId:queueSheet(id,input.data.note,true)},{status:202});}
  catch(error) {return Response.json({error:error instanceof Error ? error.message:"Could not queue sheet"},{status:409});}
}
