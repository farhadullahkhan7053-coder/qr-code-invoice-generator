// Actions for the Farhadio Invoice Generator.
//
// All money math happens here, server-side: line totals, discounts, tax
// and grand totals are computed from the submitted lines and stored with
// the invoice, so history and reports never recompute differently.
// AI features run through ctx.inference (language tasks only); price
// suggestions and duplicate detection are exact lookups over the user's
// own sales history.

import {
defineAction,
z,
type ActionsModule,
type Ctx,
} from "@hatch/space-sdk";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import * as schema from "./schema";

type Db = ReturnType<Ctx["db"]>;

const round2 = (n: number) => Math.round(n * 100) / 100;

const lineInput = z.object({
  name: z.string().trim().max(120),
  qty: z.number().min(0).max(100000),
  price: z.number().min(0).max(100000000),
  discountPercent: z.number().min(0).max(100).default(0),
});

type LineInput = z.infer<typeof lineInput>;

function computeTotals(items: LineInput[], taxPercent: number) {
  let subtotal = 0;
  let discountTotal = 0;
  const lines = items.map((it) => {
    const gross = it.qty * it.price;
    const disc = (gross * it.discountPercent) / 100;
    subtotal += gross;
    discountTotal += disc;
    return { ...it, lineTotal: round2(gross - disc) };
  });
  const taxable = subtotal - discountTotal;
  const taxAmount = (taxable * taxPercent) / 100;
  return {
    lines,
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxAmount: round2(taxAmount),
    total: round2(taxable + taxAmount),
  };
}

const settingsShape = z.object({
  businessName: z.string(),
  tagline: z.string(),
  phone: z.string(),
  address: z.string(),
  currency: z.string(),
  currencyCode: z.string(),
  language: z.string(),
  paymentLink: z.string(),
});

const CURRENCY_SYMBOLS: Record<string, string> = {
  PKR: "Rs",
  USD: "$",
  EUR: "€",
  AED: "AED",
  GBP: "£",
  SAR: "SAR",
};

function symbolFor(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

async function ensureSettings(db: Db) {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.id, 1))
    .limit(1);
  const existing = rows[0];
  if (existing) return existing;
  await db.insert(schema.settings).values({ id: 1 });
  return {
    id: 1,
    businessName: "FARHADIO",
    tagline: "",
    phone: "",
    address: "",
    currency: "Rs",
    currencyCode: "PKR",
    language: "en",
    paymentLink: "",
    nextSeq: 1,
  };
}

/** Loose name key: lowercase, collapsed spaces, singularized word endings. */
function nameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

/** Most recent known price for an item name: saved product first, then sales history. */
async function knownPrice(
  db: Db,
  name: string,
): Promise<{ price: number; source: "saved" | "history" } | null> {
  const key = nameKey(name);
  if (!key) return null;
  const prods = await db.select().from(schema.products);
  const prod = prods.find((p) => nameKey(p.name) === key);
  if (prod) return { price: prod.price, source: "saved" };
  const hist = await db
    .select()
    .from(schema.invoiceItems)
    .orderBy(desc(schema.invoiceItems.id))
    .limit(500);
  const hit = hist.find((h) => nameKey(h.name) === key);
  if (hit) return { price: hit.price, source: "history" };
  return null;
}

const invoiceShape = z.object({
  id: z.number(),
  number: z.string(),
  date: z.string(),
  customerName: z.string(),
  customerPhone: z.string(),
  customerAddress: z.string(),
  status: z.enum(["paid", "unpaid", "partial"]),
  amountPaid: z.number(),
  taxPercent: z.number(),
  subtotal: z.number(),
  discountTotal: z.number(),
  taxAmount: z.number(),
  total: z.number(),
  notes: z.string(),
  itemCount: z.number(),
});

type InvoiceRow = typeof schema.invoices.$inferSelect;

function toInvoiceShape(row: InvoiceRow, itemCount: number) {
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerAddress: row.customerAddress,
    status: row.status,
    amountPaid: row.amountPaid,
    taxPercent: row.taxPercent,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxAmount: row.taxAmount,
    total: row.total,
    notes: row.notes,
    itemCount,
  };
}

const invoiceDetailShape = invoiceShape.extend({
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number(),
      price: z.number(),
      discountPercent: z.number(),
      lineTotal: z.number(),
    }),
  ),
});

async function loadInvoiceDetail(db: Db, id: number) {
  const rows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1);
  const inv = rows[0];
  if (!inv) return null;
  const items = await db
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, id))
    .orderBy(asc(schema.invoiceItems.id));
  return {
    ...toInvoiceShape(inv, items.length),
    items: items.map((it) => ({
      name: it.name,
      qty: it.qty,
      price: it.price,
      discountPercent: it.discountPercent,
      lineTotal: it.lineTotal,
    })),
  };
}

