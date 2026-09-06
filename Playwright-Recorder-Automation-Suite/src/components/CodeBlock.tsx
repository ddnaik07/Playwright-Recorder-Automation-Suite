import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../utils/cn";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
}

export function CodeBlock({ code, language = "text", title, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/10 bg-[#0b0e14] shadow-lg shadow-black/20",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
          {title && <span className="ml-3 text-xs font-medium text-slate-400">{title}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{language}</span>
          <button
            onClick={onCopy}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 text-[12.5px] leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
