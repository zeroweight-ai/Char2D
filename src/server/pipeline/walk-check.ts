import "server-only";
import sharp from "sharp";
import { z } from "zod";
import type { ChatModel } from "../ai/types";
import { walkRepairPrompt,type LegIdentity } from "./prompts/walk";
export type { LegIdentity } from "./prompts/walk";

// AI (vision) validation of a side-view 4-frame walk. Muse Image often keeps
// the same leg in front in frames 1 and 3, or lifts the same leg in 2 and 4,
// so one leg never steps. The colour heuristic in pose-checks.ts only sees
// frame 3's feet; the vision model checks every frame and names the legs by
// appearance, which is what a repair prompt needs.
//
// Leg A = the leg in FRONT in frame 1, leg B = the other. A correct cycle is:
//   1 contact: A front · 2 passing: B lifted · 3 contact: B front · 4 passing: A lifted
export const EXPECTED_WALK=[{front:"A"},{lifted:"B"},{front:"B"},{lifted:"A"}] as const;
const legSchema=z.enum(["A","B","none","unclear"]).catch("unclear");
const checkSchema=z.object({
  legA:z.string().trim().min(1).max(300),
  legB:z.string().trim().min(1).max(300),
  distinguishable:z.boolean(),
  frames:z.array(z.object({frame:z.number().int(),front:legSchema.optional(),lifted:legSchema.optional()})),
});
export type WalkCheck={legs:LegIdentity;distinguishable:boolean;observed:{front?:string;lifted?:string}[];wrong:number[]};

/** Transparent frames are flattened on light grey and capped in size for the vision model. */
async function viewable(png:Buffer) {
  const meta=await sharp(png).metadata();
  const image=sharp(png).flatten({background:"#d9d9d9"});
  return (meta.height!>480?image.resize({height:480}):image).png().toBuffer();
}
const parse=(text:string)=>JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,""));
const facingText=(direction:string)=>direction==="left"?"screen-left":"screen-right";

const system=(direction:string)=>`You are the Char2D walk-cycle checker. You inspect frames of a 2D pixel-art side-view walk cycle. The character faces ${direction} (forward = toward ${facingText(direction)}). Return ONLY JSON.
Identify the two legs by APPEARANCE, never by position alone: skin/stocking/trouser colours, boot design, shading (the far leg is usually darker), and occlusion (the near leg is drawn on top of the far leg).
- Leg A = the leg whose foot is further FORWARD in frame 1. Leg B = the other leg.
- legA / legB: one short sentence each that lets someone find that leg in another frame (e.g. "pale bare leg with a black-and-red boot, drawn in front of the other leg").
- distinguishable: false only if the two legs look identical so you cannot tell which is which in other frames.
- For contact frames (both feet on the ground, legs split) report "front": which leg's foot is further forward (A or B).
- For passing frames (one knee bent, its foot off the ground) report "lifted": which leg is lifted (A, B, or "none" if both feet are planted).
- Use "unclear" when you genuinely cannot tell. Judge each frame independently; do not assume the cycle is correct.`;

/** Describe frame 1's two legs (used to make the frames 3–4 prompt concrete). */
export async function describeWalkLegs(model:ChatModel,frame1:Buffer,direction:string):Promise<LegIdentity|null> {
  const result=await model.chat({system:system(direction),messages:[{role:"user",content:'Look at frame 1 only. Return {"legA":"...","legB":"...","distinguishable":true|false,"frames":[{"frame":1,"front":"A"}]}.',images:[{label:"Frame 1 (contact pose):",png:await viewable(frame1)}]}]});
  const parsed=checkSchema.parse(parse(result.text));
  return parsed.distinguishable?{front:parsed.legA,back:parsed.legB}:null;
}

/** Check all four frames against EXPECTED_WALK. `wrong` holds 0-based frame indices. */
export async function checkWalkLegs(model:ChatModel,frames:Buffer[],direction:string,legs?:LegIdentity):Promise<WalkCheck> {
  if(frames.length!==4)throw new Error("Walk check needs four frames");
  const images=await Promise.all(frames.map(async(png,i)=>({label:`Frame ${i+1} (${i%2?"passing":"contact"} pose):`,png:await viewable(png)})));
  const known=legs?` Leg A in frame 1 was previously described as: "${legs.front}". Leg B: "${legs.back}". Re-check against the images.`:"";
  const content=`Report the legs of this 4-frame walk.${known} Return {"legA":"...","legB":"...","distinguishable":true|false,"frames":[{"frame":1,"front":"A"},{"frame":2,"lifted":"A|B|none|unclear"},{"frame":3,"front":"A|B|unclear"},{"frame":4,"lifted":"A|B|none|unclear"}]}.`;
  for(let attempt=0;attempt<2;attempt++) {
    const result=await model.chat({system:system(direction),messages:[{role:"user",content,images},...(attempt?[{role:"user" as const,content:"Return valid JSON only, in exactly the requested shape."}]:[])]});
    try {
      const parsed=checkSchema.parse(parse(result.text));
      const observed=EXPECTED_WALK.map((_,i)=>{const frame=parsed.frames.find(item=>item.frame===i+1);return {front:frame?.front,lifted:frame?.lifted};});
      const wrong=parsed.distinguishable?EXPECTED_WALK.flatMap((expected,i)=>{
        const actual="front" in expected?observed[i].front:observed[i].lifted;
        const want="front" in expected?expected.front:expected.lifted;
        return (actual==="A"||actual==="B")&&actual!==want?[i]:[];
      }):[];
      return {legs:{front:parsed.legA,back:parsed.legB},distinguishable:parsed.distinguishable,observed,wrong};
    } catch(error){if(attempt===1)throw error;}
  }
  throw new Error("Walk check failed");
}

/**
 * Build the single-frame repair request: the wrong pose itself on the chroma
 * key (so composition, size and everything above the hips can stay), plus the
 * sheet anchor for identity. Only the legs change.
 */
export async function walkRepairRequest(input:{pose:Buffer;frameIndex:number;legs:LegIdentity|null;anchor:Buffer;key:string;direction:"left"|"right"}) {
  const meta=await sharp(input.pose).metadata();
  const padX=Math.round(meta.width!*0.15),padY=Math.round(meta.height!*0.08);
  const width=meta.width!+padX*2,height=meta.height!+padY*2;
  const base=await sharp({create:{width,height,channels:4,background:input.key}}).composite([{input:input.pose,left:padX,top:padY}]).png().toBuffer();
  return {prompt:walkRepairPrompt({frameIndex:input.frameIndex,legs:input.legs,direction:input.direction,key:input.key}),references:[base,input.anchor],size:[width,height] as [number,number],canvasHeight:height};
}
