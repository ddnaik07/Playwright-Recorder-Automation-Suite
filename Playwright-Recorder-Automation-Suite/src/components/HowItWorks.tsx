import { MousePointerClick, Radio, ListChecks, FileBarChart } from "lucide-react";

const STEPS = [
  {
    icon: MousePointerClick,
    title: "1. Record",
    desc: "Pick an open tab, hit Record, and interact normally. Clicks, typing, selects, checkboxes, key presses, hovers, drag-and-drop and navigation are all captured with a resilient selector for each element.",
  },
  {
    icon: Radio,
    title: "2. Stream or export",
    desc: "Steps stream live to the desktop app over a local, token-authenticated WebSocket bridge — or download a JSON step file / generated Playwright .py script directly from the popup.",
  },
  {
    icon: ListChecks,
    title: "3. Review & run",
    desc: "In the desktop app, edit selectors/values, reorder or delete steps, insert waits/assertions, then Run All or step-by-step with Pause/Resume and Skip/Retry/Abort on failure.",
  },
  {
    icon: FileBarChart,
    title: "4. Report",
    desc: "Get a Playwright-style end-of-run report — pass/fail/skip counts, duration, per-step screenshots — exportable as HTML/PDF, with one click to re-run only what failed.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading eyebrow="Workflow" title="How it works" />
      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-indigo-500/40 hover:bg-white/[0.05]"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">
              <step.icon className="h-5 w-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">{step.title}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{step.desc}</p>
            {i < STEPS.length - 1 && (
              <div className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-gradient-to-r from-indigo-500/40 to-transparent lg:block" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string }) {
  return (
    <div className="max-w-2xl">
      <span className="text-xs font-semibold uppercase tracking-widest text-indigo-400">{eyebrow}</span>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{title}</h2>
      {desc && <p className="mt-3 text-[15px] leading-relaxed text-slate-400">{desc}</p>}
    </div>
  );
}
