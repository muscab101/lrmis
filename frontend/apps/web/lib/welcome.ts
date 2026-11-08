/**
 * "Just signed in": set by the sign-in forms right before they open the app, read once by the layout to show the
 * welcome screen, then cleared. A cookie (not storage) so the server draws the welcome screen with the first paint,
 * with no flash of the page underneath. Lives a minute at most.
 */
export const WELCOME_COOKIE = "dhulka_welcome";

export function markJustSignedIn() {
  document.cookie = `${WELCOME_COOKIE}=1; path=/; max-age=60; samesite=lax`;
}

export function clearJustSignedIn() {
  document.cookie = `${WELCOME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
