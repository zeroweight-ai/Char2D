import { actionPatchSchema,updateAction,EditError } from "@/server/characters/edit";
import { deleteAction,DeleteError } from "@/server/characters/delete";
export const runtime="nodejs";
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  try{return Response.json({ok:true,...deleteAction(id,key)},{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete action"},{status:error instanceof DeleteError?error.status:500});}
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;key:string}>}) {
  const {id,key}=await params;
  const parsed=actionPatchSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message??"Invalid update"},{status:400});
  try{return Response.json(updateAction(id,key,parsed.data));}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not update action"},{status:error instanceof EditError?error.status:500});}
}
