import { expect, test } from "@playwright/test";

test("root redirects to the Somali home page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/so$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "so");
  await expect(page.getByRole("link", { name: "Galitaanka shaqaalaha" }).first()).toBeVisible();
});

test("language switch keeps the page", async ({ page }) => {
  await page.goto("/so/login");
  await page.getByRole("button", { name: "Beddel luqadda" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
});

test("staff pages require sign-in and keep the target", async ({ page }) => {
  await page.goto("/en/admin/users");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fadmin%2Fusers/);
});

test("login shows a clear, translated error", async ({ page }) => {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is not correct");
  await expect(page.getByRole("alert")).toContainText("Ref");
});

test("design system page renders tokens and components", async ({ page }) => {
  await page.goto("/en/design");
  await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible();
  await expect(page.getByText("BN-HDN-012-000123").first()).toBeVisible();
});

test("health endpoint reports the database", async ({ request }) => {
  const res = await request.get("/api/health");
  const body = (await res.json()) as { database: string };
  expect(["ok", "down", "unconfigured"]).toContain(body.database);
});
