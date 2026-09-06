/**
 * content.js
 * Injected programmatically into the tab being recorded. Captures user
 * interactions, builds step objects, and relays them to the background
 * service worker. Designed to be idempotent (safe to inject more than once
 * after in-tab navigations).
 */
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    // Secure-context safety fallback (crypto.randomUUID is only available in
    // secure contexts on some browsers/HTTP sites).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  if (root.__PW_REC__ && root.__PW_REC__.installed) {
    // Already installed on this document (e.g. duplicate injection) - just
    // make sure state is resumed and exit.
    root.__PW_REC__.setPaused(false);
    return;
  }

  if (!root.__PW_REC__ || !root.__PW_REC__.selectorEngine) {
    console.warn('[recorder] selector-engine.js was not loaded; content script aborted');
    return;
  }

  const engine = root.__PW_REC__.selectorEngine;
  const state = {
    installed: true,
    paused: false,
    settings: {
      captureScreenshots: false,
      captureHovers: false,
      inputDebounceMs: 400,
    },
  };
  root.__PW_REC__.setPaused = (p) => {
    state.paused = p;
  };
  root.__PW_REC__.installed = true;

  let debounceTimer = null;
  let lastInputEl = null;

  function send(step) {
    if (state.paused) return;
    try {
      const result = chrome.runtime.sendMessage({
        type: 'step-recorded',
        step: {
          id: uuid(),
          timestamp: Date.now(),
          url: location.href,
          frameId: root === root.top ? 0 : -1,
          ...step,
        },
      });
      if (result && typeof result.catch === 'function') {
        result.catch((e) => console.warn('[recorder] failed to send step', e));
      }
    } catch (e) {
      // The content-script context can be invalidated after a navigation.
      console.warn('[recorder] failed to send step', e);
    }
  }

  function describeSelector(el) {
    const { selector, selectorType, cssEquivalent, role } = engine.generateSelector(el);
    return { selector, selectorType, cssEquivalent, role };
  }

  function onClick(e) {
    if (state.paused) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    // Ignore clicks that are actually about to trigger a file picker; those
    // are captured separately by the 'upload-trigger' handler below.
    if (el.tagName === 'INPUT' && el.type === 'file') {
      send({ action: 'upload-click', value: null, ...describeSelector(el) });
      return;
    }
    send({
      action: 'click',
      value: null,
      ...describeSelector(el),
      meta: { tag: el.tagName.toLowerCase(), text: engine.getVisibleText(el) },
    });
  }

  function onInput(e) {
    if (state.paused) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
    lastInputEl = el;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      send({ action: 'fill', value: el.value, ...describeSelector(el) });
    }, state.settings.inputDebounceMs);
  }

  function onChange(e) {
    if (state.paused) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      send({ action: 'select', value: el.value, ...describeSelector(el) });
    } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      send({
        action: el.checked ? 'check' : 'uncheck',
        value: el.checked,
        ...describeSelector(el),
      });
    } else if (tag === 'input' && el.type === 'file') {
      const names = el.files ? Array.from(el.files).map((f) => f.name) : [];
      send({ action: 'upload', value: names.join(', '), ...describeSelector(el) });
    } else if (tag === 'input' || tag === 'textarea') {
      // Fire an immediate fill on change to make sure the final value is
      // captured even if the debounce timer was cleared by a blur.
      clearTimeout(debounceTimer);
      send({ action: 'fill', value: el.value, ...describeSelector(el) });
    }
  }

  function onKeydown(e) {
    if (state.paused) return;
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.type ? String(el.type).toLowerCase() : '');
    if (e.key === 'Enter') {
      // These controls already produce a click/check/select step; recording a
      // separate Enter press would create duplicate actions.
      if (tag === 'button' || tag === 'a' || tag === 'select') return;
      if (tag === 'input' && ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file'].includes(type)) return;
    }
    send({ action: 'press', value: e.key, ...describeSelector(el) });
  }

  let hoverTimer = null;
  function onMouseOver(e) {
    if (state.paused || !state.settings.captureHovers) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      send({ action: 'hover', value: null, ...describeSelector(el) });
    }, 600);
  }

  let dragSourceInfo = null;
  function onDragStart(e) {
    if (state.paused) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    dragSourceInfo = describeSelector(el);
  }
  function onDrop(e) {
    if (state.paused || !dragSourceInfo) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const target = describeSelector(el);
    send({
      action: 'dragdrop',
      value: null,
      selector: dragSourceInfo.selector,
      selectorType: dragSourceInfo.selectorType,
      cssEquivalent: dragSourceInfo.cssEquivalent,
      meta: {
        targetSelector: target.selector,
        targetSelectorType: target.selectorType,
        targetCssEquivalent: target.cssEquivalent,
        targetRole: target.role,
      },
    });
    dragSourceInfo = null;
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('drop', onDrop, true);

  // Let the background worker update capture settings / pause state live.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'recorder-set-paused') {
      state.paused = !!msg.paused;
      sendResponse({ ok: true });
    } else if (msg.type === 'recorder-update-settings') {
      Object.assign(state.settings, msg.settings || {});
      sendResponse({ ok: true });
    } else if (msg.type === 'recorder-ping') {
      sendResponse({ ok: true, installed: true });
    }
    return true;
  });

  // Notify background that a fresh document/frame is ready (covers in-tab
  // navigations where the script gets re-injected).
  chrome.runtime.sendMessage({ type: 'recorder-ready', url: location.href });
})();
