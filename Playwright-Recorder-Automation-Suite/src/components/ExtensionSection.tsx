import {
  ScanSearch,
  ListTree,
  Settings2,
  Wifi,
  Download,
  CircleDot,
} from "lucide-react";
import { SectionHeading } from "./HowItWorks";
import { CodeBlock } from "./CodeBlock";

const FEATURES = [
  {
    icon: CircleDot,
    title: "Record / Pause / Stop state machine",
    desc: "Clear idle → recording → paused → stopped transitions in the popup, with buttons enabled/disabled per state.",
  },
  {
    icon: ScanSearch,
    title: "Resilient selector engine",
    desc: "Priority order: data-testid/data-* → id → aria-role/label + visible text → unique CSS path → XPath fallback.",
  },
  {
    icon: ListTree,
    title: "Live step list",
    desc: "Every captured click, fill, select, check/uncheck, key press, hover, drag-drop and navigation appears instantly — delete a mis-captured step before stopping.",
  },
  {
    icon: Settings2,
    title: "Settings panel",
    desc: "Selector strategy reference, per-step screenshot toggle, domain ignore-list, and bridge host/port/token configuration.",
  },
  {
    icon: Wifi,
    title: "Live bridge streaming",
    desc: "Optional WebSocket connection to the desktop app with a visible connected / connecting / disconnected indicator.",
  },
  {
    icon: Download,
    title: "JSON & Playwright .py export",
    desc: "Stop a session and download the structured step list and/or an auto-generated Playwright Python script — no desktop app required.",
  },
];

const SAMPLE_STEP = `{
  "id": "b3b9c9b0-6f1a-4a9e-9c2e-6b6f1a2b0002",
  "action": "fill",
  "selector": "email",
  "selectorType": "testid",
  "cssEquivalent": "[data-testid=\\"email\\"]",
  "value": "jane.doe@example.com",
  "url": "https://demo-shop.example.com/login",
  "frameId": 0,
  "timestamp": 1732200002500,
  "screenshot": null,
  "waitFor": { "type": "visible", "timeout": 5000 }
}`;

export function ExtensionSection() {
  return (
    <section id="extension" className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading
        eyebrow="Part A · Chrome Extension"
        title="Record any tab, capture resilient steps"
        desc="Manifest V3, vanilla JavaScript. Uses chrome.tabs / chrome.scripting / chrome.storage / chrome.runtime to pick a tab, inject a recorder, and turn DOM events into a portable step schema."
      />

      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <PopupMock />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                <f.icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <CodeBlock code={SAMPLE_STEP} language="json" title="A recorded step, as sent over the bridge" />
      </div>
    </section>
  );
}

function PopupMock() {
  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-[#12141b] shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3">
        <span className="text-xs font-semibold text-white">Playwright Recorder</span>
        <span className="flex items-center gap-1 text-[10px] text-white/90">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Bridge: connected
        </span>
      </div>
      <div className="flex gap-1 border-b border-white/10 bg-white/5 px-2 pt-2">
        <span className="rounded-t-md bg-[#12141b] px-3 py-1.5 text-[11px] font-semibold text-indigo-300">Record</span>
        <span className="px-3 py-1.5 text-[11px] font-medium text-slate-500">Settings</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="mb-2 text-[10px] font-semibold text-slate-400">CHOOSE A TAB TO RECORD</div>
          {[
            { title: "Demo Shop — Checkout", url: "demo-shop.example.com", active: true },
            { title: "Analytics Dashboard", url: "analytics.example.com" },
            { title: "Docs — API Reference", url: "docs.example.com" },
          ].map((t) => (
            <div
              key={t.title}
              className={`mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] ${
                t.active ? "border border-indigo-500/50 bg-indigo-500/10" : ""
              }`}
            >
              <span className="h-3 w-3 shrink-0 rounded-sm bg-slate-600" />
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-200">{t.title}</div>
                <div className="truncate text-slate-500">{t.url}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-indigo-500 px-2.5 py-1 text-[11px] font-semibold text-white">● Record</span>
          <span className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-500">‖ Pause</span>
          <span className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-slate-500">■ Stop</span>
          <span className="ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-bold uppercase text-red-300">recording</span>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-slate-400">
            <span>RECORDED STEPS</span>
            <span>4</span>
          </div>
          {[
            ["NAVIGATE", "/login"],
            ["FILL", "#email → jane.doe@…"],
            ["CLICK", "role=button[name=Sign in]"],
            ["PRESS", "Enter"],
          ].map(([action, detail]) => (
            <div key={action} className="mb-1 flex items-center gap-2 rounded-md bg-white/[0.03] px-2 py-1 text-[10.5px]">
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-bold text-indigo-300">{action}</span>
              <span className="truncate text-slate-400">{detail}</span>
              <span className="ml-auto text-red-400">✕</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
