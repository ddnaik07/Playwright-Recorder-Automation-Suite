"""Reusable Qt widgets for the main window: the editable steps table, the
live log panel, and the failure-resolution dialog (Skip/Retry/Abort)."""
from __future__ import annotations

from typing import List, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..models import Step, StepStatus

COLUMNS = ["#", "Action", "Selector Type", "Selector", "Value", "Wait (ms)", "Status"]

STATUS_COLORS = {
    StepStatus.PENDING.value: QColor("#9ca3af"),
    StepStatus.RUNNING.value: QColor("#60a5fa"),
    StepStatus.PASSED.value: QColor("#34d399"),
    StepStatus.FAILED.value: QColor("#f87171"),
    StepStatus.SKIPPED.value: QColor("#fbbf24"),
}


class StepsTable(QTableWidget):
    """Editable table of Steps: reorder, edit selector/value/wait, delete,
    insert wait/assert steps."""

    stepsChanged = Signal()

    def __init__(self, parent=None):
        super().__init__(0, len(COLUMNS), parent)
        self.setHorizontalHeaderLabels(COLUMNS)
        self.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.setEditTriggers(
            QAbstractItemView.EditTrigger.DoubleClicked | QAbstractItemView.EditTrigger.EditKeyPressed
        )
        self.steps: List[Step] = []
        self.itemChanged.connect(self._on_item_changed)

    # -- data binding ---------------------------------------------------------
    def load_steps(self, steps: List[Step]):
        self.steps = steps
        self.blockSignals(True)
        self.setRowCount(0)
        for step in steps:
            self._append_row(step)
        self.blockSignals(False)

    def _append_row(self, step: Step):
        row = self.rowCount()
        self.insertRow(row)
        values = [
            str(row + 1),
            step.action,
            step.selectorType,
            step.selector or "",
            "" if step.value is None else str(step.value),
            str((step.waitFor or {}).get("timeout", 5000)),
            StepStatus.PENDING.value,
        ]
        for col, value in enumerate(values):
            item = QTableWidgetItem(value)
            if col in (0, 6):
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.setItem(row, col, item)
        self._colorize_status(row, StepStatus.PENDING.value)

    def _on_item_changed(self, item: QTableWidgetItem):
        row, col = item.row(), item.column()
        if row >= len(self.steps):
            return
        step = self.steps[row]
        text = item.text()
        if col == 1:
            step.action = text
        elif col == 2:
            step.selectorType = text
        elif col == 3:
            step.selector = text
        elif col == 4:
            step.value = text
        elif col == 5:
            try:
                step.waitFor = {**(step.waitFor or {}), "timeout": int(text)}
            except ValueError:
                pass
        self.stepsChanged.emit()

    # -- status rendering ---------------------------------------------------------
    def set_row_status(self, row: int, status: str, message: str = ""):
        if row < 0 or row >= self.rowCount():
            return
        item = self.item(row, 6)
        if item:
            item.setText(status if not message else f"{status}")
            if message:
                item.setToolTip(message)
        self._colorize_status(row, status)

    def _colorize_status(self, row: int, status: str):
        color = STATUS_COLORS.get(status, QColor("#9ca3af"))
        for col in range(self.columnCount()):
            cell = self.item(row, col)
            if cell:
                cell.setForeground(color)

    # -- editing helpers -------------------------------------------------------
    def selected_row(self) -> Optional[int]:
        rows = self.selectionModel().selectedRows() if self.selectionModel() else []
        return rows[0].row() if rows else None

    def move_row(self, row: int, delta: int):
        new_row = row + delta
        if new_row < 0 or new_row >= len(self.steps):
            return
        self.steps[row], self.steps[new_row] = self.steps[new_row], self.steps[row]
        self.load_steps(self.steps)
        self.selectRow(new_row)
        self.stepsChanged.emit()

    def delete_row(self, row: int):
        if 0 <= row < len(self.steps):
            del self.steps[row]
            self.load_steps(self.steps)
            self.stepsChanged.emit()

    def insert_step(self, row: int, step: Step):
        self.steps.insert(row, step)
        self.load_steps(self.steps)
        self.stepsChanged.emit()


class LogPanel(QListWidget):
    """Live scrolling execution log with color-coded severity."""

    LEVEL_COLORS = {
        "info": QColor("#d1d5db"),
        "success": QColor("#34d399"),
        "error": QColor("#f87171"),
        "warn": QColor("#fbbf24"),
    }

    def append_log(self, text: str, level: str = "info"):
        item = QListWidgetItem(text)
        item.setForeground(self.LEVEL_COLORS.get(level, QColor("#d1d5db")))
        self.addItem(item)
        self.scrollToBottom()


class FailureDecisionDialog(QDialog):
    """Modal dialog shown when a step fails during a run: Skip / Retry / Abort."""

    def __init__(self, step_desc: str, error: str, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Step failed")
        self.decision = "abort"
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"<b>Step:</b> {step_desc}"))
        err_label = QLabel(error)
        err_label.setWordWrap(True)
        err_label.setStyleSheet("color:#f87171;")
        layout.addWidget(err_label)

        btn_row = QHBoxLayout()
        skip_btn = QPushButton("Skip")
        retry_btn = QPushButton("Retry")
        abort_btn = QPushButton("Abort run")
        abort_btn.setStyleSheet("background:#7f1d1d;color:white;")
        skip_btn.clicked.connect(lambda: self._choose("skip"))
        retry_btn.clicked.connect(lambda: self._choose("retry"))
        abort_btn.clicked.connect(lambda: self._choose("abort"))
        btn_row.addWidget(skip_btn)
        btn_row.addWidget(retry_btn)
        btn_row.addWidget(abort_btn)
        layout.addLayout(btn_row)

    def _choose(self, decision: str):
        self.decision = decision
        self.accept()


class NewStepDialog(QDialog):
    """Simple dialog to append a wait/assert step for review-before-run edits."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Insert step")
        layout = QVBoxLayout(self)

        self.action_box = QComboBox()
        self.action_box.addItems(["wait", "assert-text", "assert-visible"])
        layout.addWidget(QLabel("Action"))
        layout.addWidget(self.action_box)

        self.selector_edit = QLineEdit()
        self.selector_edit.setPlaceholderText("CSS selector (for assertions)")
        layout.addWidget(QLabel("Selector"))
        layout.addWidget(self.selector_edit)

        self.value_edit = QLineEdit()
        self.value_edit.setPlaceholderText("expected text (for assert-text)")
        layout.addWidget(QLabel("Value"))
        layout.addWidget(self.value_edit)

        self.wait_spin = QSpinBox()
        self.wait_spin.setRange(0, 60000)
        self.wait_spin.setValue(1000)
        self.wait_spin.setSuffix(" ms")
        layout.addWidget(QLabel("Timeout"))
        layout.addWidget(self.wait_spin)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def to_step(self) -> Step:
        return Step(
            action=self.action_box.currentText(),
            selector=self.selector_edit.text() or None,
            selectorType="css" if self.selector_edit.text() else "none",
            value=self.value_edit.text() or None,
            waitFor={"type": "timeout", "timeout": self.wait_spin.value()},
        )
