/**
 * background.js (classic, non-module service worker)
 * Central orchestrator: tab picking, recording lifecycle, content-script
 * injection/re-injection across navigations, screenshot capture, the local
 * WebSocket bridge to the desktop app, and export generation.
 */
importScripts('codegen.js');

const DEFAULT_SETTINGS = {
  selectorPriority: ['testid', 'id', 'role', 'css', 'xpath'],
  captureScreenshots: false,
  captureHovers: false,
  ignoreDomains: [],
  bridgeHost: '127.0.0.1',
  bridgePort: 8765,
  bridgeToken: 'change-me-shared-secret',
  autoConnectBridge: false,
};

/** In-memory session (mirrored to chrome.storage.session for durability). */
let session = {
  status: 'idle', // idle | recording | paused | stopped
  sessionId: null,
  tabId: null,
  tabInfo: null,
  startedAt: null,
  steps: [],
};

let bridgeSocket = null;
let bridgeStatus = 'disconnected'; // disconnected | connecting | connected | error
let settingsCache = null;
let lastScreenshotAt = 0;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function getSettings() {
  if (settingsCache) return settingsCache;
  const stored = await chrome.storage.local.get('settings');
  settingsCache = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  return settingsCache;
}

async function saveSettings(partial) {
  const current = await getSettings();
  settingsCache = { ...current, ...partial };
  await chrome.storage.local.set({ settings: settingsCache });
  return settingsCache;
}

// ---------------------------------------------------------------------------
// Session persistence (service workers can be evicted at any time)
// ---------------------------------------------------------------------------
async function persistSession() {
  await chrome.storage.session.set({ session });
}
async function restoreSession() {
  const stored = await chrome.storage.session.get('session');
  if (stored.session) session = stored.session;
}
restoreSession();

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'state-update', session, bridgeStatus }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Domain ignore-list helper
// ---------------------------------------------------------------------------
function isIgnoredUrl(url, ignoreDomains) {
  try {
    const host = new URL(url).hostname;
    return (ignoreDomains || []).some((d) => host === d || host.endsWith('.' + d));
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Content-script injection
// ---------------------------------------------------------------------------
async function injectRecorder(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['selector-engine.js', 'content.js'],
    });
    const settings = await getSettings();
    await chrome.tabs
      .sendMessage(tabId, {
        type: 'recorder-update-settings',
        settings: {
          captureScreenshots: settings.captureScreenshots,
          captureHovers: settings.captureHovers,
        },
      })
      .catch(() => {});
  } catch (e) {
    console.warn('[recorder] injection failed', e);
  }
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------
async function startRecording(tabId) {
  const tab = await chrome.tabs.get(tabId);
  session = {
    status: 'recording',
    sessionId: crypto.randomUUID(),
    tabId,
    tabInfo: { title: tab.title, url: tab.url, favIconUrl: tab.favIconUrl },
    startedAt: Date.now(),
    steps: [],
  };
  await persistSession();
  await injectRecorder(tabId);
  addStep({
    id: crypto.randomUUID(),
    action: 'navigate',
    selector: null,
    selectorType: null,
    value: null,
    url: tab.url,
    frameId: 0,
    timestamp: Date.now(),
    screenshot: null,
    waitFor: { type: 'networkidle', timeout: 8000 },
  }, { skipBroadcastOnly: false });

  sendBridge({
    type: 'session.start',
    sessionId: session.sessionId,
    token: (await getSettings()).bridgeToken,
    meta: { url: tab.url, title: tab.title, userAgent: navigator.userAgent },
  });
  broadcastState();
}

async function setPausedOnTab(paused) {
  if (!session.tabId) return;
  await chrome.tabs.sendMessage(session.tabId, { type: 'recorder-set-paused', paused }).catch(() => {});
}

async function pauseRecording() {
  if (session.status !== 'recording') return;
  session.status = 'paused';
  await setPausedOnTab(true);
  await persistSession();
  sendBridge({ type: 'session.pause', sessionId: session.sessionId });
  broadcastState();
}

async function resumeRecording() {
  if (session.status !== 'paused') return;
  session.status = 'recording';
  await setPausedOnTab(false);
  await persistSession();
  sendBridge({ type: 'session.resume', sessionId: session.sessionId });
  broadcastState();
}

async function stopRecording() {
  if (session.status === 'idle') return;
  session.status = 'stopped';
  await setPausedOnTab(true);
  await persistSession();
  sendBridge({
    type: 'session.stop',
    sessionId: session.sessionId,
    summary: { stepCount: session.steps.length, endedAt: Date.now() },
  });
  broadcastState();
}

async function resetSession() {
  session = { status: 'idle', sessionId: null, tabId: null, tabInfo: null, startedAt: null, steps: [] };
  await persistSession();
  broadcastState();
}

function addStep(step) {
  session.steps.push(step);
  persistSession();
  broadcastState();
  sendBridge({ type: 'step.recorded', sessionId: session.sessionId, step });
}

async function maybeCaptureScreenshot() {
  const settings = await getSettings();
  if (!settings.captureScreenshots) return null;
  const now = Date.now();
  if (now - lastScreenshotAt < 550) return null; // stay under capture rate limits
  lastScreenshotAt = now;
  try {
    const tab = await chrome.tabs.get(session.tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 40 });
    return dataUrl;
  } catch (e) {
    return null;
  }
}

