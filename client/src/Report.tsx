// Daily Report: everything sold on a chosen day as summary cards, an
// items table with each item's share of sales, top sellers, a 7-day
// revenue chart, plain-language sales insights, an AI day summary, and
// print / PDF / Excel export.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import {
  buildReportPdf,
  downloadFile,
  downloadText,
  fmtMoney,
  fmtQty,
  prettyDate,
  round2,
  shortDate,
  todayStr,
  type Settings,
} from "./lib";

export function Report({ settings }: { settings: Settings }) {
  const cur = settings.currency;
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const report = useQuery({
    queryKey: ["report", date],
    queryFn: () => api.dailyReport({ date }),
  });
  const r = report.data;

  const insights = useQuery({
    queryKey: ["insights", date],
    queryFn: () => api.salesInsights({ date }),
  });
  const ins = insights.data;

  const summaryMutation = useMutation({
    mutationFn: async () => await api.dailySummary({ date }),
    onSuccess: (data) => setSummary(data.summary),
    onError: (e) => setExportError(e instanceof Error ? e.message : String(e)),
  });

  const csvMutation = useMutation({
    mutationFn: async () => await api.exportReportCsv({ date }),
    onSuccess: (data) => downloadText(data.filename, data.csv, "text/csv"),
    onError: (e) => setExportError(e instanceof Error ? e.message : String(e)),
  });

  const chartData = (r?.last7Days ?? []).map((d) => ({
    date: shortDate(d.date),
    revenue: d.revenue,
  }));

  const itemsSold = r ? round2(r.items.reduce((a, it) => a + it.qty, 0)) : 0;
  const maxItemTotal = r ? Math.max(0, ...r.items.map((it) => it.total)) : 0;

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label
            htmlFor="report-date"
            className="block text-xs font-medium text-[var(--dim)] mb-1"
          >
            Report date
          </label>
          <input
            id="report-date"
            type="date"
            className="border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)]"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSummary(null);
            }}
          />
        </div>
        <p className="text-sm text-[var(--dim)] pb-2">{prettyDate(date)}</p>
      </div>

      {report.isPending && <p className="text-[var(--dim)] py-8 text-center">Loading report…</p>}
      {report.isError && (
        <p className="py-8 text-center" style={{ color: "var(--danger)" }}>
          Could not load the report for this date.
        </p>
      )}

      {r && (
        <>
          {/* Summary cards */}
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3.5">
              <p className="text-xs font-medium text-[var(--dim)]">Total invoices</p>
              <p className="font-display text-2xl font-extrabold tnum mt-0.5">{r.invoiceCount}</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3.5">
              <p className="text-xs font-medium text-[var(--dim)]">Total revenue</p>
              <p className="font-display text-2xl font-extrabold tnum mt-0.5 text-[#2f6bea]">
                {fmtMoney(r.revenue, cur)}
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3.5">
              <p className="text-xs font-medium text-[var(--dim)]">Items sold</p>
              <p className="font-display text-2xl font-extrabold tnum mt-0.5">{fmtQty(itemsSold)}</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3.5">
              <p className="text-xs font-medium text-[var(--dim)]">Unpaid / partial amount</p>
              <p
                className="font-display text-2xl font-extrabold tnum mt-0.5"
                style={{ color: "var(--danger)" }}
              >
                {fmtMoney(r.outstanding, cur)}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm border-y border-[var(--border)] py-4">
            <div>
              <dt className="text-[var(--dim)]">Collected (paid)</dt>
              <dd className="font-display text-lg font-bold tnum" style={{ color: "var(--accent)" }}>
                {fmtMoney(r.collected, cur)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dim)]">Discounts given</dt>
              <dd className="font-display text-lg font-bold tnum">{fmtMoney(r.discounts, cur)}</dd>
            </div>
            <div>
              <dt className="text-[var(--dim)]">Tax collected</dt>
              <dd className="font-display text-lg font-bold tnum">{fmtMoney(r.tax, cur)}</dd>
            </div>
            <div>
              <dt className="text-[var(--dim)]">Yesterday ({shortDate(r.previousDay.date)})</dt>
              <dd className="font-display text-lg font-bold tnum">
                {fmtMoney(r.previousDay.revenue, cur)}
                <span className="text-sm font-medium text-[var(--dim)]">
                  {" "}
                  · {r.previousDay.invoiceCount} inv
                </span>
              </dd>
            </div>
          </dl>

          {/* AI summary */}
          <div className="mt-5">
            {summary ? (
              <div className="rounded-2xl bg-[var(--surface-alt)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1">
                  Day summary
                </p>
                <p className="text-sm leading-relaxed">{summary}</p>
              </div>
            ) : (
              <button
                type="button"
                disabled={summaryMutation.isPending}
                className="px-4 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
                onClick={() => summaryMutation.mutate()}
              >
                {summaryMutation.isPending ? "Writing summary…" : "Write today's summary"}
              </button>
            )}
          </div>

          {/* Sales insights */}
          {ins?.hasData && (
            <div className="mt-5 rounded-2xl border border-[var(--border)] px-4 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1">
                Sales insights
              </p>
              {ins.insight ? (
                <p className="text-sm leading-relaxed">{ins.insight}</p>
              ) : (
                <p className="text-sm text-[var(--dim)]">Writing insights…</p>
              )}
              <div className="mt-3 grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-semibold mb-1">Best sellers (30 days)</p>
                  {ins.bestSellers.length === 0 ? (
                    <p className="text-[var(--dim)]">No sales in the last 30 days.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {ins.bestSellers.map((b) => (
                        <li key={b.name} className="flex justify-between gap-3">
                          <span>
                            {b.name} <span className="text-[var(--dim)]">× {fmtQty(b.qty)}</span>
                          </span>
                          <span className="tnum font-medium">{fmtMoney(b.revenue, cur)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-semibold mb-1">Slow items (not sold in 30+ days)</p>
                  {ins.slowItems.length === 0 ? (
                    <p className="text-[var(--dim)]">Nothing has gone slow — everything sold recently.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {ins.slowItems.map((s) => (
                        <li key={s.name} className="flex justify-between gap-3">
                          <span>{s.name}</span>
                          <span className="text-[var(--dim)]">last sold {shortDate(s.lastSold)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <p className="mt-3 text-sm">
                Still unpaid overall:{" "}
                <span className="font-semibold" style={{ color: "var(--danger)" }}>
                  {fmtMoney(ins.unpaidTotal, cur)}
                </span>{" "}
                across {ins.unpaidCount} invoice{ins.unpaidCount === 1 ? "" : "s"} · Today{" "}
                {fmtMoney(ins.todayRevenue, cur)} vs yesterday {fmtMoney(ins.yesterdayRevenue, cur)}
              </p>
            </div>
          )}

          {/* Items sold with share of sales */}
          <h2 className="font-display font-bold text-lg mt-7 mb-2">Items sold</h2>
          {r.items.length === 0 ? (
            <p className="text-[var(--dim)] text-sm">Nothing was sold on this date.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[430px]">
                <thead>
                  <tr className="border-y border-[var(--border)] text-left text-[var(--dim)]">
                    <th className="py-2 pr-2 font-medium">Item</th>
                    <th className="py-2 px-2 font-medium text-right">Qty</th>
                    <th className="py-2 px-2 font-medium text-right">Unit price</th>
                    <th className="py-2 px-2 font-medium text-right">Amount</th>
                    <th className="py-2 pl-2 font-medium text-right">Share of sales</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((it, i) => {
                    const share = r.revenue > 0 ? (it.total / r.revenue) * 100 : 0;
                    const barW = maxItemTotal > 0 ? (it.total / maxItemTotal) * 100 : 0;
                    return (
                      <tr key={i} className="border-b border-[var(--border)]">
                        <td className="py-2 pr-2">{it.name}</td>
                        <td className="py-2 px-2 text-right tnum">{fmtQty(it.qty)}</td>
                        <td className="py-2 px-2 text-right tnum">{fmtMoney(it.unitPrice, cur)}</td>
                        <td className="py-2 px-2 text-right tnum font-medium">
                          {fmtMoney(it.total, cur)}
                        </td>
                        <td className="py-2 pl-2">
                          <div className="flex items-center gap-2 justify-end">
                            <div
                              className="h-2 w-20 sm:w-28 rounded-full bg-[var(--surface-alt)] overflow-hidden"
                              role="img"
                              aria-label={`${it.name} made ${round2(share)} percent of the day's sales`}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${barW}%`, background: "var(--accent)" }}
                              />
                            </div>
                            <span className="tnum text-xs w-11 text-right">
                              {round2(share)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Top sellers + chart */}
          {r.topItems.length > 0 && (
            <>
              <h2 className="font-display font-bold text-lg mt-7 mb-2">Top sellers</h2>
              <ol className="space-y-1.5">
                {r.topItems.map((t, i) => (
                  <li key={t.name} className="flex justify-between text-sm gap-3">
                    <span>
                      <span className="text-[var(--dim)]">{i + 1}.</span> {t.name}
                      <span className="text-[var(--dim)]"> — {fmtQty(t.qty)} sold</span>
                    </span>
                    <span className="tnum font-medium">{fmtMoney(t.revenue, cur)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          <h2 className="font-display font-bold text-lg mt-7 mb-2">Revenue — last 7 days</h2>
          <div className="h-52 w-full" aria-label="Bar chart of revenue for the last 7 days">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "var(--dim)" }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--dim)" }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip
                  formatter={(value) => [fmtMoney(Number(value ?? 0), cur), "Revenue"]}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                  }}
                />
                <Bar dataKey="revenue" fill="#2f6bea" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Day's invoices */}
          {r.invoices.length > 0 && (
            <>
              <h2 className="font-display font-bold text-lg mt-7 mb-2">Invoices that day</h2>
              <ul className="divide-y divide-[var(--border)] text-sm">
                {r.invoices.map((inv) => (
                  <li key={inv.number} className="py-2.5 flex justify-between gap-3">
                    <span>
                      <span className="tnum text-[var(--dim)]">{inv.number}</span> {inv.customerName}
                    </span>
                    <span className="text-right">
                      <span className="tnum font-medium">{fmtMoney(inv.total, cur)}</span>{" "}
                      <span
                        className="text-xs font-semibold uppercase"
                        style={{
                          color:
                            inv.status === "paid"
                              ? "var(--accent)"
                              : inv.status === "partial"
                                ? "var(--amber)"
                                : "var(--danger)",
                        }}
                      >
                        {inv.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Export */}
          <div className="mt-7 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <button
              type="button"
              className="px-4 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm"
              onClick={() => window.print()}
            >
              Print report
            </button>
            <button
              type="button"
              className="px-4 py-2.5 rounded-full font-medium text-sm"
              style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
              onClick={() =>
                downloadFile(`farhadio-report-${date}.pdf`, buildReportPdf(r, settings, summary))
              }
            >
              Download PDF
            </button>
            <button
              type="button"
              className="px-4 py-2.5 rounded-full border border-[var(--border)] bg-[var(--surface)] font-medium text-sm"
              disabled={csvMutation.isPending}
              onClick={() => csvMutation.mutate()}
            >
              {csvMutation.isPending ? "Preparing…" : "Download Excel (CSV)"}
            </button>
          </div>
          {exportError && (
            <p className="mt-3 text-sm" style={{ color: "var(--danger)" }} role="alert">
              {exportError}
            </p>
          )}

          {createPortal(
            <div className="print-area">
              <div style={{ fontFamily: "sans-serif", color: "#000", padding: 24 }}>
                <h1 style={{ fontSize: 20 }}>
                  {settings.businessName} — Daily Report {prettyDate(r.date)}
                </h1>
                <p>
                  Invoices: {r.invoiceCount} · Revenue: {fmtMoney(r.revenue, cur)} · Items sold:{" "}
                  {fmtQty(itemsSold)} · Collected: {fmtMoney(r.collected, cur)} · Outstanding:{" "}
                  {fmtMoney(r.outstanding, cur)}
                </p>
                {summary && <p>{summary}</p>}
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #999" }}>Item</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #999" }}>Qty</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #999" }}>Unit price</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #999" }}>Amount</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #999" }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.name}</td>
                        <td style={{ textAlign: "right" }}>{fmtQty(it.qty)}</td>
                        <td style={{ textAlign: "right" }}>{fmtMoney(it.unitPrice, cur)}</td>
                        <td style={{ textAlign: "right" }}>{fmtMoney(it.total, cur)}</td>
                        <td style={{ textAlign: "right" }}>
                          {r.revenue > 0 ? round2((it.total / r.revenue) * 100) : 0}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
