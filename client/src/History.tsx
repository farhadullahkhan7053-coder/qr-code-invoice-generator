// Invoice history: search + filters by text, date range and status,
// a Scan QR button (camera or manual number) that opens the scanned
// invoice, and an Open button on every row.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api } from "./api";
import { InvoiceDetail } from "./InvoiceView";
import { QrScanner, invoiceNumberFromScan } from "./Qr";
import { fmtMoney, labelsFor, prettyDate, type Settings } from "./lib";

const FIELDS = actionFields<typeof Actions>();

const inputCls =
  "w-full border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]";
const labelCls = "block text-xs font-medium text-[var(--dim)] mb-1";

const statusStyle = (status: string): React.CSSProperties => ({
  color:
    status === "paid"
      ? "var(--accent)"
      : status === "partial"
        ? "var(--amber)"
        : "var(--danger)",
});

export function History({ settings }: { settings: Settings }) {
  const L = labelsFor(settings.language);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState<"all" | "paid" | "unpaid" | "partial">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["invoices", { search, dateFrom, dateTo, status }],
    queryFn: () => api.listInvoices({ search, dateFrom, dateTo, status, limit: 100 }),
  });

  const findMutation = useMutation({
    mutationFn: async (number: string) => await api.findInvoiceByNumber({ number }),
    onSuccess: (data) => {
      if (data.invoice) {
        setScanError(null);
        setSelectedId(data.invoice.id);
      } else {
        setScanError("No saved invoice matches that code. Check the number and try again.");
      }
    },
    onError: (e) => setScanError(e instanceof Error ? e.message : String(e)),
  });

  const onScan = (text: string) => {
    setScanning(false);
    const number = invoiceNumberFromScan(text);
    if (!number) {
      setScanError("That code didn't contain an invoice number.");
      return;
    }
    findMutation.mutate(number);
  };

  if (selectedId != null) {
    return (
      <InvoiceDetail id={selectedId} settings={settings} onBack={() => setSelectedId(null)} />
    );
  }

  const invoices = list.data?.invoices ?? [];

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display font-extrabold text-lg">Invoice history</h2>
        <button
          type="button"
          className="px-4 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-display font-bold text-sm shadow"
          onClick={() => {
            setScanError(null);
            setScanning(true);
          }}
        >
          Scan QR
        </button>
      </div>
      {scanError && (
        <p className="mt-3 text-sm rounded-xl bg-[var(--surface-alt)] px-3 py-2.5" role="alert" style={{ color: "var(--danger)" }}>
          {scanError}
        </p>
      )}
      {findMutation.isPending && (
        <p className="mt-3 text-sm text-[var(--dim)]">Looking up the scanned invoice…</p>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="col-span-2">
          <label htmlFor="hist-search" className={labelCls}>
            Search
          </label>
          <input
            id="hist-search"
            {...FIELDS.listInvoices.search}
            className={inputCls}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Customer name or invoice number"
          />
        </div>
        <div>
          <label htmlFor="hist-from" className={labelCls}>
            From date
          </label>
          <input
            id="hist-from"
            type="date"
            className={inputCls}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="hist-to" className={labelCls}>
            To date
          </label>
          <input
            id="hist-to"
            type="date"
            className={inputCls}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label htmlFor="hist-status" className={labelCls}>
            Payment status
          </label>
          <select
            id="hist-status"
            className={inputCls}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">All invoices</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        {list.isPending && <p className="text-[var(--dim)] py-6 text-center">Loading…</p>}
        {list.isError && (
          <p className="py-6 text-center" style={{ color: "var(--danger)" }}>
            Could not load invoices. Reopen the app to try again.
          </p>
        )}
        {!list.isPending && invoices.length === 0 && (
          <p className="text-[var(--dim)] py-8 text-center">
            No invoices match. Create your first one from the New Invoice tab.
          </p>
        )}
        <ul className="divide-y divide-[var(--border)]">
          {invoices.map((inv) => (
            <li key={inv.id} className="py-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{inv.customerName}</p>
                <p className="text-sm text-[var(--dim)]">
                  {inv.number} · {prettyDate(inv.date)} · {inv.itemCount}{" "}
                  item{inv.itemCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="tnum font-display font-bold">
                  {fmtMoney(inv.total, settings.currency)}
                </p>
                <p className="text-xs font-semibold uppercase" style={statusStyle(inv.status)}>
                  {inv.status === "paid"
                    ? L.paid
                    : inv.status === "partial"
                      ? L.partiallyPaid
                      : L.unpaid}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 px-4 py-2 rounded-full text-sm font-bold"
                style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
                onClick={() => setSelectedId(inv.id)}
                aria-label={`Open invoice ${inv.number} for ${inv.customerName}`}
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      </div>

      {scanning && (
        <QrScanner title="Scan an invoice QR code" onResult={onScan} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
