import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { NewInvoice } from "./NewInvoice";
import { History } from "./History";
import { Report } from "./Report";
import { Library } from "./Library";
import type { Settings } from "./lib";

type Tab = "new" | "history" | "report" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "new", label: "New Invoice" },
  { id: "history", label: "History" },
  { id: "report", label: "Daily Report" },
  { id: "library", label: "Library" },
];

const FALLBACK_SETTINGS: Settings = {
  businessName: "FARHADIO",
  tagline: "",
  phone: "",
  address: "",
  currency: "Rs",
  currencyCode: "PKR",
  language: "en",
  paymentLink: "",
};

export function App() {
  const [tab, setTab] = useState<Tab>("new");
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings({}),
  });
  const settings = settingsQuery.data ?? FALLBACK_SETTINGS;

  return (
    <div
      className="min-h-screen text-[var(--text)]"
      style={{ background: "var(--bg-gradient)", backgroundColor: "var(--bg)" }}
    >
      <div className="app-shell mx-auto max-w-6xl px-4 pb-16">
        <header className="pt-safe">
          <p className="pt-5 font-display text-2xl font-extrabold tracking-tight text-white">
            {settings.businessName.toUpperCase()}{" "}
            <span className="text-white/85 font-bold">AI</span>
          </p>
          <p className="text-sm text-white/85">
            {settings.tagline || "Create professional invoices — customize, send and get paid."}
          </p>
        </header>
        <nav aria-label="Sections" className="sticky top-0 z-20 -mx-4 px-4 pb-3">
          <div className="flex flex-wrap gap-1.5 pt-3">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-3.5 py-2.5 rounded-full font-display text-sm font-bold shadow ${
                  tab === t.id
                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "bg-white/90 text-[#24406e]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        <main className="pt-2">
          {tab === "new" && <NewInvoice settings={settings} />}
          {tab === "history" && <History settings={settings} />}
          {tab === "report" && <Report settings={settings} />}
          {tab === "library" && <Library settings={settings} />}
        </main>
      </div>
    </div>
  );
}
