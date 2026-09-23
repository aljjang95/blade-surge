-- Existing PREPARED rows have no trusted merchant binding. Leave them NULL;
-- a future paid verifier must refuse them rather than infer an account ID.
ALTER TABLE commerce_order_intents ADD COLUMN merchant_id TEXT;

CREATE TRIGGER IF NOT EXISTS commerce_order_intents_require_merchant
BEFORE INSERT ON commerce_order_intents
WHEN NEW.merchant_id IS NULL OR length(trim(NEW.merchant_id)) = 0
BEGIN
  SELECT RAISE(ABORT, 'merchant snapshot required');
END;