/** Validation + duplicate/price checks shared by checkInvoice and createInvoice. */
async function runChecks(
  db: Db,
  args: {
    customerName: string;
    date: string;
    items: LineInput[];
    taxPercent: number;
    status: "paid" | "unpaid" | "partial";
    amountPaid: number;
  },
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const totals = computeTotals(args.items, args.taxPercent);

  if (!args.customerName.trim()) errors.push("Customer name is empty.");
  if (args.items.length === 0) errors.push("Add at least one item.");
  if (totals.discountTotal > totals.subtotal + 0.01)
    errors.push("The total discount is larger than the subtotal — lower the discount percentages.");
  args.items.forEach((it, i) => {
    const label = it.name.trim() || `Item ${i + 1}`;
    if (!it.name.trim()) errors.push(`Item ${i + 1} has no name.`);
    if (it.qty <= 0) errors.push(`"${label}" has quantity 0 — set a quantity or remove the line.`);
    if (it.price <= 0) warnings.push(`"${label}" has price 0.`);
  });
  // Duplicate line names inside this invoice.
  const seen = new Map<string, number>();
  for (const it of args.items) {
    const key = it.name.trim().toLowerCase();
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) warnings.push(`"${key}" appears ${count} times on this invoice — merge the lines if it's the same item.`);
  }
  if (args.status === "partial") {
    if (args.amountPaid <= 0) errors.push("Partial payment needs an amount paid greater than 0.");
    if (args.amountPaid >= totals.total && totals.total > 0)
      errors.push("Amount paid covers the full total — mark the invoice Paid instead of Partial.");
  }
  // Price drift vs history.
  for (const it of args.items) {
    if (it.price <= 0) continue;
    const known = await knownPrice(db, it.name);
    if (known && known.price > 0) {
      const drift = Math.abs(it.price - known.price) / known.price;
      if (drift > 0.3)
        warnings.push(
          `"${it.name.trim()}" is priced at ${it.price} but usually sells at ${known.price} — double-check the price.`,
        );
    }
  }
  // Possible duplicate invoice: same customer, same day, same total.
  if (args.customerName.trim() && totals.total > 0) {
    const sameDay = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.date, args.date));
    const dup = sameDay.find(
      (r) =>
        r.customerName.trim().toLowerCase() === args.customerName.trim().toLowerCase() &&
        Math.abs(r.total - totals.total) < 0.01,
    );
    if (dup)
      warnings.push(
        `Possible duplicate: invoice ${dup.number} for this customer on ${args.date} already totals ${dup.total}.`,
      );
  }
  return { errors, warnings, totals };
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function dayAggregates(db: Db, date: string) {
  const invs = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.date, date));
  let revenue = 0;
  let discounts = 0;
  let tax = 0;
  let collected = 0;
  for (const inv of invs) {
    revenue += inv.total;
    discounts += inv.discountTotal;
    tax += inv.taxAmount;
    collected += inv.status === "paid" ? inv.total : inv.status === "partial" ? inv.amountPaid : 0;
  }
  return {
    invoiceCount: invs.length,
    revenue: round2(revenue),
    discounts: round2(discounts),
    tax: round2(tax),
    collected: round2(collected),
    outstanding: round2(revenue - collected),
  };
}

const reportShape = z.object({
  date: z.string(),
  invoiceCount: z.number(),
  revenue: z.number(),
  discounts: z.number(),
  tax: z.number(),
  collected: z.number(),
  outstanding: z.number(),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number(),
      unitPrice: z.number(),
      total: z.number(),
    }),
  ),
  topItems: z.array(
    z.object({ name: z.string(), qty: z.number(), revenue: z.number() }),
  ),
  invoices: z.array(
    z.object({
      number: z.string(),
      customerName: z.string(),
      status: z.string(),
      total: z.number(),
    }),
  ),
  previousDay: z.object({
    date: z.string(),
    invoiceCount: z.number(),
    revenue: z.number(),
  }),
  last7Days: z.array(
    z.object({ date: z.string(), revenue: z.number(), invoiceCount: z.number() }),
  ),
});

type Report = z.infer<typeof reportShape>;

