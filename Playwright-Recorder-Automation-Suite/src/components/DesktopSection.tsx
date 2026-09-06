import { FolderTree, Server, ListPlus, PlayCircle, ShieldCheck, FileBarChart2 } from "lucide-react";
import { SectionHeading } from "./HowItWorks";
import { CodeBlock } from "./CodeBlock";

const FEATURES = [
  {
    icon: FolderTree,
    title: "Project-based workflow",
    desc: "Create/save/load .pwproj.json projects bundling one or more recorded scripts, each independently editable and runnable.",
  },
  {
    icon: Server,
    title: "Local bridge server",
    desc: "A QThread-hosted WebSocket server (ws://127.0.0.1:8765) accepts live steps from the extension after a shared-secret handshake, or import an exported JSON/script file manually.",
  },
  {
    icon: ListPlus,
    title: "Editable step table",
    desc: "Review and edit selector, value, and waits; reorder, delete, or insert wait/assert-text/assert-visible steps before running.",
  },
  {
    icon: PlayCircle,
    title: "Real Playwright execution",
    desc: "Run All, Run Single Step, Pause/Resume, Stop/Abort — replays steps against a real browser, with automatic multi-tab/page context switching.",
  },
  {
    icon: ShieldCheck,
    title: "Resilient live logging",
    desc: "pending → running → passed/failed/skipped status per step; on failure, execution pauses and you choose Skip, Retry, or Abort. Every run is persisted to a timestamped log file.",
  },
  {
    icon: FileBarChart2,
    title: "Playwright-style reports",
    desc: "Totals, pass/fail/skip counts, duration, per-step breakdown with linked screenshots. Export HTML/PDF, or re-run only the failed/skipped steps.",
  },
];

const SAMPLE_LOG = `[09:12:41] [1/9] running navigate (None: None)
  -> passed in 812ms
[09:12:42] [2/9] running fill (testid: email)
  -> passed in 143ms
[09:12:42] [3/9] running fill (testid: password)
  -> passed in 121ms
[09:12:43] [4/9] running press (testid: password)
  -> passed in 98ms
[09:12:45] [6/9] running click (role: Add to cart)
  -> FAILED: Timeout 5000ms exceeded waiting for locator to become visible
  -> awaiting decision: [Skip] [Retry] [Abort]
  -> retrying step
  -> passed in 640ms
[09:12:47] [9/9] running click (role: Checkout)
  -> passed in 205ms

Run finished: 9 total · 8 passed · 0 failed · 1 skipped · 7.1s`;

export function DesktopSection() {
  return (
    <section id="desktop" className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading
        eyebrow="Part B · Python Desktop App"
        title="Run, watch, and report on every step"
        desc="PySide6 GUI, Playwright for Python, a websockets-based bridge server, packaged with PyInstaller. Turns recorded steps into an editable, replayable, reportable automation."
      />

      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2">
          <ReportMock />
        </div>
      </div>

      <div className="mt-10">
        <CodeBlock code={SAMPLE_LOG} language="log" title="Live Log tab — sample run output" />
      </div>
    </section>
  );
}

function ReportMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#12141b] shadow-2xl shadow-black/40">
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300">
        Report — demo-run-0001
      </div>
      <div className="grid grid-cols-4 gap-2 p-4">
        {[
          { label: "Total", value: 9, color: "text-slate-200" },
          { label: "Passed", value: 7, color: "text-emerald-400" },
          { label: "Failed", value: 1, color: "text-red-400" },
          { label: "Skipped", value: 1, color: "text-amber-400" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center">
            <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
            <div className="mt-1 text-[9px] uppercase tracking-wide text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 px-4 pb-4">
        {[
          { n: 6, action: "click", sel: "Add to cart", status: "failed" },
          { n: 7, action: "select", sel: "#shipping-method", status: "skipped" },
          { n: 8, action: "check", sel: "terms-checkbox", status: "passed" },
          { n: 9, action: "click", sel: "Checkout", status: "passed" },
        ].map((r) => (
          <div
            key={r.n}
            className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
          >
            <span className="text-slate-500">{r.n}</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-slate-300">{r.action}</span>
            <span className="truncate text-slate-400">{r.sel}</span>
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                r.status === "passed"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : r.status === "failed"
                    ? "bg-red-500/15 text-red-300"
                    : "bg-amber-500/15 text-amber-300"
              }`}
            >
              {r.status}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-white/10 p-3">
        <span className="rounded-md bg-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300">Export HTML</span>
        <span className="rounded-md bg-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-slate-300">Export PDF</span>
        <span className="rounded-md bg-indigo-500/80 px-2.5 py-1.5 text-[10px] font-semibold text-white">Re-run failed</span>
      </div>
    </div>
  );
}
