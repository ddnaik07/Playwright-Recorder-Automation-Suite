# Playwright Recorder & Automation Suite

A two-part toolkit for recording browser interactions and replaying them as
real, resilient Playwright automations.

- **Part A — `extension/`** — a Manifest V3 Chrome extension that records
  clicks, typing, dropdowns (including scrollable/lazy-loading custom
  dropdowns), checkboxes, key presses, navigation, hovers, in-container
  scrolls, drag-and-drop, and file-input interactions on any chosen open tab,
  and exports them as JSON and/or a generated Playwright Python script. While
  recording, a **draggable slide panel** floats over the page with live
  controls and the growing step list.
- **Part B — `desktop-app/`** — a PySide6 desktop application that hosts the
  Playwright engine: import recordings (via file or a live local WebSocket
  bridge), edit steps, run them against a real browser with live logging,
  and produce an end-of-run report.
- **`docs/PROTOCOL.md`** — the shared JSON step schema and WebSocket bridge
  message contract used by both parts.

```
├── extension/          Chrome extension (Manifest V3, vanilla JS)
├── desktop-app/         Python + PySide6 desktop app + Playwright engine
├── docs/PROTOCOL.md       Step schema & WebSocket protocol reference
└── src/                    (this repo's own documentation website - see below)
```

## Quick start

### 1. Load the extension

```
chrome://extensions → Developer mode → Load unpacked → select extension/
```

### 2. Run the desktop app

```bash
cd desktop-app
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install
python main.py
```

### 3. Record → run

1. In the desktop app, click **Start Bridge Server** (default
   `ws://127.0.0.1:8765`, set a shared token).
2. In the extension popup, open **Settings**, enter the same host/port/token,
   click **Connect**.
3. Back on **Record**, pick a tab, click **Record**, interact with the page,
   then **Stop**. Steps stream live into a new script in the desktop app
   (or download the JSON/`.py` export from the popup and use **Import
   Recording** in the desktop app instead — both paths work).
4. In the desktop app, review/edit steps, then **Run All**. Watch the *Live
   Log* tab; on any failure choose Skip/Retry/Abort. Check the **Report**
   tab when finished, export it, or re-run just the failed/skipped steps.

## Testing

- **Extension service worker** — loads `background.js`/`codegen.js` in a
  worker-like context and exercises the message router:
  ```bash
  npm install
  npm test
  ```
- **Desktop app core** — dependency-free unit tests for the data model,
  code generation, project import/save/load, and report output:
  ```bash
  cd desktop-app
  python -m unittest discover -s tests
  ```
- **Documentation site** — TypeScript check and production build:
  ```bash
  npm run typecheck
  npm run build
  ```

## Sample artifacts

- `desktop-app/samples/sample_recording.json` — an example JSON export from
  the extension (login → add to cart → checkout flow).
- `desktop-app/samples/sample_generated_script.py` — the Playwright script
  generated from that recording.
- `desktop-app/samples/sample_report.html` — an example end-of-run report.

## Documentation website

`src/App.tsx` in this repository is a documentation/showcase site for the
whole suite (architecture, feature tour, schema reference) built with
React + Tailwind — it is **not** part of the extension or desktop app
runtime; the actual deliverables are the `extension/` and `desktop-app/`
folders described above.
