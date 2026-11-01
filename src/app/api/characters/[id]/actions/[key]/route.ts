import { deleteAction,DeleteError } from "@/server/characters/delete";
export const runtime="nodejs";
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  try{return Response.json({ok:true,...deleteAction(id,key)},{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete action"},{status:error instanceof DeleteError?error.status:500});}
}
