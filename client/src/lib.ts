// Shared helpers: formatting, file downloads, and a small hand-rolled
// PDF writer (standard PDF fonts only) used for invoice and report
// downloads — window.print() is not available inside the app shell.

import { api, type ApiResponse } from "./api";

export type Settings = ApiResponse<typeof api, "getSettings">;
export type InvoiceDetail = NonNullable<
  ApiResponse<typeof api, "getInvoice">["invoice"]
>;
export type InvoiceSummary =
  ApiResponse<typeof api, "listInvoices">["invoices"][number];
export type ReportData = ApiResponse<typeof api, "dailyReport">;
export type Catalog = ApiResponse<typeof api, "getCatalog">;
export type CatalogProduct = Catalog["products"][number];
export type CatalogCustomer = Catalog["customers"][number];

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function fmtMoney(n: number, currency: string): string {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${v < 0 ? "-" : ""}${s}`;
}

export function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function prettyDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ------------------------------------------------------- i18n / money ---

export const CURRENCIES = [
  { code: "PKR", symbol: "Rs", label: "PKR — Pakistani Rupee" },
  { code: "USD", symbol: "$", label: "USD — US Dollar" },
  { code: "EUR", symbol: "€", label: "EUR — Euro" },
  { code: "AED", symbol: "AED", label: "AED — UAE Dirham" },
  { code: "GBP", symbol: "£", label: "GBP — British Pound" },
  { code: "SAR", symbol: "SAR", label: "SAR — Saudi Riyal" },
] as const;

export type LanguageCode = "en" | "ur" | "roman";

export const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ur", label: "Urdu" },
  { code: "roman", label: "Roman Urdu" },
];

export type Labels = {
  invoice: string;
  billTo: string;
  item: string;
  qty: string;
  price: string;
  amount: string;
  subtotal: string;
  discounts: string;
  tax: string;
  total: string;
  paidSoFar: string;
  balanceDue: string;
  paid: string;
  partiallyPaid: string;
  unpaid: string;
  date: string;
  thanks: string;
  scanToVerify: string;
};

const LABELS: Record<LanguageCode, Labels> = {
  en: {
    invoice: "INVOICE",
    billTo: "Bill To",
    item: "Item",
    qty: "Qty",
    price: "Price",
    amount: "Amount",
    subtotal: "Subtotal",
    discounts: "Discounts",
    tax: "Tax",
    total: "Total",
    paidSoFar: "Paid so far",
    balanceDue: "Balance due",
    paid: "PAID",
    partiallyPaid: "PARTIALLY PAID",
    unpaid: "UNPAID",
    date: "Date",
    thanks: "Thank you for your business",
    scanToVerify: "Scan to verify this invoice",
  },
  ur: {
    invoice: "انوائس",
    billTo: "بل وصول کنندہ",
    item: "آئٹم",
    qty: "تعداد",
    price: "قیمت",
    amount: "رقم",
    subtotal: "ذیلی کل",
    discounts: "رعایت",
    tax: "ٹیکس",
    total: "کل رقم",
    paidSoFar: "ادا شدہ",
    balanceDue: "بقایا رقم",
    paid: "ادا شدہ",
    partiallyPaid: "جزوی ادا شدہ",
    unpaid: "غیر ادا شدہ",
    date: "تاریخ",
    thanks: "آپ کے کاروبار کا شکریہ",
    scanToVerify: "اس انوائس کی تصدیق کے لیے اسکین کریں",
  },
  roman: {
    invoice: "INVOICE",
    billTo: "Wusool Kunanda",
    item: "Shay",
    qty: "Tadad",
    price: "Qeemat",
    amount: "Raqam",
    subtotal: "Zeli Kul",
    discounts: "Discount",
    tax: "Tax",
    total: "Kul Raqam",
    paidSoFar: "Ada Shuda",
    balanceDue: "Baqaya Raqam",
    paid: "ADA SHUDA",
    partiallyPaid: "JUZVI ADA SHUDA",
    unpaid: "GHAIR ADA SHUDA",
    date: "Tareekh",
    thanks: "Aap ke karobar ka shukriya",
    scanToVerify: "Invoice ki tasdeeq ke liye scan karein",
  },
};

export function labelsFor(language: string): Labels {
  return LABELS[(language as LanguageCode) in LABELS ? (language as LanguageCode) : "en"];
}

/** Text encoded into every invoice QR code: number, total, currency, date (+ payment link when set). */
export function invoiceQrText(
  inv: { number: string; total: number; date: string },
  settings: Settings,
): string {
  const lines = [
    settings.businessName,
    `Invoice: ${inv.number}`,
    `Total: ${settings.currencyCode} ${round2(inv.total)}`,
    `Date: ${inv.date}`,
  ];
  if (settings.paymentLink) lines.push(`Pay: ${settings.paymentLink}`);
  return lines.join("\n");
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

export function downloadFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(filename: string, text: string, mime: string) {
  downloadFile(filename, new Blob([text], { type: mime }));
}

// ---------------------------------------------------------------- PDF ---

const PAGE_W = 595.28;
const PAGE_H = 841.89;

function escPdf(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Courier is fixed-width (0.6 × size per char) so money columns align exactly. */
function textWidth(s: string, font: "F1" | "F2" | "F3", size: number): number {
  const factor = font === "F3" ? 0.6 : font === "F2" ? 0.56 : 0.52;
  return s.length * size * factor;
}

type TextOpts = {
  font?: "F1" | "F2" | "F3";
  size?: number;
  align?: "left" | "right" | "center";
  color?: [number, number, number];
};

class PdfDoc {
  private streams: string[] = [];
  private ops: string[] = [];

  constructor() {
    this.newPage();
  }

  newPage() {
    if (this.ops.length) this.streams.push(this.ops.join("\n"));
    this.ops = [];
  }

  /** y is measured from the top of the page. */
  text(x: number, yTop: number, s: string, opts: TextOpts = {}) {
    const font = opts.font ?? "F1";
    const size = opts.size ?? 11;
    const align = opts.align ?? "left";
    const w = textWidth(s, font, size);
    const tx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const y = PAGE_H - yTop;
    const [r, g, b] = opts.color ?? [0.1, 0.11, 0.1];
    this.ops.push(
      `${r} ${g} ${b} rg BT /${font} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${escPdf(s)}) Tj ET`,
    );
  }

  line(x1: number, yTop: number, x2: number, width = 0.7) {
    const y = PAGE_H - yTop;
    this.ops.push(
      `0.45 0.42 0.36 RG ${width} w ${x1} ${y.toFixed(2)} m ${x2} ${y.toFixed(2)} l S`,
    );
  }

  build(): Blob {
    this.streams.push(this.ops.join("\n"));
    this.ops = [];
    const objects: string[] = [];
    // 1: catalog, 2: pages, 3-5: fonts, then page/content pairs.
    const pageObjNums: number[] = [];
    let next = 6;
    for (let i = 0; i < this.streams.length; i++) {
      pageObjNums.push(next);
      next += 2;
    }
    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] =
      `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${this.streams.length} >>`;
    objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
    objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;
    this.streams.forEach((stream, i) => {
      const pageNum = pageObjNums[i] ?? 6;
      objects[pageNum] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageNum + 1} 0 R >>`;
      objects[pageNum + 1] =
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (let i = 1; i < objects.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) {
      out += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    return new Blob([out], { type: "application/pdf" });
  }
}

