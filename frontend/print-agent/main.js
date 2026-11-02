// LRMIS print program: one copy runs for one added printer. It signs in with that printer's secret key, takes jobs
// from the website, prints them silently on that printer only, and reports back. No PDF is made.
const { app, BrowserWindow } = require("electron");
const { execFile } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const CHECK_EVERY_MS = 10_000;
const PAGE_TIMEOUT_MS = 60_000;

const config = JSON.parse(readFileSync(process.argv.find((a) => a.endsWith(".json")) ?? join(__dirname, "config.json"), "utf8"));
const server = config.server.replace(/\/+$/, "");
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(path, body) {
  const res = await fetch(`${server}/api/print-agent/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** What the network says is at the printer's address, from the computer's ARP table. Null when it can't tell. */
function macAt(ip) {
  return new Promise((resolve) => {
    if (!ip) return resolve(null);
    execFile("arp", process.platform === "win32" ? ["-a", ip] : ["-n", ip], { timeout: 3000 }, (_err, stdout) => {
      const m = /([0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}/i.exec(stdout ?? "");
      if (!m) return resolve(null);
      resolve(m[0].replace(/-/g, ":").split(":").map((x) => x.padStart(2, "0").toUpperCase()).join(":"));
    });
  });
}

function printJob(job, printerName) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const finish = (ok, error) => {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      resolve({ ok, error });
    };
    const timer = setTimeout(() => finish(false, "The page did not open in time"), PAGE_TIMEOUT_MS);
    win.webContents.once("did-fail-load", (_e, _code, why) => finish(false, why));
    win.webContents.once("did-finish-load", () => {
      // Give the emblem and QR code a moment to draw.
      setTimeout(() => {
        win.webContents.print({ silent: true, printBackground: true, deviceName: printerName, margins: { marginType: "none" }, preferCSSPageSize: true }, (ok, why) => finish(ok, ok ? undefined : why));
      }, 1000);
    });
    void win.loadURL(`${server}/${job.locale}/agent-print/${job.token}`);
  });
}

let printerIp = null;
let lastBlocked = null;
let helper;

async function tick() {
  try {
    const printers = (await helper.webContents.getPrintersAsync()).map((p) => p.name);
    const printer_mac = await macAt(printerIp);
    const { status, data } = await api("claim", { printers, ...(printer_mac ? { printer_mac } : {}) });
    if (status === 401) return log("The server refused this key. Get a new key on the Add printer page.");
    if (!data.ok) return log("The server answered:", status, data.error);
    printerIp = data.printer.connection_type === "usb" ? null : data.printer.ip_address;
    if (data.blocked !== lastBlocked) {
      lastBlocked = data.blocked;
      log(data.blocked ? `Printing is stopped: ${data.blocked}` : `Ready: ${data.printer.code} (${data.printer.system_name})`);
    }
    if (!data.job) return;
    log(`Printing ${data.job.serial}`);
    const result = await printJob(data.job, data.printer.system_name);
    log(result.ok ? `Sent ${data.job.serial} to the printer` : `Failed ${data.job.serial}: ${result.error}`);
    await api("report", { job: data.job.id, ok: result.ok, ...(result.error ? { error: String(result.error).slice(0, 300) } : {}) });
    // More may be waiting.
    return tick();
  } catch (err) {
    log("Could not reach the server:", err.message);
  }
}

app.on("window-all-closed", () => {});
void app.whenReady().then(async () => {
  helper = new BrowserWindow({ show: false });
  log(`LRMIS print program, server ${server}`);
  const loop = async () => {
    await tick();
    setTimeout(() => void loop(), CHECK_EVERY_MS);
  };
  void loop();
});
