import { z } from "zod";
import { config } from "@/server/config";
import { AnimationError } from "@/server/characters/animations";
import { planCustomAction,createCustomAction } from "@/server/characters/custom-action";
import { customActionSchema } from "@/lib/custom-action";
const actionRequestSchema=z.discriminatedUnion("mode",[
  z.object({mode:z.literal("plan"),prompt:z.string().trim().min(1).max(2000)}),
  z.object({mode:z.literal("generate"),sheetId:z.string().min(1),action:customActionSchema}),
]);
import { getCharacter } from "@/server/characters/repository";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const character=getCharacter((await params).id);
  return character?Response.json(character.animation?.actions??[]):Response.json({error:"Character not found"},{status:404});
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  if(!config.fakeAI&&!config.apiKey)return Response.json({error:"Configure your Muse API key before creating actions."},{status:503});
  try {
    const id=(await params).id;
    const body=actionRequestSchema.parse(await request.json());
    if(body.mode==="plan")return Response.json(await planCustomAction(id,body.prompt));
    return Response.json(createCustomAction(id,body.sheetId,body.action),{status:202});
  } catch(error) {
    return Response.json({error:error instanceof z.ZodError?"The action plan is invalid. Use 1–4 poses with matching positive durations.":error instanceof Error?error.message:"Could not create action"},{status:error instanceof AnimationError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:500});
  }
}
