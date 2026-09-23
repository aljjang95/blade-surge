# Blade Surge web/PWA commerce server contract — candidate

Base: `aljjang95/blade-surge` main `73cd2fc0f647828336a7cba87a75681d08c85dbe`. This is a source-grounded implementation contract, not a connected payment system or an approved sales catalog. The 2026-09-23 cash-grant guard is a separate draft PR; neither candidate makes browser saves authoritative.

## Current boundary

The Worker serves static assets, companion and party APIs. It has no authenticated player identity, order database, payment-provider verification, paid entitlement ledger, refund processor or restore endpoint. `src/data/shop.js` labels its catalog mock; `src/game/economy.js` saves purchase/VIP/pass fields in localStorage. Client-submitted state, payment redirects and UI callbacks cannot authorize goods. Cash purchase and premium pass must remain unavailable until the server path below passes its tests and provider sandbox checks.

## Catalog inventory to decide before sale

These are **mock prices in KRW**, read from `src/data/shop.js` and the pass UI. They are not approved product IDs, provider channel mappings or store listings. Every row is `disabled` for real-money sale.

| Client ID | Mock KRW | Product / fulfillment question |
|---|---:|---|
| `starter` | 1,200 | One-time bundle; define server-side eligibility and first-purchase bonus. |
| `monthly` | 5,900 | Immediate 600 gems plus 30 daily claims; define start/expiry and missed-day rule. |
| `growth` | 12,000 | Consumable bundle including tickets and gold. |
| `boss_pack` | 33,000 | Time-limited bundle; define eligibility against server clock and gear selection. |
| `vip_pass` | 19,000 | Thirty-day benefit; define overlapping purchases, expiry and refund effects. |
| `gem1` | 3,900 | Gem pack; current client displays a first-purchase bonus. |
| `gem2` | 12,000 | Gem pack; current client displays a first-purchase bonus. |
| `gem3` | 25,000 | Gem pack; current client displays a first-purchase bonus. |
| `gem4` | 39,000 | Gem pack; current client displays a first-purchase bonus. |
| `gem5` | 79,000 | Gem pack; current client displays a first-purchase bonus. |
| `gem6` | 129,000 | Gem pack; current client displays a first-purchase bonus. |
| `enh_pack` | 22,000 | Time-limited consumable bundle; define eligibility against server clock. |
| `pass` | 9,900 | Premium season pass from `BATTLE_PASS` / `src/ui/meta.js`; define season ID and duplicate purchase rule. |

The gem-priced items are earned-currency exchanges, not a real-money SKU. Their current local behavior is separate from a future server wallet. A paid gem wallet cannot treat an old local gem balance as proof of purchase. Before any public sale, reconcile item description, actual grant quantities, first-purchase doubling, period, eligible channel and refund policy against the approved catalog. Resolve whether an item is a consumable, non-consumable or timed entitlement per platform; do not reuse a web transaction as Play, ONE Store or Apps in Toss proof.

## Required server-owned path

1. Bind a stable authenticated player subject to a recoverable account before preparing an order. A browser-generated ID or localStorage key is not an account. Require the same subject on order lookup, restore and claim. Define account deletion and cross-device recovery before enabling sale.
2. Publish a versioned server catalog containing the approved item, currency, integer amount, channel eligibility, immutable grant definition and validity rule. Resolve price and rewards from that catalog; reject client-supplied amount, discount, reward and account fields. Unknown, disabled and expired SKUs fail closed.
3. Create an order under an idempotency key scoped to the authenticated subject and sales channel. Persist subject, catalog version/SKU, amount/currency, payment ID, channel and state before opening the provider. A retry returns the same compatible pending order; a conflicting retry is rejected. Do not publish provider credentials to the browser.
4. On a browser return or provider event, read the payment's actual state from the provider using server credentials. Verify payment ID, merchant/store/channel, amount, currency and order mapping against the frozen order. A redirect, client callback or unsigned event alone cannot mark an order paid. Treat duplicate, out-of-order and unknown events as no grant, with safe reconciliation for delayed provider responses.
5. Grant exactly once in an atomic transaction keyed by provider payment and grant line. Persist both the verified payment and each balance/entitlement mutation before returning success. Restoration reads the server ledger; it does not replay a client save. Define pass season, monthly-day and VIP expiry on the server clock.
6. Reconcile full/partial cancellation, refund and chargeback with the provider. Record reversal IDs idempotently, revoke timed access and handle already-spent consumables with an explicit nonnegative-balance/debt policy. A pending or failed refund must not silently erase or retain a paid entitlement as though final.
7. Keep cash checkout disabled until identity, catalog, persistence, provider sandbox, restore and refund are verified on the same candidate. Preserve the separate Android release hold; Play/ONE/Toss billing each require their own receipt validation and store-console evidence.

## Acceptance evidence for the implementation PR

- Duplicate order, conflicting idempotency key, concurrent paid callback and repeated grant yield one order and one grant.
- Tampered SKU, price, reward, subject or channel; forged success redirect; invalid/unknown webhook; provider timeout and mismatch yield zero grants.
- Full and partial refund, late paid event after refund, repeat reversal, already-spent currency and reinstall/second-device restore have explicit tested outcomes.
- The pinned dependency graph passes Worker typecheck, local D1/Worker integration tests and Wrangler dry-run. Browser sandbox checkout and restore/refund are demonstrated on the same version before any live or store submission claim.

## Next bounded implementation unit

Build authenticated subject binding plus a disabled, versioned server catalog in an isolated branch. Do not add checkout or a grant endpoint until server identity and persistence have tests. Then implement order creation/verification/ledger behind a disabled flag, using the selected provider's current official API schema and sandbox. The PortOne documentation MCP returned an empty listing during this audit, so no PortOne API shape or KG Inicis channel ID is asserted here.
