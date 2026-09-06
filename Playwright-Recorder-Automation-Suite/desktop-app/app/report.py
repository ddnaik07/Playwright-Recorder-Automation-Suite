"""
End-of-run reporting: builds a Playwright-Codegen-report-style HTML summary
(total steps, passed/failed/skipped counts, duration, per-step breakdown
with linked screenshots) and can export it to HTML or PDF. Also exposes a
helper to collect the failed/skipped steps of a run for a targeted re-run.
"""
from __future__ import annotations

import os
from typing import List

from .models import RunResult, Step, StepStatus

_HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Automation Run Report - {{ run_id }}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#0f1115; color:#e5e7eb; margin:0; padding:24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color:#9ca3af; font-size:12px; margin-bottom: 20px; }
  .summary { display:flex; gap:12px; margin-bottom: 24px; flex-wrap: wrap; }
  .card { background:#171a21; border:1px solid #262b36; border-radius:10px; padding:14px 18px; min-width:110px; }
  .card .num { font-size:24px; font-weight:700; }
  .card .label { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#9ca3af; }
  .passed .num { color:#34d399; } .failed .num { color:#f87171; } .skipped .num { color:#fbbf24; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #262b36; vertical-align: top; }
  th { color:#9ca3af; font-weight:600; text-transform:uppercase; font-size: 11px; }
  tr.failed { background: rgba(248,113,113,.06); }
  tr.skipped { background: rgba(251,191,36,.06); }
  .status-pill { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight:700; text-transform:uppercase; }
  .status-passed { background:#064e3b; color:#34d399; }
  .status-failed { background:#7f1d1d; color:#fca5a5; }
  .status-skipped { background:#78350f; color:#fcd34d; }
  .status-pending, .status-running { background:#1e293b; color:#93c5fd; }
  .selector { font-family: ui-monospace, monospace; font-size:11px; color:#93c5fd; word-break: break-all; }
  .err { color:#fca5a5; font-size: 11px; }
  a.shot { color:#818cf8; font-size:11px; }
</style>
</head>
<body>
  <h1>Automation Run Report</h1>
  <div class="meta">Run ID: {{ run_id }} &middot; Started: {{ started }} &middot; Duration: {{ duration }}</div>
  <div class="summary">
    <div class="card"><div class="num">{{ total }}</div><div class="label">Total steps</div></div>
    <div class="card passed"><div class="num">{{ passed }}</div><div class="label">Passed</div></div>
    <div class="card failed"><div class="num">{{ failed }}</div><div class="label">Failed</div></div>
    <div class="card skipped"><div class="num">{{ skipped }}</div><div class="label">Skipped</div></div>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Action</th><th>Selector</th><th>Value</th><th>Status</th><th>Duration</th><th>Notes</th></tr>
    </thead>
    <tbody>
      {{ rows }}
    </tbody>
  </table>
</body>
</html>
"""

_ROW_TEMPLATE = """<tr class="{{ row_class }}">
  <td>{{ idx }}</td>
  <td>{{ action }}</td>
  <td class="selector">{{ selector }}</td>
  <td>{{ value }}</td>
  <td><span class="status-pill status-{{ status }}">{{ status }}</span></td>
  <td>{{ duration }} ms</td>
  <td>{{ notes }}</td>
</tr>"""


def _fmt_ms(ms: int) -> str:
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    return f"{m}m {s}s"


def build_html_report(result: RunResult) -> str:
    counts = result.counts()
    rows_html = []
    for i, sr in enumerate(result.steps, start=1):
        notes = sr.error or ""
        if sr.screenshotPath:
            fname = os.path.basename(sr.screenshotPath)
            notes += f' <a class="shot" href="{sr.screenshotPath}">screenshot: {fname}</a>'
        row = (
            _ROW_TEMPLATE.replace("{{ row_class }}", sr.status if sr.status in ("failed", "skipped") else "")
            .replace("{{ idx }}", str(i))
            .replace("{{ action }}", sr.step.action)
            .replace("{{ selector }}", str(sr.step.selector or ""))
            .replace("{{ value }}", str(sr.step.value if sr.step.value is not None else ""))
            .replace("{{ status }}", sr.status)
            .replace("{{ duration }}", str(sr.durationMs))
            .replace("{{ notes }}", f'<span class="err">{notes}</span>' if notes else "")
        )
        rows_html.append(row)

    html = (
        _HTML_TEMPLATE.replace("{{ run_id }}", result.runId)
        .replace("{{ started }}", str(result.startedAt))
        .replace("{{ duration }}", _fmt_ms(result.durationMs))
        .replace("{{ total }}", str(len(result.steps)))
        .replace("{{ passed }}", str(counts.get(StepStatus.PASSED.value, 0)))
        .replace("{{ failed }}", str(counts.get(StepStatus.FAILED.value, 0)))
        .replace("{{ skipped }}", str(counts.get(StepStatus.SKIPPED.value, 0)))
        .replace("{{ rows }}", "\n".join(rows_html))
    )
    return html


def export_html(result: RunResult, path: str) -> str:
    html = build_html_report(result)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


def export_pdf(result: RunResult, path: str) -> str:
    """Render the HTML report to PDF using Qt's built-in printing support so
    no extra native dependency (e.g. wkhtmltopdf) is required."""
    from PySide6.QtGui import QTextDocument
    from PySide6.QtPrintSupport import QPrinter

    html = build_html_report(result)
    document = QTextDocument()
    document.setHtml(html)

    printer = QPrinter(QPrinter.PrinterMode.HighResolution)
    printer.setOutputFormat(QPrinter.OutputFormat.PdfFormat)
    printer.setOutputFileName(path)
    document.print_(printer)
    return path


def failed_or_skipped_steps(result: RunResult) -> List[Step]:
    return [
        sr.step
        for sr in result.steps
        if sr.status in (StepStatus.FAILED.value, StepStatus.SKIPPED.value)
    ]