async function buildReport(db: Db, date: string): Promise<Report> {
  const agg = await dayAggregates(db, date);
  const invs = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.date, date))
    .orderBy(asc(schema.invoices.id));

  const itemRows: Report["items"] = [];
  const byName = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const inv of invs) {
    const items = await db
      .select()
      .from(schema.invoiceItems)
      .where(eq(schema.invoiceItems.invoiceId, inv.id))
      .orderBy(asc(schema.invoiceItems.id));
    for (const it of items) {
      const existing = itemRows.find((r) => r.name === it.name && r.unitPrice === it.price);
      if (existing) {
        existing.qty += it.qty;
        existing.total = round2(existing.total + it.lineTotal);
      } else {
        itemRows.push({ name: it.name, qty: it.qty, unitPrice: it.price, total: it.lineTotal });
      }
      const aggRow = byName.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
      aggRow.qty += it.qty;
      aggRow.revenue = round2(aggRow.revenue + it.lineTotal);
      byName.set(it.name, aggRow);
    }
  }
  itemRows.sort((a, b) => b.qty - a.qty);
  const topItems = [...byName.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

  const prevDate = shiftDate(date, -1);
  const prev = await dayAggregates(db, prevDate);
  const last7Days: Report["last7Days"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = shiftDate(date, -i);
    const a = await dayAggregates(db, d);
    last7Days.push({ date: d, revenue: a.revenue, invoiceCount: a.invoiceCount });
  }

  return {
    date,
    ...agg,
    items: itemRows,
    topItems,
    invoices: invs.map((inv) => ({
      number: inv.number,
      customerName: inv.customerName,
      status: inv.status,
      total: inv.total,
    })),
    previousDay: { date: prevDate, invoiceCount: prev.invoiceCount, revenue: prev.revenue },
    last7Days,
  };
}

