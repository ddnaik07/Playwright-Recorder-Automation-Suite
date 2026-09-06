import { useEffect, useState } from "react";
import { Menu, X, PlayCircle } from "lucide-react";
import { cn } from "../utils/cn";

const LINKS = [
  { id: "overview", label: "Overview" },
  { id: "how-it-works", label: "How it works" },
  { id: "extension", label: "Chrome Extension" },
  { id: "desktop", label: "Desktop App" },
  { id: "schema", label: "Schema & Protocol" },
  { id: "get-started", label: "Get Started" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors",
        scrolled ? "border-white/10 bg-[#0a0c12]/90 backdrop-blur" : "border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <button onClick={() => scrollTo("top")} className="flex items-center gap-2 text-slate-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-900/40">
            <PlayCircle className="h-5 w-5 text-white" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Playwright Recorder Suite</span>
        </button>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              className="rounded-md px-3 py-2 text-[13px] font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            >
              {link.label}
            </button>
          ))}
        </nav>

        <button
          className="rounded-md p-2 text-slate-300 hover:bg-white/10 md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-white/10 bg-[#0a0c12] px-6 py-3 md:hidden">
          {LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => scrollTo(link.id)}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5"
            >
              {link.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
