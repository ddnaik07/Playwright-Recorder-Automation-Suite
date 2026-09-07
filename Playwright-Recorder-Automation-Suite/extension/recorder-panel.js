/**
 * recorder-panel.js
 *
 * In-page "slide panel" UI for the recorder, injected into the recorded tab
 * next to content.js. Unlike the browser-action popup it stays visible while
 * you interact with the page, which is essential for flows like scrollable
 * dropdowns where you need to see steps appear as you scroll and click.
 *
 * Features:
 *   - Slides in from the right when recording starts (or when opened from the
 *     popup's "Open slide panel" button).
 *   - Fully draggable: grab the header (or the collapsed pill) and move it
 *     anywhere; the position is remembered across navigations.
 *   - Collapsible to a small floating pill so it stays out of the way.
 *   - Live step list with per-step delete, record/pause/resume/stop controls,
 *     and JSON / Playwright-Python export once the session is stopped.
 *
 * The panel renders inside a closed shadow DOM (styles isolated from - and
 * safe against - the host page) and exposes its host element on
 * __PW_REC__.panelHost so content.js can ignore panel-originated events.
 */
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;

  if (!root.__PW_REC__ || !root.__PW_REC__.installed) {
    // content.js runs first; without it the panel has nothing to show.
    console.warn('[recorder] recorder-panel.js loaded without content.js; skipped');
    return;
  }

  if (root.__PW_REC__.panelHost && root.__PW_REC__.panelHost.isConnected) {
    // Already installed (duplicate injection after an in-tab navigation):
    // just make sure it is visible again.
    try {
      root.__PW_REC__.panel.open({ collapsed: false });
    } catch (e) {
      /* ignore */
    }
    return;
  }

  const HOST_ID = '__pw-recorder-panel__';
  const POS_KEY = 'pwPanelPos';
  const PANEL_WIDTH = 320;
  const EDGE_MARGIN = 10;

  // ---------------------------------------------------------------------------
  // Chrome API guards (tests / non-extension contexts)
  // ---------------------------------------------------------------------------
  function runtimeSendMessage(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      return p && typeof p.catch === 'function' ? p : Promise.resolve(p);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function storageGet(key) {
    try {
      return Promise.resolve(chrome.storage.local.get(key));
    } catch (e) {
      return Promise.resolve({});
    }
  }

  function storageSet(obj) {
    try {
      return Promise.resolve(chrome.storage.local.set(obj));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // ---------------------------------------------------------------------------
  // DOM scaffolding
  // ---------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = HOST_ID;
  // Inline styles (highest practical specificity) so page CSS cannot move or
  // resize the host. Everything inside lives in the shadow root.
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('z-index', '2147483646', 'important');
  host.style.setProperty('pointer-events', 'none', 'important'); // re-enabled per state
  host.style.setProperty('width', '0', 'important');
  host.style.setProperty('height', '0', 'important');
  host.style.setProperty('overflow', 'visible', 'important');

  const shadow = host.attachShadow({ mode: 'closed' });

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .container {
      position: fixed; width: ${PANEL_WIDTH}px; max-height: 70vh;
      display: flex; flex-direction: column;
      background: #ffffff; color: #1a1c23;
      border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, .22);
      overflow: hidden;
      transform: translateX(calc(100% + 48px)); opacity: 0;
      transition: transform .28s cubic-bezier(.2,.8,.3,1), opacity .22s ease;
    }
    .container.open { transform: translateX(0); opacity: 1; }
    .container.dragging { transition: none; }
    .header {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 10px; cursor: grab; user-select: none; touch-action: none;
      background: linear-gradient(135deg,#4f46e5,#7c3aed); color: #fff;
    }
    .header:active { cursor: grabbing; }
    .header .grip { display: flex; flex-direction: column; gap: 2px; opacity: .8; }
    .header .grip span { width: 12px; height: 2px; border-radius: 2px; background: #fff; }
    .brand { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 12px; flex: 1; min-width: 0; white-space: nowrap; }
    .brand .rec-dot { width: 9px; height: 9px; border-radius: 50%; background: #f87171; flex-shrink: 0; }
    .brand .rec-dot.live { background: #ef4444; animation: pulse 1.4s infinite; }
    .icon-btn {
      border: none; background: rgba(255,255,255,.16); color: #fff; cursor: pointer;
      width: 22px; height: 22px; border-radius: 6px; font-size: 12px; line-height: 1;
      display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .icon-btn:hover { background: rgba(255,255,255,.3); }
    .badge {
      font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
      padding: 3px 8px; border-radius: 999px; font-weight: 700; background: #e5e7eb; color: #374151;
    }
    .badge.recording { background: #fee2e2; color: #b91c1c; }
    .badge.paused { background: #fef3c7; color: #92400e; }
    .badge.stopped { background: #dcfce7; color: #166534; }
    .badge.idle { background: #e5e7eb; color: #374151; }
    @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:.4;} }

    .body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .controls { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .btn {
      border: 1px solid #d1d5db; background: #fff; padding: 6px 10px; border-radius: 8px;
      font-size: 12px; cursor: pointer; font-weight: 600; color: #111827;
    }
    .btn:disabled { opacity: .45; cursor: not-allowed; }
    .btn-primary { background: #4f46e5; border-color: #4f46e5; color: #fff; }
    .btn-danger { background: #ef4444; border-color: #ef4444; color: #fff; }
    .btn-secondary { background: #eef2ff; border-color: #c7d2fe; color: #4338ca; }
    .btn-link { background: transparent; border: none; color: #4f46e5; text-decoration: underline; padding: 4px; cursor: pointer; font-size: 11px; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; }
    .card-title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .card-title { font-size: 11px; font-weight: 700; color: #111827; }
    .muted { color: #6b7280; }
    .count { font-size: 10px; color: #6b7280; }
    .steps { max-height: 190px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .empty-hint { color: #9ca3af; font-size: 11px; padding: 10px 0; text-align: center; }
    .step-item {
      display: flex; align-items: center; gap: 6px; padding: 5px 6px; background: #f9fafb;
      border-radius: 8px; font-size: 10.5px; border: 1px solid #f0f1f4;
    }
    .step-index { color: #9ca3af; width: 15px; flex-shrink: 0; }
    .step-action {
      font-weight: 700; text-transform: uppercase; font-size: 8.5px; padding: 2px 6px;
      border-radius: 6px; background: #eef2ff; color: #4338ca; flex-shrink: 0;
    }
    .step-action.scroll { background: #fef9c3; color: #854d0e; }
    .step-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .step-del { border: none; background: transparent; color: #ef4444; cursor: pointer; font-weight: 700; padding: 0 2px; }
    .export-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .hint { font-size: 10px; color: #9ca3af; text-align: center; }

    .pill {
      position: fixed; display: none; align-items: center; gap: 7px;
      padding: 8px 13px; border-radius: 999px; cursor: grab; user-select: none; touch-action: none;
      background: linear-gradient(135deg,#4f46e5,#7c3aed); color: #fff;
      font-size: 12px; font-weight: 600;
      box-shadow: 0 8px 20px rgba(79, 70, 229, .45);
      transform: scale(.6); opacity: 0; transition: transform .2s ease, opacity .2s ease;
    }
    .pill.open { transform: scale(1); opacity: 1; }
    .pill .p-dot { width: 8px; height: 8px; border-radius: 50%; background: #fca5a5; }
    .pill .p-dot.live { background: #ef4444; animation: pulse 1.4s infinite; }
  `;

  let styleEl = null;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    shadow.adoptedStyleSheets = [sheet];
  } catch (e) {
    styleEl = document.createElement('style');
    styleEl.textContent = CSS_TEXT;
    shadow.appendChild(styleEl);
  }

  shadow.innerHTML = `
    <div class="container" part="container">
      <div class="header" data-handle="1">
        <div class="grip"><span></span><span></span><span></span></div>
        <div class="brand"><span class="rec-dot"></span><span>Playwright Recorder</span></div>
        <span class="badge idle">idle</span>
        <button class="icon-btn" data-action="collapse" title="Collapse to pill">–</button>
        <button class="icon-btn" data-action="close" title="Hide panel">✕</button>
      </div>
      <div class="body">
        <div class="controls">
          <button class="btn btn-primary" data-action="record">● Record</button>
          <button class="btn" data-action="pause">‖ Pause</button>
          <button class="btn" data-action="resume" hidden>▶ Resume</button>
          <button class="btn btn-danger" data-action="stop">■ Stop</button>
        </div>
        <div class="card">
          <div class="card-title-row">
            <span class="card-title">Recorded steps</span>
            <span class="count">0</span>
          </div>
          <div class="steps">
            <div class="empty-hint">No steps yet. Hit Record and interact with this page.</div>
          </div>
        </div>
        <div class="card export-card" hidden>
          <div class="card-title-row"><span class="card-title">Export session</span></div>
          <div class="export-row">
            <button class="btn btn-secondary" data-action="export-json">⬇ JSON</button>
            <button class="btn btn-secondary" data-action="export-py">⬇ Playwright .py</button>
          </div>
          <button class="btn-link" data-action="reset">Start a new recording</button>
        </div>
        <div class="hint">Drag the header to move · – to collapse</div>
      </div>
    </div>
    <div class="pill" data-handle="1" title="Playwright Recorder — click to expand">
      <span class="p-dot"></span><span class="p-label">Recorder</span>
    </div>
  `;

  const els = {
    container: shadow.querySelector('.container'),
    pill: shadow.querySelector('.pill'),
    header: shadow.querySelector('.header'),
    badge: shadow.querySelector('.badge'),
    recDot: shadow.querySelector('.rec-dot'),
    steps: shadow.querySelector('.steps'),
    count: shadow.querySelector('.count'),
    exportCard: shadow.querySelector('.export-card'),
    btnRecord: shadow.querySelector('[data-action="record"]'),
    btnPause: shadow.querySelector('[data-action="pause"]'),
    btnResume: shadow.querySelector('[data-action="resume"]'),
    btnStop: shadow.querySelector('[data-action="stop"]'),
    pillDot: shadow.querySelector('.p-dot'),
    pillLabel: shadow.querySelector('.p-label'),
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentState = null;
  let collapsed = false;
  let opened = false;
  // Set when the user explicitly closes the panel; stops state updates from
  // forcing it back open. Cleared by the popup's "Open slide panel" button
  // and whenever the session returns to idle (new session).
  let userDismissed = false;
  // Animations are applied via requestAnimationFrame; bumping this token
  // invalidates frames queued by a superseded open/close/collapse.
  let animToken = 0;

  function clamp(left, top, width, height) {
    const w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    const l = Math.min(Math.max(left, EDGE_MARGIN), Math.max(EDGE_MARGIN, w - width - EDGE_MARGIN));
    const t = Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, h - height - EDGE_MARGIN));
    return { left: l, top: t };
  }

  function applyPosition(left, top) {
    const width = collapsed ? 150 : PANEL_WIDTH;
    const height = collapsed ? 40 : Math.min(70 * Math.max(document.documentElement.clientHeight, 1) / 100, 480);
    const pos = clamp(left, top, width, height);
    els.container.style.left = `${Math.round(pos.left)}px`;
    els.container.style.top = `${Math.round(pos.top)}px`;
    els.pill.style.left = `${Math.round(pos.left)}px`;
    els.pill.style.top = `${Math.round(pos.top)}px`;
    return pos;
  }

  function defaultPosition() {
    const w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    return { left: w - PANEL_WIDTH - 16, top: 64 };
  }

  async function rememberPosition(left, top) {
    try {
      await storageSet({ [POS_KEY]: { left: Math.round(left), top: Math.round(top), collapsed } });
    } catch (e) {
      /* storage unavailable - position just won't persist */
    }
  }

  window.addEventListener('resize', () => {
    const rect = (collapsed ? els.pill : els.container).getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  });

  // ---------------------------------------------------------------------------
  // Dragging (shared by header and collapsed pill)
  // ---------------------------------------------------------------------------
  function makeDraggable(handle, surface) {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let moved = false;
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = surface.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      surface.classList.add('dragging');
      try {
        if (typeof handle.setPointerCapture === 'function' && e.pointerId !== undefined) {
          handle.setPointerCapture(e.pointerId);
        }
      } catch (err) {
        /* pointer capture unsupported (older browsers / test DOMs) */
      }
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      applyPosition(originLeft + dx, originTop + dy);
    });

    function finish(e) {
      if (!dragging) return;
      dragging = false;
      surface.classList.remove('dragging');
      if (moved) {
        const rect = surface.getBoundingClientRect();
        const pos = applyPosition(rect.left, rect.top);
        rememberPosition(pos.left, pos.top);
        e && e.stopPropagation && e.stopPropagation();
      } else if (surface === els.pill) {
        // A plain click on the pill expands the panel.
        api.expand();
      }
    }

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    // Lost capture (e.g. element removed mid-drag) should end the gesture.
    handle.addEventListener('lostpointercapture', () => dragging && finish(null));
  }

  makeDraggable(els.header, els.container);
  makeDraggable(els.pill, els.pill);

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
  }

  function stepDetail(step) {
    if (step.action === 'navigate') return step.url || '';
    if (step.action === 'scroll') {
      const meta = step.meta || {};
      return `${step.selector || ''} ↓${meta.deltaY != null ? meta.deltaY : step.value}`;
    }
    const detail = step.selector || '';
    return step.value != null && step.value !== '' ? `${detail} → ${step.value}` : String(detail);
  }

  function renderSteps(steps) {
    els.count.textContent = String(steps.length);
    if (!steps.length) {
      els.steps.innerHTML = '<div class="empty-hint">No steps yet. Hit Record and interact with this page.</div>';
      return;
    }
    els.steps.innerHTML = '';
    steps.forEach((step, idx) => {
      const row = document.createElement('div');
      row.className = 'step-item';
      row.innerHTML = `
        <span class="step-index">${idx + 1}</span>
        <span class="step-action${step.action === 'scroll' ? ' scroll' : ''}">${escapeHtml(step.action)}</span>
        <span class="step-detail" title="${escapeHtml(stepDetail(step))}">${escapeHtml(stepDetail(step))}</span>
        <button class="step-del" data-id="${escapeHtml(step.id)}">✕</button>`;
      els.steps.appendChild(row);
    });
    els.steps.scrollTop = els.steps.scrollHeight;
  }

  function renderState(state) {
    currentState = state;
    const session = (state && state.session) || { status: 'idle', steps: [] };
    const status = session.status || 'idle';

    els.badge.textContent = status;
    els.badge.className = `badge ${status}`;
    els.recDot.classList.toggle('live', status === 'recording');
    els.pillDot.classList.toggle('live', status === 'recording');
    els.pillLabel.textContent = status === 'idle' ? 'Recorder' : `Recorder · ${(session.steps || []).length}`;

    els.btnRecord.disabled = status === 'recording' || status === 'paused';
    els.btnPause.disabled = status !== 'recording';
    els.btnPause.hidden = status === 'paused';
    els.btnResume.hidden = status !== 'paused';
    els.btnResume.disabled = status !== 'paused';
    els.btnStop.disabled = status === 'idle' || status === 'stopped';
    els.exportCard.hidden = status !== 'stopped';

    renderSteps(session.steps || []);
  }

  // ---------------------------------------------------------------------------
  // Actions (mirror the popup's message vocabulary)
  // ---------------------------------------------------------------------------
  shadow.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    switch (action) {
      case 'record':
        runtimeSendMessage({ type: 'start-recording' }).catch(() => {});
        break;
      case 'pause':
        runtimeSendMessage({ type: 'pause-recording' }).catch(() => {});
        break;
      case 'resume':
        runtimeSendMessage({ type: 'resume-recording' }).catch(() => {});
        break;
      case 'stop':
        runtimeSendMessage({ type: 'stop-recording' }).catch(() => {});
        break;
      case 'reset':
        runtimeSendMessage({ type: 'reset-session' }).catch(() => {});
        break;
      case 'export-json':
        runtimeSendMessage({ type: 'download-export', format: 'json' }).catch(() => {});
        break;
      case 'export-py':
        runtimeSendMessage({ type: 'download-export', format: 'python' }).catch(() => {});
        break;
      case 'collapse':
        api.collapse();
        break;
      case 'close':
        api.close();
        break;
      default:
        break;
    }
  });

  els.steps.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('.step-del') : null;
    if (!btn) return;
    runtimeSendMessage({ type: 'delete-step', stepId: btn.getAttribute('data-id') }).catch(() => {});
  });

  // ---------------------------------------------------------------------------
  // Public panel API
  // ---------------------------------------------------------------------------
  function showPillNow(token) {
    els.pill.style.display = 'flex';
    requestAnimationFrame(() => {
      if (token === animToken) els.pill.classList.add('open');
    });
  }

  function slideContainerIn() {
    els.container.style.display = 'flex';
    const token = animToken;
    // Double rAF so the slide-in transition runs even on first paint.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token === animToken) els.container.classList.add('open');
      })
    );
  }

  function hidePanel() {
    opened = false;
    collapsed = false;
    animToken += 1; // cancel any queued open/slide-in frames
    els.container.classList.remove('open');
    els.pill.classList.remove('open');
    host.style.setProperty('pointer-events', 'none', 'important');
    setTimeout(() => {
      if (!opened) {
        els.container.style.display = 'none';
        els.pill.style.display = 'none';
      }
    }, 280);
  }

  const api = {
    open(opts) {
      const options = opts || {};
      host.style.setProperty('pointer-events', 'auto', 'important');
      animToken += 1;
      if (options.collapsed === true) {
        collapsed = true;
      }
      if (collapsed) {
        els.container.classList.remove('open');
        showPillNow(animToken);
      } else {
        els.pill.classList.remove('open');
        els.pill.style.display = 'none';
        slideContainerIn();
      }
      opened = true;
    },
    collapse() {
      const rect = els.container.getBoundingClientRect();
      collapsed = true;
      animToken += 1;
      applyPosition(rect.left, rect.top);
      els.container.classList.remove('open');
      showPillNow(animToken);
      setTimeout(() => {
        if (collapsed) els.container.style.display = 'none';
      }, 280);
      rememberPosition(rect.left, rect.top);
    },
    expand() {
      const rect = els.pill.getBoundingClientRect();
      collapsed = false;
      animToken += 1;
      applyPosition(rect.left, rect.top);
      els.pill.classList.remove('open');
      els.pill.style.display = 'none';
      slideContainerIn();
      rememberPosition(rect.left, rect.top);
    },
    close() {
      // User-initiated hide: stay hidden until they ask for the panel again
      // (popup button / "Open slide panel") or a new session starts.
      userDismissed = true;
      hidePanel();
    },
    renderState,
    _els: els,
    _host: host,
  };

  root.__PW_REC__.panelHost = host;
  root.__PW_REC__.panel = api;

  // ---------------------------------------------------------------------------
  // Live updates from the background worker
  // ---------------------------------------------------------------------------
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'state-update') {
        renderState({ session: msg.session, bridgeStatus: msg.bridgeStatus });
        const status = (msg.session && msg.session.status) || 'idle';
        if (status === 'idle') userDismissed = false; // fresh session upcoming
        // The panel follows the session: auto-open (or switch to the pill on
        // stop) but never force itself open after the user closed it.
        if (opened) {
          if (collapsed && status === 'recording') api.expand();
        } else if (!userDismissed) {
          if (status === 'recording' || status === 'paused') {
            api.open({ collapsed: false });
          } else if (status === 'stopped' && host.isConnected) {
            api.open({ collapsed: true });
          }
        }
      } else if (msg.type === 'panel-open') {
        userDismissed = false;
        api.open({ collapsed: false });
      }
    });
  } catch (e) {
    /* runtime unavailable (tests) */
  }

  // ---------------------------------------------------------------------------
  // Boot: mount, restore position, decide initial visibility
  // ---------------------------------------------------------------------------
  function mount() {
    if (!host.isConnected) {
      (document.body || document.documentElement).appendChild(host);
    }
  }

  async function boot() {
    mount();
    let saved = null;
    try {
      const stored = await storageGet(POS_KEY);
      saved = stored && stored[POS_KEY];
    } catch (e) {
      saved = null;
    }
    const base = defaultPosition();
    const left = saved && Number.isFinite(saved.left) ? saved.left : base.left;
    const top = saved && Number.isFinite(saved.top) ? saved.top : base.top;
    collapsed = !!(saved && saved.collapsed);
    applyPosition(left, top);

    let state = null;
    try {
      state = await runtimeSendMessage({ type: 'get-state' });
    } catch (e) {
      state = null;
    }
    renderState(state || { session: { status: 'idle', steps: [] } });

    const status = state && state.session ? state.session.status : 'idle';
    // Only the recorded tab gets the panel injected, so recording/paused
    // always means "this tab". For a finished session show just the pill.
    if (status === 'recording' || status === 'paused') {
      api.open({ collapsed: false });
    } else if (status === 'stopped') {
      api.open({ collapsed: true });
    } else {
      hidePanel();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
})();
