import { expect,it } from "vitest";
import { bindingsInputSchema,codeOwner,defaultCodes,findConflicts,keyLabel,movementKeys,type Bindings } from "../src/lib/bindings";
it("assigns PLAN §6.5 default keys and skips taken ones",() => {
  const taken=new Set(Object.keys(movementKeys("side_scroller","p1")));
  expect(defaultCodes("side_scroller","p1","jump",taken)).toEqual(["KeyW","Space"]);
  expect(defaultCodes("side_scroller","p2","crouch",taken)).toEqual(["ArrowDown"]);
  expect(defaultCodes("side_scroller","p1","walk",taken)).toEqual([]);
  expect(defaultCodes("side_scroller","p1","fireball",new Set(["KeyJ"]))).toEqual(["KeyK"]);
  expect(defaultCodes("top_down","p2","fireball",new Set())).toEqual(["Numpad1"]);
  // Top-down W is movement, so a custom action never lands on it.
  expect(movementKeys("top_down","p1").KeyW).toBe("up");
});
it("detects conflicts with movement keys and across players",() => {
  const labels={jump:"Jump",fireball:"Fireball"};
  const ok:Bindings={p1:{jump:["KeyW","Space"],fireball:["KeyJ"]},p2:{jump:["ArrowUp"]}};
  expect(findConflicts("side_scroller",ok,labels)).toEqual([]);
  expect(findConflicts("side_scroller",{p1:{fireball:["KeyA"]},p2:{}},labels)[0].message).toBe("A is already used by Player 1 move left.");
  expect(findConflicts("side_scroller",{p1:{fireball:["KeyJ"]},p2:{jump:["KeyJ"]}},labels)[0].message).toBe("J is already used by Fireball (Player 1).");
  expect(codeOwner("side_scroller",ok,"Space")).toEqual({profile:"p1",action:"jump"});
  expect(codeOwner("side_scroller",ok,"ArrowLeft")).toEqual({profile:"p2",action:null});
  expect(codeOwner("side_scroller",ok,"KeyZ")).toBeNull();
});
it("validates input and labels keys for humans",() => {
  expect(bindingsInputSchema.safeParse({profile:"p1",bindings:{jump:["Escape"]}}).success).toBe(false);
  expect(bindingsInputSchema.safeParse({profile:"p3",bindings:{}}).success).toBe(false);
  expect(bindingsInputSchema.safeParse({profile:"p1",bindings:{jump:["KeyQ","Space"]}}).success).toBe(true);
  expect([keyLabel("KeyJ"),keyLabel("ArrowUp"),keyLabel("Digit3"),keyLabel("Numpad4"),keyLabel("Space")]).toEqual(["J","↑","3","Num4","Space"]);
});
