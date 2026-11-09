import "server-only";
import { headers } from "next/headers";

/** Opened inside the LRMIS desktop app (its window is protected from screenshots and screen sharing). */
export async function inDesktopApp() {
  return /\bLRMISDesktop\/\d/.test((await headers()).get("user-agent") ?? "");
}

/**
 * Certificates and ID cards are shown on screen only inside the desktop app (CERTIFICATES_DESKTOP_ONLY=on). In a normal
 * browser their page asks to open them in the app. Printing through the print program is not affected.
 */
export async function certificateHidden() {
  return process.env.CERTIFICATES_DESKTOP_ONLY === "on" && !(await inDesktopApp());
}
