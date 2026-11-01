import { expect,test } from "@playwright/test";
test("fake job runs through the worker and streams its saved preview",async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading",{name:/Your next character/})).toBeVisible();
  await page.getByRole("button",{name:"Run demo job"}).click();
  await expect(page.getByRole("status")).toHaveText("Ready",{timeout:30_000});
  await expect(page.getByRole("img",{name:"Demo pixel character sheet"})).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("value","100");
  await page.getByRole("link",{name:"Settings",exact:true}).click();
  await expect(page.getByText("Fake AI — no paid calls")).toBeVisible();
  await page.getByRole("button",{name:"Test connection"}).click();
  await expect(page.getByRole("status")).toContainText("Fake AI is connected");
});
