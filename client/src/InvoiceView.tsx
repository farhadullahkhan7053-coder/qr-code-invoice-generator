// The branded invoice sheet (on-screen preview, saved-invoice view and
// the printed copy) plus the detail view with the Pay > Share > Email >
// PDF action row, status changes, AI messages and delete.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api } from "./api";
import { QrCode } from "./Qr";
import {
  blobToDataUrl,
  buildInvoicePdf,
  downloadFile,
  fmtMoney,
  fmtQty,
  invoiceQrText,
  labelsFor,
  prettyDate,
  round2,
  type InvoiceDetail as InvoiceDetailData,
  type Settings,
} from "./lib";

const FIELDS = actionFields<typeof Actions>();

export function InvoiceSheet({
  inv,
  settings,
}: {
  inv: InvoiceDetailData;
  settings: Settings;
}) {
  const cur = settings.currency;
  const L = labelsFor(settings.language);
  const balance = round2(inv.total - inv.amountPaid);
  const statusText =
    inv.status === "paid" ? L.paid : inv.status === "partial" ? L.partiallyPaid : L.unpaid;
  return (
    <div className="bg-[var(--surface)] text-[var(--text)] p-5 sm:p-7 rounded-[var(--radius)] shadow-[var(--card-shadow)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-2xl font-extrabold tracking-tight text-[#2f6bea]">
            {settings.businessName.toUpperCase()}
          </p>
          {settings.tagline && <p className="text-sm text-[var(--dim)]">{settings.tagline}</p>}
          {(settings.phone || settings.address) && (
            <p className="text-xs text-[var(--dim)] mt-0.5">
              {[settings.phone, settings.address].filter(Boolean).join("  ·  ")}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold">{L.invoice}</p>
          <p className="tnum text-sm text-[var(--dim)]">{inv.number}</p>
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--dim)]">{L.billTo}</p>
          <p className="font-semibold mt-0.5">{inv.customerName || "—"}</p>
          {inv.customerPhone && <p className="text-sm text-[var(--dim)]">{inv.customerPhone}</p>}
          {inv.customerAddress && (
            <p className="text-sm text-[var(--dim)] whitespace-pre-line">{inv.customerAddress}</p>
          )}
        </div>
        <div className="text-right text-sm">
          <p>
            {L.date}: {prettyDate(inv.date)}
          </p>
          <p
            className="font-semibold mt-1"
            style={{
              color:
                inv.status === "paid"
                  ? "var(--accent)"
                  : inv.status === "partial"
                    ? "var(--amber)"
                    : "var(--danger)",
            }}
          >
            {statusText}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full mt-5 text-sm min-w-[290px]">
          <thead>
            <tr className="border-y border-[var(--border)] text-left text-[var(--dim)]">
              <th className="py-2 pr-2 font-medium">{L.item}</th>
              <th className="py-2 px-2 font-medium text-right">{L.qty}</th>
              <th className="py-2 px-2 font-medium text-right">{L.price}</th>
              <th className="py-2 pl-2 font-medium text-right">{L.amount}</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="py-2 pr-2">
                  {it.name}
                  {it.discountPercent > 0 && (
                    <span className="text-[var(--dim)]"> (−{fmtQty(it.discountPercent)}%)</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right tnum">{fmtQty(it.qty)}</td>
                <td className="py-2 px-2 text-right tnum">{fmtMoney(it.price, cur)}</td>
                <td className="py-2 pl-2 text-right tnum">{fmtMoney(it.lineTotal, cur)}</td>
              </tr>
            ))}
            {inv.items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-[var(--dim)]">
                  No items yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <QrCode text={invoiceQrText(inv, settings)} size={92} />
          <p className="text-xs text-[var(--dim)] max-w-[130px]">
            {L.scanToVerify}
            <span className="block tnum mt-0.5">
              {inv.number} · {fmtMoney(inv.total, cur)}
            </span>
          </p>
        </div>
        <div className="w-56 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-[var(--dim)]">{L.subtotal}</span>
            <span className="tnum">{fmtMoney(inv.subtotal, cur)}</span>
          </div>
          {inv.discountTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--dim)]">{L.discounts}</span>
              <span className="tnum">−{fmtMoney(inv.discountTotal, cur)}</span>
            </div>
          )}
          {inv.taxPercent > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--dim)]">
                {L.tax} ({fmtQty(inv.taxPercent)}%)
              </span>
              <span className="tnum">{fmtMoney(inv.taxAmount, cur)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--border)] pt-2 font-display text-base font-bold">
            <span>{L.total}</span>
            <span className="tnum">{fmtMoney(inv.total, cur)}</span>
          </div>
          {inv.status !== "paid" && (
            <>
              <div className="flex justify-between">
                <span className="text-[var(--dim)]">{L.paidSoFar}</span>
                <span className="tnum">{fmtMoney(inv.amountPaid, cur)}</span>
              </div>
              <div className="flex justify-between font-semibold" style={{ color: "var(--danger)" }}>
                <span>{L.balanceDue}</span>
                <span className="tnum">{fmtMoney(balance, cur)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {inv.notes && (
        <p className="mt-5 text-sm text-[var(--dim)] whitespace-pre-line">{inv.notes}</p>
      )}
      <p className="mt-6 text-center text-xs text-[var(--dim)]">
        {L.thanks} — {settings.businessName}
      </p>
    </div>
  );
}

export function InvoiceDetail({
  id,
  settings,
  onBack,
}: {
  id: number;
  settings: Settings;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const invQuery = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.getInvoice({ id }),
  });
  const inv = invQuery.data?.invoice ?? null;
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");

  const statusMutation = useMutation({
    mutationFn: async (args: { status: "paid" | "unpaid" | "partial"; amountPaid: number }) =>
      await api.updateInvoiceStatus({ id, status: args.status, amountPaid: args.amountPaid }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoice", id] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e) => setNotice(`Could not update: ${e instanceof Error ? e.message : String(e)}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => await api.deleteInvoice({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      onBack();
    },
    onError: (e) => setNotice(`Could not delete: ${e instanceof Error ? e.message : String(e)}`),
  });

  const messageMutation = useMutation({
    mutationFn: async (kind: "thanks" | "reminder") =>
      await api.writeMessage({ invoiceId: id, kind }),
    onSuccess: (data) => {
      setMessage(data.message);
      setCopied(false);
    },
    onError: (e) =>
      setNotice(`Could not write the message: ${e instanceof Error ? e.message : String(e)}`),
  });

  if (invQuery.isPending)
    return <p className="py-10 text-center text-white/90">Loading invoice…</p>;
  if (!inv) return <p className="py-10 text-center text-white/90">Invoice not found.</p>;

  const balance = round2(inv.total - inv.amountPaid);
  const pdfBlob = () => buildInvoicePdf(inv, settings);
  const summaryText =
    `${settings.businessName} — Invoice ${inv.number} (${inv.date})\n` +
    `Customer: ${inv.customerName}\n` +
    inv.items.map((it) => `${fmtQty(it.qty)} × ${it.name} — ${fmtMoney(it.lineTotal, settings.currency)}`).join("\n") +
    `\nTotal: ${fmtMoney(inv.total, settings.currency)}` +
    (balance > 0 ? `\nBalance due: ${fmtMoney(balance, settings.currency)}` : "\nPaid in full.");

  const shareInvoice = async () => {
    setNotice(null);
    try {
      const file = new File([pdfBlob()], `farhadio-${inv.number}.pdf`, {
        type: "application/pdf",
      });
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Invoice ${inv.number}` });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: `Invoice ${inv.number}`, text: summaryText });
        return;
      }
      await navigator.clipboard?.writeText(summaryText);
      setNotice("Sharing isn't available here, so the invoice summary was copied — paste it anywhere to send it.");
    } catch {
      /* user closed the share sheet */
    }
  };

  const emailInvoice = async () => {
    setNotice(null);
    try {
      const dataUrl = await blobToDataUrl(pdfBlob());
      const subject = encodeURIComponent(`Invoice ${inv.number} from ${settings.businessName}`);
      const body = encodeURIComponent(
        `${summaryText}\n\nPDF copy (open this link in a browser to download the invoice file):\n${dataUrl.slice(0, 1800)}…`,
      );
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      setNotice("Your email app opened with the invoice details. The PDF button below saves the full invoice file to attach.");
    } catch {
      window.location.href = `mailto:?subject=${encodeURIComponent(`Invoice ${inv.number} from ${settings.businessName}`)}&body=${encodeURIComponent(summaryText)}`;
    }
  };

  const actionBtn =
    "flex-1 min-w-[70px] px-3 py-3 rounded-2xl font-display font-bold text-sm flex flex-col items-center gap-1";

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-sm font-semibold text-white min-h-9 px-2 -ml-2"
      >
        ← Back
      </button>

      <InvoiceSheet inv={inv} settings={settings} />

      {/* Action row: Pay > Share > Email > PDF */}
      <div className="mt-4 flex gap-2" role="group" aria-label="Invoice actions">
        {settings.paymentLink ? (
          <a
            href={settings.paymentLink}
            target="_blank"
            rel="noreferrer"
            className={actionBtn}
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            <span aria-hidden="true" className="text-base leading-none">$</span> Pay
          </a>
        ) : (
          <button
            type="button"
            className={actionBtn}
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            onClick={() =>
              setNotice(
                balance > 0
                  ? `No payment link is set yet. Ask ${inv.customerName} to pay ${fmtMoney(balance, settings.currency)}, or add your JazzCash / Easypaisa / bank payment link in Library → Business details so this button and the QR code carry it.`
                  : "This invoice is fully paid — nothing to collect.",
              )
            }
          >
            <span aria-hidden="true" className="text-base leading-none">$</span> Pay
          </button>
        )}
        <button
          type="button"
          className={actionBtn}
          style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
          onClick={() => void shareInvoice()}
        >
          <span aria-hidden="true">↗</span> Share
        </button>
        <button
          type="button"
          className={actionBtn}
          style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
          onClick={() => void emailInvoice()}
        >
          <span aria-hidden="true">✉</span> Email
        </button>
        <button
          type="button"
          className={actionBtn}
          style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
          onClick={() => downloadFile(`farhadio-${inv.number}.pdf`, pdfBlob())}
        >
          <span aria-hidden="true">⬇</span> PDF
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="px-4 py-2 rounded-full text-sm font-semibold bg-[var(--surface)] text-[var(--text)] shadow"
          onClick={() => window.print()}
        >
          Print invoice
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-full border border-white/50 text-white font-medium text-sm"
          disabled={messageMutation.isPending}
          onClick={() => messageMutation.mutate("thanks")}
        >
          {messageMutation.isPending ? "Writing…" : "Thank-you message"}
        </button>
        {balance > 0 && (
          <button
            type="button"
            className="px-4 py-2 rounded-full border border-white/50 text-white font-medium text-sm"
            disabled={messageMutation.isPending}
            onClick={() => messageMutation.mutate("reminder")}
          >
            Payment reminder
          </button>
        )}
      </div>

      {notice && (
        <p className="mt-3 text-sm text-white bg-white/15 rounded-xl px-3 py-2.5" role="status">
          {notice}
        </p>
      )}

      <div className="mt-5 space-y-4 card p-4">
        {message && (
          <div className="border border-[var(--border)] rounded-xl bg-[var(--surface-alt)] p-4">
            <p className="text-sm whitespace-pre-line">{message}</p>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-[#1d4fa1] min-h-9 px-2 -ml-2"
              onClick={() => {
                void navigator.clipboard?.writeText(message).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied ✓" : "Copy message"}
            </button>
          </div>
        )}

        <div>
          <p className="text-sm font-semibold mb-2">Payment status</p>
          <div className="flex flex-wrap gap-2">
            {(["paid", "partial", "unpaid"] as const).map((st) => (
              <button
                key={st}
                type="button"
                disabled={statusMutation.isPending}
                className={`px-4 py-2 rounded-full text-sm font-medium border ${
                  inv.status === st
                    ? "bg-[var(--accent)] text-[var(--accent-ink)] border-transparent"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
                onClick={() => {
                  if (st === "partial") {
                    const amt = Number(partialAmount);
                    if (!(amt > 0)) {
                      setNotice("Type the amount paid so far below, then tap Partial.");
                      return;
                    }
                    statusMutation.mutate({ status: st, amountPaid: amt });
                  } else {
                    statusMutation.mutate({ status: st, amountPaid: 0 });
                  }
                }}
              >
                {st === "paid" ? "Paid" : st === "partial" ? "Partial" : "Unpaid"}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <label htmlFor="partial-amount" className="text-sm text-[var(--dim)]">
              Amount paid so far ({settings.currency})
            </label>
            <input
              id="partial-amount"
              {...FIELDS.updateInvoiceStatus.amountPaid}
              type="number"
              inputMode="decimal"
              className="w-32 border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] tnum"
              value={partialAmount}
              placeholder={String(inv.amountPaid || "")}
              onChange={(e) => setPartialAmount(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          {!confirmDelete ? (
            <button
              type="button"
              className="text-sm font-medium min-h-9 px-2 -ml-2"
              style={{ color: "var(--danger)" }}
              onClick={() => setConfirmDelete(true)}
            >
              Delete this invoice
            </button>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm">Delete {inv.number} for good?</span>
              <button
                type="button"
                className="px-4 py-2 rounded-full text-sm font-semibold text-white"
                style={{ background: "var(--danger)" }}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                Yes, delete
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-full border border-[var(--border)] text-sm bg-[var(--surface)]"
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
            </div>
          )}
        </div>
      </div>

      {createPortal(
        <div className="print-area">
          <InvoiceSheet inv={inv} settings={settings} />
        </div>,
        document.body,
      )}
    </div>
  );
}
