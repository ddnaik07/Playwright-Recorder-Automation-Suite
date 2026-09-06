import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
import { ExtensionSection } from "./components/ExtensionSection";
import { DesktopSection } from "./components/DesktopSection";
import { SchemaSection } from "./components/SchemaSection";
import { GetStarted } from "./components/GetStarted";
import { DeliverablesSection } from "./components/DeliverablesSection";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0a0c12] text-slate-200 antialiased">
      <Navbar />
      <main>
        <Hero />
        <div id="overview" />
        <HowItWorks />
        <div className="mx-auto h-px max-w-7xl bg-white/5" />
        <ExtensionSection />
        <div className="mx-auto h-px max-w-7xl bg-white/5" />
        <DesktopSection />
        <div className="mx-auto h-px max-w-7xl bg-white/5" />
        <SchemaSection />
        <div className="mx-auto h-px max-w-7xl bg-white/5" />
        <DeliverablesSection />
        <div className="mx-auto h-px max-w-7xl bg-white/5" />
        <GetStarted />
      </main>
      <Footer />
    </div>
  );
}
