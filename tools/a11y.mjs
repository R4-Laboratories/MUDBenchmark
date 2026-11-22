// Browser accessibility audit for the three public pages.
//
// This is not a substitute for a human screen-reader pass. It checks the
// structural contract that is easy to regress: main/h1 landmarks, accessible
// names, skip-link first focus, tab semantics, table names, chart names,
// contrast of the core palette and reduced-motion scroll behavior.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import WebSocket from "../runtime/node_modules/ws/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value; } catch {}
    await wait(100);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const port = async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
};
const devtools = (socket) => {
  let nextId = 0;
  const pending = new Map();
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return async (method, params = {}) => {
    const id = ++nextId;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params }));
    return response;
  };
};

const channel = (value) => value / 255;
const linear = (value) => channel(value) <= 0.03928 ? channel(value) / 12.92 : ((channel(value) + 0.055) / 1.055) ** 2.4;
const luminance = (hex) => {
  const value = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  const [r, g, b] = [0, 2, 4].map((index) => linear(parseInt(value.slice(index, index + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const first = luminance(a); const second = luminance(b);
  if (first === null || second === null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

const dir = await mkdtemp(join(tmpdir(), "mudbench-a11y-"));
const webPort = await port();
const telnetPort = await port();
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: join(root, "runtime"),
  env: {
    ...process.env,
    WEB_PORT: String(webPort),
    TELNET_PORT: String(telnetPort),
    STATE_FILE: join(dir, "world.json"),
    IDENTITY_FILE: join(dir, "identities.json"),
    TRACE_FILE: join(dir, "trace.jsonl"),
    TELEMETRY_LOG: join(dir, "telemetry.jsonl"),
    COMMAND_INTERVAL_MS: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const chromeBin = process.env.CHROME_BIN
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const profile = join(dir, "chrome");
const chrome = spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
  "--disable-background-networking", "--no-first-run", "--hide-scrollbars",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
let ws;
const failures = [];
const report = { pages: {} };
try {
  await until(() => fetch(`http://127.0.0.1:${webPort}/health`).then((response) => response.ok), "server");
  const debugPort = await until(async () => {
    const value = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }, "chrome");
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const tab = tabs.find((entry) => entry.type === "page");
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  const send = devtools(ws);
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Accessibility.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  async function audit(path) {
    await send("Page.navigate", { url: `http://127.0.0.1:${webPort}${path}` });
    await wait(1200);
    const tree = await send("Accessibility.getFullAXTree");
    const nodes = (tree.nodes ?? []).filter((node) => !node.ignored);
    const role = (node) => node.role?.value ?? "";
    const name = (node) => node.name?.value ?? "";
    const roles = {};
    for (const node of nodes) roles[role(node)] = (roles[role(node)] ?? 0) + 1;
    const unnamed = nodes
      .filter((node) => ["button", "link", "textbox", "combobox", "tab", "checkbox"].includes(role(node)) && !name(node).trim())
      .map((node) => role(node));
    const headings = nodes.filter((node) => role(node) === "heading").map((node) => ({
      name: name(node),
      level: node.properties?.find((property) => property.name === "level")?.value?.value ?? null,
    }));
    const tables = nodes.filter((node) => role(node) === "table").map((node) => name(node));
    const skip = await evaluate('(() => { const el = document.querySelector(".skip"); return el ? { text: el.textContent.trim(), href: el.getAttribute("href") } : null; })()');
    const firstFocus = await evaluate('(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")].filter((el) => !el.hidden && el.offsetParent !== null && el.tabIndex >= 0).slice(0, 8).map((el) => ({ tag: el.tagName, id: el.id, text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 50) })))()');
    await evaluate('document.body.focus(); document.activeElement.blur()');
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await wait(150);
    const firstTab = await evaluate('({ tag: document.activeElement?.tagName, id: document.activeElement?.id, text: (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").trim().slice(0, 80), cls: document.activeElement?.className })');
    const landmarks = { main: roles.main ?? 0, log: roles.log ?? 0, tablist: roles.tablist ?? 0, tab: roles.tab ?? 0, img: roles.img ?? 0, table: roles.table ?? 0 };
    const result = {
      path,
      roles,
      unnamed,
      h1: headings.filter((heading) => heading.level === 1),
      headings: headings.length,
      tables,
      skip,
      firstFocus,
      firstTab,
      landmarks,
    };
    report.pages[path] = result;
    if (!landmarks.main) failures.push(`${path}: no main landmark`);
    if (!headings.some((heading) => heading.level === 1)) failures.push(`${path}: no level-1 heading`);
    if (unnamed.length) failures.push(`${path}: unnamed interactive roles ${unnamed.join(",")}`);
    if (!skip) failures.push(`${path}: no skip link`);
    if (!firstTab?.cls?.includes("skip")) failures.push(`${path}: first Tab is not the skip link (${JSON.stringify(firstTab)})`);
    if (path === "/" && !landmarks.log) failures.push("/: no log role");
    if (path === "/watch" && (!landmarks.log || !landmarks.tablist)) failures.push("/watch: missing log or tablist");
    if (path === "/stats" && (!landmarks.table || tables.some((table) => !table))) failures.push("/stats: a table has no accessible name");
  }

  await audit("/");
  await audit("/watch");
  await audit("/stats");

  const palette = await evaluate('(() => { const style = getComputedStyle(document.documentElement); return Object.fromEntries(["--bg","--surface","--text","--muted","--faint","--accent","--accent-ink","--link","--warn","--danger"].map((key) => [key, style.getPropertyValue(key).trim()])); })()');
  const pairs = [
    ["text", "--text", "--bg", 4.5],
    ["muted", "--muted", "--surface", 4.5],
    ["faint", "--faint", "--surface", 4.5],
    ["accent", "--accent", "--bg", 4.5],
    ["accent-ink", "--accent-ink", "--accent", 4.5],
    ["link", "--link", "--bg", 4.5],
    ["warn", "--warn", "--bg", 4.5],
    ["danger", "--danger", "--bg", 4.5],
  ];
  report.contrast = {};
  for (const [label, foreground, background, minimum] of pairs) {
    const ratio = contrast(palette[foreground], palette[background]);
    report.contrast[label] = ratio === null ? null : Math.round(ratio * 100) / 100;
    if (ratio === null || ratio < minimum) failures.push(`contrast ${label} is ${ratio}`);
  }

  await send("Page.navigate", { url: `http://127.0.0.1:${webPort}/watch` });
  await wait(900);
  await evaluate('document.querySelector("#tab-chat").focus()');
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await wait(150);
  const tabsAfter = await evaluate('({ selected: document.querySelector("#tab-stats").getAttribute("aria-selected"), statsHidden: document.querySelector("#stats-panel").hidden, focus: document.activeElement?.id, controls: [...document.querySelectorAll(".side-tab")].map((tab) => tab.getAttribute("aria-controls")) })');
  report.watchTabs = tabsAfter;
  if (tabsAfter.selected !== "true" || tabsAfter.statsHidden || tabsAfter.focus !== "tab-stats" || tabsAfter.controls.some((value) => !value)) {
    failures.push(`/watch: arrow-key tabs failed ${JSON.stringify(tabsAfter)}`);
  }

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(150);
  const reduced = await evaluate('({ feed: getComputedStyle(document.querySelector("#feed")).scrollBehavior, dot: getComputedStyle(document.querySelector(".dot")).animationDuration })');
  report.reducedMotion = reduced;
  if (reduced.feed !== "auto") failures.push(`/watch: reduced motion did not stop smooth feed scrolling (${reduced.feed})`);

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const mobile = {};
  for (const path of ["/", "/watch", "/stats"]) {
    await send("Page.navigate", { url: `http://127.0.0.1:${webPort}${path}` });
    await wait(900);
    const data = await evaluate(`(() => {
      const visible = (el) => !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
      let menu = null;
      if (location.pathname === "/") {
        const toggle = document.querySelector("#mobile-nav-toggle");
        if (toggle) {
          toggle.click();
          const nav = document.querySelector("#mobile-nav");
          menu = {
            toggleVisible: toggle.offsetParent !== null,
            expanded: toggle.getAttribute("aria-expanded"),
            hidden: nav.hidden,
            stats: nav.querySelector('a[href="/stats"]')?.textContent ?? "",
          };
          toggle.click();
        }
      }
      const controls = [...document.querySelectorAll("button,input,select,textarea")].filter(visible).map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, id: el.id, text: (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const links = [...document.querySelectorAll("header a, .hero-actions a, #mobile-nav a, .dir-cta")].filter(visible).map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim().slice(0, 40), href: el.getAttribute("href"), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const state = document.querySelector("#state") ? {
        text: document.querySelector("#state").textContent.trim(),
        width: Math.round(document.querySelector("#state").getBoundingClientRect().width),
        fontSize: getComputedStyle(document.querySelector("#state")).fontSize,
      } : null;
      const latest = document.querySelector("#latest") ? visible(document.querySelector("#latest")) : false;
      return {
        path: location.pathname,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        controls,
        links,
        state,
        latest,
        menu,
      };
    })()`);
    mobile[path] = data;
    if (data.overflow) failures.push(`${path}: mobile horizontal overflow (${data.scrollWidth} > ${data.clientWidth})`);
    const smallControls = data.controls.filter((control) => control.w < 24 || control.h < 24);
    if (smallControls.length) failures.push(`${path}: touch targets under 24px ${smallControls.map((control) => `${control.id || control.tag}:${control.w}x${control.h}`).join(",")}`);
    const smallLinks = data.links.filter((link) => link.h < 24);
    if (smallLinks.length) failures.push(`${path}: navigation links under 24px high ${smallLinks.map((link) => `${link.text}:${link.h}`).join(",")}`);
    if (path === "/") {
      if (!data.menu?.toggleVisible || data.menu.expanded !== "true" || data.menu.hidden || !data.menu.stats.includes("Stats")) failures.push(`/: mobile menu failed ${JSON.stringify(data.menu)}`);
      if (!data.state?.text || data.state.fontSize === "0px") failures.push(`/: connection state is not visible (${JSON.stringify(data.state)})`);
      if (data.latest) failures.push("/: Latest button is visible over the guest hero");
    }
  }
  report.mobile = mobile;

  // Signed-in game shell. The guest audits above never create a character, so
  // the HUD, First steps and the hidden character panel need their own pass.
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${webPort}/` });
  await wait(1200);
  await evaluate('document.querySelector("#hero-play").click()');
  await until(() => evaluate('document.querySelector("#new-character") && !document.querySelector("#characters").hidden'), "signed-in character form", 15000);
  await evaluate('document.querySelector("#new-character").value = "a11y-player"; document.querySelector("#create-character-form").requestSubmit()');
  await until(() => evaluate('!document.querySelector("#cmd").disabled && !document.querySelector("#signed").hidden'), "signed-in game", 15000);
  await wait(500);
  const signedIn = await evaluate(`(() => {
    const visible = (el) => el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const controls = [...document.querySelectorAll("#signed button, #hud button, #entry input, #entry button")].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id, text: (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      signed: visible(document.querySelector("#signed")),
      characters: visible(document.querySelector("#characters")),
      firstSteps: visible(document.querySelector("#first-steps")),
      persistence: visible(document.querySelector("#account-persistence")),
      hud: visible(document.querySelector("#hud")),
      cmdEnabled: !document.querySelector("#cmd")?.disabled,
      focus: document.activeElement?.id || document.activeElement?.tagName,
      controls,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  report.signedIn = signedIn;
  if (!signedIn.signed || signedIn.characters || !signedIn.firstSteps || !signedIn.persistence || !signedIn.hud || !signedIn.cmdEnabled || signedIn.focus !== "cmd") {
    failures.push(`signed-in shell failed ${JSON.stringify(signedIn)}`);
  }
  const smallSigned = signedIn.controls.filter((control) => control.w < 24 || control.h < 24);
  if (smallSigned.length) failures.push(`signed-in: touch targets under 24px ${smallSigned.map((control) => `${control.id || control.text}:${control.w}x${control.h}`).join(",")}`);

  await evaluate('document.querySelector("#first-steps").click()');
  await wait(700);
  const firstSteps = await evaluate('document.querySelector("#log").innerText.includes("First steps:")');
  if (!firstSteps) failures.push("signed-in: First steps did not open the tutorial");

  await evaluate('document.querySelector("#characters-button").click()');
  await until(() => evaluate('!document.querySelector("#characters").hidden'), "characters panel", 5000);
  await evaluate('document.querySelector("#characters-close").click()');
  await wait(200);
  const closed = await evaluate('document.querySelector("#characters").hidden');
  if (!closed) failures.push("signed-in: Back to game did not close the characters panel");

  const signedTree = await send("Accessibility.getFullAXTree");
  const signedNodes = (signedTree.nodes ?? []).filter((node) => !node.ignored);
  const signedUnnamed = signedNodes
    .filter((node) => ["button", "link", "textbox", "combobox", "tab", "checkbox"].includes(node.role?.value ?? "") && !(node.name?.value ?? "").trim())
    .map((node) => node.role?.value ?? "");
  if (signedUnnamed.length) failures.push(`signed-in: unnamed interactive roles ${signedUnnamed.join(",")}`);

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(400);
  const signedMobile = await evaluate(`(() => {
    const visible = (el) => el && !el.hidden && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
    const controls = [...document.querySelectorAll("#signed button, #hud button, #entry input, #entry button")].filter(visible).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id, text: (el.getAttribute("aria-label") || el.textContent || el.placeholder || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      signed: visible(document.querySelector("#signed")),
      characters: visible(document.querySelector("#characters")),
      firstSteps: visible(document.querySelector("#first-steps")),
      persistence: visible(document.querySelector("#account-persistence")),
      cmd: visible(document.querySelector("#cmd")),
      state: document.querySelector("#state")?.textContent.trim(),
      controls,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  report.signedInMobile = signedMobile;
  if (!signedMobile.signed || signedMobile.characters || !signedMobile.firstSteps || !signedMobile.persistence || !signedMobile.cmd || !signedMobile.state) {
    failures.push(`signed-in mobile shell failed ${JSON.stringify(signedMobile)}`);
  }
  if (signedMobile.overflow) failures.push("signed-in mobile: horizontal overflow");
  const smallSignedMobile = signedMobile.controls.filter((control) => control.w < 24 || control.h < 24);
  if (smallSignedMobile.length) failures.push(`signed-in mobile: touch targets under 24px ${smallSignedMobile.map((control) => `${control.id || control.text}:${control.w}x${control.h}`).join(",")}`);

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error("\nA11Y FAILURES:", failures.join(" | "));
    process.exitCode = 1;
  } else {
    console.log("\na11y audit: ok");
  }
} catch (error) {
  console.error("A11Y AUDIT ERROR:", error.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  await wait(500);
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
