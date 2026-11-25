// Drizzle schema for the Farhadio Invoice Generator.
//
// Tables:
//   invoices      — one row per invoice; money totals are computed
//                   server-side from the line items and stored with it.
//   invoice_items — line items belonging to an invoice.
//   customers     — saved customers for auto-suggest.
//   products      — saved products for auto-suggest and price memory.
//   settings      — single-row (id = 1) business settings + the invoice
//                   number counter, so numbers stay unique.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(),
  // Calendar date of the sale, YYYY-MM-DD, exactly as the user picked it.
  date: text("date").notNull(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull().default(""),
  customerAddress: text("customer_address").notNull().default(""),
  status: text("status", { enum: ["paid", "unpaid", "partial"] })
    .notNull()
    .default("paid"),
  amountPaid: real("amount_paid").notNull().default(0),
  taxPercent: real("tax_percent").notNull().default(0),
  subtotal: real("subtotal").notNull().default(0),
  discountTotal: real("discount_total").notNull().default(0),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const invoiceItems = sqliteTable("invoice_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id),
  name: text("name").notNull(),
  qty: real("qty").notNull().default(1),
  price: real("price").notNull().default(0),
  // Per-line discount as a percentage of qty * price.
  discountPercent: real("discount_percent").notNull().default(0),
  lineTotal: real("line_total").notNull().default(0),
});

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  price: real("price").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  businessName: text("business_name").notNull().default("FARHADIO"),
  tagline: text("tagline").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  currency: text("currency").notNull().default("Rs"),
  // ISO-style currency code chosen in the app (PKR, USD, EUR, AED…);
  // `currency` above stays as the display symbol derived from it.
  currencyCode: text("currency_code").notNull().default("PKR"),
  // Invoice language: "en" | "ur" | "roman" — drives labels + AI messages.
  language: text("language").notNull().default("en"),
  // Optional payment link (JazzCash / Easypaisa / bank page) encoded in
  // the invoice QR code alongside number, total, currency and date.
  paymentLink: text("payment_link").notNull().default(""),
  nextSeq: integer("next_seq").notNull().default(1),
});
