ALTER TABLE settings ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'PKR';
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN payment_link TEXT NOT NULL DEFAULT '';
