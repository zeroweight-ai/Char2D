import { deleteCharacter,DeleteError } from "@/server/characters/delete";
import { getCharacter } from "@/server/characters/repository";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const character=getCharacter(id);
  return character ? Response.json(character):Response.json({error:"Character not found"},{status:404});
}

export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try{deleteCharacter((await params).id);return new Response(null,{status:204});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete character"},{status:error instanceof DeleteError?error.status:500});}
}
