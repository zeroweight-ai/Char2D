import { expect,test,type APIRequestContext,type Page } from "@playwright/test";
// Phase 3 acceptance: every default action plays from chips and keys, retiming
// persists, undo/redo between versions works, and bindings detect conflicts.
async function readyHero(page:Page,request:APIRequestContext,name:string) {
  const response=await request.post("/api/characters",{multipart:{mode:"prompt",name:`${name} ${Date.now()}`,description:"green knight",viewType:"side_scroller"}});
  expect(response.status()).toBe(202);const {id}=await response.json();
  await page.goto(`/characters/${id}`);
  await page.getByRole("button",{name:"Looks good — accept sheet"}).click({timeout:30_000});
  await expect(page.getByTestId("hero-status")).toHaveText("Ready to play",{timeout:30_000});
  return id as string;
}
const detail=async(request:APIRequestContext,id:string)=>(await request.get(`/api/characters/${id}`)).json();

test("default actions play from keys with the saved bindings",async({page,request})=>{
  const id=await readyHero(page,request,"Keys");
  const bindings=(await detail(request,id)).bindings;
  expect(bindings.p1).toMatchObject({jump:["KeyW","Space"],crouch:["KeyS"]});
  expect(bindings.p2).toMatchObject({jump:["ArrowUp"],crouch:["ArrowDown"]});
  const canvas=page.getByTestId("sprite-player"),stage=page.getByRole("group",{name:"Animation stage, keyboard controls"});
  for(const [label,key] of [["Walk","walk"],["Jump","jump"],["Crouch","crouch"],["Idle","idle"]]){await page.getByRole("button",{name:label,exact:true}).click();await expect(canvas).toHaveAttribute("data-action",key);}
  await stage.focus();
  await page.keyboard.down("KeyD");await expect(canvas).toHaveAttribute("data-action","walk");await expect(canvas).toHaveAttribute("data-direction","right");await page.keyboard.up("KeyD");await expect(canvas).toHaveAttribute("data-action","idle");
  await page.keyboard.down("KeyS");await expect(canvas).toHaveAttribute("data-action","crouch");await page.keyboard.up("KeyS");await expect(canvas).toHaveAttribute("data-action","idle");
  // Jump is a press: it plays through, then returns to idle on its own.
  await page.keyboard.press("Space");await expect(canvas).toHaveAttribute("data-action","jump");await expect(canvas).toHaveAttribute("data-action","idle",{timeout:5_000});
  await page.keyboard.down("ArrowDown");await expect(canvas).toHaveAttribute("data-action","crouch");await page.keyboard.up("ArrowDown");
  // Keys work page-wide, even right after clicking a move button.
  await page.getByRole("button",{name:"Idle",exact:true}).click();
  await page.keyboard.down("KeyD");await expect(canvas).toHaveAttribute("data-action","walk");
  // Jump while walking: after landing, keep walking because D is still held.
  await page.keyboard.press("KeyW");await expect(canvas).toHaveAttribute("data-action","jump");
  await expect(canvas).toHaveAttribute("data-action","walk",{timeout:5_000});await expect(canvas).toHaveAttribute("data-direction","right");
  await page.keyboard.up("KeyD");await expect(canvas).toHaveAttribute("data-action","idle");
  // Typing in a field never drives the hero.
  await page.getByRole("button",{name:"Edit move",exact:true}).click();
  await page.getByLabel("Frame 1 duration in milliseconds").focus();await page.keyboard.press("KeyD");await expect(canvas).toHaveAttribute("data-action","idle");
});

