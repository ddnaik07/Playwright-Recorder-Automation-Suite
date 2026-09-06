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
      captureScrolls: true,
      inputDebounceMs: 400,
    },
  };
  root.__PW_REC__.setPaused = (p) => {
    state.paused = p;
  };
  root.__PW_REC__.installed = true;

  let debounceTimer = null;
  let lastInputEl = null;

  // ---------------------------------------------------------------------------
  // Recorder-UI guards & target resolution
  // ---------------------------------------------------------------------------

  /**
   * True when the event originates from the recorder's own in-page slide
   * panel (recorder-panel.js). Panel interactions must never be recorded.
   * The panel lives in a closed shadow DOM attached to a host element that
   * both scripts can see, so a simple identity check is enough.
   */
  function isPanelEvent(e) {
    const host = root.__PW_REC__ && root.__PW_REC__.panelHost;
    if (!host) return false;
    if (e.target === host) return true;
    if (typeof e.composedPath === 'function') {
      try {
        const path = e.composedPath();
        return path && path.includes(host);
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  /**
   * Resolve the deepest element an event actually hit. For content inside
   * open shadow roots, e.target is retargeted to the host at document level,
   * but composedPath() still exposes the real inner element - which gives far
   * better selectors for clicks inside shadowed dropdowns.
   */
  function eventTarget(e) {
    if (typeof e.composedPath === 'function') {
      try {
        const path = e.composedPath();
        for (let i = 0; i < path.length; i += 1) {
          if (path[i] instanceof Element) return path[i];
        }
      } catch (err) {
        /* fall through to e.target */
      }
    }
    return e.target instanceof Element ? e.target : null;
  }

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

  function describeSelector(el, opts) {
    const { selector, selectorType, cssEquivalent, role, fallbackCss, meta } = engine.generateSelector(
      el,
      opts
    );
    const described = { selector, selectorType, cssEquivalent, role };
    if (fallbackCss) described.fallbackCss = fallbackCss;
    if (meta) described.clickedMeta = meta;
    return described;
  }

  /**
   * Extra context for clicks on custom-dropdown options: the list container
   * and, when discoverable, the combobox input that owns it. This lets the
   * executor / generated scripts reopen the dropdown if the option is not
   * visible yet.
   */
  function dropdownClickContext(el) {
    const owner = engine.listOwnerFor ? engine.listOwnerFor(el) : null;
    if (!owner) return null;
    const item = engine.nearestDropdownItem ? engine.nearestDropdownItem(el) : el;
    const context = {};
    const list = describeSelector(owner, { noItemResolve: true, withFallback: false });
    context.listSelector = list.selector;
    context.listSelectorType = list.selectorType;
    context.listCssEquivalent = list.cssEquivalent;
    const combo = engine.controllingCombobox ? engine.controllingCombobox(owner) : null;
    if (combo && combo !== el) {
      const c = describeSelector(combo, { noItemResolve: true, withFallback: false });
      context.comboboxSelector = c.selector;
      context.comboboxSelectorType = c.selectorType;
      context.comboboxCssEquivalent = c.cssEquivalent;
      context.comboboxRole = c.role;
    }
    context.itemTag = item ? item.tagName.toLowerCase() : undefined;
    return context;
  }

  function onClick(e) {
    if (state.paused) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
    // Ignore clicks that are actually about to trigger a file picker; those
    // are captured separately by the 'upload-trigger' handler below.
    if (el.tagName === 'INPUT' && el.type === 'file') {
      send({ action: 'upload-click', value: null, ...describeSelector(el) });
      return;
    }
    const listboxContext = dropdownClickContext(el);
    const described = describeSelector(el, { withFallback: true });
    const meta = {
      tag: el.tagName.toLowerCase(),
      text: engine.getVisibleText(el),
    };
    if (listboxContext) meta.listboxContext = listboxContext;
    if (described.fallbackCss) meta.fallbackCss = described.fallbackCss;
    if (described.clickedMeta) Object.assign(meta, described.clickedMeta);
    send({
      action: 'click',
      value: null,
      selector: described.selector,
      selectorType: described.selectorType,
      cssEquivalent: described.cssEquivalent,
      role: described.role,
      meta,
    });
  }


  function onInput(e) {
    if (state.paused) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
    lastInputEl = el;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      send({ action: 'fill', value: el.value, ...describeSelector(el, { noItemResolve: true }) });
    }, state.settings.inputDebounceMs);
  }

  function onChange(e) {
    if (state.paused) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      send({ action: 'select', value: el.value, ...describeSelector(el, { noItemResolve: true }) });
    } else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      send({
        action: el.checked ? 'check' : 'uncheck',
        value: el.checked,
        ...describeSelector(el, { noItemResolve: true }),
      });
    } else if (tag === 'input' && el.type === 'file') {
      const names = el.files ? Array.from(el.files).map((f) => f.name) : [];
      send({ action: 'upload', value: names.join(', '), ...describeSelector(el, { noItemResolve: true }) });
    } else if (tag === 'input' || tag === 'textarea') {
      // Fire an immediate fill on change to make sure the final value is
      // captured even if the debounce timer was cleared by a blur.
      clearTimeout(debounceTimer);
      send({ action: 'fill', value: el.value, ...describeSelector(el, { noItemResolve: true }) });
    }
  }

  function onKeydown(e) {
    if (state.paused) return;
    if (isPanelEvent(e)) return;
    if (e.key !== 'Enter' && e.key !== 'Tab') return;
    const el = eventTarget(e);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.type ? String(el.type).toLowerCase() : '');
    if (e.key === 'Enter') {
      // These controls already produce a click/check/select step; recording a
      // separate Enter press would create duplicate actions.
      if (tag === 'button' || tag === 'a' || tag === 'select') return;
      if (tag === 'input' && ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file'].includes(type)) return;
    }
    send({ action: 'press', value: e.key, ...describeSelector(el, { noItemResolve: true }) });
  }

  let hoverTimer = null;
  function onMouseOver(e) {
    if (state.paused || !state.settings.captureHovers) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      send({ action: 'hover', value: null, ...describeSelector(el) });
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // Scroll capture
  //
  // Many custom dropdowns only populate their options while the list is being
  // scrolled (lazy loading / windowed rendering). Recording the scroll itself
  // lets replay reproduce the same population before clicking an option.
  // ---------------------------------------------------------------------------

  const scrollTrackers = new WeakMap(); // container -> { timer, lastTop, lastLeft }

  function onScroll(e) {
    if (state.paused || !state.settings.captureScrolls) return;
    if (isPanelEvent(e)) return;
    let container = null;
    const t = e.target;
    if (t === document || t === document.documentElement || t === root) {
      container = document.scrollingElement || document.documentElement;
    } else if (t instanceof Element) {
      container = t;
    }
    if (!container) return;

    const top = container.scrollTop || 0;
    const left = container.scrollLeft || 0;
    let tracker = scrollTrackers.get(container);
    if (!tracker) {
      tracker = { timer: null, lastTop: 0, lastLeft: 0 };
      scrollTrackers.set(container, tracker);
    }
    clearTimeout(tracker.timer);
    const captured = tracker;
    captured.timer = setTimeout(() => {
      const deltaY = Math.round(top - captured.lastTop);
      const deltaX = Math.round(left - captured.lastLeft);
      captured.lastTop = top;
      captured.lastLeft = left;
      // Ignore sub-pixel/rest-position jitters.
      if (Math.abs(deltaY) < 4 && Math.abs(deltaX) < 4) return;
      send({
        action: 'scroll',
        value: Math.round(top),
        ...describeSelector(container, { noItemResolve: true }),
        meta: {
          top: Math.round(top),
          left: Math.round(left),
          deltaY,
          deltaX,
          containerTag: container.tagName ? container.tagName.toLowerCase() : null,
          scrollingDocument: container === document.documentElement || container === document.body,
        },
      });
    }, 300);
  }

  let dragSourceInfo = null;
  function onDragStart(e) {
    if (state.paused) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
    dragSourceInfo = describeSelector(el);
  }
  function onDrop(e) {
    if (state.paused || !dragSourceInfo) return;
    if (isPanelEvent(e)) return;
    const el = eventTarget(e);
    if (!el) return;
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
  document.addEventListener('scroll', onScroll, true);
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
