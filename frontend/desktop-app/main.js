// LRMIS desktop app: the LRMIS website in a window that the computer protects. Screenshots, screen recording and screen
// sharing (Zoom, Meet, Teams) of the window come out black (Windows) or leave it out (Mac). Certificates are shown only
// here: in a normal browser the certificate page asks to open it in this app.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf8"));
const server = String(config.server).replace(/\/+$/, "");
const origin = new URL(server).origin;
// The website knows it is inside this app from this mark (it then shows certificates).
const MARK = `LRMISDesktop/${app.getVersion()}`;

/** Every window of the app is protected, including ones the site opens (print preview, documents). */
function protect(win) {
  win.setContentProtection(true);
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ${MARK}`);
  // No developer tools and no "save page" route around the protection.
  win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
  win.webContents.on("before-input-event", (e, input) => {
    const k = input.key.toLowerCase();
    if (input.key === "F12" || ((input.control || input.meta) && input.shift && (k === "i" || k === "j" || k === "c"))) e.preventDefault();
    if ((input.control || input.meta) && k === "s") e.preventDefault();
  });
  // Only LRMIS pages open inside the app; anything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 1100, height: 900, autoHideMenuBar: true } };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
}

function open() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "LRMIS",
    icon: join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    fullscreen: Boolean(config.fullScreen),
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  void win.loadURL(`${server}/`);
}

// Every window, including ones the site opens, gets the same protection.
app.on("browser-window-created", (_e, win) => protect(win));

void app.whenReady().then(() => {
  // A plain menu (Edit for copy/paste in forms, View for reload and zoom), no developer tools.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ]),
  );
  // Only LRMIS pages get the camera (staff chat pictures); no microphone or other device access is ever granted.
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => {
    const fromLrmis = (details.requestingUrl ?? wc.getURL()).startsWith(origin);
    if (permission === "media") return done(fromLrmis && !(details.mediaTypes ?? []).includes("audio"));
    done(permission === "clipboard-sanitized-write");
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === "media" && requestingOrigin === origin);
  open();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && open());
});
app.on("window-all-closed", () => app.quit());
