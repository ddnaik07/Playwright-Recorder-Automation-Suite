import { PlayCircle } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-[#0a0c12] py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <PlayCircle className="h-4 w-4 text-indigo-400" />
          Playwright Recorder &amp; Automation Suite
        </div>
        <p className="text-center text-xs text-slate-600 sm:text-right">
          Chrome extension (Manifest V3) + Python/PySide6 desktop app. See{" "}
          <span className="text-slate-400">README.md</span>, <span className="text-slate-400">extension/README.md</span> and{" "}
          <span className="text-slate-400">desktop-app/README.md</span> for full setup docs.
        </p>
      </div>
    </footer>
  );
}
