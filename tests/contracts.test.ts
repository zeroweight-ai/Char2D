import { expect,it } from "vitest";
import { frameAtTime } from "../src/lib/anim/timeline";
import { actionPlanSchema } from "../src/lib/manifest";
import { assetPath } from "../src/server/storage/assets";
it("uses variable frame timing, wraps loops, and holds terminal frames",() => {
  expect(frameAtTime([100,200,100],100,"loop")).toEqual({index:1,finished:false});
  expect(frameAtTime([100,200,100],450,"loop")).toEqual({index:0,finished:false});
  expect(frameAtTime([100,200,100],400,"once_hold")).toEqual({index:2,finished:true});
});
it("rejects mismatched pose counts and out-of-bounds frame hints",() => {
  const plan={summary:"jump",frames:2,poses:["crouch","leap"],durationsMs:[100,200],playback:"once",canvas:"standard"};
  expect(actionPlanSchema.safeParse(plan).success).toBe(true);
  expect(actionPlanSchema.safeParse({...plan,poses:["crouch"]}).success).toBe(false);
  expect(actionPlanSchema.safeParse({...plan,airborneFrames:[2]}).success).toBe(false);
});
it("prevents asset paths from escaping storage",() => {
  expect(() => assetPath("../secret")).toThrow("Invalid asset path");
  expect(() => assetPath("/etc/passwd")).toThrow("Invalid asset path");
});

it("limits action plans to four frames",() => {
  const plan=(frames:number)=>({summary:"walk",frames,poses:Array(frames).fill("pose"),durationsMs:Array(frames).fill(100),playback:"loop",canvas:"standard"});
  expect(actionPlanSchema.safeParse(plan(4)).success).toBe(true);
  expect(actionPlanSchema.safeParse(plan(5)).success).toBe(false);
});
