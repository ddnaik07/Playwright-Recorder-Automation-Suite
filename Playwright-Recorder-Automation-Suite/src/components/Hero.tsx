import { Globe, MonitorCog, ArrowRight, FolderGit2 } from "lucide-react";

const BADGES = ["Manifest V3", "Vanilla JS", "Python 3.11+", "PySide6", "Playwright", "WebSocket bridge"];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-20 pt-16 sm:pt-24">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.25), transparent 40%), radial-gradient(circle at 80% 0%, rgba(139,92,246,0.2), transparent 40%)",
        }}
      />
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Two-part automation toolkit — record once, run anywhere
          </div>
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl">
            Playwright Recorder <span className="text-indigo-400">&amp;</span> Automation Suite
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-slate-400">
            A Chrome extension that records real user interactions into resilient, testable steps —
            paired with a Python desktop app that turns those steps into a live-running, fully
            reported Playwright automation. Stream sessions over a local WebSocket bridge, or export
            JSON / a generated <code className="rounded bg-white/10 px-1 py-0.5 text-indigo-300">.py</code> script.
          </p>

          <div className="mt-7 flex flex-wrap gap-2">
            {BADGES.map((b) => (
              <span
                key={b}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300"
              >
                {b}
              </span>
            ))}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <a
              href="#extension"
              className="flex items-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:bg-indigo-400"
            >
              <Globe className="h-4 w-4" /> Explore the extension
            </a>
            <a
              href="#desktop"
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
            >
              <MonitorCog className="h-4 w-4" /> Explore the desktop app
            </a>
            <a
              href="#get-started"
              className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-slate-400 transition hover:text-slate-200"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-slate-500">
            <FolderGit2 className="h-3.5 w-3.5" />
            Full source included in this project under{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-slate-300">extension/</code> and{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-slate-300">desktop-app/</code>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-indigo-600/20 to-violet-600/10 blur-2xl" />
          <img
            src="/images/hero.jpg"
            alt="Diagram of the browser recorder streaming steps to the desktop automation runner"
            className="w-full rounded-2xl border border-white/10 object-cover shadow-2xl shadow-black/50"
          />
        </div>
      </div>
    </section>
  );
}
