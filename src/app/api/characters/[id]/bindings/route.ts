import { bindingsInputSchema } from "@/lib/bindings";
import { ControlsError,getBindings,replaceBindings } from "@/server/characters/controls";
import { getCharacter } from "@/server/characters/repository";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!getCharacter(id))return Response.json({error:"Character not found"},{status:404});
  return Response.json(getBindings(id));
}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const parsed=bindingsInputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message??"Invalid bindings"},{status:400});
  try{return Response.json(replaceBindings(id,parsed.data.profile,parsed.data.bindings));}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not save bindings"},{status:error instanceof ControlsError?error.status:500});}
}
