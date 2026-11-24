ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS ticket text;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS used_at bigint;
UPDATE redemptions SET ticket=upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)) WHERE ticket IS NULL;
ALTER TABLE redemptions ALTER COLUMN ticket SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS redemption_ticket ON redemptions(ticket);
