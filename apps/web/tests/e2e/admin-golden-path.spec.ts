/**
 * §10 step 11 — Admin golden path, end to end against a real Supabase stack:
 *   supabase db reset && pnpm create-super-admin && pnpm test:e2e
 * Needs E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD (the bootstrap credentials).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { changePassword, completeMfa, signIn } from "./helpers";

const SA_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL;
const SA_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD;
const SA_NEW_PASSWORD = "Banadir-Admin-2026!x";
const COLLECTOR_EMAIL = "collector.test@gmail.com";
const COLLECTOR_TEMP = "Temp-Collector-2026!";
const COLLECTOR_NEW = "Collector-Own-2026!q";

test.describe.serial("admin golden path", () => {
  test.skip(!SA_EMAIL || !SA_PASSWORD, "Set E2E_SUPER_ADMIN_EMAIL and E2E_SUPER_ADMIN_PASSWORD");

  let admin: Page;
  let adminSecret = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    admin = await (await browser.newContext({ locale: "en-US" })).newPage();
  });

  test("Super Admin signs in with the bootstrap Gmail, changes password, sets up 2FA", async () => {
    await signIn(admin, SA_EMAIL!, SA_PASSWORD!);
    await changePassword(admin, SA_PASSWORD!, SA_NEW_PASSWORD);
    adminSecret = await completeMfa(admin);
    await expect(admin.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Users" })).toBeVisible();
  });

  test("creates role Field Collector with only payments.create + parcels.view", async () => {
    await admin.goto("/en/admin/roles/new");
    await admin.getByLabel("Name (Somali)").fill("Ururiye Goob");
    await admin.getByLabel("Name (English)").fill("Field Collector");
    await admin.getByRole("radio", { name: /Own district/ }).check();
    await admin.getByRole("checkbox", { name: "Payments — Create" }).click();
    await admin.getByRole("checkbox", { name: "Parcels — View" }).click();
    await expect(admin.getByText("2 permissions selected")).toBeVisible();
    await admin.getByRole("button", { name: "Create role" }).click();
    await expect(admin).toHaveURL(/\/en\/admin\/roles\/[0-9a-f-]{36}$/);
  });

  test("creates collector.test@gmail.com with a password, that role and district Hodan", async () => {
    await admin.goto("/en/admin/users/new");
    await admin.getByLabel("Full name").fill("Test Collector");
    await admin.getByLabel("Email").fill(COLLECTOR_EMAIL);
    await admin.getByText("Field Collector", { exact: true }).click();
    await admin.getByRole("combobox").click();
    await admin.getByPlaceholder("Search").fill("Hodan");
    await admin.getByRole("option", { name: /Hodan/ }).click();
    await admin.keyboard.press("Escape");
    await admin.getByLabel("Temporary password").fill(COLLECTOR_TEMP);
    // Double-click must not create two users (idempotency key + disabled button).
    await admin.getByRole("button", { name: "Create user" }).dblclick();
    await expect(admin.getByRole("dialog")).toContainText(COLLECTOR_TEMP);
    await admin.getByRole("button", { name: "I've copied it" }).click();
    await expect(admin).toHaveURL(/\/en\/admin\/users\/[0-9a-f-]{36}$/);

    await admin.goto(`/en/admin/users?q=${encodeURIComponent(COLLECTOR_EMAIL)}`);
    await expect(admin.getByText("1 user", { exact: true })).toBeVisible();
  });

  test("the collector must change password, sees only their area and gets 403 on /admin", async ({ browser }) => {
    const collector = await (await browser.newContext({ locale: "en-US" })).newPage();
    await signIn(collector, COLLECTOR_EMAIL, COLLECTOR_TEMP);
    await changePassword(collector, COLLECTOR_TEMP, COLLECTOR_NEW);
    await completeMfa(collector);
    const nav = collector.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
    await collector.goto("/en/admin/users");
    await expect(collector.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
    await collector.context().close();
  });

  test("admin suspends the collector and their sign-in is blocked", async ({ browser }) => {
    await admin.goto(`/en/admin/users?q=${encodeURIComponent(COLLECTOR_EMAIL)}`);
    await admin.getByRole("link", { name: /Test Collector/ }).first().click();
    await admin.getByRole("tab", { name: "Security & status" }).click();
    await admin.getByRole("button", { name: "Suspend", exact: true }).click();
    await admin.getByRole("alertdialog").getByRole("button", { name: "Confirm" }).click();
    await expect(admin.getByText("User suspended")).toBeVisible();

    const collector = await (await browser.newContext({ locale: "en-US" })).newPage();
    await signIn(collector, COLLECTOR_EMAIL, COLLECTOR_NEW);
    await expect(collector.getByRole("alert")).toContainText("This account is suspended");
    await collector.context().close();
  });

  test("deleting the role while assigned is blocked; after moving the user it is deleted", async () => {
    await admin.goto("/en/admin/roles");
    const row = admin.getByRole("row", { name: /Field Collector/ });
    await row.getByRole("button", { name: "Actions" }).click();
    await admin.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = admin.getByRole("alertdialog");
    await expect(dialog).toContainText("1 user still has this role");
    await dialog.getByRole("button", { name: "Move users and delete" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Move them to another role first");
    await dialog.getByLabel("Move users to").selectOption({ label: "Cashier / Collector" });
    await dialog.getByRole("button", { name: "Move users and delete" }).click();
    await expect(admin.getByText('Role "Field Collector" deleted')).toBeVisible();
    await expect(admin.getByRole("row", { name: /Field Collector/ })).toHaveCount(0);
  });

  test("admin cannot delete or suspend themselves (last Super Admin is protected)", async () => {
    await admin.goto("/en/admin/users?q=" + encodeURIComponent(SA_EMAIL!));
    await admin.getByRole("link", { name: new RegExp(SA_EMAIL!.split("@")[0]!, "i") }).first().click();
    await admin.getByRole("tab", { name: "Security & status" }).click();
    await expect(admin.getByText("Some actions are not available on your own account.")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await expect(admin.getByRole("button", { name: "Suspend", exact: true })).toHaveCount(0);
    expect(adminSecret).not.toBe("");
  });
});
