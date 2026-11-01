import { reprocessSheet,ReprocessError } from "@/server/characters/reprocess";
export const runtime="nodejs";
export async function POST(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try{return Response.json(reprocessSheet((await params).id),{status:202});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Could not reprocess sheet"},{status:error instanceof ReprocessError?error.status:500});}
}
