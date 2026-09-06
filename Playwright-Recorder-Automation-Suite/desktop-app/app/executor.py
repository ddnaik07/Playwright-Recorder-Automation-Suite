"""
Execution engine: replays a list of Step objects against a real browser
using Playwright's sync API, running inside its own QThread so the GUI stays
responsive. Emits Qt signals for live logging and supports Pause/Resume,
Stop/Abort, and an interactive Skip/Retry/Abort decision when a step fails.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import List, Optional

from PySide6.QtCore import QThread, Signal

from .codegen import locator_expr
from .models import RunResult, Step, StepResult, StepStatus


class RunnerThread(QThread):
    step_status_changed = Signal(int, str, str, object)  # index, status, message, screenshot_path
    run_started = Signal()
    run_finished = Signal(object)  # RunResult
    log = Signal(str)
    awaiting_decision = Signal(int, str)  # index, error message

    def __init__(
        self,
        steps: List[Step],
        browser_name: str = "chromium",
        headless: bool = False,
        screenshots_dir: str = "run_artifacts",
        single_step_index: Optional[int] = None,
        parent=None,
    ):
        super().__init__(parent)
        self.steps = steps
        self.browser_name = browser_name
        self.headless = headless
        self.screenshots_dir = screenshots_dir
        self.single_step_index = single_step_index

        self._pause_event = threading.Event()
        self._pause_event.set()  # set == running, cleared == paused
        self._stop_flag = threading.Event()
        self._decision_event = threading.Event()
        self._decision: Optional[str] = None  # 'skip' | 'retry' | 'abort'

    # -- external controls ----------------------------------------------------
    def pause(self):
        self._pause_event.clear()

    def resume(self):
        self._pause_event.set()

    def stop(self):
        self._stop_flag.set()
        self._pause_event.set()
        self._decision = "abort"
        self._decision_event.set()

    def resolve_decision(self, decision: str):
        """Called from the GUI thread after the user picks Skip/Retry/Abort."""
        self._decision = decision
        self._decision_event.set()

    def _wait_while_paused(self):
        while not self._pause_event.is_set() and not self._stop_flag.is_set():
            time.sleep(0.1)

    # -- run --------------------------------------------------------------------
    def run(self):
        os.makedirs(self.screenshots_dir, exist_ok=True)
        result = RunResult()
        self.run_started.emit()

        try:
            from playwright.sync_api import sync_playwright, expect  # noqa: F401
        except ImportError:
            self.log.emit("ERROR: playwright is not installed. Run: pip install playwright && playwright install")
            result.endedAt = int(time.time() * 1000)
            self.run_finished.emit(result)
            return

        indices = (
            [self.single_step_index] if self.single_step_index is not None else list(range(len(self.steps)))
        )

        with sync_playwright() as p:
            browser_launcher = getattr(p, self.browser_name)
            browser = browser_launcher.launch(headless=self.headless)
            context = browser.new_context()
            pages = {"main": context.new_page()}
            page = pages["main"]

            for idx in indices:
                if self._stop_flag.is_set():
                    self.step_status_changed.emit(idx, StepStatus.SKIPPED.value, "Run aborted", None)
                    result.steps.append(StepResult(step=self.steps[idx], status=StepStatus.SKIPPED.value))
                    continue

                self._wait_while_paused()
                if self._stop_flag.is_set():
                    break

                step = self.steps[idx]
                attempt = 0
                while True:
                    attempt += 1
                    started = time.time()
                    self.step_status_changed.emit(idx, StepStatus.RUNNING.value, "", None)
                    self.log.emit(f"[{idx + 1}/{len(self.steps)}] running {step.action} ({step.selectorType}: {step.selector})")
                    try:
                        page = self._run_step(page, pages, step)
                        duration = int((time.time() - started) * 1000)
                        self.step_status_changed.emit(idx, StepStatus.PASSED.value, "", None)
                        self.log.emit(f"  -> passed in {duration}ms")
                        result.steps.append(
                            StepResult(step=step, status=StepStatus.PASSED.value, durationMs=duration)
                        )
                        break
                    except Exception as e:  # noqa: BLE001
                        duration = int((time.time() - started) * 1000)
                        shot_path = self._safe_screenshot(page, idx)
                        message = str(e).splitlines()[0]
                        self.log.emit(f"  -> FAILED: {message}")
                        self.step_status_changed.emit(idx, StepStatus.FAILED.value, message, shot_path)

                        self._decision_event.clear()
                        self.awaiting_decision.emit(idx, message)
                        self._decision_event.wait()
                        decision = self._decision or "abort"

                        if decision == "retry":
                            self.log.emit("  -> retrying step")
                            continue
                        elif decision == "skip":
                            self.log.emit("  -> skipped step")
                            result.steps.append(
                                StepResult(
                                    step=step,
                                    status=StepStatus.SKIPPED.value,
                                    error=message,
                                    screenshotPath=shot_path,
                                    durationMs=duration,
                                )
                            )
                            break
                        else:  # abort
                            self.log.emit("  -> aborting run")
                            result.steps.append(
                                StepResult(
                                    step=step,
                                    status=StepStatus.FAILED.value,
                                    error=message,
                                    screenshotPath=shot_path,
                                    durationMs=duration,
                                )
                            )
                            self._stop_flag.set()
                            break

            context.close()
            browser.close()

        result.endedAt = int(time.time() * 1000)
        self.run_finished.emit(result)

    # -- step execution -----------------------------------------------------------
    def _run_step(self, page, pages: dict, step: Step):
        timeout = int((step.waitFor or {}).get("timeout", 5000))
        action = step.action

        if action == "navigate":
            page.goto(step.url, timeout=max(timeout, 8000))
            return page

        if (step.meta or {}).get("newTab"):
            new_page = page.context.new_page()
            pages[f"tab_{len(pages)}"] = new_page
            page = new_page

        locator = self._resolve(page, step)

        if action in ("click", "upload-click"):
            locator.click(timeout=timeout)
        elif action == "fill":
            locator.fill(str(step.value or ""), timeout=timeout)
        elif action == "select":
            locator.select_option(str(step.value), timeout=timeout)
        elif action == "check":
            locator.check(timeout=timeout)
        elif action == "uncheck":
            locator.uncheck(timeout=timeout)
        elif action == "press":
            locator.press(str(step.value or "Enter"), timeout=timeout)
        elif action == "hover":
            locator.hover(timeout=timeout)
        elif action == "upload":
            files = [f.strip() for f in str(step.value or "").split(",") if f.strip()]
            locator.set_input_files(files, timeout=timeout)
        elif action == "dragdrop":
            target_selector = (step.meta or {}).get("targetSelector")
            if target_selector:
                locator.drag_to(page.locator(target_selector), timeout=timeout)
        elif action == "wait":
            page.wait_for_timeout(timeout)
        elif action == "assert-text":
            from playwright.sync_api import expect

            expect(locator).to_contain_text(str(step.value or ""), timeout=timeout)
        elif action == "assert-visible":
            from playwright.sync_api import expect

            expect(locator).to_be_visible(timeout=timeout)
        else:
            raise RuntimeError(f"Unsupported action '{action}'")

        return page

    def _resolve(self, page, step: Step):
        """Resolve a Playwright Locator for the step using the same priority
        order as the recorder: testid -> id -> role -> css -> xpath."""
        st = step.selectorType
        if st == "testid":
            return page.get_by_test_id(step.selector)
        if st == "id":
            return page.locator(f"#{step.selector}")
        if st == "role":
            return page.get_by_role(step.role or "button", name=step.selector)
        if st == "css":
            return page.locator(step.cssEquivalent or step.selector)
        if st == "xpath":
            target = step.cssEquivalent or step.selector or ""
            if not target.startswith("xpath="):
                target = f"xpath={target}"
            return page.locator(target)
        return page.locator(step.selector or "body")

    def _safe_screenshot(self, page, idx: int) -> Optional[str]:
        try:
            path = os.path.join(self.screenshots_dir, f"step_{idx + 1}_{int(time.time() * 1000)}.png")
            page.screenshot(path=path)
            return path
        except Exception:
            return None
