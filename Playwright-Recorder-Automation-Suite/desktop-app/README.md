# Playwright Automation Desktop App (Part B)

PySide6 desktop application that hosts the Playwright automation engine,
imports recordings produced by the Chrome extension (Part A), runs them with
live logging, and produces an end-of-run report.

## Setup

```bash
cd desktop-app
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install                # downloads the Chromium/Firefox/WebKit binaries
python main.py
```

## Features & where to find them

- **Project workflow** — `Project` menu: New/Open/Save Project
  (`*.pwproj.json`), New Script, Import Recording (JSON exported by the
  extension), Export Playwright `.py`.
- **Bridge server** — `Bridge Server` menu (or toolbar 🌉/🔌): starts a local
  WebSocket server (default `ws://127.0.0.1:8765`) that the extension
  connects to for live step streaming. The status bar shows
  stopped/listening/client-connected states. A shared-secret token gate is
  enforced (see `app/bridge_server.py` and `docs/PROTOCOL.md`).
- **Step editor** — the *Steps* tab is an editable table: double-click a
  cell to edit action/selector type/selector/value/wait timeout, use the
  toolbar to reorder (↑/↓), delete, or insert a `wait`/`assert-text`/
  `assert-visible` step before running.
- **Execution engine** (`app/executor.py`) — runs steps with a real
  Playwright browser in a background `QThread`. Toolbar/menu controls: Run
  All, Run Selected Step, Pause, Resume, Stop/Abort. A screenshot is
  captured automatically on any step failure (saved under
  `run_artifacts/`).
- **Live logging** — the *Live Log* tab streams `pending → running →
  passed/failed/skipped` events as they happen. On failure, execution pauses
  and a dialog lets you **Skip**, **Retry**, or **Abort** the run. Every run
  also writes a timestamped log file to `run_logs/run-YYYYMMDD-HHMMSS.log`.
- **Reporting** (`app/report.py`) — the *Report* tab shows totals/pass/fail/
  skip counts and duration after each run, with buttons to export an HTML or
  PDF report (PDF export uses Qt's built-in `QPrinter`, no external binary
  required) and to **re-run only the failed/skipped steps** as a new script.

## Packaging with PyInstaller

```bash
pip install pyinstaller
pyinstaller --noconfirm --windowed --name "PlaywrightAutomationSuite" \
  --add-data "app:app" \
  main.py
```

- On Windows use `--add-data "app;app"` (semicolon separator).
- Because Playwright ships browser binaries separately, either instruct end
  users to run `playwright install` once after installing the packaged app,
  or bundle the browsers by pointing `PLAYWRIGHT_BROWSERS_PATH` at a folder
  included in your installer and running `playwright install` at build time
  into that folder.

## Directory layout

```
desktop-app/
  main.py                 # entry point, applies the dark theme, launches MainWindow
  requirements.txt
  app/
    models.py              # Step / StepResult / RunResult / Script / Project dataclasses
    codegen.py              # Step list -> Playwright Python script generator
    executor.py              # QThread-based Playwright run engine (pause/resume/skip/retry)
    bridge_server.py          # QThread-based local WebSocket bridge server
    project.py                 # Project/Script save, load, and recording import
    report.py                   # HTML/PDF report generation + failed/skipped step extraction
    ui/
      main_window.py             # Main window: menus, toolbar, docks, tabs, wiring
      widgets.py                  # StepsTable, LogPanel, FailureDecisionDialog, NewStepDialog
  samples/
    sample_recording.json        # Example JSON export from the extension
    sample_generated_script.py    # Playwright script generated from the sample recording
    sample_report.html             # Example end-of-run HTML report
```

## Notes

- The bridge server binds to `127.0.0.1` only by design (see
  `docs/PROTOCOL.md`); it is not reachable from other machines.
- Multi-tab flows: a step whose `meta.newTab` flag is set causes the
  executor to open a new Playwright page/tab and continue on it — this
  keeps single-tab flows simple while still supporting flows that spill
  into a second tab.
- `app/models.py` and `app/codegen.py` have **no PySide6/Playwright import
  at module scope**, so they can be reused headlessly (e.g. in CI) without
  installing GUI dependencies.
