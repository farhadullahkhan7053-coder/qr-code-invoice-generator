// The New Invoice screen: "Customize invoice" form on the left with
// auto-suggest, natural-language entry, bill-photo AI and product-code
// scanning — and a live invoice preview on the right that updates as
// you type, exactly like the reference layout.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import { fileToBase64 } from "@hatch/space-sdk/client";
import type { Actions } from "../../server/src/actions";
import { api } from "./api";
import { InvoiceDetail, InvoiceSheet } from "./InvoiceView";
import { QrScanner } from "./Qr";
import {
  CURRENCIES,
  LANGUAGES,
  fmtMoney,
  round2,
  todayStr,
  type CatalogCustomer,
  type CatalogProduct,
  type InvoiceDetail as InvoiceDetailData,
  type LanguageCode,
  type Settings,
} from "./lib";

const FIELDS = actionFields<typeof Actions>();

type DraftLine = {
  name: string;
  qty: string;
  price: string;
  discountPercent: string;
};

const emptyLine = (): DraftLine => ({ name: "", qty: "1", price: "", discountPercent: "" });

const inputCls =
  "w-full border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]";
const labelCls = "block text-xs font-medium text-[var(--dim)] mb-1";

export function NewInvoice({ settings }: { settings: Settings }) {
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api.getCatalog({}) });
  const customers = useMemo(() => catalog.data?.customers ?? [], [catalog.data]);
  const products = useMemo(() => catalog.data?.products ?? [], [catalog.data]);

  const [date, setDate] = useState(todayStr());
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [taxPercent, setTaxPercent] = useState("");
  const [status, setStatus] = useState<"paid" | "unpaid" | "partial">("paid");
  const [amountPaid, setAmountPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [nlText, setNlText] = useState("");
  const [suggestFor, setSuggestFor] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ errors: string[]; warnings: string[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [scanProduct, setScanProduct] = useState(false);
  const photoRef = useRef<HTMLInputElement | null>(null);

  // Currency + language for this invoice; they start from the saved
  // defaults and become the new defaults when the invoice is saved.
  type CurrencyCode = "PKR" | "USD" | "EUR" | "AED" | "GBP" | "SAR";
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>(
    (settings.currencyCode as CurrencyCode) || "PKR",
  );
  const [language, setLanguage] = useState<LanguageCode>(
    (settings.language as LanguageCode) || "en",
  );
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!touchedRef.current) {
      setCurrencyCode((settings.currencyCode as CurrencyCode) || "PKR");
      setLanguage((settings.language as LanguageCode) || "en");
    }
  }, [settings.currencyCode, settings.language]);

  const symbol = CURRENCIES.find((c) => c.code === currencyCode)?.symbol ?? currencyCode;
  const previewSettings: Settings = {
    ...settings,
    currency: symbol,
    currencyCode,
    language,
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    for (const l of lines) {
      const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
      subtotal += gross;
      discountTotal += (gross * (Number(l.discountPercent) || 0)) / 100;
    }
    const tax = ((subtotal - discountTotal) * (Number(taxPercent) || 0)) / 100;
    return {
      subtotal: round2(subtotal),
      discountTotal: round2(discountTotal),
      taxAmount: round2(tax),
      total: round2(subtotal - discountTotal + tax),
    };
  }, [lines, taxPercent]);

  const lineTotal = (l: DraftLine) => {
    const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
    return round2(gross - (gross * (Number(l.discountPercent) || 0)) / 100);
  };

  const previewInvoice: InvoiceDetailData = useMemo(
    () => ({
      id: 0,
      number: "INV-####",
      date,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerAddress: customerAddress.trim(),
      status,
      amountPaid: status === "paid" ? totals.total : Number(amountPaid) || 0,
      taxPercent: Number(taxPercent) || 0,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      notes: notes.trim(),
      itemCount: lines.filter((l) => l.name.trim()).length,
      items: lines
        .filter((l) => l.name.trim() !== "")
        .map((l) => ({
          name: l.name.trim(),
          qty: Number(l.qty) || 0,
          price: Number(l.price) || 0,
          discountPercent: Number(l.discountPercent) || 0,
          lineTotal: lineTotal(l),
        })),
    }),
    [date, customerName, customerPhone, customerAddress, status, amountPaid, taxPercent, totals, notes, lines],
  );

  const updateLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickCustomer = (c: CatalogCustomer) => {
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    setCustomerAddress(c.address);
    setSuggestFor(null);
  };

  const pickProduct = (i: number, p: CatalogProduct) => {
    updateLine(i, { name: p.name, price: String(p.price) });
    setSuggestFor(null);
  };

  const usualPrice = (name: string): CatalogProduct | undefined =>
    products.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

  const appendLines = (newLines: { name: string; qty: number; price: number }[]) => {
    setLines((prev) => {
      const kept = prev.filter((l) => l.name.trim() !== "");
      const added = newLines.map((l) => ({
        name: l.name,
        qty: String(l.qty),
        price: l.price ? String(l.price) : "",
        discountPercent: "",
      }));
      return [...kept, ...added];
    });
  };

  const parseMutation = useMutation({
    mutationFn: async (text: string) => await api.parseOrderText({ text }),
    onSuccess: (data) => {
      if (data.lines.length === 0) {
        setFormError("No items could be read from that text. Try something like “2 shirts 1500, 3 caps 400”.");
        return;
      }
      setFormError(null);
      appendLines(data.lines);
      setNlText("");
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const img = await fileToBase64(file);
      return await api.extractBillPhoto({ image: img });
    },
    onSuccess: (data) => {
      if (data.lines.length === 0) {
        setFormError("No items could be read from that photo. Try a clearer, closer photo of the bill.");
        return;
      }
      setFormError(null);
      appendLines(data.lines);
      setNotice(`Read ${data.lines.length} item(s) from the bill photo — check the names, quantities and prices before saving.`);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const onProductScan = (text: string) => {
    setScanProduct(false);
    const code = text.trim();
    const match =
      products.find((p) => p.name.trim().toLowerCase() === code.toLowerCase()) ??
      products.find((p) => code.toLowerCase().includes(p.name.trim().toLowerCase()));
    if (match) {
      appendLines([{ name: match.name, qty: 1, price: match.price }]);
      setNotice(`Added ${match.name} from the scanned code.`);
    } else {
      appendLines([{ name: code.slice(0, 120), qty: 1, price: 0 }]);
      setNotice("That code isn't a saved product yet — it was added as a new item, so set its price.");
    }
  };

  const buildPayload = (force: boolean) => ({
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerAddress: customerAddress.trim(),
    date,
    items: lines
      .filter((l) => l.name.trim() !== "" || Number(l.qty) > 0 || Number(l.price) > 0)
      .map((l) => ({
        name: l.name.trim(),
        qty: Number(l.qty) || 0,
        price: Number(l.price) || 0,
        discountPercent: Number(l.discountPercent) || 0,
      })),
    taxPercent: Number(taxPercent) || 0,
    status,
    amountPaid: Number(amountPaid) || 0,
    notes: notes.trim(),
    force,
  });

  const saveMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (currencyCode !== settings.currencyCode || language !== settings.language) {
        await api.updateSettings({
          businessName: settings.businessName,
          tagline: settings.tagline,
          phone: settings.phone,
          address: settings.address,
          currency: settings.currency,
          currencyCode,
          language,
          paymentLink: settings.paymentLink,
        });
      }
      return await api.createInvoice(buildPayload(force));
    },
    onSuccess: (data) => {
      if (data.saved && data.invoice) {
        setIssues(null);
        setSavedId(data.invoice.id);
      } else {
        setIssues({ errors: data.errors, warnings: data.warnings });
      }
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const resetForm = () => {
    setSavedId(null);
    setDate(todayStr());
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setLines([emptyLine()]);
    setTaxPercent("");
    setStatus("paid");
    setAmountPaid("");
    setNotes("");
    setIssues(null);
    setFormError(null);
    setNotice(null);
  };

  if (savedId != null) {
    return (
      <div>
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold bg-white text-[#1d7a6e] shadow">
          Invoice saved. Pay, share, email or download the PDF below.
        </div>
        <InvoiceDetail id={savedId} settings={previewSettings} onBack={resetForm} />
        <button
          type="button"
          onClick={resetForm}
          className="mt-5 w-full py-3 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-display font-bold shadow"
        >
          + New invoice
        </button>
      </div>
    );
  }

  const customerMatches =
    suggestFor === "customer" && customerName.trim()
      ? customers
          .filter((c) => c.name.toLowerCase().includes(customerName.trim().toLowerCase()))
          .slice(0, 6)
      : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] items-start">
      {/* ------------------------- Customize invoice (form) ------------------------- */}
      <div className="card p-4 sm:p-5">
        <h2 className="font-display font-extrabold text-lg">Customize invoice</h2>

        {/* Quick add */}
        <section className="mt-4 rounded-2xl bg-[var(--surface-alt)] p-3.5">
          <label htmlFor="nl-text" className="font-display font-bold text-base">
            Quick add — just type the order
          </label>
          <p className="text-sm text-[var(--dim)] mt-0.5">
            e.g. “2 shirts 1500, 3 caps 400” — prices in the text win; missing prices fill in
            from your past sales.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              id="nl-text"
              {...FIELDS.parseOrderText.text}
              className={inputCls}
              placeholder="2 shirts 1500, 3 caps 400…"
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              aria-label="Order in plain words"
            />
            <button
              type="button"
              disabled={parseMutation.isPending || !nlText.trim()}
              className="shrink-0 px-4 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
              onClick={() => parseMutation.mutate(nlText.trim())}
            >
              {parseMutation.isPending ? "Reading…" : "Add items"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              aria-label="Photo of a handwritten bill"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) photoMutation.mutate(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={photoMutation.isPending}
              className="px-3.5 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
              onClick={() => photoRef.current?.click()}
            >
              {photoMutation.isPending ? "Reading photo…" : "📷 Scan a bill photo"}
            </button>
            <button
              type="button"
              className="px-3.5 py-2 rounded-full text-sm font-semibold"
              style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
              onClick={() => setScanProduct(true)}
            >
              Scan product code
            </button>
          </div>
          {notice && (
            <p className="mt-2.5 text-sm font-medium text-[#1d7a6e]" role="status">
              {notice}
            </p>
          )}
        </section>

        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            if (!customerName.trim()) {
              setFormError("Customer name is required.");
              return;
            }
            saveMutation.mutate(false);
          }}
        >
          {/* Customer */}
          <section>
            <h3 className="font-display font-bold text-base mb-2">Customer</h3>
            <div className="relative">
              <label htmlFor="cust-name" className={labelCls}>
                Name *
              </label>
              <input
                id="cust-name"
                {...FIELDS.createInvoice.customerName}
                className={inputCls}
                value={customerName}
                autoComplete="off"
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSuggestFor("customer");
                }}
                onFocus={() => setSuggestFor("customer")}
                onBlur={() => setTimeout(() => setSuggestFor(null), 150)}
                placeholder="Customer name"
              />
              {customerMatches.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 border border-[var(--border)] rounded-lg bg-[var(--surface)] shadow-lg overflow-hidden">
                  {customerMatches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-alt)]"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickCustomer(c);
                        }}
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.phone && <span className="text-sm text-[var(--dim)]"> · {c.phone}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label htmlFor="cust-phone" className={labelCls}>
                  Phone
                </label>
                <input
                  id="cust-phone"
                  {...FIELDS.createInvoice.customerPhone}
                  className={inputCls}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="03xx xxxxxxx"
                  inputMode="tel"
                />
              </div>
              <div>
                <label htmlFor="inv-date" className={labelCls}>
                  Date
                </label>
                <input
                  id="inv-date"
                  type="date"
                  className={inputCls}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="cust-address" className={labelCls}>
                Address
              </label>
              <input
                id="cust-address"
                {...FIELDS.createInvoice.customerAddress}
                className={inputCls}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Street, area, city"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label htmlFor="inv-currency" className={labelCls}>
                  Currency
                </label>
                <select
                  id="inv-currency"
                  className={inputCls}
                  value={currencyCode}
                  onChange={(e) => {
                    touchedRef.current = true;
                    setCurrencyCode(e.target.value as CurrencyCode);
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="inv-language" className={labelCls}>
                  Invoice language
                </label>
                <select
                  id="inv-language"
                  className={inputCls}
                  value={language}
                  onChange={(e) => {
                    touchedRef.current = true;
                    setLanguage(e.target.value as LanguageCode);
                  }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Items */}
          <section className="mt-6">
            <h3 className="font-display font-bold text-base mb-2">Items</h3>
            <div className="space-y-3">
              {lines.map((line, i) => {
                const matches =
                  suggestFor === `item-${i}` && line.name.trim()
                    ? products
                        .filter((p) => p.name.toLowerCase().includes(line.name.trim().toLowerCase()))
                        .slice(0, 6)
                    : [];
                const usual = line.name.trim() ? usualPrice(line.name) : undefined;
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="relative">
                      <label htmlFor={`item-name-${i}`} className={labelCls}>
                        Item {i + 1}
                      </label>
                      <input
                        id={`item-name-${i}`}
                        className={inputCls}
                        value={line.name}
                        autoComplete="off"
                        onChange={(e) => {
                          updateLine(i, { name: e.target.value });
                          setSuggestFor(`item-${i}`);
                        }}
                        onFocus={() => setSuggestFor(`item-${i}`)}
                        onBlur={() => {
                          setTimeout(() => setSuggestFor(null), 150);
                          const u = usualPrice(line.name);
                          if (u && !line.price) updateLine(i, { price: String(u.price) });
                        }}
                        placeholder="Item name"
                      />
                      {matches.length > 0 && (
                        <ul className="absolute z-10 left-0 right-0 mt-1 border border-[var(--border)] rounded-lg bg-[var(--surface)] shadow-lg overflow-hidden">
                          {matches.map((p) => (
                            <li key={p.name}>
                              <button
                                type="button"
                                className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-alt)] flex justify-between gap-2"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  pickProduct(i, p);
                                }}
                              >
                                <span className="font-medium">{p.name}</span>
                                <span className="tnum text-sm text-[var(--dim)]">
                                  {fmtMoney(p.price, symbol)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {usual && Number(line.price) !== usual.price && (
                      <p className="text-xs mt-1.5" style={{ color: "var(--amber)" }}>
                        Usual price: {fmtMoney(usual.price, symbol)}
                        <button
                          type="button"
                          className="ml-2 underline font-medium min-h-8 px-1"
                          onClick={() => updateLine(i, { price: String(usual.price) })}
                        >
                          Use it
                        </button>
                      </p>
                    )}
                    <div className="grid grid-cols-4 gap-2 mt-2">
                      <div>
                        <label htmlFor={`item-qty-${i}`} className={labelCls}>
                          Qty
                        </label>
                        <input
                          id={`item-qty-${i}`}
                          {...FIELDS.createInvoice.items.qty}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className={`${inputCls} tnum`}
                          value={line.qty}
                          onChange={(e) => updateLine(i, { qty: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`item-price-${i}`} className={labelCls}>
                          Price ({symbol})
                        </label>
                        <input
                          id={`item-price-${i}`}
                          {...FIELDS.createInvoice.items.price}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className={`${inputCls} tnum`}
                          value={line.price}
                          onChange={(e) => updateLine(i, { price: e.target.value })}
                        />
                      </div>
                      <div>
                        <label htmlFor={`item-disc-${i}`} className={labelCls}>
                          Disc %
                        </label>
                        <input
                          id={`item-disc-${i}`}
                          {...FIELDS.createInvoice.items.discountPercent}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          className={`${inputCls} tnum`}
                          value={line.discountPercent}
                          onChange={(e) => updateLine(i, { discountPercent: e.target.value })}
                        />
                      </div>
                      <div>
                        <span className={labelCls}>Total</span>
                        <p className="tnum font-semibold py-2">{fmtMoney(lineTotal(line), symbol)}</p>
                      </div>
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="mt-1 text-sm min-h-9 px-2 -ml-2"
                        style={{ color: "var(--danger)" }}
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        Remove item
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="mt-3 px-4 py-2 rounded-full text-sm font-semibold"
              style={{ background: "var(--secondary)", color: "var(--secondary-ink)" }}
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              + Add another item
            </button>
          </section>

          {/* Tax, status, notes */}
          <section className="mt-6 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="tax-percent" className={labelCls}>
                Tax %
              </label>
              <input
                id="tax-percent"
                {...FIELDS.createInvoice.taxPercent}
                type="number"
                inputMode="decimal"
                step="any"
                className={`${inputCls} tnum`}
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="pay-status" className={labelCls}>
                Payment status
              </label>
              <select
                id="pay-status"
                className={inputCls}
                value={status}
                onChange={(e) => setStatus(e.target.value as "paid" | "unpaid" | "partial")}
              >
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
              </select>
            </div>
            {status === "partial" && (
              <div className="col-span-2">
                <label htmlFor="amount-paid" className={labelCls}>
                  Amount paid so far ({symbol})
                </label>
                <input
                  id="amount-paid"
                  {...FIELDS.createInvoice.amountPaid}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className={`${inputCls} tnum`}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="0"
                />
              </div>
            )}
            <div className="col-span-2">
              <label htmlFor="inv-notes" className={labelCls}>
                Notes (optional)
              </label>
              <input
                id="inv-notes"
                {...FIELDS.createInvoice.notes}
                className={inputCls}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything to print on the invoice"
              />
            </div>
          </section>

          {/* Issues from checks */}
          {issues && (issues.errors.length > 0 || issues.warnings.length > 0) && (
            <div className="mt-5 space-y-3">
              {issues.errors.length > 0 && (
                <div
                  className="rounded-2xl border px-4 py-3 text-sm"
                  style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                  role="alert"
                >
                  <p className="font-semibold mb-1">Fix these before saving:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {issues.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {issues.warnings.length > 0 && issues.errors.length === 0 && (
                <div
                  className="rounded-2xl border px-4 py-3 text-sm"
                  style={{ borderColor: "var(--amber)" }}
                  role="alert"
                >
                  <p className="font-semibold mb-1" style={{ color: "var(--amber)" }}>
                    Please double-check:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {issues.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={saveMutation.isPending}
                    className="mt-3 px-4 py-2 rounded-full font-semibold text-sm text-white disabled:opacity-50"
                    style={{ background: "var(--amber)" }}
                    onClick={() => saveMutation.mutate(true)}
                  >
                    Save anyway
                  </button>
                </div>
              )}
            </div>
          )}
          {formError && (
            <p className="mt-4 text-sm" style={{ color: "var(--danger)" }} role="alert">
              {formError}
            </p>
          )}

          {/* Totals + save */}
          <section className="mt-6 rounded-2xl bg-[var(--surface-alt)] px-4 py-4">
            <div className="space-y-1 text-sm max-w-xs ml-auto">
              <div className="flex justify-between">
                <span className="text-[var(--dim)]">Subtotal</span>
                <span className="tnum">{fmtMoney(totals.subtotal, symbol)}</span>
              </div>
              {totals.discountTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--dim)]">Discounts</span>
                  <span className="tnum">−{fmtMoney(totals.discountTotal, symbol)}</span>
                </div>
              )}
              {totals.taxAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--dim)]">Tax</span>
                  <span className="tnum">{fmtMoney(totals.taxAmount, symbol)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 font-display text-xl font-extrabold">
                <span>Total</span>
                <span className="tnum text-[#2f6bea]">{fmtMoney(totals.total, symbol)}</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="mt-4 w-full py-3.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-display font-bold text-base disabled:opacity-50 shadow"
            >
              {saveMutation.isPending ? "Saving…" : "Save invoice"}
            </button>
            <p className="mt-2 text-xs text-center text-[var(--dim)]">
              Currency and language chosen above become your defaults for the next invoice too.
            </p>
          </section>
        </form>
      </div>

      {/* ------------------------- Live preview ------------------------- */}
      <div className="lg:sticky lg:top-28">
        <h2 className="font-display font-bold text-white text-base mb-2 px-1">Live preview</h2>
        <InvoiceSheet inv={previewInvoice} settings={previewSettings} />
      </div>

      {scanProduct && (
        <QrScanner
          title="Scan a product code"
          onResult={onProductScan}
          onClose={() => setScanProduct(false)}
        />
      )}
    </div>
  );
}
