import { expect,test } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve } from "node:path";
test("retries processing a saved failed sheet without replacing its raw image",async({page,request})=>{
  const response=await request.post("/api/characters",{multipart:{mode:"prompt",name:`Saved retry ${Date.now()}`,description:"green knight",viewType:"side_scroller"}});const {id}=await response.json();
  await page.goto(`/characters/${id}`);await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
  const before=await (await request.get(`/api/characters/${id}`)).json();
  // Simulate a processing failure in the isolated Playwright database, retaining
  // the provider's saved raw image exactly as a real extraction failure does.
  const db=new Database(resolve("data/e2e/char2d.db"));db.pragma("busy_timeout=5000");
  db.transaction(()=>{
    db.prepare("UPDATE character_sheets SET status='error',processed_asset_id=NULL WHERE id=?").run(before.sheet.id);
    db.prepare("UPDATE characters SET status='error' WHERE id=?").run(id);
    db.prepare("UPDATE jobs SET status='error',error='extract_mismatch: expected 3 separated poses' WHERE id=?").run(before.job.id);
  }).immediate();db.close();
  await page.reload();await page.getByRole("button",{name:"Retry saved sheet processing",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Your transparent character sheet"})).toBeVisible({timeout:30_000});
  const after=await (await request.get(`/api/characters/${id}`)).json();
  expect(after.sheet.id).toBe(before.sheet.id);expect(after.sheet.rawAssetId).toBe(before.sheet.rawAssetId);expect(after.sheet.status).toBe("ready");
});
