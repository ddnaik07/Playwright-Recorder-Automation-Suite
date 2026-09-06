/**
 * Lightweight service-worker smoke test for the Chrome extension.
 *
 * It loads codegen.js and background.js in a Node "worker-like" context
 * (no `window`) and exercises the public message router with stubbed
 * chrome.* APIs. Run with: npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const EXTENSION_DIR = new URL("../extension/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, EXTENSION_DIR), "utf8");

function makeChrome() {
  const messageListeners = [];
  const localData = {
    settings: {
      selectorPriority: ["testid", "id", "role", "css", "xpath"],
      captureScreenshots: false,
      captureHovers: false,
      ignoreDomains: [],
      bridgeHost: "127.0.0.1",
      bridgePort: 8765,
      bridgeToken: "change-me-shared-secret",
      autoConnectBridge: false,
    },
  };
  const sessionData = {};

  const downloadsLog = [];

  return {
    messageListeners,
    localData,
    sessionData,
    downloadsLog,
    storage: {
      local: {
        async get(key) {
          return { settings: localData.settings };
        },
        async set(obj) {
          Object.assign(localData, obj);
        },
      },
      session: {
        async get(key) {
          return { session: sessionData.session };
        },
        async set(obj) {
          Object.assign(sessionData, obj);
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
      },
      onInstalled: {
        addListener: () => {},
      },
      sendMessage: async () => undefined,
      getManifest: () => ({ version: "1.0.0" }),
    },
    tabs: {
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
      async get(tabId) {
        return { id: tabId, title: "Test Tab", url: "https://example.com/login", favIconUrl: "" };
      },
      async query() {
        return [{ id: 1, title: "Test Tab", url: "https://example.com/login", favIconUrl: "" }];
      },
      async sendMessage() {},
      async captureVisibleTab() {
        return "data:image/jpeg;base64,AA==";
      },
    },
    scripting: {
      async executeScript() {},
    },
    downloads: {
      async download({ url, filename }) {
        downloadsLog.push({ url, filename });
      },
    },
  };
}

function createWorkerContext(chrome) {
  const ctx = {
    console,
    chrome,
    setTimeout,
    clearTimeout,
    WebSocket,
    btoa,
    atob,
    URL,
    TextEncoder,
    TextDecoder,
    navigator: { userAgent: "node-test" },
    crypto: {
      randomUUID: () => "uuid-" + Math.random().toString(16).slice(2),
    },
    importScripts: (...files) => {
      for (const file of files) {
        vm.runInContext(read(file), ctx, { filename: file });
      }
    },
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

async function callMessage(chrome, message, sender = {}) {
  const listener = chrome.messageListeners[0];
  assert.ok(listener, "background.js should register a runtime message listener");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sendResponse was not called")), 1000);
    const sendResponse = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    try {
      const keepPort = listener(message, sender, sendResponse);
      assert.equal(keepPort, true, "message handler should keep the async port open");
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function main() {
  // 1. Manifest is valid MV3 and points to files that exist.
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.background.service_worker, /^background\.js$/);
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.action.default_icon || {}),
  ]) {
    assert.ok(fs.existsSync(new URL(file, EXTENSION_DIR)), `missing extension file: ${file}`);
  }

  // 2. Background/codegen/selector/content parse and load without window in worker context.
  const chrome = makeChrome();
  const ctx = createWorkerContext(chrome);
  assert.doesNotThrow(() => {
    vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
  }, "background.js must load in a service-worker context (no window)");
  assert.ok(ctx.__PW_CODEGEN__, "codegen should be exposed on the service worker global");
  assert.ok(ctx.__PW_REC__ && ctx.__PW_REC__.codegen, "codegen should be exposed on __PW_REC__.codegen");

  // 3. Code generation works inside the service worker context.
  const script = ctx.__PW_CODEGEN__.generatePlaywrightScript(
    [
      { id: "1", timestamp: Date.now(), action: "navigate", selector: null, selectorType: null, url: "https://example.com" },
      { id: "2", timestamp: Date.now(), action: "fill", selector: "email", selectorType: "testid", cssEquivalent: '[data-testid="email"]', value: "a@b.test" },
      { id: "3", timestamp: Date.now(), action: "click", selector: "Submit", selectorType: "role", role: "button", value: null },
      { id: "4", timestamp: Date.now(), action: "upload-click", selector: "file", selectorType: "css" },
      { id: "5", timestamp: Date.now(), action: "upload", selector: "file", selectorType: "css", value: "a.txt" },
      { id: "6", timestamp: Date.now(), action: "dragdrop", selector: "src", selectorType: "css", meta: { targetSelector: "Drop here", targetSelectorType: "role", targetRole: "button", targetCssEquivalent: 'role=button[name="Drop here"]' } },
      { id: "7", timestamp: Date.now(), action: "scroll", selector: "#country-listbox", selectorType: "css", cssEquivalent: "#country-listbox", value: 320, meta: { top: 320, left: 0, deltaY: 320, deltaX: 0 } },
      { id: "8", timestamp: Date.now(), action: "click", selector: "Sri Lanka", selectorType: "role", role: "option", value: null, meta: { fallbackCss: "#country-listbox > li:nth-of-type(41)" } },
    ],
    { browser: "chromium" }
  );
  assert.match(script, /page\.goto\("https:\/\/example\.com"\)/);
  assert.match(script, /page\.get_by_test_id\("email"\)\.fill\("a@b\.test"\)/);
  assert.match(script, /page\.get_by_role\("button", name="Submit"\)\.click\(\)/);
  assert.match(script, /recorded file-picker click; file selection is captured by the upload step/);
  assert.match(script, /page\.locator\("file"\)\.set_input_files\("a\.txt"\)/);
  assert.match(script, /page\.locator\("src"\)\.drag_to\(page\.get_by_role\("button", name="Drop here"\)\)/);
  // scroll steps reproduce the container scroll that populates lazy options
  assert.match(script, /page\.locator\("#country-listbox"\)\.hover\(\)\n\s+page\.mouse\.wheel\(0, 320\)/);
  assert.match(script, /page\.get_by_role\("option", name="Sri Lanka"\)\.click\(\)/);
  assert.match(script, /# fallback: page\.locator\("#country-listbox > li:nth-of-type\(41\)"\)/);

  // 4. Basic message flow: tab discovery, state, recording lifecycle, export.
  const tabs = await callMessage(chrome, { type: "get-tabs" });
  assert.equal(tabs.activeTabId, 1);
  assert.equal(tabs.tabs.length, 1);

  const start = await callMessage(chrome, { type: "start-recording", tabId: 1 });
  assert.equal(start.ok, true);

  const state = await callMessage(chrome, { type: "get-state" });
  assert.equal(state.session.status, "recording");
  assert.equal(state.session.steps.length, 1, "start-recording should add an initial navigate step");
  assert.equal(state.session.tabId, 1);

  // Content script submits a recorded step.
  await callMessage(chrome, { type: "step-recorded", step: { action: "click", selector: "Sign in", selectorType: "role", role: "button", url: "https://example.com/login", timestamp: Date.now() } }, { tab: { id: 1 } });
  const stateAfterStep = await callMessage(chrome, { type: "get-state" });
  assert.equal(stateAfterStep.session.steps.length, 2, "recorded step should be appended");

  const stop = await callMessage(chrome, { type: "stop-recording" });
  assert.equal(stop.ok, true);
  const stopped = await callMessage(chrome, { type: "get-state" });
  assert.equal(stopped.session.status, "stopped");

  const jsonExport = await callMessage(chrome, { type: "export-session", format: "json" });
  assert.match(jsonExport.filename, /\.json$/);
  assert.match(jsonExport.dataUrl, /^data:application\/json;base64,/);

  const pyExport = await callMessage(chrome, { type: "export-session", format: "python" });
  assert.match(pyExport.filename, /\.py$/);
  assert.match(pyExport.dataUrl, /^data:text\/x-python;base64,/);

  // 4b. Slide panel support: downloads are proxied through the worker
  // (chrome.downloads is unavailable to content scripts).
  const dl = await callMessage(chrome, { type: "download-export", format: "python" });
  assert.equal(dl.ok, true);
  assert.equal(chrome.downloadsLog.length, 1);
  assert.match(chrome.downloadsLog[0].filename, /\.py$/);

  // 4c. The slide panel can start recording on the tab it lives in (no
  // explicit tabId -> fall back to the sender's tab).
  await callMessage(chrome, { type: "reset-session" });
  const panelStart = await callMessage(chrome, { type: "start-recording" }, { tab: { id: 9 } });
  assert.equal(panelStart.ok, true);
  const panelState = await callMessage(chrome, { type: "get-state" });
  assert.equal(panelState.session.tabId, 9, "panel-initiated recording should target the sender tab");

  const noTabStart = await callMessage(chrome, { type: "start-recording" });
  assert.equal(noTabStart.ok, false, "start-recording without any tab should fail cleanly");

  const showPanel = await callMessage(chrome, { type: "show-panel", tabId: 9 });
  assert.equal(showPanel.ok, true, "show-panel should inject and reveal the panel");

  await callMessage(chrome, { type: "stop-recording" });

  // 5. Settings round-trip follows the same shape.
  const initialSettings = (await callMessage(chrome, { type: "get-state" })).settings;
  assert.equal(initialSettings.captureScrolls, true, "scroll capture should default to on");
  const updated = await callMessage(chrome, {
    type: "update-settings",
    settings: { captureHovers: true, captureScrolls: false, bridgeHost: "localhost", bridgePort: 8888, bridgeToken: "tok" },
  });
  assert.equal(updated.settings.captureHovers, true);
  assert.equal(updated.settings.captureScrolls, false);
  assert.equal(updated.settings.bridgePort, 8888);

  // 6. Content + selector + panel + popup files parse fine (syntax guard).
  assert.doesNotThrow(() => new Function(read("selector-engine.js")), "selector-engine.js should parse");
  assert.doesNotThrow(() => new Function(read("content.js")), "content.js should parse");
  assert.doesNotThrow(() => new Function(read("recorder-panel.js")), "recorder-panel.js should parse");
  assert.doesNotThrow(() => new Function(read("popup.js")), "popup.js should parse");

  // 7. Popup references every element it uses.
  const popupHtml = read("popup.html");
  for (const id of ["btnRecord", "btnPause", "btnResume", "btnStop", "btnNewSession", "btnExportJson", "btnExportPy", "btnShowPanel", "cfgScreenshots", "cfgHovers", "cfgScrolls", "cfgIgnoreDomains", "cfgHost", "cfgPort", "cfgToken", "cfgAutoConnect", "btnSaveSettings", "btnConnectBridge", "btnDisconnectBridge", "stepsList", "tabList"]) {
    assert.match(popupHtml, new RegExp(`id="${id}"`), `popup.html should contain #${id}`);
  }

  console.log("✅ extension service-worker smoke tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
