import { SectionHeading } from "./HowItWorks";
import { CodeBlock } from "./CodeBlock";

const STEP_SCHEMA = `{
  "id": "uuid4",
  "action": "navigate | click | fill | select | check | uncheck |
             press | hover | dragdrop | upload | upload-click |
             wait | assert-text | assert-visible",
  "selector": "string | null",
  "selectorType": "testid | id | role | css | xpath | none",
  "cssEquivalent": "string",       // ready-to-use Playwright locator
  "role": "string | null",         // ARIA role, when selectorType == role
  "value": "string | boolean | null",
  "url": "string",
  "frameId": 0,                     // 0 = top frame, -1 = unknown subframe
  "timestamp": 1732200000000,         // epoch ms
  "screenshot": "data:image/jpeg;base64,... | null",
  "waitFor": { "type": "visible", "timeout": 5000 },
  "meta": { "...": "action-specific extras, e.g. drag target" }
}`;

const MESSAGES = [
  { type: "session.start", dir: "ext → server", payload: "{ token, sessionId, meta }" },
  { type: "auth.ok", dir: "server → ext", payload: "{ sessionId }" },
  { type: "auth.error", dir: "server → ext", payload: "{ reason } — socket closed after send" },
  { type: "step.recorded", dir: "ext → server", payload: "{ sessionId, step: <Step> }" },
  { type: "session.pause", dir: "ext → server", payload: "{ sessionId }" },
  { type: "session.resume", dir: "ext → server", payload: "{ sessionId }" },
  { type: "session.stop", dir: "ext → server", payload: "{ sessionId, summary }" },
  { type: "session.export", dir: "ext → server", payload: "{ sessionId, format, payload }" },
];

export function SchemaSection() {
  return (
    <section id="schema" className="mx-auto max-w-7xl px-6 py-20">
      <SectionHeading
        eyebrow="Shared contract"
        title="Step schema & WebSocket protocol"
        desc="The extension and desktop app never guess about each other's shape — everything is pinned down in docs/PROTOCOL.md."
      />

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <CodeBlock code={STEP_SCHEMA} language="jsonc" title="Step schema" />

        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0e14]">
          <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300">
            WebSocket message types
          </div>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-slate-500">
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Direction</th>
                <th className="px-4 py-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {MESSAGES.map((m, i) => (
                <tr key={m.type} className={i % 2 ? "bg-white/[0.02]" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-indigo-300">{m.type}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-400">{m.dir}</td>
                  <td className="px-4 py-2 text-slate-400">{m.payload}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-white/10 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
            The bridge server binds to <span className="text-slate-300">127.0.0.1 only</span> and requires a
            shared-secret <span className="text-slate-300">token</span> in the initial{" "}
            <span className="text-slate-300">session.start</span> handshake before accepting any traffic.
          </div>
        </div>
      </div>
    </section>
  );
}
