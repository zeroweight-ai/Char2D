import { expect,it } from "vitest";
import { stripPrompt } from "../src/server/pipeline/prompts/strip";
import { stripGuide } from "../src/server/pipeline/guides";
import { MAX_FRAMES_PER_STRIP } from "../src/server/pipeline/presets";
import { styleSchema,createCharacterSchema } from "../src/lib/character";
it("caps generation and guides at four frames and uses correct continuation indices",async()=>{
  expect(MAX_FRAMES_PER_STRIP).toBe(4);
  const input={label:"Walk",direction:"right" as const,poses:["left foot forward","right foot forward"],key:"#FF00FF",segment:1,total:6,referenceWidth:600,referenceHeight:1100};
  const prompt=stripPrompt(input);
  expect(prompt).toContain("frames 5–6 of 6");expect(prompt).toContain("600×1100 native pixels");expect(prompt).toMatch(/never use .*on the character/i);
  expect(()=>stripPrompt({...input,poses:Array(5).fill("pose")})).toThrow("one to four");
  await expect(stripGuide(5,"#FF00FF")).rejects.toThrow("one to four");
});
it("uses a fixed 128-pixel creation default while supporting existing 48/64-pixel styles",()=>{
  expect(styleSchema.parse({chromaKey:"#FF00FF"}).logicalHeight).toBe(128);
  for(const logicalHeight of [48,64,128])expect(styleSchema.parse({chromaKey:"#FF00FF",logicalHeight}).logicalHeight).toBe(logicalHeight);
  expect(styleSchema.parse({chromaKey:"#FF00FF"}).outline).toBe(false);
  const input={name:"Knight",description:"green clothes",mode:"prompt",viewType:"side_scroller"};
  expect(createCharacterSchema.parse(input).logicalHeight).toBe(128);
  expect(createCharacterSchema.safeParse({...input,logicalHeight:64}).success).toBe(false);
});


it("targets the approved 1920×1280 sheet without a low-resolution logical grid", async()=>{
  const { sheetPrompt } = await import("../src/server/pipeline/prompts/sheet");
  const { stripLayout } = await import("../src/server/pipeline/guides");
  const prompt=sheetPrompt("knight","#FF00FF",false);
  expect(prompt).toContain("1920×1280");
  expect(prompt).toContain("1126 pixels per standing character");
  expect(prompt).not.toContain("approximately 128-pixel-high logical grid");
  const layout=stripLayout(2);
  expect(Math.abs(layout.height-1280)).toBeLessThanOrEqual(1);
  expect(layout.poseHeight).toBe(1126);
});


it("uses the eye-level side view everywhere, the only supported camera",async()=>{
  const { sheetPrompt }=await import("../src/server/pipeline/prompts/sheet");
  const { manifestSchema }=await import("../src/lib/manifest");
  expect(createCharacterSchema.parse({name:"Knight",mode:"prompt",description:"green knight"})).not.toHaveProperty("viewType");
  const sheet=sheetPrompt("knight","#FF00FF",false);
  const strip=stripPrompt({label:"Walk",direction:"right",poses:["standing"],key:"#FF00FF",segment:0,total:1});
  for(const text of [sheet,strip]){expect(text.toLowerCase()).toContain("eye-level side view");expect(text).not.toMatch(/top-down|overhead camera|three-quarter/i);}
  expect(manifestSchema.shape.viewType.parse("side_scroller")).toBe("side_scroller");
  expect(manifestSchema.shape.viewType.safeParse("top_down").success).toBe(false);
});

it("gives every basic action a complete per-frame body plan within the frame limit",async()=>{
  const { defaultPresets }=await import("../src/server/pipeline/presets");
  const { actionPlanSchema }=await import("../src/lib/manifest");
  for(const action of defaultPresets()){
    expect(actionPlanSchema.safeParse(action.plan).success).toBe(true);
    for(const pose of action.plan.poses){
      expect(pose).toMatch(/torso|chest/);
      expect(pose).toMatch(/foot|feet|heel/);
      expect(pose).toMatch(/arm/i);
      expect(pose).toMatch(/head/i);
      expect(pose).toMatch(/eyes|eyelids/);
      expect(pose).toMatch(/mouth/);
    }
  }
});

it("applies direction, exact frame order and playback guidance to custom actions",()=>{
  for(const direction of ["left","right","up","down"] as const){
    const prompt=stripPrompt({label:"Custom salute",direction,poses:["Raise hand","Hold salute"],key:"#FF00FF",segment:0,total:2,playback:"once_hold"});
    expect(prompt).toContain(`Facing ${direction} means`);
    expect(prompt).toContain("Action frame 1 of 2");
    expect(prompt).toContain("Action frame 2 of 2");
    expect(prompt).toContain("no omitted, duplicated, merged or extra frames");
    expect(prompt).toContain("both arms/elbows/hands");
    expect(prompt).toContain("hold the final listed pose");
    if(direction==="up")expect(prompt).toContain("never a front-facing face");
  }
  expect(stripPrompt({label:"Idle",direction:"right",poses:["Rest"],key:"#FF00FF",segment:0,total:1,playback:"loop"})).toContain("last pose must connect naturally to the first");
});

