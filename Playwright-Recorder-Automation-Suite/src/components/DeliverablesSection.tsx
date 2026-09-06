import { SectionHeading } from "./HowItWorks";

const TREE = [
  {
    root: "extension/",
    items: [
      "manifest.json — MV3 permissions & wiring",
      "background.js — session state machine, injection, bridge client, exports",
      "content.js + selector-engine.js — event capture & resilient selectors",
      "codegen.js — client-side Playwright script generator",
      "popup.html / popup.js / popup.css — recorder & settings UI",
    ],
  },
  {
    root: "desktop-app/",
    items: [
      "main.py — app entry point",
      "app/models.py — Step / Script / Project / RunResult dataclasses",
      "app/bridge_server.py — local WebSocket bridge (QThread)",
      "app/executor.py — Playwright run engine (pause/resume/skip/retry)",
      "app/codegen.py & app/report.py — script generation & HTML/PDF reports",
      "app/ui/ — PySide6 main window, step table, log panel, dialogs",
      "samples/ — sample_recording.json, generated .py script, sample_report.html",
    ],
  },
  {
    root: "docs/",
    items: ["PROTOCOL.md — Step schema + WebSocket message contract"],
  },
];

export function DeliverablesSection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading
        eyebrow="What's included"
        title="Full source, docs, and sample artifacts"
        desc="Everything described on this page ships as real files in this project — this site is documentation for them, not a substitute."
      />
      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        {TREE.map((group) => (
          <div key={group.root} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-3 font-mono text-sm font-semibold text-indigo-300">{group.root}</div>
            <ul className="space-y-2">
              {group.items.map((item) => (
                <li key={item} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
