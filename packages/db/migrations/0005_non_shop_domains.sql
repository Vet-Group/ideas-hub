-- Landing domains that are never a shop: DEFAULT_SETTINGS.nonShopDomains in packages/core/src/settings.ts
-- (src/migration.test.ts checks they agree). Ads keep their landing domain; shops and shop_days drop the rows.
INSERT INTO "settings" ("key", "value") VALUES
  ('nonShopDomains', '["doubleclick.net","googleadservices.com","play.google.com","apps.apple.com","itunes.apple.com","a.co","amzn.to","amazon.*","ebay.*","aliexpress.*","temu.com","shein.com","etsy.com","walmart.com","tiktok.com","l.facebook.com","bit.ly","linktr.ee"]')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- The pattern of nonShopPattern (packages/core/src/measures.ts): the domain or a subdomain, `*` for the rest.
DELETE FROM "shop_days" WHERE EXISTS (
  SELECT 1 FROM "settings" s, jsonb_array_elements_text(s."value") e
  WHERE s."key" = 'nonShopDomains' AND "shop_days"."landing_domain" ~ ('^(.+\.)?' || replace(replace(e, '.', '\.'), '*', '.+') || '$')
);--> statement-breakpoint
DELETE FROM "shops" WHERE EXISTS (
  SELECT 1 FROM "settings" s, jsonb_array_elements_text(s."value") e
  WHERE s."key" = 'nonShopDomains' AND "shops"."landing_domain" ~ ('^(.+\.)?' || replace(replace(e, '.', '\.'), '*', '.+') || '$')
);
