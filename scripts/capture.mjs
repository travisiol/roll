/**
 * Screenshots of the running site with headless Chrome over the DevTools
 * protocol (Node's built-in WebSocket, no dependency):
 *
 *   node scripts/capture.mjs [base=http://localhost:3941] [outDir=docs/captures]
 *   ONLY=hero,table node scripts/capture.mjs      # a subset
 *
 * SwiftShader renders WebGL without a GPU, so the glass dice appear. Device
 * metrics are emulated per shot (phone widths need it), each shot waits a
 * few real seconds for fonts, the scene and the chain reads, and a shot can
 * run a snippet first (`evaluate`) to pick cells on the ladder.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:3941";
const out = resolve(process.argv[3] ?? "docs/captures");
mkdirSync(out, { recursive: true });
const only = process.env.ONLY?.split(",");

const CANDIDATES = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"];
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error("no Chrome found");

// clicks the cells one after the other, a beat apart, the way a hand would
const pick = (cells) => `new Promise((done) => {
  const fire = (el, type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", button: 0, isPrimary: true }));
  const cells = ${JSON.stringify(cells)};
  const step = (i) => {
    if (i >= cells.length) { window.scrollTo(0, 0); done(true); return; }
    const el = document.querySelector('[data-cell="' + cells[i] + '"]');
    if (el) { fire(el, "pointerdown"); fire(el, "pointerup"); }
    setTimeout(() => step(i + 1), 250);
  };
  step(0);
})`;

const shots = [
  { name: "hero", path: "/", w: 1440, h: 900 },
  { name: "landing-full", path: "/", w: 1440, h: 900, full: true },
  { name: "table-btc", path: "/table/btc", w: 1440, h: 900 },
  { name: "table-btc-zone", path: "/table/btc", w: 1440, h: 1100, evaluate: pick([22, 18]) },
  { name: "table-nvda-full", path: "/table/nvda", w: 1440, h: 900, full: true, evaluate: pick([20]) },
  { name: "mobile-hero", path: "/", w: 400, h: 860, mobile: true },
  { name: "mobile-landing-full", path: "/", w: 400, h: 860, mobile: true, full: true },
  { name: "mobile-table-full", path: "/table/eth", w: 400, h: 860, mobile: true, full: true, evaluate: pick([21]) },
].filter((s) => !only || only.includes(s.name));

const PORT = 9341;
const proc = spawn(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${resolve(tmpdir(), "roll-capture")}`,
    `--remote-debugging-port=${PORT}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForChrome() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("chrome did not start");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

async function connect() {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return { cdp: new Cdp(ws), ws, targetId: target.id };
}

try {
  await waitForChrome();
  for (const s of shots) {
    const { cdp, ws, targetId } = await connect();
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: Boolean(s.mobile) });
    await cdp.send("Page.navigate", { url: base + s.path });
    await sleep(7000);
    if (s.evaluate) {
      await cdp.send("Runtime.evaluate", { expression: s.evaluate, awaitPromise: true });
      await sleep(1200);
    }
    let clip;
    if (s.full) {
      const { contentSize } = await cdp.send("Page.getLayoutMetrics");
      const height = Math.min(Math.ceil(contentSize.height), 7000);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.w, height, deviceScaleFactor: 1, mobile: Boolean(s.mobile) });
      await sleep(1500);
      clip = { x: 0, y: 0, width: s.w, height, scale: 1 };
    }
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: Boolean(s.full), ...(clip ? { clip } : {}) });
    writeFileSync(resolve(out, `${s.name}.png`), Buffer.from(data, "base64"));
    console.log(`${s.name}.png`);
    ws.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => {});
  }
} finally {
  proc.kill();
}
