// Library: saved products and customers (used for auto-suggest and price
// memory) plus the business settings printed on every invoice.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api } from "./api";
import { fmtMoney, CURRENCIES, LANGUAGES, type LanguageCode, type Settings } from "./lib";

const FIELDS = actionFields<typeof Actions>();

const inputCls =
  "w-full border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]";
const labelCls = "block text-xs font-medium text-[var(--dim)] mb-1";

export function Library({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api.getCatalog({}) });
  const savedProducts = useQuery({
    queryKey: ["saved-products"],
    queryFn: () => api.listSavedProducts({}),
  });

  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["saved-products"] });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  };

  // Product form
  const [prodId, setProdId] = useState<number | null>(null);
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodError, setProdError] = useState<string | null>(null);
  const saveProduct = useMutation({
    mutationFn: async () =>
      await api.saveProduct({
        ...(prodId ? { id: prodId } : {}),
        name: prodName.trim(),
        price: Number(prodPrice) || 0,
      }),
    onSuccess: () => {
      setProdId(null);
      setProdName("");
      setProdPrice("");
      refresh();
    },
    onError,
  });
  const deleteProduct = useMutation({
    mutationFn: async (id: number) => await api.deleteProduct({ id }),
    onSuccess: refresh,
    onError,
  });

  // Customer form
  const [custId, setCustId] = useState<number | null>(null);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddress, setCustAddress] = useState("");
  const [custError, setCustError] = useState<string | null>(null);
  const saveCustomer = useMutation({
    mutationFn: async () =>
      await api.saveCustomer({
        ...(custId ? { id: custId } : {}),
        name: custName.trim(),
        phone: custPhone.trim(),
        address: custAddress.trim(),
      }),
    onSuccess: () => {
      setCustId(null);
      setCustName("");
      setCustPhone("");
      setCustAddress("");
      refresh();
    },
    onError,
  });
  const deleteCustomer = useMutation({
    mutationFn: async (id: number) => await api.deleteCustomer({ id }),
    onSuccess: refresh,
    onError,
  });

  // Settings form
  type CurrencyCode = "PKR" | "USD" | "EUR" | "AED" | "GBP" | "SAR";
  const [bizName, setBizName] = useState(settings.businessName);
  const [tagline, setTagline] = useState(settings.tagline);
  const [bizPhone, setBizPhone] = useState(settings.phone);
  const [bizAddress, setBizAddress] = useState(settings.address);
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>(
    (settings.currencyCode as CurrencyCode) || "PKR",
  );
  const [language, setLanguage] = useState<LanguageCode>(
    (settings.language as LanguageCode) || "en",
  );
  const [paymentLink, setPaymentLink] = useState(settings.paymentLink);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  useEffect(() => {
    setBizName(settings.businessName);
    setTagline(settings.tagline);
    setBizPhone(settings.phone);
    setBizAddress(settings.address);
    setCurrencyCode((settings.currencyCode as CurrencyCode) || "PKR");
    setLanguage((settings.language as LanguageCode) || "en");
    setPaymentLink(settings.paymentLink);
  }, [settings]);
  const saveSettings = useMutation({
    mutationFn: async () =>
      await api.updateSettings({
        businessName: bizName.trim(),
        tagline: tagline.trim(),
        phone: bizPhone.trim(),
        address: bizAddress.trim(),
        currency: settings.currency,
        currencyCode,
        language,
        paymentLink: paymentLink.trim(),
      }),
    onSuccess: () => {
      setSettingsSaved(true);
      refresh();
    },
    onError,
  });

  const products = savedProducts.data?.products ?? [];
  const customers = catalog.data?.customers ?? [];

  return (
    <div className="card p-4 sm:p-5 space-y-9">
      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}

      {/* Products */}
      <section>
        <h2 className="font-display font-bold text-lg">Products</h2>
        <p className="text-sm text-[var(--dim)]">
          Saved products appear as suggestions with their usual price when you type an invoice.
        </p>
        <form
          className="mt-3 grid grid-cols-[1fr_110px_auto] gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!prodName.trim()) {
              setProdError("Give the product a name first.");
              return;
            }
            setProdError(null);
            saveProduct.mutate();
          }}
        >
          <div>
            <label htmlFor="prod-name" className={labelCls}>
              Product name
            </label>
            <input
              id="prod-name"
              {...FIELDS.saveProduct.name}
              className={inputCls}
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder="e.g. Cotton shirt"
            />
          </div>
          <div>
            <label htmlFor="prod-price" className={labelCls}>
              Price ({settings.currency})
            </label>
            <input
              id="prod-price"
              {...FIELDS.saveProduct.price}
              type="number"
              inputMode="decimal"
              step="any"
              className={`${inputCls} tnum`}
              value={prodPrice}
              onChange={(e) => setProdPrice(e.target.value)}
              placeholder="0"
            />
          </div>
          <button
            type="submit"
            disabled={saveProduct.isPending}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
          >
            {prodId ? "Update" : "Add"}
          </button>
        </form>
        {prodError && (
          <p className="text-sm mt-2" style={{ color: "var(--danger)" }} role="alert">
            {prodError}
          </p>
        )}
        {products.length === 0 ? (
          <p className="text-sm text-[var(--dim)] mt-3">
            No saved products yet — products are also remembered automatically from invoices.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {products.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center gap-2">
                <span className="flex-1 font-medium">{p.name}</span>
                <span className="tnum text-sm">{fmtMoney(p.price, settings.currency)}</span>
                <button
                  type="button"
                  className="text-sm text-[var(--accent)] font-medium px-2 min-h-9"
                  onClick={() => {
                    setProdId(p.id);
                    setProdName(p.name);
                    setProdPrice(String(p.price));
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-sm font-medium px-2 min-h-9"
                  style={{ color: "var(--danger)" }}
                  aria-label={`Delete product ${p.name}`}
                  onClick={() => deleteProduct.mutate(p.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Customers */}
      <section>
        <h2 className="font-display font-bold text-lg">Customers</h2>
        <p className="text-sm text-[var(--dim)]">
          Customers from your invoices are saved here automatically; you can also add them by hand.
        </p>
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custName.trim()) {
              setCustError("Give the customer a name first.");
              return;
            }
            setCustError(null);
            saveCustomer.mutate();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label htmlFor="lib-cust-name" className={labelCls}>
                Customer name
              </label>
              <input
                id="lib-cust-name"
                {...FIELDS.saveCustomer.name}
                className={inputCls}
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div>
              <label htmlFor="lib-cust-phone" className={labelCls}>
                Phone
              </label>
              <input
                id="lib-cust-phone"
                {...FIELDS.saveCustomer.phone}
                className={inputCls}
                value={custPhone}
                onChange={(e) => setCustPhone(e.target.value)}
                placeholder="03xx xxxxxxx"
                inputMode="tel"
              />
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label htmlFor="lib-cust-address" className={labelCls}>
                Address
              </label>
              <input
                id="lib-cust-address"
                {...FIELDS.saveCustomer.address}
                className={inputCls}
                value={custAddress}
                onChange={(e) => setCustAddress(e.target.value)}
                placeholder="Street, area, city"
              />
            </div>
            <button
              type="submit"
              disabled={saveCustomer.isPending}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
            >
              {custId ? "Update" : "Add"}
            </button>
          </div>
        </form>
        {custError && (
          <p className="text-sm mt-2" style={{ color: "var(--danger)" }} role="alert">
            {custError}
          </p>
        )}
        {customers.length === 0 ? (
          <p className="text-sm text-[var(--dim)] mt-3">No saved customers yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {customers.map((c) => (
              <li key={c.id} className="py-2.5 flex items-center gap-2">
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{c.name}</span>
                  {(c.phone || c.address) && (
                    <span className="block text-sm text-[var(--dim)] truncate">
                      {[c.phone, c.address].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="text-sm text-[var(--accent)] font-medium px-2 min-h-9"
                  onClick={() => {
                    setCustId(c.id);
                    setCustName(c.name);
                    setCustPhone(c.phone);
                    setCustAddress(c.address);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-sm font-medium px-2 min-h-9"
                  style={{ color: "var(--danger)" }}
                  aria-label={`Delete customer ${c.name}`}
                  onClick={() => deleteCustomer.mutate(c.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Business settings */}
      <section>
        <h2 className="font-display font-bold text-lg">Business details</h2>
        <p className="text-sm text-[var(--dim)]">Printed at the top of every invoice and report.</p>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSettingsSaved(false);
            if (!bizName.trim()) {
              setSettingsError("The business name can't be empty — it prints on every invoice.");
              return;
            }
            setSettingsError(null);
            saveSettings.mutate();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="biz-name" className={labelCls}>
                Business name
              </label>
              <input
                id="biz-name"
                {...FIELDS.updateSettings.businessName}
                className={inputCls}
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="biz-currency" className={labelCls}>
                Currency
              </label>
              <select
                id="biz-currency"
                className={inputCls}
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value as CurrencyCode)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="biz-language" className={labelCls}>
                Invoice language
              </label>
              <select
                id="biz-language"
                className={inputCls}
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="biz-paylink" className={labelCls}>
                Payment link (optional — goes into the invoice QR code and Pay button)
              </label>
              <input
                id="biz-paylink"
                {...FIELDS.updateSettings.paymentLink}
                className={inputCls}
                value={paymentLink}
                onChange={(e) => setPaymentLink(e.target.value)}
                placeholder="https://… your JazzCash / Easypaisa / bank payment page"
                inputMode="url"
              />
            </div>
            <div>
              <label htmlFor="biz-tagline" className={labelCls}>
                Tagline
              </label>
              <input
                id="biz-tagline"
                {...FIELDS.updateSettings.tagline}
                className={inputCls}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. Quality clothing & accessories"
              />
            </div>
            <div>
              <label htmlFor="biz-phone" className={labelCls}>
                Phone
              </label>
              <input
                id="biz-phone"
                {...FIELDS.updateSettings.phone}
                className={inputCls}
                value={bizPhone}
                onChange={(e) => setBizPhone(e.target.value)}
                inputMode="tel"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="biz-address" className={labelCls}>
                Address
              </label>
              <input
                id="biz-address"
                {...FIELDS.updateSettings.address}
                className={inputCls}
                value={bizAddress}
                onChange={(e) => setBizAddress(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saveSettings.isPending}
              className="px-5 py-2.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
            >
              {saveSettings.isPending ? "Saving…" : "Save business details"}
            </button>
            {settingsSaved && (
              <span className="text-sm" style={{ color: "var(--accent)" }}>
                Saved ✓
              </span>
            )}
            {settingsError && (
              <span className="text-sm" style={{ color: "var(--danger)" }} role="alert">
                {settingsError}
              </span>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
