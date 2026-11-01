import { regenerateAction,AnimationError } from "@/server/characters/animations";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  try{return Response.json(regenerateAction(id,key,"reprocess"),{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not reprocess saved strips"},{status:error instanceof AnimationError?error.status:500});}
}
