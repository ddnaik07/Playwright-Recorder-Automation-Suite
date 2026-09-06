/**
 * DOM-level tests for the recorder content scripts.
 *
 * Simulates, in jsdom, the exact "scrollable dropdown" scenario from the bug
 * report: a custom combobox whose listbox lazy-loads options while scrolling.
 * Verifies that content.js + selector-engine.js now record:
 *   1. the click on the combobox,
 *   2. the scroll *inside* the list container,
 *   3. a click on an option resolved to a resilient role=option selector
 *      (with CSS fallback + listbox context),
 * and that interactions with the draggable slide panel are never recorded.
 *
 * Requires the jsdom devDependency: npm install && npm test
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const EXTENSION_DIR = new URL("../extension/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, EXTENSION_DIR), "utf8");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeChromeStub(window) {
  const recordedSteps = [];
  const sentMessages = [];
  const messageListeners = [];
  const localStorageData = {};
  let stateResponse = { session: { status: "idle", steps: [] }, bridgeStatus: "disconnected" };

  const chromeStub = {
    recordedSteps,
    sentMessages,
    messageListeners,
    setState(next) {
      stateResponse = next;
    },
    runtime: {
      sendMessage(msg) {
        sentMessages.push(msg);
        if (msg.type === "step-recorded") recordedSteps.push(msg.step);
        if (msg.type === "get-state") return Promise.resolve(stateResponse);
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        },
      },
    },
    storage: {
      local: {
        get(key) {
          return Promise.resolve({ [key]: localStorageData[key] });
        },
        set(obj) {
          Object.assign(localStorageData, obj);
          return Promise.resolve();
        },
      },
    },
  };
  Object.defineProperty(window, "chrome", { value: chromeStub, configurable: true });
  return chromeStub;
}

function buildLazyDropdownPage(dom) {
  const doc = dom.window.document;
  doc.body.innerHTML = `
    <div class="combo">
      <input id="country-input" role="combobox" aria-expanded="false"
             aria-controls="country-listbox" aria-autocomplete="list"
             placeholder="Pick a country…" readonly />
      <ul id="country-listbox" role="listbox" aria-label="Country" class="listbox"></ul>
    </div>
    <button id="submit-order">Submit order</button>
  `;
  const listbox = doc.getElementById("country-listbox");
  const input = doc.getElementById("country-input");
  for (const name of ["India", "Indonesia", "Iran", "Iraq", "Ireland", "Italy", "Iceland", "Sri Lanka"]) {
    const li = doc.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.value = name.toLowerCase().replace(/\s+/g, "-");
    // Nested span: clicks land on the span, not the option node itself.
    const span = doc.createElement("span");
    span.textContent = name;
    li.appendChild(span);
    listbox.appendChild(li);
  }
  input.setAttribute("aria-expanded", "true");
  return { input, listbox };
}

function fireClick(window, el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
}

async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://demo-shop.example.com/checkout",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const chromeStub = makeChromeStub(window);

  // 1. Load the recorder scripts exactly as the extension injects them.
  const ctx = dom.getInternalVMContext();
  vm.runInContext(read("selector-engine.js"), ctx, { filename: "selector-engine.js" });
  vm.runInContext(read("content.js"), ctx, { filename: "content.js" });
  vm.runInContext(read("recorder-panel.js"), ctx, { filename: "recorder-panel.js" });

  assert.ok(window.__PW_REC__.selectorEngine, "selector engine should be installed");
  assert.ok(window.__PW_REC__.panelHost, "slide panel host should be created");
  await sleep(80); // let the panel boot (storage lookup + get-state)

  const { input, listbox } = buildLazyDropdownPage(dom);
  const engine = window.__PW_REC__.selectorEngine;

  // 2. Selector engine: options resolve to role+text, with a CSS fallback.
  const target = listbox.querySelector("li:nth-of-type(8) > span"); // "Sri Lanka"
  const sel = engine.generateSelector(target, { withFallback: true });
  assert.equal(sel.selectorType, "role");
  assert.equal(sel.role, "option");
  assert.equal(sel.selector, "Sri Lanka");
  assert.ok(sel.fallbackCss, "option selectors should carry a CSS fallback");
  assert.ok(sel.fallbackCss.includes("#country-listbox"), "fallback should anchor on the listbox");

  // Implicit roles for role-less dropdown items (plain <div> options).
  const div = window.document.createElement("div");
  div.textContent = "Kenya";
  listbox.appendChild(div);
  const implicit = engine.generateSelector(div);
  assert.equal(implicit.role, "option", "role-less direct children of a listbox are implicit options");
  assert.equal(implicit.selector, "Kenya");
  div.remove();

  // <li> list items outside ARIA lists get the listitem role (not nth-of-type CSS).
  const plainUl = window.document.createElement("ul");
  const plainLi = window.document.createElement("li");
  plainLi.textContent = "standalone item";
  plainUl.appendChild(plainLi);
  window.document.body.appendChild(plainUl);
  const liSel = engine.generateSelector(plainLi);
  assert.equal(liSel.selectorType, "role");
  assert.equal(liSel.role, "listitem");
  plainUl.remove();

  // 3. Recording flow: click the combobox to open the dropdown.
  const before = chromeStub.recordedSteps.length;
  fireClick(window, input);
  assert.equal(chromeStub.recordedSteps.length, before + 1, "combobox click should be recorded");
  const comboStep = chromeStub.recordedSteps[chromeStub.recordedSteps.length - 1];
  assert.equal(comboStep.action, "click");
  assert.equal(comboStep.selectorType, "id");
  assert.equal(comboStep.selector, "country-input");

  // 4. Recording flow: scroll inside the listbox (the lazy-population part).
  listbox.scrollTop = 320;
  listbox.dispatchEvent(new window.Event("scroll"));
  await sleep(450); // scroll debounce is 300ms
  const scrollSteps = chromeStub.recordedSteps.filter((s) => s.action === "scroll");
  assert.equal(scrollSteps.length, 1, "a scroll step should be recorded for the list container");
  assert.equal(scrollSteps[0].selectorType, "id");
  assert.equal(scrollSteps[0].selector, "country-listbox");
  assert.equal(scrollSteps[0].meta.deltaY, 320);
  assert.equal(scrollSteps[0].meta.top, 320);
  assert.equal(scrollSteps[0].value, 320);

  // Further scrolling records the *delta*, not the absolute offset again.
  listbox.scrollTop = 480;
  listbox.dispatchEvent(new window.Event("scroll"));
  await sleep(450);
  const scrollSteps2 = chromeStub.recordedSteps.filter((s) => s.action === "scroll");
  assert.equal(scrollSteps2.length, 2);
  assert.equal(scrollSteps2[1].meta.deltaY, 160);

  // 5. Recording flow: click the option that only loaded after scrolling.
  fireClick(window, target);
  const clicks = chromeStub.recordedSteps.filter((s) => s.action === "click");
  const optionClick = clicks[clicks.length - 1];
  assert.equal(optionClick.selectorType, "role", "option click should use a role selector");
  assert.equal(optionClick.role, "option");
  assert.equal(optionClick.selector, "Sri Lanka");
  assert.ok(optionClick.meta.fallbackCss, "option click should carry meta.fallbackCss");
  const listCtx = optionClick.meta.listboxContext;
  assert.ok(listCtx, "option click should carry listboxContext");
  assert.equal(listCtx.listSelector, "country-listbox");
  assert.equal(listCtx.comboboxSelector, "country-input", "the owning combobox should be linked via aria-controls");

  // 6. Panel interactions are never recorded.
  const panelHost = window.__PW_REC__.panelHost;
  const stepsBefore = chromeStub.recordedSteps.length;
  fireClick(window, panelHost); // events inside the closed shadow root retarget to the host
  listbox.scrollTop = 600; // ignored: scrollTop reset below would double-record otherwise
  panelHost.dispatchEvent(new window.Event("scroll"));
  listbox.scrollTop = 480;
  await sleep(450);
  assert.equal(chromeStub.recordedSteps.length, stepsBefore, "panel events must not be recorded");

  // 7. The slide panel renders, follows state, and drags.
  const panel = window.__PW_REC__.panel;
  chromeStub.messageListeners.forEach((fn) =>
    fn({
      type: "state-update",
      session: {
        status: "recording",
        steps: [
          { id: "s1", action: "navigate", url: "https://demo-shop.example.com/checkout" },
          { id: "s2", action: "scroll", selector: "#country-listbox", meta: { deltaY: 320 } },
        ],
      },
      bridgeStatus: "disconnected",
    })
  );
  await sleep(80);
  const els = panel._els;
  assert.equal(els.badge.textContent, "recording");
  assert.equal(els.count.textContent, "2");
  assert.ok(els.steps.querySelectorAll(".step-item").length >= 1, "steps should render in the panel");
  assert.equal(els.container.classList.contains("open"), true, "panel should slide open while recording");
  assert.equal(els.recDot.classList.contains("live"), true);

  // Drag by the header moves the panel.
  const before0 = els.container.style.left;
  const header = els.header;
  header.dispatchEvent(
    new window.MouseEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 200 })
  );
  header.dispatchEvent(
    new window.MouseEvent("pointermove", { bubbles: true, clientX: 520, clientY: 330 })
  );
  header.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
  assert.notEqual(els.container.style.left, before0, "dragging the header should move the panel");
  assert.ok(els.container.style.top.endsWith("px"));

  // Collapse to the pill and back.
  panel.collapse();
  assert.equal(els.pill.style.display, "flex", "collapse should show the pill");
  panel.expand();
  assert.equal(els.pill.style.display, "none", "expand should hide the pill");

  // Panel buttons talk to the worker with the right messages.
  els.btnStop.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  const lastMsg = chromeStub.sentMessages[chromeStub.sentMessages.length - 1];
  assert.equal(lastMsg.type, "stop-recording");

  // 8. Closing the panel keeps it closed across further state updates…
  panel.close();
  assert.equal(els.container.classList.contains("open"), false, "close() should hide the panel");
  chromeStub.messageListeners.forEach((fn) =>
    fn({ type: "state-update", session: { status: "recording", steps: [] }, bridgeStatus: "disconnected" })
  );
  await sleep(50);
  assert.equal(els.container.classList.contains("open"), false, "a closed panel must not force itself open on new steps");

  // …until the user asks for it again (popup button) or a new session starts.
  chromeStub.messageListeners.forEach((fn) => fn({ type: "panel-open" }));
  await sleep(50);
  assert.equal(els.container.classList.contains("open"), true, "panel-open should reveal the panel again");

  console.log("✅ extension DOM tests passed (lazy dropdown + slide panel)");
  window.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