export const Actions = {
  getSettings: defineAction({
    description: "Returns the business settings shown on invoices (name, currency, contact).",
    request: z.object({}),
    response: settingsShape,
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      return {
        businessName: s.businessName,
        tagline: s.tagline,
        phone: s.phone,
        address: s.address,
        currency: s.currency,
        currencyCode: s.currencyCode,
        language: s.language,
        paymentLink: s.paymentLink,
      };
    },
  }),

  updateSettings: defineAction({
    description: "Updates the business settings printed on invoices.",
    request: z.object({
      businessName: z.string().trim().min(1).max(80),
      tagline: z.string().trim().max(120).default(""),
      phone: z.string().trim().max(40).default(""),
      address: z.string().trim().max(200).default(""),
      currency: z.string().trim().min(1).max(8).default("Rs"),
      currencyCode: z
        .enum(["PKR", "USD", "EUR", "AED", "GBP", "SAR"])
        .default("PKR"),
      language: z.enum(["en", "ur", "roman"]).default("en"),
      paymentLink: z.string().trim().max(300).default(""),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await ensureSettings(db);
      await db
        .update(schema.settings)
        .set({
          businessName: args.businessName,
          tagline: args.tagline,
          phone: args.phone,
          address: args.address,
          currency: symbolFor(args.currencyCode),
          currencyCode: args.currencyCode,
          language: args.language,
          paymentLink: args.paymentLink,
        })
        .where(eq(schema.settings.id, 1));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getCatalog: defineAction({
    description:
      "Returns saved customers plus product suggestions (saved products merged with items from past invoices, each with its last known price) for auto-suggest.",
    request: z.object({}),
    response: z.object({
      customers: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          phone: z.string(),
          address: z.string(),
        }),
      ),
      products: z.array(
        z.object({ name: z.string(), price: z.number(), saved: z.boolean() }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const customers = await db
        .select()
        .from(schema.customers)
        .orderBy(asc(schema.customers.name));
      const saved = await db
        .select()
        .from(schema.products)
        .orderBy(asc(schema.products.name));
      const byName = new Map<string, { name: string; price: number; saved: boolean }>();
      for (const p of saved) {
        byName.set(p.name.trim().toLowerCase(), { name: p.name, price: p.price, saved: true });
      }
      const hist = await db
        .select()
        .from(schema.invoiceItems)
        .orderBy(desc(schema.invoiceItems.id))
        .limit(1000);
      for (const h of hist) {
        const key = h.name.trim().toLowerCase();
        if (key && !byName.has(key)) {
          byName.set(key, { name: h.name, price: h.price, saved: false });
        }
      }
      return {
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          address: c.address,
        })),
        products: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  }),

  saveCustomer: defineAction({
    description: "Creates or updates a saved customer.",
    request: z.object({
      id: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).default(""),
      address: z.string().trim().max(300).default(""),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id) {
        await db
          .update(schema.customers)
          .set({ name: args.name, phone: args.phone, address: args.address })
          .where(eq(schema.customers.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const inserted = await db
        .insert(schema.customers)
        .values({ name: args.name, phone: args.phone, address: args.address })
        .returning({ id: schema.customers.id });
      const row = inserted[0];
      if (!row) throw new Error("Could not save the customer.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  deleteCustomer: defineAction({
    description: "Deletes a saved customer (past invoices keep their customer details).",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.customers).where(eq(schema.customers.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  saveProduct: defineAction({
    description: "Creates or updates a saved product with its usual price.",
    request: z.object({
      id: z.number().int().positive().optional(),
      name: z.string().trim().min(1).max(120),
      price: z.number().min(0).max(100000000),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id) {
        await db
          .update(schema.products)
          .set({ name: args.name, price: args.price })
          .where(eq(schema.products.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      // Reuse an existing product with the same name instead of duplicating it.
      const existing = await db.select().from(schema.products);
      const match = existing.find(
        (p) => p.name.trim().toLowerCase() === args.name.toLowerCase(),
      );
      if (match) {
        await db
          .update(schema.products)
          .set({ price: args.price })
          .where(eq(schema.products.id, match.id));
        ctx.invalidateQueries();
        return { id: match.id };
      }
      const inserted = await db
        .insert(schema.products)
        .values({ name: args.name, price: args.price })
        .returning({ id: schema.products.id });
      const row = inserted[0];
      if (!row) throw new Error("Could not save the product.");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  deleteProduct: defineAction({
    description: "Deletes a saved product.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.products).where(eq(schema.products.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listSavedProducts: defineAction({
    description: "Lists saved products with their ids for the library screen.",
    request: z.object({}),
    response: z.object({
      products: z.array(
        z.object({ id: z.number(), name: z.string(), price: z.number() }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.products)
        .orderBy(asc(schema.products.name));
      return {
        products: rows.map((p) => ({ id: p.id, name: p.name, price: p.price })),
      };
    },
  }),

  priceSuggestion: defineAction({
    description: "Returns the usual price for an item name from saved products and past sales.",
    request: z.object({ name: z.string().trim().max(120) }),
    response: z.object({
      found: z.boolean(),
      price: z.number(),
      source: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const known = await knownPrice(db, args.name);
      if (!known) return { found: false, price: 0, source: "" };
      return { found: true, price: known.price, source: known.source };
    },
  }),

  parseOrderText: defineAction({
    description:
      "Converts natural-language order text like \"2 shirts 1500, 3 caps 400\" into invoice lines. A price written in the text wins; missing prices are filled from saved products and past sales.",
    request: z.object({ text: z.string().trim().min(1).max(500) }),
    response: z.object({
      lines: z.array(
        z.object({
          name: z.string(),
          qty: z.number(),
          price: z.number(),
          priceKnown: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let parsed: { name: string; qty: number; price?: number }[] = [];
      try {
        const result = await ctx.inference.complete(args.text, {
          system:
            "You convert a shopkeeper's short order note into invoice line items. Extract each item's name, quantity, and unit price when the note states one (e.g. \"2 shirts 1500\" means qty 2, name \"shirts\", price 1500; \"3 caps 400\" means qty 3, name \"caps\", price 400). Keep the item name short and in the words the note uses. If no quantity is stated for an item, use 1. Only include a price when the note clearly gives one for that item.",
          schema: z.object({
            lines: z.array(
              z.object({
                name: z.string(),
                qty: z.number().positive(),
                price: z.number().nonnegative().optional(),
              }),
            ),
          }),
        });
        parsed = result.lines;
      } catch {
        // Fallback: plain "2 shirts 1500, 3 caps" pattern parsing.
        parsed = args.text
          .split(/,|\band\b/i)
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const withPrice = part.match(
              /^(\d+(?:\.\d+)?)\s*(?:x|×)?\s*(.+?)\s+(\d+(?:\.\d+)?)$/i,
            );
            if (withPrice && withPrice[1] && withPrice[2] && withPrice[3])
              return {
                name: withPrice[2].trim(),
                qty: Number(withPrice[1]),
                price: Number(withPrice[3]),
              };
            const m = part.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)?\s*(.+)$/i);
            if (m && m[1] && m[2]) return { name: m[2].trim(), qty: Number(m[1]) };
            return { name: part, qty: 1 };
          });
      }
      const lines = [];
      for (const line of parsed) {
        const name = line.name.trim();
        if (!name) continue;
        if (line.price != null && line.price > 0) {
          lines.push({ name, qty: line.qty, price: line.price, priceKnown: true });
          continue;
        }
        const known = await knownPrice(db, name);
        lines.push({
          name,
          qty: line.qty,
          price: known?.price ?? 0,
          priceKnown: known != null,
        });
      }
      return { lines };
    },
  }),

  checkInvoice: defineAction({
    description:
      "Runs error and duplicate checks on a draft invoice and returns computed totals without saving.",
    request: z.object({
      customerName: z.string().trim().max(120),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      items: z.array(lineInput).max(100),
      taxPercent: z.number().min(0).max(100).default(0),
      status: z.enum(["paid", "unpaid", "partial"]).default("paid"),
      amountPaid: z.number().min(0).max(100000000).default(0),
    }),
    response: z.object({
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      subtotal: z.number(),
      discountTotal: z.number(),
      taxAmount: z.number(),
      total: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { errors, warnings, totals } = await runChecks(db, args);
      return {
        errors,
        warnings,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
      };
    },
  }),

  createInvoice: defineAction({
    description:
      "Saves an invoice after running checks. With warnings present it refuses unless force is true; errors always block. Also remembers the customer and item prices for future suggestions.",
    request: z.object({
      customerName: z.string().trim().max(120),
      customerPhone: z.string().trim().max(40).default(""),
      customerAddress: z.string().trim().max(300).default(""),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      items: z.array(lineInput).min(1).max(100),
      taxPercent: z.number().min(0).max(100).default(0),
      status: z.enum(["paid", "unpaid", "partial"]).default("paid"),
      amountPaid: z.number().min(0).max(100000000).default(0),
      notes: z.string().trim().max(500).default(""),
      force: z.boolean().default(false),
    }),
    response: z.object({
      saved: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      invoice: invoiceDetailShape.nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { errors, warnings, totals } = await runChecks(db, args);
      if (errors.length > 0 || (warnings.length > 0 && !args.force)) {
        return { saved: false, errors, warnings, invoice: null };
      }
      const s = await ensureSettings(db);
      const number = `INV-${String(s.nextSeq).padStart(4, "0")}`;
      const amountPaid =
        args.status === "paid"
          ? totals.total
          : args.status === "unpaid"
            ? 0
            : round2(args.amountPaid);
      const inserted = await db
        .insert(schema.invoices)
        .values({
          number,
          date: args.date,
          customerName: args.customerName,
          customerPhone: args.customerPhone,
          customerAddress: args.customerAddress,
          status: args.status,
          amountPaid,
          taxPercent: args.taxPercent,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxAmount: totals.taxAmount,
          total: totals.total,
          notes: args.notes,
        })
        .returning({ id: schema.invoices.id });
      const invRow = inserted[0];
      if (!invRow) throw new Error("Could not save the invoice.");
      for (const line of totals.lines) {
        await db.insert(schema.invoiceItems).values({
          invoiceId: invRow.id,
          name: line.name,
          qty: line.qty,
          price: line.price,
          discountPercent: line.discountPercent,
          lineTotal: line.lineTotal,
        });
      }
      await db
        .update(schema.settings)
        .set({ nextSeq: s.nextSeq + 1 })
        .where(eq(schema.settings.id, 1));
      // Remember the customer for auto-suggest.
      const custRows = await db.select().from(schema.customers);
      const custMatch = custRows.find(
        (c) => c.name.trim().toLowerCase() === args.customerName.toLowerCase(),
      );
      if (!custMatch) {
        await db.insert(schema.customers).values({
          name: args.customerName,
          phone: args.customerPhone,
          address: args.customerAddress,
        });
      } else if (args.customerPhone || args.customerAddress) {
        await db
          .update(schema.customers)
          .set({
            phone: args.customerPhone || custMatch.phone,
            address: args.customerAddress || custMatch.address,
          })
          .where(eq(schema.customers.id, custMatch.id));
      }
      ctx.invalidateQueries();
      const invoice = await loadInvoiceDetail(db, invRow.id);
      return { saved: true, errors: [], warnings, invoice };
    },
  }),

  listInvoices: defineAction({
    description: "Lists invoices with search and filters by text, date range, customer and status.",
    request: z.object({
      search: z.string().trim().max(120).default(""),
      dateFrom: z.string().max(10).default(""),
      dateTo: z.string().max(10).default(""),
      status: z.enum(["all", "paid", "unpaid", "partial"]).default("all"),
      limit: z.number().int().positive().max(200).default(100),
    }),
    response: z.object({ invoices: z.array(invoiceShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const conditions = [];
      if (args.search) {
        conditions.push(
          sql`(${schema.invoices.customerName} LIKE ${"%" + args.search + "%"} OR ${schema.invoices.number} LIKE ${"%" + args.search + "%"})`,
        );
      }
      if (args.dateFrom) conditions.push(gte(schema.invoices.date, args.dateFrom));
      if (args.dateTo) conditions.push(lte(schema.invoices.date, args.dateTo));
      if (args.status !== "all") conditions.push(eq(schema.invoices.status, args.status));
      const rows = await db
        .select()
        .from(schema.invoices)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(schema.invoices.id))
        .limit(args.limit);
      const counts = await db
        .select({
          invoiceId: schema.invoiceItems.invoiceId,
          n: sql<number>`count(*)`,
        })
        .from(schema.invoiceItems)
        .groupBy(schema.invoiceItems.invoiceId);
      const countMap = new Map(counts.map((c) => [c.invoiceId, c.n]));
      return {
        invoices: rows.map((r) => toInvoiceShape(r, countMap.get(r.id) ?? 0)),
      };
    },
  }),

  getInvoice: defineAction({
    description: "Returns one invoice with its line items.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ invoice: invoiceDetailShape.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const invoice = await loadInvoiceDetail(db, args.id);
      return { invoice };
    },
  }),

  updateInvoiceStatus: defineAction({
    description: "Changes an invoice's payment status (and amount paid for partial payments).",
    request: z.object({
      id: z.number().int().positive(),
      status: z.enum(["paid", "unpaid", "partial"]),
      amountPaid: z.number().min(0).max(100000000).default(0),
    }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, args.id))
        .limit(1);
      const inv = rows[0];
      if (!inv) throw new Error("Invoice not found.");
      const amountPaid =
        args.status === "paid" ? inv.total : args.status === "unpaid" ? 0 : round2(args.amountPaid);
      await db
        .update(schema.invoices)
        .set({ status: args.status, amountPaid })
        .where(eq(schema.invoices.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteInvoice: defineAction({
    description: "Deletes an invoice and its line items.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.invoiceItems)
        .where(eq(schema.invoiceItems.invoiceId, args.id));
      await db.delete(schema.invoices).where(eq(schema.invoices.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  writeMessage: defineAction({
    description:
      "Writes a short thank-you or payment-reminder message for an invoice, ready to copy and send to the customer.",
    request: z.object({
      invoiceId: z.number().int().positive(),
      kind: z.enum(["thanks", "reminder"]),
    }),
    response: z.object({ message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const inv = await loadInvoiceDetail(db, args.invoiceId);
      if (!inv) throw new Error("Invoice not found.");
      const s = await ensureSettings(db);
      const itemList = inv.items.map((it) => `${it.qty} × ${it.name}`).join(", ");
      const balance = round2(inv.total - inv.amountPaid);
      const langNote =
        s.language === "ur"
          ? " Write the message in Urdu (Urdu script)."
          : s.language === "roman"
            ? " Write the message in Roman Urdu (Urdu written in Latin letters)."
            : "";
      const facts =
        `Business: ${s.businessName}. Customer: ${inv.customerName}. Invoice ${inv.number} dated ${inv.date}. ` +
        `Items: ${itemList}. Total: ${s.currency} ${inv.total}. Status: ${inv.status}.` +
        (balance > 0 ? ` Balance still due: ${s.currency} ${balance}.` : " Fully paid.");
      try {
        const result = await ctx.inference.complete(facts, {
          system:
            (args.kind === "thanks"
              ? "Write a short, warm thank-you message (2-3 sentences) from the business to the customer for their purchase and payment. Address the customer by name, mention the invoice number, and sign off with the business name. Plain text only, suitable for WhatsApp."
              : "Write a short, polite payment-reminder message (2-3 sentences) from the business to the customer about the balance still due on their invoice. Mention the invoice number, the amount due and the date. Friendly, never threatening. Sign off with the business name. Plain text only, suitable for WhatsApp.") +
            langNote,
          schema: z.object({ message: z.string() }),
        });
        return { message: result.message };
      } catch {
        const message =
          args.kind === "thanks"
            ? `Thank you, ${inv.customerName}! Your invoice ${inv.number} for ${s.currency} ${inv.total} is ${inv.status === "paid" ? "paid in full" : "ready"}. We appreciate your business. — ${s.businessName}`
            : `Hello ${inv.customerName}, a friendly reminder that ${s.currency} ${balance} is still due on invoice ${inv.number} dated ${inv.date}. Please let us know when it's settled. Thank you! — ${s.businessName}`;
        return { message };
      }
    },
  }),

  dailyReport: defineAction({
    description:
      "Returns the full daily report for a date: items sold, totals, paid vs unpaid, top items, previous-day figures and the last 7 days of revenue.",
    request: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: reportShape,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      return await buildReport(db, args.date);
    },
  }),

  dailySummary: defineAction({
    description:
      "Writes a short AI summary of a day's sales with a comparison against the previous day and the recent average, using only the computed report figures.",
    request: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({ summary: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const report = await buildReport(db, args.date);
      const priorDays = report.last7Days.slice(0, 6);
      const avgRevenue = priorDays.length
        ? round2(priorDays.reduce((a, d) => a + d.revenue, 0) / priorDays.length)
        : 0;
      const topText = report.topItems
        .map((t) => `${t.name} (${t.qty} sold, ${s.currency} ${t.revenue})`)
        .join("; ");
      const unpaidCount = report.invoices.filter((i) => i.status !== "paid").length;
      const facts =
        `Date: ${report.date}. Invoices: ${report.invoiceCount}. Revenue: ${s.currency} ${report.revenue}. ` +
        `Discounts given: ${s.currency} ${report.discounts}. Tax collected: ${s.currency} ${report.tax}. ` +
        `Collected: ${s.currency} ${report.collected}. Still outstanding: ${s.currency} ${report.outstanding} across ${unpaidCount} unpaid or partial invoice(s). ` +
        `Top items: ${topText || "none"}. Previous day (${report.previousDay.date}): ${report.previousDay.invoiceCount} invoices, ${s.currency} ${report.previousDay.revenue}. ` +
        `Average revenue over the previous 6 days: ${s.currency} ${avgRevenue}.`;
      try {
        const result = await ctx.inference.complete(facts, {
          system:
            "You are the end-of-day summary writer for a small shop. In 3-4 short sentences, summarize the day using ONLY the figures given: how the day went, how it compares with the previous day and the recent average, what sold best, and anything about unpaid balances worth noting. No invented numbers.",
          schema: z.object({ summary: z.string() }),
        });
        return { summary: result.summary };
      } catch {
        const summary =
          report.invoiceCount === 0
            ? `No invoices were recorded on ${report.date}.`
            : `${report.invoiceCount} invoice${report.invoiceCount === 1 ? "" : "s"} brought in ${s.currency} ${report.revenue} on ${report.date} (${s.currency} ${report.collected} collected, ${s.currency} ${report.outstanding} outstanding), versus ${s.currency} ${report.previousDay.revenue} the day before.`;
        return { summary };
      }
    },
  }),

  exportReportCsv: defineAction({
    description:
      "Builds a CSV of a day's sold items and totals that downloads and opens in Excel.",
    request: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({ filename: z.string(), csv: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const report = await buildReport(db, args.date);
      const esc = (v: string | number) => {
        const str = String(v);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const lines: string[] = [];
      lines.push(`${s.businessName} — Daily Report ${report.date}`);
      lines.push("");
      lines.push("Item,Quantity,Unit Price,Total");
      for (const it of report.items) {
        lines.push([esc(it.name), it.qty, it.unitPrice, it.total].join(","));
      }
      lines.push("");
      lines.push(`Total invoices,${report.invoiceCount}`);
      lines.push(`Revenue (${s.currency}),${report.revenue}`);
      lines.push(`Discounts (${s.currency}),${report.discounts}`);
      lines.push(`Tax (${s.currency}),${report.tax}`);
      lines.push(`Collected (${s.currency}),${report.collected}`);
      lines.push(`Outstanding (${s.currency}),${report.outstanding}`);
      lines.push("");
      lines.push("Invoice,Customer,Status,Total");
      for (const inv of report.invoices) {
        lines.push([esc(inv.number), esc(inv.customerName), inv.status, inv.total].join(","));
      }
      return {
        filename: `farhadio-daily-report-${report.date}.csv`,
        csv: lines.join("\n"),
      };
    },
  }),

  findInvoiceByNumber: defineAction({
    description:
      "Finds a saved invoice by its number (e.g. INV-0007) — used by QR scanning and the manual number lookup.",
    request: z.object({ number: z.string().trim().min(1).max(40) }),
    response: z.object({ invoice: invoiceDetailShape.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const wanted = args.number.trim().toUpperCase();
      const rows = await db.select().from(schema.invoices);
      const hit = rows.find((r) => r.number.toUpperCase() === wanted);
      if (!hit) return { invoice: null };
      const invoice = await loadInvoiceDetail(db, hit.id);
      return { invoice };
    },
  }),

  extractBillPhoto: defineAction({
    description:
      "Reads a photo of a handwritten or printed bill and extracts its line items, filling missing prices from saved products and past sales.",
    request: z.object({
      image: z.object({ dataBase64: z.string(), mimeType: z.string() }),
    }),
    response: z.object({
      lines: z.array(
        z.object({
          name: z.string(),
          qty: z.number(),
          price: z.number(),
          priceKnown: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { dataBase64, mimeType } = args.image;
      if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
        throw new Error("Please use a JPG or PNG photo of the bill.");
      }
      const result = await ctx.inference.complete(
        "Extract every line item written on this bill photo.",
        {
          system:
            "You read photos of handwritten or printed shop bills. Extract each item's name, quantity and unit price exactly as written. Keep item names short, in the words on the bill. If a quantity is not written, use 1. Only include a price when one is clearly written for that item.",
          images: [{ dataBase64, mimeType, caption: "Photo of a bill" }],
          schema: z.object({
            lines: z.array(
              z.object({
                name: z.string(),
                qty: z.number().positive(),
                price: z.number().nonnegative().optional(),
              }),
            ),
          }),
        },
      );
      const lines = [];
      for (const line of result.lines) {
        const name = line.name.trim();
        if (!name) continue;
        if (line.price != null && line.price > 0) {
          lines.push({ name, qty: line.qty, price: line.price, priceKnown: true });
          continue;
        }
        const known = await knownPrice(db, name);
        lines.push({
          name,
          qty: line.qty,
          price: known?.price ?? 0,
          priceKnown: known != null,
        });
      }
      return { lines };
    },
  }),

  salesInsights: defineAction({
    description:
      "Plain-language sales insights from the user's own records: best sellers, slow items, today vs yesterday, and money still unpaid.",
    request: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({
      hasData: z.boolean(),
      bestSellers: z.array(
        z.object({ name: z.string(), qty: z.number(), revenue: z.number() }),
      ),
      slowItems: z.array(z.object({ name: z.string(), lastSold: z.string() })),
      todayRevenue: z.number(),
      yesterdayRevenue: z.number(),
      unpaidTotal: z.number(),
      unpaidCount: z.number(),
      insight: z.string(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const s = await ensureSettings(db);
      const today = await dayAggregates(db, args.date);
      const yesterday = await dayAggregates(db, shiftDate(args.date, -1));

      const allInvs = await db.select().from(schema.invoices);
      let unpaidTotal = 0;
      let unpaidCount = 0;
      for (const inv of allInvs) {
        if (inv.status === "unpaid") {
          unpaidTotal += inv.total;
          unpaidCount += 1;
        } else if (inv.status === "partial") {
          unpaidTotal += inv.total - inv.amountPaid;
          unpaidCount += 1;
        }
      }

      // Best sellers over the last 30 days (inclusive of the chosen date).
      const from30 = shiftDate(args.date, -29);
      const recent = allInvs.filter((i) => i.date >= from30 && i.date <= args.date);
      const byName = new Map<string, { name: string; qty: number; revenue: number }>();
      const lastSoldByName = new Map<string, string>();
      for (const inv of allInvs) {
        const items = await db
          .select()
          .from(schema.invoiceItems)
          .where(eq(schema.invoiceItems.invoiceId, inv.id));
        for (const it of items) {
          const prev = lastSoldByName.get(it.name);
          if (!prev || inv.date > prev) lastSoldByName.set(it.name, inv.date);
        }
      }
      for (const inv of recent) {
        const items = await db
          .select()
          .from(schema.invoiceItems)
          .where(eq(schema.invoiceItems.invoiceId, inv.id));
        for (const it of items) {
          const row = byName.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
          row.qty += it.qty;
          row.revenue = round2(row.revenue + it.lineTotal);
          byName.set(it.name, row);
        }
      }
      const bestSellers = [...byName.values()]
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      const slowItems = [...lastSoldByName.entries()]
        .filter(([, d]) => d < from30)
        .map(([name, lastSold]) => ({ name, lastSold }))
        .sort((a, b) => a.lastSold.localeCompare(b.lastSold))
        .slice(0, 5);

      const hasData = allInvs.length > 0;
      let insight = "";
      if (hasData) {
        const facts =
          `Today (${args.date}): ${today.invoiceCount} invoices, ${s.currency} ${today.revenue} revenue. ` +
          `Yesterday: ${yesterday.invoiceCount} invoices, ${s.currency} ${yesterday.revenue}. ` +
          `Best sellers (last 30 days): ${bestSellers.map((b) => `${b.name} (${b.qty} sold, ${s.currency} ${b.revenue})`).join("; ") || "none yet"}. ` +
          `Slow items (not sold in 30+ days): ${slowItems.map((x) => `${x.name} (last sold ${x.lastSold})`).join("; ") || "none"}. ` +
          `Money still unpaid: ${s.currency} ${round2(unpaidTotal)} across ${unpaidCount} invoice(s).`;
        try {
          const result = await ctx.inference.complete(facts, {
            system:
              "You are a friendly sales coach for a small shop. In 3-4 short plain-language sentences, explain what is selling best, what has gone slow, how today compares with yesterday, and how much money is still unpaid and worth chasing. Use ONLY the figures given; invent nothing.",
            schema: z.object({ insight: z.string() }),
          });
          insight = result.insight;
        } catch {
          insight =
            `Today brought in ${s.currency} ${today.revenue} from ${today.invoiceCount} invoice(s), versus ${s.currency} ${yesterday.revenue} yesterday. ` +
            (bestSellers[0]
              ? `Best seller recently: ${bestSellers[0].name} (${bestSellers[0].qty} sold). `
              : "") +
            (unpaidCount > 0
              ? `${s.currency} ${round2(unpaidTotal)} is still unpaid across ${unpaidCount} invoice(s).`
              : "Nothing is outstanding — every invoice is paid.");
        }
      }
      return {
        hasData,
        bestSellers,
        slowItems,
        todayRevenue: today.revenue,
        yesterdayRevenue: yesterday.revenue,
        unpaidTotal: round2(unpaidTotal),
        unpaidCount,
        insight,
      };
    },
  }),
} satisfies ActionsModule;
