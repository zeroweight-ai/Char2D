import { expect,test } from "@playwright/test";
import { manifestSchema } from "../src/lib/manifest";
test.use({deviceScaleFactor:2});
test("side-view acceptance generates the four default moves, mirrors left, and plays frames",async({page,request},testInfo)=>{
  const response=await request.post("/api/characters",{multipart:{mode:"prompt",name:`Side adventurer ${Date.now()}`,description:"A green-clothed knight"}});
  expect(response.status()).toBe(202);const {id}=await response.json();
  await page.goto(`/characters/${id}`);
  await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
  const detail=await (await request.get(`/api/characters/${id}`)).json();
  await page.getByRole("button",{name:"Looks good — accept sheet"}).click();
  await expect(page.getByTestId("hero-status")).toHaveText("Ready to play",{timeout:30_000});
  const duplicate=await request.post(`/api/characters/${id}/sheet/accept`,{data:{sheetId:detail.sheet.id}});
  expect(duplicate.status()).toBe(202);expect((await duplicate.json()).alreadyQueued).toBe(true);
  const character=await (await request.get(`/api/characters/${id}`)).json();
  const manifest=manifestSchema.parse(character.manifest);expect(character.animation.total).toBe(10);
  expect(Object.keys(manifest.actions)).toEqual(["idle","walk","jump","crouch"]);
  expect(manifest.actions.walk.directions.left).toEqual({mirrorOf:"right"});
  expect(Math.max(...manifest.actions.walk.directions.right!.frames!.map(frame=>frame.h))).toBe(43);
  await page.getByRole("button",{name:"Walk",exact:true}).click();
  const canvas=page.getByTestId("sprite-player");
  await expect(canvas).toHaveAttribute("data-action","walk");
  await expect.poll(async()=>canvas.evaluate(el=>{const c=el as HTMLCanvasElement;return c.getContext("2d")!.getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0);})).toBe(true);
  await expect.poll(async()=>canvas.evaluate(el=>{
    const c=el as HTMLCanvasElement,pixels=c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;
    let first=c.height,last=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]){first=Math.min(first,y);last=Math.max(last,y);}
    return (last-first+1)/c.height;
  })).toBeGreaterThan(0.7);
  await page.getByLabel("Animation direction",{exact:true}).selectOption("left");await expect(canvas).toHaveAttribute("data-direction","left");
  await page.getByRole("button",{name:"Pause",exact:true}).click();await page.getByLabel("Animation frame",{exact:true}).fill("3");await expect(canvas).toHaveAttribute("data-frame","3");
  await page.getByRole("group",{name:"Animation stage, keyboard controls"}).focus();await page.keyboard.down("ArrowRight");await expect(canvas).toHaveAttribute("data-direction","right");await page.keyboard.up("ArrowRight");await expect(canvas).toHaveAttribute("data-action","idle");
  await page.reload();await expect(page.getByRole("tab",{name:"Play",selected:true})).toBeVisible();
  await page.getByText("View ▾").click();
  await page.getByLabel("Preview zoom",{exact:true}).selectOption("native");
  await expect(canvas).toHaveAttribute("data-render-scale","1");
  await page.getByLabel("Preview zoom",{exact:true}).selectOption("fit");
  expect(await canvas.evaluate(el=>{const canvas=el as HTMLCanvasElement;return canvas.width>=Math.floor(canvas.getBoundingClientRect().width*(window.devicePixelRatio||1));})).toBe(true);
  await page.screenshot({path:testInfo.outputPath("animations.png"),fullPage:true});
});
