import { expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/en/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Forced first-login password change. */
export async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Save and continue" }).click();
}

/** Enrol (or verify) TOTP using the manual key shown on /mfa. Returns the secret. */
export async function completeMfa(page: Page, knownSecret?: string): Promise<string> {
  await expect(page).toHaveURL(/\/mfa$/);
  let secret = knownSecret;
  if (!secret) {
    const key = page.locator("span.select-all");
    await expect(key).toBeVisible();
    secret = (await key.innerText()).trim();
  }
  await page.getByLabel("6-digit code").fill(authenticator.generate(secret));
  await page.getByRole("button", { name: knownSecret ? "Verify" : "Turn on 2FA" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return secret;
}