test("retiming persists without an AI call, and undo/redo switches versions",async({page,request})=>{
  const id=await readyHero(page,request,"Retime");
  await page.getByRole("button",{name:"Walk",exact:true}).click();
  await page.getByRole("button",{name:"Edit move",exact:true}).click();
  const inspector=page.getByRole("complementary",{name:"Inspector: Walk"});
  await inspector.getByLabel("Frame 1 duration in milliseconds").fill("300");
  await inspector.getByRole("button",{name:"Slower",exact:true}).click();
  const saved=page.waitForResponse(r=>r.url().endsWith(`/api/characters/${id}/actions/walk`)&&r.request().method()==="PATCH");
  await inspector.getByRole("button",{name:"Save changes",exact:true}).click();
  expect((await (await saved).json()).imageCalls).toBe(0);
  await page.reload();await page.getByRole("button",{name:"Edit move",exact:true}).click();
  const durations=(await detail(request,id)).manifest.actions.walk.directions.right.frames.map((f:{durationMs:number})=>f.durationMs);
  expect(durations[0]).toBe(380);expect(durations.slice(1)).toEqual([130,130,130]);
  await page.getByRole("button",{name:"Walk",exact:true}).click();
  await expect(page.getByRole("complementary",{name:"Inspector: Walk"}).getByLabel("Frame 1 duration in milliseconds")).toHaveValue("380");

  // Re-roll Walk to create v2, then undo back to v1 and redo to v2.
  await page.getByRole("tab",{name:"Moves"}).click();await page.getByRole("button",{name:"Regenerate Walk",exact:true}).click();
  await expect.poll(async()=>{const value=await detail(request,id);return value.status==="ready"&&value.animation.actions.find((a:{key:string})=>a.key==="walk").activeVersion;},{timeout:30_000}).toBe(2);
  await page.reload();await page.getByRole("button",{name:"Walk",exact:true}).click();await page.getByRole("button",{name:"Edit move",exact:true}).click();
  const atlasBefore=(await detail(request,id)).manifest.atlas.version;
  await page.getByRole("button",{name:"Undo to v1",exact:true}).click();
  await expect.poll(async()=>{const value=await detail(request,id);return value.status==="ready"&&value.animation.actions.find((a:{key:string})=>a.key==="walk").activeVersion;},{timeout:30_000}).toBe(1);
  const undone=await detail(request,id);
  expect(undone.manifest.atlas.version).toBe(atlasBefore+1);
  // v1 kept its own retimed durations.
  expect(undone.manifest.actions.walk.directions.right.frames[0].durationMs).toBe(380);
  await page.getByRole("button",{name:"Walk",exact:true}).click();
  await page.getByRole("button",{name:"Redo to v2",exact:true}).click();
  await expect.poll(async()=>{const value=await detail(request,id);return value.status==="ready"&&value.animation.actions.find((a:{key:string})=>a.key==="walk").activeVersion;},{timeout:30_000}).toBe(2);
});

test("rebinding detects conflicts, offers a swap, and drives the stage",async({page,request})=>{
  const id=await readyHero(page,request,"Bindings");
  await page.getByRole("tab",{name:"Controls"}).click();
  const controls=page.getByRole("table",{name:"Key bindings"});
  await controls.getByRole("button",{name:"Add key for Crouch (Player 1)"}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByRole("heading",{name:"Press a key for Crouch"})).toBeVisible();
  await page.keyboard.press("KeyA");await expect(dialog.getByRole("alert")).toContainText("A is a Player 1 movement key");
  await page.keyboard.press("Space");
  await expect(dialog.getByText("Space is already used by Jump (Player 1). Swap?")).toBeVisible();
  await dialog.getByRole("button",{name:"Swap keys",exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async()=>(await detail(request,id)).bindings.p1).toMatchObject({jump:["KeyW"],crouch:["KeyS","Space"]});
  // Server rejects a conflicting set even if the UI is bypassed.
  const conflict=await request.put(`/api/characters/${id}/bindings`,{data:{profile:"p2",bindings:{jump:["Space"]}}});
  expect(conflict.status()).toBe(409);expect((await conflict.json()).error).toContain("Space is already used by Crouch (Player 1)");
  await page.getByRole("tab",{name:"Play"}).click();
  const stage=page.getByRole("group",{name:"Animation stage, keyboard controls"});await stage.focus();
  await page.keyboard.down("Space");await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-action","crouch");await page.keyboard.up("Space");
  // Backspace clears a key, and a cleared key stays cleared after reload.
  await page.getByRole("tab",{name:"Controls"}).click();
  await controls.getByRole("button",{name:"Change Space for Crouch (Player 1)"}).click();
  await page.keyboard.press("Backspace");await expect(dialog).toBeHidden();
  await page.reload();
  await expect.poll(async()=>(await detail(request,id)).bindings.p1.crouch).toEqual(["KeyS"]);
});
