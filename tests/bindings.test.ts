import { expect,it } from "vitest";
import { bindingsInputSchema,codeOwner,defaultCodes,findConflicts,keyLabel,movementKeys,type Bindings } from "../src/lib/bindings";
it("assigns PLAN §6.5 default keys and skips taken ones",() => {
  const taken=new Set(Object.keys(movementKeys("p1")));
  expect(defaultCodes("p1","jump",taken)).toEqual(["KeyW","Space"]);
  expect(defaultCodes("p2","crouch",taken)).toEqual(["ArrowDown"]);
  expect(defaultCodes("p1","walk",taken)).toEqual([]);
  expect(defaultCodes("p1","fireball",new Set(["KeyJ"]))).toEqual(["KeyK"]);
  expect(defaultCodes("p2","fireball",new Set())).toEqual(["Numpad1"]);
  // Side view: only A/D (P1) and ←/→ (P2) move.
  expect(movementKeys("p1")).toEqual({KeyA:"left",KeyD:"right"});
});
it("detects conflicts with movement keys and across players",() => {
  const labels={jump:"Jump",fireball:"Fireball"};
  const ok:Bindings={p1:{jump:["KeyW","Space"],fireball:["KeyJ"]},p2:{jump:["ArrowUp"]}};
  expect(findConflicts(ok,labels)).toEqual([]);
  expect(findConflicts({p1:{fireball:["KeyA"]},p2:{}},labels)[0].message).toBe("A is already used by Player 1 move left.");
  expect(findConflicts({p1:{fireball:["KeyJ"]},p2:{jump:["KeyJ"]}},labels)[0].message).toBe("J is already used by Fireball (Player 1).");
  expect(codeOwner(ok,"Space")).toEqual({profile:"p1",action:"jump"});
  expect(codeOwner(ok,"ArrowLeft")).toEqual({profile:"p2",action:null});
  expect(codeOwner(ok,"KeyZ")).toBeNull();
});
it("validates input and labels keys for humans",() => {
  expect(bindingsInputSchema.safeParse({profile:"p1",bindings:{jump:["Escape"]}}).success).toBe(false);
  expect(bindingsInputSchema.safeParse({profile:"p3",bindings:{}}).success).toBe(false);
  expect(bindingsInputSchema.safeParse({profile:"p1",bindings:{jump:["KeyQ","Space"]}}).success).toBe(true);
  expect([keyLabel("KeyJ"),keyLabel("ArrowUp"),keyLabel("Digit3"),keyLabel("Numpad4"),keyLabel("Space")]).toEqual(["J","↑","3","Num4","Space"]);
});