it("restricts weapons for basic actions while allowing explicit custom combat actions",()=>{
  const input={direction:"right" as const,poses:["Pose"],key:"#FF00FF",segment:0,total:1};
  for(const label of ["Idle","Walk","Jump","Crouch"]){
    const prompt=stripPrompt({...input,label});
    expect(prompt).toContain("NO WEAPON USE");
    expect(prompt).toMatch(/(?:weapon safety|passive grip) takes priority/);
  }
  expect(stripPrompt({...input,label:"Sword attack",actionKey:"sword_attack"})).not.toContain("NO WEAPON USE");
});


it("uses the continuous near/far Walk cycle even when regenerating an older plan",()=>{
  const input={label:"Walk",actionKey:"walk",idleReference:true,direction:"right" as const,poses:["old A","old B","old C","old D"],key:"#FF00FF",segment:0,total:4,playback:"loop" as const};
  const prompt=stripPrompt(input);
  expect(prompt).toContain("performing a smooth, continuous Walk cycle");
  expect(prompt).toContain("Contact A — NEAR-SIDE LEG IN FRONT");
  expect(prompt).toContain("Passing B — FAR-SIDE LEG PLANTED, NEAR-SIDE LEG LIFTED");
  expect(prompt).toContain("ANTI-STUTTER RULE");
  expect(prompt).toContain("1 shade darker from the existing palette");
  expect(prompt).not.toContain("old A");
  expect(prompt).not.toContain("Return toward Idle");
  const continuation=stripPrompt({...input,direction:"left",poses:["old C","old D"],segment:1,startFrame:3});
  expect(continuation).toContain("facing left");
  expect(continuation).toContain("Action frame 3 of 4: Contact B");
  expect(continuation).not.toContain("Action frame 3 of 4: Contact A");
});

it("lays the sheet out as Right Side, Front, Behind",async()=>{
  const {sheetPrompt,revisionSheetPrompt,sheetAnchorOrder}=await import("../src/server/pipeline/prompts/sheet");
  expect(sheetPrompt("knight","#FF00FF",false)).toContain("Slot order: Right Side, Front, Behind.");
  expect(sheetAnchorOrder()).toEqual(["right","down","up"]);
  expect(revisionSheetPrompt("knight","#FF00FF","red hat","new_sheet",false)).toContain("Slot order: Right Side, Front, Behind.");
});

it("keeps requested custom slash effects within direction-aware slot bounds",()=>{
  const prompt=stripPrompt({label:"Horizontal sword slash with a blade trail",actionKey:"sword_slash",direction:"left",poses:["Wind-up","Active slash","Follow-through","Recovery"],key:"#FF00FF",segment:0,total:4,playback:"once"});
  expect(prompt).toContain("exactly 4 full-body pixel-art frames, facing left");
  expect(prompt).toContain("the right-center");
  expect(prompt).toContain("Frame 1 wind-up has NO trail");
  expect(prompt).toContain("Frame 4 clean recovery has ZERO lingering");
  expect(prompt).toContain("Requested VFX must use opaque flat pixels");
  expect(prompt).not.toContain("captions, or effects.");
});

it("locks custom body and weapon size to the first action frame across strips",()=>{
  const prompt=stripPrompt({label:"Sword slash",actionKey:"slash",actionReference:true,canvas:"wide",direction:"right",poses:["Follow-through","Recovery"],key:"#FF00FF",segment:1,startFrame:3,total:4});
  expect(prompt).toContain("The LAST reference is frame 1 of THIS action");
  expect(prompt).toContain("Never enlarge later frames");
  expect(prompt).toContain("Do not shorten, retract, bend or replace the weapon");
  expect(prompt).not.toContain("angle the intact weapon in depth to fit");
});

it("uses Idle to lock custom size while allowing the requested attack",()=>{
  const prompt=stripPrompt({label:"Thrust",actionKey:"thrust",idleReference:true,actionReference:true,canvas:"wide",direction:"right",poses:["Thrust forward"],key:"#FF00FF",segment:1,total:4});
  expect(prompt).toContain("BASIC-ACTION SIZE FOUNDATION");
  expect(prompt).toContain("never scale up to fill the slot");
  expect(prompt).toContain("Weapon use and requested VFX are allowed");
  expect(prompt).toContain("reference immediately before LAST");
  expect(prompt).not.toContain("Keep weapons stowed or passively lowered exactly as in Idle");
});
