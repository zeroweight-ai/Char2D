import { activateVersion,EditError } from "@/server/characters/edit";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{id:string;key:string;vid:string}>}) {
  const {id,key,vid}=await params;
  try{return Response.json(activateVersion(id,key,vid),{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not restore version"},{status:error instanceof EditError?error.status:500});}
}
