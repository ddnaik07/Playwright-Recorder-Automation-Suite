# Playwright Recorder — Chrome Extension (Part A)

Manifest V3 extension that records user interactions on a chosen browser tab
and exports them as JSON steps and/or an auto-generated Playwright (Python)
script. Can optionally stream steps live to the companion desktop app over a
local WebSocket bridge.

## Load as an unpacked extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the `extension/` folder.
4. Pin the "Playwright Recorder" icon to the toolbar for quick access.

## Using it

1. Click the toolbar icon to open the popup.
2. Under **Record**, pick which open tab to record (defaults to the active
   tab) — title, URL and favicon are shown for every open tab.
3. Click **Record**. The content script is injected into the chosen tab and
   starts capturing clicks, input/typing (debounced), select/dropdown
   changes, checkbox/radio toggles, Enter/Tab key presses, in-tab
   navigation, hovers (optional), scrolls inside scrollable containers,
   drag-and-drop, and file-input clicks.
4. Use **Pause/Resume** to temporarily stop capturing without ending the
   session, and **Stop** to finalize it.
5. While recording, the step list updates live (in the popup and in the
   in-page slide panel); click the ✕ next to a step to delete a
   mis-captured entry before stopping.
6. After stopping, download the session as **JSON** and/or a generated
   **Playwright Python script** (`.py`), or start a new recording.

## In-page slide panel

When recording starts (or when you press **⇱ Open slide panel in tab** in the
popup), a floating panel slides in from the right edge of the recorded page:

- **Draggable** — grab the header (or the collapsed pill) and move it
  anywhere on the page; the position is remembered across navigations.
- **Collapsible** — press `–` to shrink it to a small pill; click the pill to
  bring it back.
- **Live controls** — Record / Pause / Resume / Stop, the live step list with
  per-step delete, and JSON / `.py` export once stopped. Interactions inside
  the panel are never recorded.
- The panel renders in a closed shadow DOM, so page styles cannot break it
  and it cannot leak events into the recorded page.

## Scrollable / lazy-loading dropdowns

Dropdowns whose options only appear while the list is scrolled (lazy loading,
windowed/virtualized lists — MUI, Ant Design, React-Select, …) are recorded as:

1. `click` on the combobox,
2. `scroll` inside the list container (captures the wheel delta),
3. `click` on the option — resolved to a resilient `role=option` /
   `role=listitem` + text locator (no brittle `nth-of-type` paths), plus
   `meta.fallbackCss` and `meta.listboxContext` (the owning combobox and list
   container) for replay.

Replay (desktop executor or generated `.py`) hovers the recorded container
and sends `page.mouse.wheel(0, deltaY)` so the options populate before the
option click runs, and retries a failed role-locator click once with the
recorded CSS fallback.

You can try the whole flow against `test-pages/lazy-dropdown.html` in the
repo root.

## Settings panel

- **Selector strategy** — informational priority order used by the
  selector engine: `data-testid`/`data-*` → `id` → `aria-role`/label + text →
  unique CSS path → XPath fallback.
- **Screenshot capture** — toggle a per-step thumbnail (captured via
  `chrome.tabs.captureVisibleTab`, throttled to respect Chrome's rate
  limits).
- **Hover capture** — optional, off by default (noisy).
- **Scroll capture** — on by default. Records `scroll` steps for scrollable
  containers and the page; needed for dropdowns that load their options on
  scroll. Turn it off if your recordings pick up too many scroll steps.
- **Domain ignore-list** — interactions on these hostnames are skipped.
- **Bridge server** — host/port/shared-secret token for the desktop app's
  local WebSocket bridge (`ws://127.0.0.1:8765` by default), plus a
  Connect/Disconnect button and a live connected/disconnected indicator.

## Architecture

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest, permissions, popup/background wiring |
| `background.js` | Service worker: session state machine, tab injection & re-injection across navigations, screenshot capture, WebSocket bridge client, export generation, message router |
| `content.js` | Injected into the recorded tab; listens for DOM events and posts step objects to the background worker |
| `recorder-panel.js` | Draggable in-page slide panel: live step list, recording controls, exports (closed shadow DOM) |
| `selector-engine.js` | Resilient selector generation (testid → id → role/text → CSS → XPath), incl. dropdown-option resolution and CSS fallbacks |
| `codegen.js` | Client-side Playwright Python code generator (mirrors `desktop-app/app/codegen.py`) |
| `popup.html/js/css` | UI: tab picker, record/pause/stop controls, live step list, settings panel, bridge indicator |

## Data & protocol

See `docs/PROTOCOL.md` at the repo root for the full JSON step schema and the
WebSocket message contract shared with the desktop app.

## Notes & limitations

- Manifest V3 service workers can be suspended after ~30s of inactivity;
  session state is mirrored to `chrome.storage.session` so recordings
  survive a worker restart, but a long-lived WebSocket connection to the
  bridge may need to reconnect (the popup shows live bridge status).
- `chrome.tabs.captureVisibleTab` is rate-limited by Chrome; screenshot
  capture is throttled client-side to avoid errors.
- Recording is scoped to a single tab per session; navigating within that
  tab is tolerated (the recorder re-injects automatically and logs a
  `navigate` step), but opening a *new* tab starts a separate recording.
