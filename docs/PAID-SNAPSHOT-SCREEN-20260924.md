# Disabled Blade PortOne paid snapshot screen

This candidate adds a pure, unused `assessPortOnePaidSnapshot` function for the
web/PWA PREPARED order in PR #72. It performs no HTTP call, D1 write, checkout,
grant, refund or entitlement change. `/api/commerce/orders` still returns 503.
The function accepts unknown provider data only so malformed inputs fail closed;
the result always has `grantReady: false`, including when frozen fields match.

The [PortOne V2 REST API](https://developers.portone.io/api/rest-v2?v=v2)
OpenAPI 1.16.0 schema was read again for `Payment`, `PaidPayment`,
`PaymentAmount`, `SelectedChannel`, `PortOneVersion`, `SelectedChannelType` and
`PgProvider`. A paid record has `id`, `merchantId`, `storeId`, `channel`,
`version`, `amount` and `currency`. `SelectedChannel.key` is optional, so its
absence is rejected rather than replaced with a different channel identifier.
The local approved-binding fixture uses one Inicis enum; real Blade TEST/LIVE
merchant and channel values were not read or inferred from official examples.

The screen requires PREPARED/WEB/KRW and a non-NULL merchant in the stored order;
the exact payment, store, merchant and channel keys must match that order and
the independently approved account binding. It also requires V2/PAID, the
bound TEST or LIVE channel type and PG merchant/provider, exact safe-integer
total and paid amount, and zero discount/cancellation. Blade has no approved
promotion policy, so a discounted payment cannot pass this screen. Legacy 0002
rows with `merchant_id=NULL` fail.

This deliberately does **not** verify that the object came from PortOne, bind
the signed webhook or authenticated player, compare a frozen order name, check
whether the channel/account is actually approved, create a paid/reversal ledger,
or define entitlement/refund behavior. Those are separate gates before any
sale or grant. The function must not be wired into runtime as a grant decision.

Local synthetic tests cover a matching fixture and reject wrong status,
version, order/payment ID, store, merchant, channel key/type/PG merchant,
currency, amount, discount, cancellation, unsafe numbers and legacy NULL.
No real payment or production action was performed.
