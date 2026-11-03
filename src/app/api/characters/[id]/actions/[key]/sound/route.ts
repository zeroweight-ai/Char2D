import { requestSound,removeSound,SoundError } from "@/server/characters/sound";
export const runtime="nodejs";
const fail=(error:unknown,fallback:string)=>Response.json({error:error instanceof Error?error.message:fallback},{status:error instanceof SoundError?error.status:500});
/** Generate or regenerate this move's sound effect (one ElevenLabs call). */
export async function POST(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  try{return Response.json(requestSound(id,key),{status:202});}catch(error){return fail(error,"Could not queue the sound");}
}
/** Make this move silent (no AI call). */
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  try{return Response.json(removeSound(id,key));}catch(error){return fail(error,"Could not remove the sound");}
}
