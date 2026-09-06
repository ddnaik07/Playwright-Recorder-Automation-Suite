"""Main application window: project tree, step editor, live log, bridge
server controls, run controls, and the end-of-run report view."""
from __future__ import annotations

import datetime
import os

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (
    QDockWidget,
    QFileDialog,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStatusBar,
    QTabWidget,
    QToolBar,
    QVBoxLayout,
    QWidget,
)

from ..bridge_server import BridgeServer
from ..codegen import generate_playwright_script
from ..executor import RunnerThread
from ..models import Project, Script, Step
from ..project import import_recording_file, load_project, new_project, save_project
from ..report import export_html, export_pdf, failed_or_skipped_steps
from .widgets import FailureDecisionDialog, LogPanel, NewStepDialog, StepsTable

LOG_DIR = "run_logs"
ARTIFACT_DIR = "run_artifacts"
REPORT_DIR = "reports"


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Playwright Recorder & Automation Suite")
        self.resize(1180, 760)

        self.project: Project = new_project()
        self.current_script_index: int = -1
        self.bridge: BridgeServer | None = None
        self.runner: RunnerThread | None = None
        self.last_run_result = None
        self._live_recording_script: Script | None = None

        self._build_ui()
        self._build_menu_and_toolbar()
        self._refresh_script_list()

    # ------------------------------------------------------------------ UI --
    def _build_ui(self):
        # Left dock: scripts list
        self.script_list = QListWidget()
        self.script_list.currentRowChanged.connect(self._on_script_selected)
        dock = QDockWidget("Project scripts", self)
        dock.setWidget(self.script_list)
        self.addDockWidget(Qt.DockWidgetArea.LeftDockWidgetArea, dock)

        # Center: tabs (Steps editor / Live log / Report)
        self.tabs = QTabWidget()
        self.steps_table = StepsTable()
        self.tabs.addTab(self.steps_table, "Steps")

        self.log_panel = LogPanel()
        self.tabs.addTab(self.log_panel, "Live Log")

        self.report_view = QWidget()
        report_layout = QVBoxLayout(self.report_view)
        self.report_summary = QLabel("No run yet.")
        self.report_summary.setStyleSheet("font-size: 13px; padding: 8px;")
        report_layout.addWidget(self.report_summary)
        report_btn_row = QHBoxLayout()
        self.btn_export_html = QPushButton("Export HTML report")
        self.btn_export_pdf = QPushButton("Export PDF report")
        self.btn_rerun_failed = QPushButton("Re-run failed/skipped")
        self.btn_export_html.clicked.connect(self._export_report_html)
        self.btn_export_pdf.clicked.connect(self._export_report_pdf)
        self.btn_rerun_failed.clicked.connect(self._rerun_failed)
        report_btn_row.addWidget(self.btn_export_html)
        report_btn_row.addWidget(self.btn_export_pdf)
        report_btn_row.addWidget(self.btn_rerun_failed)
        report_layout.addLayout(report_btn_row)
        self.tabs.addTab(self.report_view, "Report")

        self.setCentralWidget(self.tabs)

        # Status bar: bridge indicator
        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.bridge_indicator = QLabel("● Bridge: stopped")
        self.bridge_indicator.setStyleSheet("color:#f87171; font-weight:600; padding: 0 8px;")
        self.status.addPermanentWidget(self.bridge_indicator)

    def _build_menu_and_toolbar(self):
        menu = self.menuBar()

        file_menu = menu.addMenu("&Project")
        file_menu.addAction(self._action("New Project", self.new_project))
        file_menu.addAction(self._action("Open Project…", self.open_project))
        file_menu.addAction(self._action("Save Project…", self.save_project))
        file_menu.addSeparator()
        file_menu.addAction(self._action("New Script", self.new_script))
        file_menu.addAction(self._action("Import Recording (JSON)…", self.import_recording))
        file_menu.addSeparator()
        file_menu.addAction(self._action("Export Playwright .py…", self.export_python))

        run_menu = menu.addMenu("&Run")
        run_menu.addAction(self._action("Run All", self.run_all))
        run_menu.addAction(self._action("Run Selected Step", self.run_selected_step))
        run_menu.addAction(self._action("Pause", self.pause_run))
        run_menu.addAction(self._action("Resume", self.resume_run))
        run_menu.addAction(self._action("Stop / Abort", self.stop_run))

        bridge_menu = menu.addMenu("&Bridge Server")
        bridge_menu.addAction(self._action("Start Bridge Server", self.start_bridge))
        bridge_menu.addAction(self._action("Stop Bridge Server", self.stop_bridge))

        toolbar = QToolBar("Main")
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        toolbar.addAction(self._action("＋ Wait/Assert", self.insert_step))
        toolbar.addAction(self._action("↑", lambda: self._move_selected(-1)))
        toolbar.addAction(self._action("↓", lambda: self._move_selected(1)))
        toolbar.addAction(self._action("🗑 Delete step", self.delete_selected_step))
        toolbar.addSeparator()
        toolbar.addAction(self._action("▶ Run All", self.run_all))
        toolbar.addAction(self._action("▶₁ Run Step", self.run_selected_step))
        toolbar.addAction(self._action("⏸ Pause", self.pause_run))
        toolbar.addAction(self._action("⏵ Resume", self.resume_run))
        toolbar.addAction(self._action("⏹ Stop", self.stop_run))
        toolbar.addSeparator()
        toolbar.addAction(self._action("🌉 Start Bridge", self.start_bridge))
        toolbar.addAction(self._action("🔌 Stop Bridge", self.stop_bridge))

    def _action(self, text: str, slot) -> QAction:
        action = QAction(text, self)
        action.triggered.connect(slot)
        return action

    # ------------------------------------------------------------ projects --
    def _refresh_script_list(self):
        self.script_list.clear()
        for script in self.project.scripts:
            self.script_list.addItem(QListWidgetItem(f"{script.name}  ({len(script.steps)} steps)"))
        if self.project.scripts and self.current_script_index < 0:
            self.script_list.setCurrentRow(0)

    def _on_script_selected(self, row: int):
        self.current_script_index = row
        if 0 <= row < len(self.project.scripts):
            self.steps_table.load_steps(self.project.scripts[row].steps)

    def new_project(self):
        name, ok = QInputDialog.getText(self, "New Project", "Project name:")
        if ok and name:
            self.project = new_project(name)
            self.current_script_index = -1
            self._refresh_script_list()
            self.steps_table.load_steps([])

    def open_project(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open Project", "", "Playwright Project (*.pwproj.json *.json)")
        if not path:
            return
        try:
            self.project = load_project(path)
            self.current_script_index = -1
            self._refresh_script_list()
        except Exception as e:
            QMessageBox.critical(self, "Open failed", str(e))

    def save_project(self):
        path, _ = QFileDialog.getSaveFileName(self, "Save Project", "project.pwproj.json", "Playwright Project (*.pwproj.json)")
        if not path:
            return
        try:
            save_project(self.project, path)
            self.status.showMessage(f"Project saved to {path}", 4000)
        except Exception as e:
            QMessageBox.critical(self, "Save failed", str(e))

    def new_script(self):
        name, ok = QInputDialog.getText(self, "New Script", "Script name:")
        if ok and name:
            self.project.scripts.append(Script(name=name, steps=[]))
            self._refresh_script_list()
            self.script_list.setCurrentRow(len(self.project.scripts) - 1)

    def import_recording(self):
        path, _ = QFileDialog.getOpenFileName(self, "Import recording", "", "JSON (*.json)")
        if not path:
            return
        try:
            script = import_recording_file(path)
            self.project.scripts.append(script)
            self._refresh_script_list()
            self.script_list.setCurrentRow(len(self.project.scripts) - 1)
            self.status.showMessage(f"Imported {len(script.steps)} steps from {os.path.basename(path)}", 4000)
        except Exception as e:
            QMessageBox.critical(self, "Import failed", str(e))

    def export_python(self):
        if not self._current_script():
            return
        script_text = generate_playwright_script(self._current_script().steps)
        path, _ = QFileDialog.getSaveFileName(self, "Export Playwright script", "automation.py", "Python (*.py)")
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(script_text)
        self.status.showMessage(f"Playwright script exported to {path}", 4000)

    def _current_script(self) -> Script | None:
        if 0 <= self.current_script_index < len(self.project.scripts):
            return self.project.scripts[self.current_script_index]
        return None

    # ------------------------------------------------------------ editing --
    def insert_step(self):
        dialog = NewStepDialog(self)
        if dialog.exec():
            row = self.steps_table.selected_row()
            insert_at = (row + 1) if row is not None else len(self.steps_table.steps)
            self.steps_table.insert_step(insert_at, dialog.to_step())

    def _move_selected(self, delta: int):
        row = self.steps_table.selected_row()
        if row is not None:
            self.steps_table.move_row(row, delta)

    def delete_selected_step(self):
        row = self.steps_table.selected_row()
        if row is not None:
            self.steps_table.delete_row(row)

    # ------------------------------------------------------------ running --
    def run_all(self):
        self._start_runner(single_step_index=None)

    def run_selected_step(self):
        row = self.steps_table.selected_row()
        if row is None:
            QMessageBox.information(self, "Run step", "Select a step in the table first.")
            return
        self._start_runner(single_step_index=row)

    def _start_runner(self, single_step_index):
        script = self._current_script()
        if not script or not script.steps:
            QMessageBox.information(self, "Run", "This script has no steps.")
            return
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        self.log_panel.clear()
        self.tabs.setCurrentWidget(self.log_panel)
        self.runner = RunnerThread(
            steps=script.steps,
            screenshots_dir=ARTIFACT_DIR,
            single_step_index=single_step_index,
        )
        self.runner.step_status_changed.connect(self._on_step_status_changed)
        self.runner.log.connect(lambda msg: self.log_panel.append_log(msg))
        self.runner.awaiting_decision.connect(self._on_awaiting_decision)
        self.runner.run_finished.connect(self._on_run_finished)
        self.runner.start()

    def pause_run(self):
        if self.runner:
            self.runner.pause()
            self.log_panel.append_log("⏸ paused by user", "warn")

    def resume_run(self):
        if self.runner:
            self.runner.resume()
            self.log_panel.append_log("⏵ resumed by user", "info")

    def stop_run(self):
        if self.runner:
            self.runner.stop()
            self.log_panel.append_log("⏹ stop requested by user", "warn")

    def _on_step_status_changed(self, index: int, status: str, message: str, screenshot_path):
        self.steps_table.set_row_status(index, status, message)
        level = {"passed": "success", "failed": "error", "skipped": "warn"}.get(status, "info")
        if message:
            self.log_panel.append_log(f"step {index + 1}: {status} — {message}", level)

    def _on_awaiting_decision(self, index: int, error: str):
        step = self._current_script().steps[index]
        dialog = FailureDecisionDialog(f"#{index + 1} {step.action} ({step.selector})", error, self)
        dialog.exec()
        if self.runner:
            self.runner.resolve_decision(dialog.decision)

    def _on_run_finished(self, result):
        self.last_run_result = result
        counts = result.counts()
        self.report_summary.setText(
            f"<b>Run {result.runId}</b><br/>"
            f"Total: {len(result.steps)} &middot; "
            f"<span style='color:#34d399'>Passed: {counts.get('passed', 0)}</span> &middot; "
            f"<span style='color:#f87171'>Failed: {counts.get('failed', 0)}</span> &middot; "
            f"<span style='color:#fbbf24'>Skipped: {counts.get('skipped', 0)}</span> &middot; "
            f"Duration: {result.durationMs} ms"
        )
        self.tabs.setCurrentWidget(self.report_view)
        self._persist_run_log(result)

    def _persist_run_log(self, result):
        os.makedirs(LOG_DIR, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        path = os.path.join(LOG_DIR, f"run-{ts}.log")
        with open(path, "w", encoding="utf-8") as f:
            for i in range(self.log_panel.count()):
                f.write(self.log_panel.item(i).text() + "\n")
        self.status.showMessage(f"Run log saved to {path}", 4000)

    def _export_report_html(self):
        if not self.last_run_result:
            QMessageBox.information(self, "Report", "Run a script first.")
            return
        os.makedirs(REPORT_DIR, exist_ok=True)
        path, _ = QFileDialog.getSaveFileName(self, "Export HTML report", os.path.join(REPORT_DIR, "report.html"), "HTML (*.html)")
        if path:
            export_html(self.last_run_result, path)
            self.status.showMessage(f"HTML report saved to {path}", 4000)

    def _export_report_pdf(self):
        if not self.last_run_result:
            QMessageBox.information(self, "Report", "Run a script first.")
            return
        os.makedirs(REPORT_DIR, exist_ok=True)
        path, _ = QFileDialog.getSaveFileName(self, "Export PDF report", os.path.join(REPORT_DIR, "report.pdf"), "PDF (*.pdf)")
        if path:
            try:
                export_pdf(self.last_run_result, path)
                self.status.showMessage(f"PDF report saved to {path}", 4000)
            except Exception as e:
                QMessageBox.critical(self, "PDF export failed", str(e))

    def _rerun_failed(self):
        if not self.last_run_result:
            return
        steps = failed_or_skipped_steps(self.last_run_result)
        if not steps:
            QMessageBox.information(self, "Re-run", "No failed or skipped steps to re-run.")
            return
        retry_script = Script(name="Retry — failed/skipped", steps=steps)
        self.project.scripts.append(retry_script)
        self._refresh_script_list()
        self.script_list.setCurrentRow(len(self.project.scripts) - 1)
        self.run_all()

    # ------------------------------------------------------------ bridge --
    def start_bridge(self):
        if self.bridge and self.bridge.isRunning():
            return
        host, ok1 = QInputDialog.getText(self, "Bridge host", "Host:", text="127.0.0.1")
        if not ok1:
            return
        port_str, ok2 = QInputDialog.getText(self, "Bridge port", "Port:", text="8765")
        if not ok2:
            return
        token, ok3 = QInputDialog.getText(self, "Shared secret token", "Token (must match the extension):", text="change-me-shared-secret")
        if not ok3:
            return
        self.bridge = BridgeServer(host=host, port=int(port_str), token=token)
        self.bridge.step_received.connect(self._on_bridge_step)
        self.bridge.session_event.connect(self._on_bridge_session_event)
        self.bridge.client_connected.connect(lambda _id: self._set_bridge_indicator(True))
        self.bridge.client_disconnected.connect(lambda _id: self._set_bridge_indicator(False))
        self.bridge.log.connect(lambda msg: self.log_panel.append_log(msg, "info"))
        self.bridge.server_error.connect(lambda msg: self.log_panel.append_log(msg, "error"))
        self.bridge.start()
        self.bridge_indicator.setText("● Bridge: listening")
        self.bridge_indicator.setStyleSheet("color:#fbbf24; font-weight:600; padding: 0 8px;")

    def stop_bridge(self):
        if self.bridge:
            self.bridge.stop()
            self.bridge.wait(2000)
            self.bridge = None
        self.bridge_indicator.setText("● Bridge: stopped")
        self.bridge_indicator.setStyleSheet("color:#f87171; font-weight:600; padding: 0 8px;")

    def _set_bridge_indicator(self, connected: bool):
        if connected:
            self.bridge_indicator.setText("● Bridge: client connected")
            self.bridge_indicator.setStyleSheet("color:#34d399; font-weight:600; padding: 0 8px;")
        else:
            self.bridge_indicator.setText("● Bridge: listening")
            self.bridge_indicator.setStyleSheet("color:#fbbf24; font-weight:600; padding: 0 8px;")

    def _on_bridge_session_event(self, mtype: str, msg: dict):
        if mtype == "session.start":
            self._live_recording_script = Script(name=f"Live recording {datetime.datetime.now():%H:%M:%S}", steps=[])
            self.project.scripts.append(self._live_recording_script)
            self._refresh_script_list()
            self.script_list.setCurrentRow(len(self.project.scripts) - 1)
        self.log_panel.append_log(f"bridge event: {mtype}", "info")

    def _on_bridge_step(self, step_dict: dict):
        if not self._live_recording_script:
            self._live_recording_script = Script(name="Live recording", steps=[])
            self.project.scripts.append(self._live_recording_script)
            self._refresh_script_list()
        step = Step.from_dict(step_dict)
        self._live_recording_script.steps.append(step)
        if self._current_script() is self._live_recording_script:
            self.steps_table.load_steps(self._live_recording_script.steps)
        self._refresh_script_list()
        self.log_panel.append_log(f"bridge: recorded {step.action} ({step.selectorType}:{step.selector})", "info")

    def closeEvent(self, event):
        self.stop_bridge()
        if self.runner and self.runner.isRunning():
            self.runner.stop()
            self.runner.wait(2000)
        super().closeEvent(event)
