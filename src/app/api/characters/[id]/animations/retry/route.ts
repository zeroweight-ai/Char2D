import { retryAnimations,AnimationError } from "@/server/characters/animations";
import { config } from "@/server/config";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!config.fakeAI&&!config.apiKey)return Response.json({error:"Configure your Muse API key first."},{status:503});
  try{return Response.json(retryAnimations(id));}catch(error){return Response.json({error:error instanceof Error?error.message:"Could not retry animations"},{status:error instanceof AnimationError?error.status:500});}
}
