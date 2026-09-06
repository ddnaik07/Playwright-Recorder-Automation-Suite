import { SectionHeading } from "./HowItWorks";
import { CodeBlock } from "./CodeBlock";

const EXT_STEPS = `chrome://extensions
→ enable "Developer mode"
→ "Load unpacked"
→ select the extension/ folder`;

const APP_STEPS = `cd desktop-app
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install
python main.py`;

export function GetStarted() {
  return (
    <section id="get-started" className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading eyebrow="Setup" title="Get started in two commands" />
      <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2">
        <CodeBlock code={EXT_STEPS} language="chrome" title="1. Load the extension" />
        <CodeBlock code={APP_STEPS} language="bash" title="2. Run the desktop app" />
      </div>
      <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-slate-500">
        Then, in the desktop app click <span className="text-slate-300">Start Bridge Server</span>, match the
        host/port/token in the extension's Settings panel and click <span className="text-slate-300">Connect</span>.
        Record on any tab, watch steps land live in a new script, edit as needed, and hit{" "}
        <span className="text-slate-300">Run All</span>. Prefer a file hand-off instead? Use{" "}
        <span className="text-slate-300">Download JSON / .py</span> in the popup and{" "}
        <span className="text-slate-300">Import Recording</span> in the desktop app — both paths are fully supported.
      </p>
    </section>
  );
}
