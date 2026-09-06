"""Dependency-free unit tests for the desktop app's core modules.

These tests intentionally avoid importing PySide6/Playwright/websockets so
they can run in CI before the GUI dependencies are installed.

Run from desktop-app/:
    python -m unittest discover -s tests
"""
import json
import os
import tempfile
import unittest

from app.codegen import generate_playwright_script, line_for_step, locator_expr
from app.models import RunResult, Script, Step, StepResult, StepStatus
from app.project import import_recording_file, load_project, new_project, save_project
from app.report import build_html_report, export_html, failed_or_skipped_steps


class ModelsTests(unittest.TestCase):
    def test_step_from_dict_roundtrip(self):
        raw = {
            "id": "abc",
            "action": "click",
            "selector": "Add to cart",
            "selectorType": "role",
            "role": "button",
            "cssEquivalent": 'role=button[name="Add to cart"]',
            "value": None,
            "url": "https://example.com",
            "frameId": 0,
            "timestamp": 1234,
            "waitFor": {"type": "visible", "timeout": 5000},
            "meta": {"tag": "button"},
        }
        step = Step.from_dict(raw)
        self.assertEqual(step.id, "abc")
        self.assertEqual(step.action, "click")
        self.assertEqual(step.selectorType, "role")
        self.assertEqual(step.role, "button")
        self.assertEqual(step.meta, {"tag": "button"})
        self.assertEqual(step.to_dict()["action"], "click")

    def test_step_from_dict_defaults(self):
        step = Step.from_dict({"action": "fill", "selector": "email", "selectorType": "testid"})
        self.assertTrue(step.id)
        self.assertIsNone(step.url)
        self.assertEqual(step.frameId, 0)
        self.assertEqual(step.selectorType, "testid")
        self.assertEqual(step.waitFor["type"], "visible")

    def test_run_result_counts(self):
        result = RunResult()
        result.steps.append(StepResult(step=Step(action="click"), status="passed"))
        result.steps.append(StepResult(step=Step(action="fill"), status="failed"))
        result.steps.append(StepResult(step=Step(action="select"), status="skipped"))
        counts = result.counts()
        self.assertEqual(counts["passed"], 1)
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(counts["skipped"], 1)
        self.assertEqual(counts["pending"], 0)


class ProjectTests(unittest.TestCase):
    def test_project_roundtrip(self):
        project = new_project("Test Project")
        project.scripts.append(
            Script(name="Login", steps=[Step(action="fill", selector="email", selectorType="testid", value="a@b.test")])
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "project.pwproj.json")
            save_project(project, path)
            loaded = load_project(path)
        self.assertEqual(loaded.name, "Test Project")
        self.assertEqual(len(loaded.scripts), 1)
        self.assertEqual(loaded.scripts[0].steps[0].value, "a@b.test")
        self.assertEqual(loaded.scripts[0].steps[0].action, "fill")

    def test_import_extension_export(self):
        sample = os.path.join(os.path.dirname(__file__), "..", "samples", "sample_recording.json")
        script = import_recording_file(sample)
        self.assertEqual(len(script.steps), 9)
        self.assertEqual(script.steps[0].action, "navigate")
        self.assertEqual(script.steps[0].selectorType, "none")

    def test_import_plain_list(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([{"action": "click", "selector": "x", "selectorType": "css"}], f)
            path = f.name
        try:
            script = import_recording_file(path)
        finally:
            os.unlink(path)
        self.assertEqual(len(script.steps), 1)
        self.assertEqual(script.steps[0].action, "click")


class CodegenTests(unittest.TestCase):
    def test_all_actions_have_output(self):
        steps = [
            Step(action="navigate", url="https://example.com"),
            Step(action="click", selector="Add to cart", selectorType="role", role="button"),
            Step(action="fill", selector="email", selectorType="testid", value="a@b.test"),
            Step(action="select", selector="#ship", selectorType="css", value="express"),
            Step(action="check", selector="terms", selectorType="testid"),
            Step(action="uncheck", selector="opt", selectorType="id"),
            Step(action="press", selector="pwd", selectorType="testid", value="Enter"),
            Step(action="hover", selector="menu", selectorType="css"),
            Step(action="upload-click", selector="file", selectorType="css"),
            Step(action="upload", selector="file", selectorType="css", value="a.txt"),
            Step(action="dragdrop", selector="src", selectorType="css", meta={"targetSelector": "Drop here", "targetSelectorType": "role", "targetRole": "button", "targetCssEquivalent": 'role=button[name="Drop here"]'}),
            Step(action="wait", waitFor={"timeout": 1000}),
            Step(action="assert-text", selector=".msg", selectorType="css", value="hello"),
            Step(action="assert-visible", selector=".toast", selectorType="css"),
        ]
        script = generate_playwright_script(steps, headless=True)
        for needle in [
            'page.goto("https://example.com")',
            'page.get_by_role("button", name="Add to cart").click()',
            'page.get_by_test_id("email").fill("a@b.test")',
            'page.locator("#ship").select_option("express")',
            'page.locator("#opt").uncheck()',
            'page.get_by_test_id("pwd").press("Enter")',
            'page.get_by_test_id("terms").check()',
            'page.locator("file").set_input_files("a.txt")  # adjust path(s)',
            '# recorded file-picker click; file selection is captured by the upload step',
            'page.locator("menu").hover()',
            'page.locator("src").drag_to(page.get_by_role("button", name="Drop here"))',
            "page.wait_for_timeout(1000)",
            'expect(page.locator(".msg")).to_contain_text("hello")',
            'expect(page.locator(".toast")).to_be_visible()',
        ]:
            self.assertIn(needle, script, f"missing generated line: {needle}")
        self.assertIn("headless=True", script)

    def test_locator_expr(self):
        self.assertEqual(locator_expr(Step(action="click", selectorType="xpath", selector="//button", cssEquivalent="//button")), 'page.locator("xpath=//button")')
        self.assertEqual(locator_expr(Step(action="click", selectorType="css", selector=".a", cssEquivalent=".a")), 'page.locator(".a")')
        self.assertIn("get_by_role", locator_expr(Step(action="click", selectorType="role", selector="Save", role="button")))


class ReportTests(unittest.TestCase):
    def _run_result(self):
        result = RunResult()
        result.steps.append(StepResult(step=Step(action="click", selector="#a"), status="passed", durationMs=10))
        result.steps.append(StepResult(step=Step(action="fill", selector="#b"), status="failed", error="boom", durationMs=20))
        result.steps.append(StepResult(step=Step(action="select", selector="#c"), status="skipped", durationMs=30))
        result.endedAt = result.startedAt + 1000
        return result

    def test_html_report(self):
        html = build_html_report(self._run_result())
        self.assertIn("boom", html)
        self.assertIn("Total steps", html)
        self.assertIn("1.0s", html)

    def test_html_report_escapes_markup(self):
        result = RunResult()
        result.steps.append(
            StepResult(step=Step(action="click", selector="<script>alert(1)</script>"), status="failed", error="<img src=x onerror=alert(1)>", durationMs=1)
        )
        result.endedAt = result.startedAt + 1
        html = build_html_report(result)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", html)
        self.assertNotIn("<script>alert(1)</script>", html)

    def test_html_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "report.html")
            export_html(self._run_result(), path)
            with open(path, encoding="utf-8") as f:
                self.assertIn("boom", f.read())

    def test_failed_or_skipped(self):
        failed = failed_or_skipped_steps(self._run_result())
        self.assertEqual(len(failed), 2)
        self.assertEqual([s.action for s in failed], ["fill", "select"])


if __name__ == "__main__":
    unittest.main()
