/**
 * popup.js - drives the popup UI, talks to background.js exclusively via
 * chrome.runtime.sendMessage/onMessage.
 */
const $ = (sel) => document.querySelector(sel);

let selectedTabId = null;
let currentState = null;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

// -- Tabs (nav between Record / Settings panels) -----------------------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// -- Tab picker ---------------------------------------------------------------
async function loadTabs() {
  const { tabs, activeTabId } = await send({ type: 'get-tabs' });
  selectedTabId = currentState?.session?.tabId || activeTabId;
  const list = $('#tabList');
  list.innerHTML = '';
  tabs.forEach((t) => {
    const item = document.createElement('div');
    item.className = 'tab-item' + (t.id === selectedTabId ? ' selected' : '');
    item.innerHTML = `
      <img src="${escapeHtml(t.favIconUrl || 'icons/icon16.png')}" onerror="this.src='icons/icon16.png'" />
      <div class="tab-meta">
        <div class="tab-title">${escapeHtml(t.title || '(untitled)')}</div>
        <div class="tab-url">${escapeHtml(t.url || '')}</div>
      </div>`;
    item.addEventListener('click', () => {
      if (currentState?.session?.status === 'recording' || currentState?.session?.status === 'paused') return;
      selectedTabId = t.id;
      document.querySelectorAll('.tab-item').forEach((el) => el.classList.remove('selected'));
      item.classList.add('selected');
    });
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// -- Recording controls --------------------------------------------------------
$('#btnRecord').addEventListener('click', async () => {
  if (!selectedTabId) return;
  await send({ type: 'start-recording', tabId: selectedTabId });
  refresh();
});
$('#btnPause').addEventListener('click', async () => {
  await send({ type: 'pause-recording' });
  refresh();
});
$('#btnResume').addEventListener('click', async () => {
  await send({ type: 'resume-recording' });
  refresh();
});
$('#btnStop').addEventListener('click', async () => {
  await send({ type: 'stop-recording' });
  refresh();
});
$('#btnNewSession').addEventListener('click', async () => {
  await send({ type: 'reset-session' });
  refresh();
});
$('#btnShowPanel').addEventListener('click', async () => {
  const target = currentState?.session?.tabId || selectedTabId;
  if (!target) return;
  const res = await send({ type: 'show-panel', tabId: target });
  if (!res || res.ok !== true) {
    console.warn('[recorder] could not open slide panel', res);
  }
  window.close();
});

function download(filename, dataUrl) {
  chrome.downloads.download({ url: dataUrl, filename, saveAs: false }).catch((err) => {
    console.error('[recorder] export failed', err);
  });
}
$('#btnExportJson').addEventListener('click', async () => {
  const { filename, dataUrl } = await send({ type: 'export-session', format: 'json' });
  download(filename, dataUrl);
});
$('#btnExportPy').addEventListener('click', async () => {
  const { filename, dataUrl } = await send({ type: 'export-session', format: 'python' });
  download(filename, dataUrl);
});

// -- Steps list -----------------------------------------------------------------
function renderSteps(steps) {
  const list = $('#stepsList');
  $('#stepCount').textContent = steps.length;
  if (!steps.length) {
    list.innerHTML = '<div class="empty-hint">No steps yet. Pick a tab and hit Record.</div>';
    return;
  }
  list.innerHTML = '';
  steps.forEach((step, idx) => {
    const row = document.createElement('div');
    row.className = 'step-item';
    const detail = step.action === 'navigate' ? step.url : (step.selector || '');
    row.innerHTML = `
      <span class="step-index">${idx + 1}</span>
      <span class="step-action">${step.action}</span>
      <span class="step-detail" title="${escapeHtml(String(step.value ?? detail ?? ''))}">${escapeHtml(
      step.value ? `${detail} → ${step.value}` : String(detail)
    )}</span>
      <button class="step-del" data-id="${step.id}">✕</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.step-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await send({ type: 'delete-step', stepId: btn.dataset.id });
      refresh();
    });
  });
}

// -- State rendering --------------------------------------------------------------
function renderState(state) {
  currentState = state;
  const { session, bridgeStatus } = state;
  const status = session.status;

  $('#stateBadge').textContent = status;
  $('#stateBadge').className = `badge ${status}`;

  $('#btnRecord').disabled = status === 'recording' || status === 'paused';
  $('#btnPause').disabled = status !== 'recording';
  $('#btnPause').hidden = status === 'paused';
  $('#btnResume').hidden = status !== 'paused';
  $('#btnResume').disabled = status !== 'paused';
  $('#btnStop').disabled = status === 'idle' || status === 'stopped';
  $('#tabPicker').style.opacity = status === 'idle' ? '1' : '.55';
  $('#tabPicker').style.pointerEvents = status === 'idle' ? 'auto' : 'none';

  $('#exportPanel').hidden = status !== 'stopped';

  renderSteps(session.steps || []);

  const dot = $('#bridgeDot');
  dot.className = 'dot ' + (bridgeStatus === 'connected' ? 'connected' : bridgeStatus === 'connecting' ? 'connecting' : '');
  $('#bridgeLabel').textContent = `Bridge: ${bridgeStatus}`;
}

async function refresh() {
  const state = await send({ type: 'get-state' });
  renderState(state);
  await loadTabs();
  loadSettingsIntoForm(state.settings);
}

// -- Settings form ------------------------------------------------------------------
function loadSettingsIntoForm(settings) {
  if (!settings) return;
  $('#cfgScreenshots').checked = !!settings.captureScreenshots;
  $('#cfgHovers').checked = !!settings.captureHovers;
  $('#cfgScrolls').checked = settings.captureScrolls !== false;
  $('#cfgIgnoreDomains').value = (settings.ignoreDomains || []).join('\n');
  $('#cfgHost').value = settings.bridgeHost;
  $('#cfgPort').value = settings.bridgePort;
  $('#cfgToken').value = settings.bridgeToken;
  $('#cfgAutoConnect').checked = !!settings.autoConnectBridge;
}

$('#btnSaveSettings').addEventListener('click', async () => {
  const settings = {
    captureScreenshots: $('#cfgScreenshots').checked,
    captureHovers: $('#cfgHovers').checked,
    captureScrolls: $('#cfgScrolls').checked,
    ignoreDomains: $('#cfgIgnoreDomains')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    bridgeHost: $('#cfgHost').value.trim() || '127.0.0.1',
    bridgePort: Number($('#cfgPort').value.trim() || 8765),
    bridgeToken: $('#cfgToken').value.trim(),
    autoConnectBridge: $('#cfgAutoConnect').checked,
  };
  if (!Number.isInteger(settings.bridgePort) || settings.bridgePort < 1 || settings.bridgePort > 65535) {
    alert('Bridge port must be a whole number between 1 and 65535.');
    return;
  }
  await send({ type: 'update-settings', settings });
  const saved = $('#settingsSaved');
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});

$('#btnConnectBridge').addEventListener('click', async () => {
  await send({ type: 'connect-bridge' });
  refresh();
});
$('#btnDisconnectBridge').addEventListener('click', async () => {
  await send({ type: 'disconnect-bridge' });
  refresh();
});

// -- Live updates while popup is open -----------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'state-update') {
    renderState({ session: msg.session, bridgeStatus: msg.bridgeStatus, settings: currentState?.settings });
  }
});

refresh();
