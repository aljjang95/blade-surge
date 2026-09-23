# Blade Surge cash-grant gate — 2026-09-23

Base: `aljjang95/blade-surge` main `73cd2fc0f647828336a7cba87a75681d08c85dbe`.

The storefront already says paid purchases are unavailable, but `Economy.purchase('starter')` could still mint rewards, increment mock KRW/VIP and save a purchase when called directly. `Economy.buyPass()` could similarly mark the premium pass owned. The new regression first reproduced the cash grant: `purchase('starter')` returned `ok: true` without billing. A second regression reproduced the premium-pass UI celebrating a rejected grant if its payment-sheet stub returned true.

Cash SKUs and premium-pass grants now return `billing-unavailable` without changing the save or generating rewards. The pass UI checks the grant result before showing success. Earned-gem purchases remain available. The public payment sheet continues to explain that billing is unavailable.

Local verification: pinned Bun 1.4.2 with `bun install --frozen-lockfile`; focused 3/3; `bun run check` typecheck, 962 pass / 1 skipped / 0 failed, and Vite build exited 0. The skipped exploratory diagnostic is not release evidence. No browser payment, provider sandbox, operational deploy or public release was run.

This is a local fail-closed guard, **not** payment security. Browser storage and existing mock save state are client-owned; no identity, server-owned order/entitlement ledger, PortOne/KG Inicis channel, refund/revocation, restore, store Billing, or ad callback is connected. Do not use this candidate to activate purchases or claim a paid entitlement. Next product unit is a server-owned identity/catalog/order and refund contract with sandbox provider verification before wiring any purchase UI. Android remains on hold under its existing product decision.
