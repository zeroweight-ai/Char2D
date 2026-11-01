import { expect,test } from "@playwright/test";
import sharp from "sharp";
for(const mode of ["prompt","upload"] as const) {
  test(`create from ${mode}, remove background, review and accept`,async({page,request})=>{
    await page.goto("/");
    await page.getByRole("link",{name:"Create a character →"}).click();
    await page.getByRole("radio",{name:mode==="prompt" ? /Describe a character/:/Upload an image/}).check();
    await expect(page.getByLabel("Character pixel height",{exact:true})).toHaveCount(0);
    await page.getByLabel("Character name").fill(`${mode} knight ${Date.now()}`);
    await page.getByLabel(mode==="prompt" ? "Describe your character":"Appearance notes (optional)").fill("A knight with green clothing and steel armor");
    if(mode==="upload") await page.getByLabel("Character image",{exact:true}).setInputFiles("tests/fixtures/demo-sheet.png");
    await page.getByRole("button",{name:"Generate character sheet"}).click();
    await expect(page).toHaveURL(/\/characters\//);
    await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
    const image=page.getByRole("img",{name:/transparent character sheet/});
    const url=await image.getAttribute("src");
    const result=await request.get(url!);expect(result.ok()).toBe(true);
    const {data,info}=await sharp(await result.body()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect(data[3]).toBe(0);
    let transparent=0,opaque=0;
    for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]===255)opaque++;}
    expect(transparent).toBeGreaterThan(info.width*info.height*0.1);expect(opaque).toBeGreaterThan(0);
    const wrongSheet=await request.post(`${new URL(page.url()).pathname.replace("/characters/","/api/characters/")}/sheet/accept`,{data:{sheetId:"stale-sheet-id"}});
    expect(wrongSheet.status()).toBe(409);
    await page.getByRole("button",{name:"Looks good — accept sheet"}).click();
    await expect(page.getByRole("heading",{name:"Character sheet accepted"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Animations ready",exact:true})).toBeVisible({timeout:30_000});
    await page.getByRole("button",{name:"Walk",exact:true}).click();
    await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-action","walk");
    await page.getByRole("button",{name:"Pause",exact:true}).click();
    await page.getByLabel("Animation frame",{exact:true}).fill("2");
    await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-frame","2");
    await page.getByLabel("Animation direction",{exact:true}).selectOption("left");
    await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-direction","left");
    await page.getByLabel("Revision note (optional)").fill("Make the cape shorter");
    await page.getByRole("button",{name:"Regenerate sheet",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
    await expect(page.getByTestId("revision-strategy")).toContainText("Editing latest sheet");
    await page.reload();
    await expect(page.getByRole("img",{name:/transparent character sheet/})).toBeVisible();
    await expect(page.getByTestId("revision-strategy")).toContainText("Editing latest sheet");
    await page.getByLabel("Revision note (optional)").fill("Start over from scratch with a new sheet");
    await page.getByRole("button",{name:"Regenerate sheet",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
    await expect(page.getByTestId("revision-strategy")).toContainText("Generating a fresh sheet");
  });
}
test("rejects invalid creation input and invalid upload bytes",async({request})=>{
  const noPrompt=await request.post("/api/characters",{multipart:{mode:"prompt",name:"Knight",description:"",viewType:"side_scroller"}});
  expect(noPrompt.status()).toBe(400);
  const badUpload=await request.post("/api/characters",{multipart:{mode:"upload",name:"Knight",description:"",viewType:"side_scroller",image:{name:"bad.png",mimeType:"image/png",buffer:Buffer.from("not an image")}}});
  expect(badUpload.status()).toBe(400);
});


test("selects three-quarter view before generating and preserves it through animations",async({page,request})=>{
  await page.goto("/create");
  await expect(page.getByRole("radio",{name:/Side view/})).toBeChecked();
  await expect(page.getByRole("radio",{name:/Top-down view/})).toBeVisible();
  await page.getByRole("radio",{name:/Three-quarter view/}).check();
  await page.getByRole("radio",{name:/Describe a character/}).check();
  await page.getByLabel("Character name").fill(`Quarter knight ${Date.now()}`);
  await page.getByLabel("Describe your character").fill("green knight");
  await page.getByRole("button",{name:"Generate character sheet"}).click();
  await expect(page).toHaveURL(/\/characters\//);
  await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
  const endpoint=new URL(page.url()).pathname.replace("/characters/","/api/characters/");
  expect((await (await request.get(endpoint)).json()).viewType).toBe("three_quarter");
  await page.getByRole("button",{name:"Looks good — accept sheet"}).click();
  await expect(page.getByRole("heading",{name:"Animations ready",exact:true})).toBeVisible({timeout:30_000});
  const detail=await (await request.get(endpoint)).json();
  expect(detail.manifest.viewType).toBe("three_quarter");
  expect(detail.manifest.actions.walk.directions.up.frames).toHaveLength(6);
  await expect(page.getByTestId("sprite-player")).toHaveAttribute("data-direction","down");
});