async function handleRecordedStep(rawStep, tabId) {
  if (session.status !== 'recording') return;
  if (tabId !== session.tabId) return;
  const settings = await getSettings();
  if (isIgnoredUrl(rawStep.url, settings.ignoreDomains)) return;

  const screenshot = await maybeCaptureScreenshot();
  const step = {
    id: rawStep.id || crypto.randomUUID(),
    action: rawStep.action,
    selector: rawStep.selector,
    selectorType: rawStep.selectorType,
    cssEquivalent: rawStep.cssEquivalent,
    role: rawStep.role,
    value: rawStep.value ?? null,
    url: rawStep.url,
    frameId: rawStep.frameId ?? 0,
    timestamp: rawStep.timestamp || Date.now(),
    screenshot,
    waitFor: { type: 'visible', timeout: 5000 },
    meta: rawStep.meta || null,
  };
  addStep(step);
}

function deleteStep(stepId) {
  session.steps = session.steps.filter((s) => s.id !== stepId);
  persistSession();
  broadcastState();
}

// ---------------------------------------------------------------------------
// Navigation tolerance: re-inject recorder + log a navigate step
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (session.status !== 'recording' || tabId !== session.tabId) return;
  if (changeInfo.status === 'complete') {
    await injectRecorder(tabId);
    const last = session.steps[session.steps.length - 1];
    if (!last || last.url !== tab.url) {
      addStep({
        id: crypto.randomUUID(),
        action: 'navigate',
        selector: null,
        selectorType: null,
        value: null,
        url: tab.url,
        frameId: 0,
        timestamp: Date.now(),
        screenshot: null,
        waitFor: { type: 'networkidle', timeout: 8000 },
      });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session.tabId === tabId && (session.status === 'recording' || session.status === 'paused')) {
    stopRecording();
  }
});

// ---------------------------------------------------------------------------
// WebSocket bridge to the desktop app
// ---------------------------------------------------------------------------
function sendBridge(message) {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    try {
      bridgeSocket.send(JSON.stringify(message));
    } catch (e) {
      /* ignore */
    }
  }
}

async function connectBridge() {
  const settings = await getSettings();
  if (bridgeSocket) {
    try {
      bridgeSocket.close();
    } catch (e) {}
  }
  bridgeStatus = 'connecting';
  broadcastState();
  try {
    bridgeSocket = new WebSocket(`ws://${settings.bridgeHost}:${settings.bridgePort}`);
  } catch (e) {
    bridgeStatus = 'error';
    broadcastState();
    return;
  }
  bridgeSocket.onopen = () => {
    bridgeStatus = 'connected';
    broadcastState();
    sendBridge({
      type: 'session.start',
      sessionId: session.sessionId,
      token: settings.bridgeToken,
      meta: { note: 'handshake', extensionVersion: chrome.runtime.getManifest().version },
    });
  };
  bridgeSocket.onclose = () => {
    bridgeStatus = 'disconnected';
    broadcastState();
  };
  bridgeSocket.onerror = () => {
    bridgeStatus = 'error';
    broadcastState();
  };
  bridgeSocket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'auth.error') {
        bridgeStatus = 'error';
        bridgeSocket.close();
        broadcastState();
      }
    } catch (e) {}
  };
}

function disconnectBridge() {
  if (bridgeSocket) {
    try {
      bridgeSocket.close();
    } catch (e) {}
  }
  bridgeSocket = null;
  bridgeStatus = 'disconnected';
  broadcastState();
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------
function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function exportSession(format) {
  if (format === 'json') {
    const payload = JSON.stringify(
      { sessionId: session.sessionId, tabInfo: session.tabInfo, steps: session.steps },
      null,
      2
    );
    return { filename: `recording-${session.sessionId}.json`, dataUrl: `data:application/json;base64,${toBase64Utf8(payload)}` };
  }
  if (format === 'python') {
    const script = self.__PW_CODEGEN__.generatePlaywrightScript(session.steps, { browser: 'chromium' });
    return { filename: `recording-${session.sessionId}.py`, dataUrl: `data:text/x-python;base64,${toBase64Utf8(script)}` };
  }
  throw new Error('Unknown export format');
}

// ---------------------------------------------------------------------------
// Message router (popup <-> background, content script -> background)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'step-recorded':
        await handleRecordedStep(message.step, sender.tab?.id);
        sendResponse({ ok: true });
        break;
      case 'recorder-ready':
        sendResponse({ ok: true });
        break;
      case 'get-tabs': {
        const tabs = await chrome.tabs.query({});
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({
          tabs: tabs
            .filter((t) => t.url && !t.url.startsWith('chrome://'))
            .map((t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl })),
          activeTabId: activeTab?.id,
        });
        break;
      }
      case 'get-state': {
        const settings = await getSettings();
        sendResponse({ session, bridgeStatus, settings });
        break;
      }
      case 'start-recording':
        await startRecording(message.tabId);
        sendResponse({ ok: true });
        break;
      case 'pause-recording':
        await pauseRecording();
        sendResponse({ ok: true });
        break;
      case 'resume-recording':
        await resumeRecording();
        sendResponse({ ok: true });
        break;
      case 'stop-recording':
        await stopRecording();
        sendResponse({ ok: true });
        break;
      case 'reset-session':
        await resetSession();
        sendResponse({ ok: true });
        break;
      case 'delete-step':
        deleteStep(message.stepId);
        sendResponse({ ok: true });
        break;
      case 'update-settings': {
        const updated = await saveSettings(message.settings);
        if (session.tabId) {
          await chrome.tabs
            .sendMessage(session.tabId, {
              type: 'recorder-update-settings',
              settings: { captureScreenshots: updated.captureScreenshots, captureHovers: updated.captureHovers },
            })
            .catch(() => {});
        }
        sendResponse({ ok: true, settings: updated });
        break;
      }
      case 'connect-bridge':
        await connectBridge();
        sendResponse({ ok: true });
        break;
      case 'disconnect-bridge':
        disconnectBridge();
        sendResponse({ ok: true });
        break;
      case 'export-session': {
        const result = await exportSession(message.format);
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message type' });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
});
