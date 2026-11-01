import { regenerateAction,AnimationError } from "@/server/characters/animations";
import { config } from "@/server/config";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  if(!config.fakeAI&&!config.apiKey)return Response.json({error:"Configure your Muse API key before regenerating actions."},{status:503});
  const {id,key}=await params;
  try{return Response.json(regenerateAction(id,key),{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not regenerate action"},{status:error instanceof AnimationError?error.status:500});}
}
