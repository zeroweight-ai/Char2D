import { expect,it } from "vitest";
import sharp from "sharp";
import { sameLegOrder } from "../src/server/pipeline/pose-checks";
import { stripPrompt } from "../src/server/pipeline/prompts/strip";
import { walkPoses } from "../src/server/pipeline/prompts/walk";
const LIGHT={r:190,g:170,b:215,alpha:1},DARK={r:60,g:40,b:110,alpha:1},BODY={r:230,g:200,b:190,alpha:1};
// A 40×80 stick figure: torso plus a light foot and a dark foot at the bottom.
async function figure(frontFoot:"light"|"dark") {
  const [front,rear]=frontFoot==="light"?[LIGHT,DARK]:[DARK,LIGHT];
  const block=(w:number,h:number,c:typeof LIGHT)=>sharp({create:{width:w,height:h,channels:4,background:c}}).png().toBuffer();
  return sharp({create:{width:40,height:80,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([
    {input:await block(16,60,BODY),left:12,top:0},{input:await block(12,20,rear),left:0,top:60},{input:await block(12,20,front),left:28,top:60},
  ]).png().toBuffer();
}
it("flags a walk contact frame that keeps the same foot in front",async()=>{
  const a=await figure("light"),same=await figure("light"),swapped=await figure("dark");
  expect(await sameLegOrder(a,same,"right")).toBe(true);
  expect(await sameLegOrder(a,swapped,"right")).toBe(false);
  // Facing left, the front is the left edge: same images, reversed meaning.
  expect(await sameLegOrder(a,swapped,"left")).toBe(false);
  // Indistinguishable feet can't be judged, so never flag them.
  expect(await sameLegOrder(await sharp({create:{width:40,height:80,channels:4,background:BODY}}).png().toBuffer(),await figure("light"),"right")).toBe(false);
});
it("names legs anatomically and enforces leg order across walk strips",()=>{
  const base={canvas:"standard" as const,viewType:"side_scroller" as const,label:"Walk",actionKey:"walk",playback:"loop" as const,key:"#00FFFF",total:4};
  const first=stripPrompt({...base,direction:"right",poses:walkPoses.slice(0,2),segment:0,startFrame:1,idleReference:true});
  expect(first).toContain("NEAR-SIDE = the character’s RIGHT leg");
  expect(first).not.toContain("CROSS-STRIP CONTINUITY");
  const second=stripPrompt({...base,direction:"right",poses:walkPoses.slice(2),segment:1,startFrame:3,idleReference:true,actionReference:true});
  expect(second).toContain("CROSS-STRIP CONTINUITY");
  expect(second).toContain("Frame 3 is the leg-swapped opposite of that frame 1");
  expect(stripPrompt({...base,direction:"left",poses:walkPoses.slice(0,2),segment:0,startFrame:1})).toContain("NEAR-SIDE = the character’s LEFT leg");
  expect(walkPoses[2]).toContain("must NOT look like frame 1");
});
