import { expect, test } from "@playwright/test";

test("plans, saves, and restores a scenic route", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await page.locator("#start-query").fill("杭州西湖");
  await page.locator("#legal-consent").check();

  const plannedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/routes/plan"),
  );
  await page.locator('form button[type="submit"]').click();
  expect((await plannedResponse).ok()).toBe(true);
  await expect(page.locator(".route-card").first()).toBeVisible();

  const savedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/saved-routes"),
  );
  await page.getByRole("button", { name: "收藏路线" }).click();
  expect((await savedResponse).status()).toBe(201);
  await expect(page.locator(".saved-route-row")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".saved-route-row")).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  const deleteAllResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith("/api/v1/session"),
  );
  await page
    .getByRole("button", { name: "删除全部设备数据" })
    .click();
  expect((await deleteAllResponse).ok()).toBe(true);
  await expect(page.locator(".saved-route-row")).toHaveCount(0);
  await expect(page.locator("#legal-consent")).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zhaolu.anonymous-session.v1"),
    ),
  ).toBeNull();
  expect(browserErrors).toEqual([]);
});

test("renders privacy and terms with configured operator details", async ({
  page,
}) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "隐私政策" }),
  ).toBeVisible();
  await expect(page.getByText("找路测试运营者")).toBeVisible();
  await expect(page.getByText("privacy@example.test")).toBeVisible();

  await page.goto("/terms");
  await expect(
    page.getByRole("heading", {
      name: "服务条款与路线免责声明",
    }),
  ).toBeVisible();
});
