"""
Playwright Recorder & Automation Suite — Desktop App entry point.

Run with:
    python main.py

See README.md for setup (virtualenv, requirements, `playwright install`).
"""
import sys

from PySide6.QtWidgets import QApplication

from app.ui.main_window import MainWindow

DARK_STYLESHEET = """
QMainWindow, QWidget { background-color: #0f1115; color: #e5e7eb; }
QDockWidget { color: #e5e7eb; }
QListWidget, QTableWidget { background-color: #171a21; border: 1px solid #262b36; }
QHeaderView::section { background-color: #171a21; color: #9ca3af; border: 1px solid #262b36; padding: 4px; }
QTabWidget::pane { border: 1px solid #262b36; }
QTabBar::tab { background: #171a21; color: #9ca3af; padding: 6px 14px; }
QTabBar::tab:selected { background: #1f2430; color: #e5e7eb; }
QToolBar { background: #171a21; border: none; spacing: 4px; }
QPushButton { background-color: #1f2430; border: 1px solid #2f3646; padding: 5px 10px; border-radius: 6px; }
QPushButton:hover { background-color: #2a3142; }
QStatusBar { background: #171a21; }
QLineEdit, QSpinBox, QComboBox { background: #171a21; border: 1px solid #2f3646; padding: 3px; border-radius: 4px; }
"""


def main():
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_STYLESHEET)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