function wrapText(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const M = 48; // margin
const RIGHT = PAGE_W - M;

export function buildInvoicePdf(inv: InvoiceDetail, s: Settings): Blob {
  const pdf = new PdfDoc();
  const cur = s.currency;
  let y = 54;
  pdf.text(M, y, s.businessName.toUpperCase(), { font: "F2", size: 24 });
  pdf.text(RIGHT, y, "INVOICE", { font: "F2", size: 20, align: "right" });
  y += 22;
  if (s.tagline) {
    pdf.text(M, y, s.tagline, { size: 10, color: [0.42, 0.4, 0.35] });
  }
  pdf.text(RIGHT, y, inv.number, { font: "F3", size: 12, align: "right" });
  y += 16;
  const contact = [s.phone, s.address].filter(Boolean).join("  ·  ");
  if (contact) pdf.text(M, y, contact, { size: 9.5, color: [0.42, 0.4, 0.35] });
  y += 14;
  pdf.line(M, y, RIGHT, 1.4);
  y += 26;
  pdf.text(M, y, "Billed to", { size: 9.5, color: [0.42, 0.4, 0.35] });
  pdf.text(RIGHT, y, `Date: ${prettyDate(inv.date)}`, { size: 10.5, align: "right" });
  y += 17;
  pdf.text(M, y, inv.customerName, { font: "F2", size: 13 });
  pdf.text(RIGHT, y, `Status: ${inv.status.toUpperCase()}`, {
    font: "F2",
    size: 10.5,
    align: "right",
    color: inv.status === "paid" ? [0.05, 0.42, 0.31] : [0.7, 0.15, 0.12],
  });
  y += 15;
  const custLines = [inv.customerPhone, inv.customerAddress].filter(Boolean);
  for (const cl of custLines) {
    pdf.text(M, y, cl, { size: 10, color: [0.3, 0.3, 0.28] });
    y += 14;
  }
  y += 12;

  const colItem = M;
  const colQty = 340;
  const colPrice = 415;
  const colDisc = 478;
  const colAmt = RIGHT;
  const header = () => {
    pdf.line(M, y - 12, RIGHT, 0.7);
    pdf.text(colItem, y, "Item", { font: "F2", size: 10 });
    pdf.text(colQty, y, "Qty", { font: "F2", size: 10, align: "right" });
    pdf.text(colPrice, y, "Price", { font: "F2", size: 10, align: "right" });
    pdf.text(colDisc, y, "Disc", { font: "F2", size: 10, align: "right" });
    pdf.text(colAmt, y, "Amount", { font: "F2", size: 10, align: "right" });
    y += 8;
    pdf.line(M, y, RIGHT, 0.7);
    y += 18;
  };
  header();
  for (const it of inv.items) {
    if (y > PAGE_H - 170) {
      pdf.newPage();
      y = 54;
      header();
    }
    pdf.text(colItem, y, it.name, { size: 10.5 });
    pdf.text(colQty, y, fmtQty(it.qty), { font: "F3", size: 10.5, align: "right" });
    pdf.text(colPrice, y, String(round2(it.price)), { font: "F3", size: 10.5, align: "right" });
    pdf.text(colDisc, y, it.discountPercent ? `${fmtQty(it.discountPercent)}%` : "—", {
      font: "F3",
      size: 10.5,
      align: "right",
    });
    pdf.text(colAmt, y, String(round2(it.lineTotal)), { font: "F3", size: 10.5, align: "right" });
    y += 17;
  }
  pdf.line(M, y - 6, RIGHT, 0.7);
  y += 22;
  const totX = 400;
  const totRow = (label: string, value: string, bold = false, size = 11) => {
    pdf.text(totX, y, label, { font: bold ? "F2" : "F1", size });
    pdf.text(colAmt, y, value, { font: "F3", size, align: "right" });
    y += 17;
  };
  totRow("Subtotal", `${cur} ${round2(inv.subtotal)}`);
  if (inv.discountTotal > 0) totRow("Discounts", `-${cur} ${round2(inv.discountTotal)}`);
  if (inv.taxPercent > 0) totRow(`Tax (${fmtQty(inv.taxPercent)}%)`, `${cur} ${round2(inv.taxAmount)}`);
  y += 2;
  pdf.line(totX, y - 12, RIGHT, 1.1);
  totRow("TOTAL", `${cur} ${round2(inv.total)}`, true, 13);
  if (inv.status !== "paid") {
    totRow("Paid so far", `${cur} ${round2(inv.amountPaid)}`);
    totRow("Balance due", `${cur} ${round2(inv.total - inv.amountPaid)}`, true);
  }
  if (inv.notes) {
    y += 14;
    pdf.text(M, y, "Notes", { font: "F2", size: 10 });
    y += 15;
    for (const ln of wrapText(inv.notes, 88)) {
      pdf.text(M, y, ln, { size: 10 });
      y += 14;
    }
  }
  pdf.text(PAGE_W / 2, PAGE_H - 44, `Thank you for your business — ${s.businessName}`, {
    size: 10,
    align: "center",
    color: [0.42, 0.4, 0.35],
  });
  return pdf.build();
}

export function buildReportPdf(
  report: ReportData,
  s: Settings,
  summary: string | null,
): Blob {
  const pdf = new PdfDoc();
  const cur = s.currency;
  let y = 54;
  pdf.text(M, y, `${s.businessName.toUpperCase()} — DAILY REPORT`, { font: "F2", size: 17 });
  y += 22;
  pdf.text(M, y, prettyDate(report.date), { size: 11, color: [0.42, 0.4, 0.35] });
  y += 12;
  pdf.line(M, y, RIGHT, 1.2);
  y += 28;
  const stat = (label: string, value: string) => {
    pdf.text(M, y, label, { size: 11.5 });
    pdf.text(RIGHT, y, value, { font: "F3", size: 11.5, align: "right" });
    y += 19;
  };
  stat("Total invoices", String(report.invoiceCount));
  stat("Revenue", `${cur} ${round2(report.revenue)}`);
  stat("Discounts given", `${cur} ${round2(report.discounts)}`);
  stat("Tax collected", `${cur} ${round2(report.tax)}`);
  stat("Collected (paid)", `${cur} ${round2(report.collected)}`);
  stat("Outstanding (unpaid)", `${cur} ${round2(report.outstanding)}`);
  stat(
    `Previous day (${shortDate(report.previousDay.date)})`,
    `${report.previousDay.invoiceCount} invoices, ${cur} ${round2(report.previousDay.revenue)}`,
  );
  y += 10;
  if (summary) {
    pdf.text(M, y, "Summary", { font: "F2", size: 12.5 });
    y += 18;
    for (const ln of wrapText(summary, 92)) {
      pdf.text(M, y, ln, { size: 10.5 });
      y += 15;
    }
    y += 12;
  }
  pdf.text(M, y, "Items sold", { font: "F2", size: 12.5 });
  y += 10;
  const colQty = 350;
  const colPrice = 440;
  pdf.line(M, y, RIGHT, 0.7);
  y += 16;
  pdf.text(M, y, "Item", { font: "F2", size: 10 });
  pdf.text(colQty, y, "Qty", { font: "F2", size: 10, align: "right" });
  pdf.text(colPrice, y, "Unit price", { font: "F2", size: 10, align: "right" });
  pdf.text(RIGHT, y, "Total", { font: "F2", size: 10, align: "right" });
  y += 8;
  pdf.line(M, y, RIGHT, 0.7);
  y += 18;
  for (const it of report.items) {
    if (y > PAGE_H - 80) {
      pdf.newPage();
      y = 54;
    }
    pdf.text(M, y, it.name, { size: 10.5 });
    pdf.text(colQty, y, fmtQty(it.qty), { font: "F3", size: 10.5, align: "right" });
    pdf.text(colPrice, y, String(round2(it.unitPrice)), { font: "F3", size: 10.5, align: "right" });
    pdf.text(RIGHT, y, String(round2(it.total)), { font: "F3", size: 10.5, align: "right" });
    y += 16;
  }
  if (report.items.length === 0) {
    pdf.text(M, y, "No items sold on this date.", { size: 10.5, color: [0.42, 0.4, 0.35] });
    y += 16;
  }
  y += 14;
  if (report.topItems.length) {
    pdf.text(M, y, "Top sellers", { font: "F2", size: 12.5 });
    y += 19;
    report.topItems.forEach((t, i) => {
      pdf.text(M, y, `${i + 1}. ${t.name} — ${fmtQty(t.qty)} sold, ${cur} ${round2(t.revenue)}`, { size: 10.5 });
      y += 16;
    });
  }
  return pdf.build();
}
