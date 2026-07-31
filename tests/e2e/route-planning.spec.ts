import { expect, test } from "@playwright/test";

test("plans, saves, and restores a scenic route", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  await page.locator("#start-query").fill("杭州西湖");

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
  expect(browserErrors).toEqual([]);
});
