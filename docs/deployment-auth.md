# Guarded deployment authentication

The existing token route remains the default (`node tools/deploy.mjs`): it requires
the existing Cloudflare account/token configuration and fails closed without it.
It never retries through OAuth when that configuration is missing or invalid.

For an already authenticated local Wrangler OAuth session, the explicit entrypoint
is `node tools/deploy.mjs --auth=wrangler` (also accepts `--reconcile`). This is a
real deployment command, not a preflight; run only under the controller's release
authorization. Do not supply CF_/CLOUDFLARE_ environment overrides, APEX_RSI_DB,
or WRANGLER_PROFILE with this route, even as empty values. Conflicting configuration
is rejected rather than ignored. No login, profile switching or credential export
is performed by the adapter.
OAuth Wrangler commands explicitly use `--env-file` with the operating system's
null device so project dotenv files cannot silently select token authentication.
This does not change the production variables in Wrangler configuration.

The installed project Wrangler runs through `process.execPath`, without a shell,
with a 15-second timeout and 1 MiB output limit per lease command. The adapter checks
`d1 info apex-rsi --json` against the configured database UUID, then uses that UUID
for execute. Only the existing repository/axis SELECT, owner/HEAD-bound INSERT,
and exact-owner DELETE templates are supported. Child errors and malformed JSON
produce fixed messages; raw output is not included. A failed INSERT still uses the
existing lease ownership reconciliation, and uncertain deployments retain leases.

The guarded build uses `vite build --configLoader native`, supported by the installed
Node runtime on this computer. Head/live/dirty, artifact, rollback, receipt and
reconciliation checks remain mandatory. Production variables are unchanged.

References: [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute)
and [Vite 6 configuration](https://v6.vite.dev/config/).
Adapter tests inject child runners and use in-memory SQLite; they perform no remote SQL.
