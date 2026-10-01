# PC authentication bridge

Run this CLI **on the authenticated PC**, through the connected Remote Desktop
Commander plugin or an existing authorized SSH connection. Credentials stay on
that device. The bridge accepts fixed commands, validates the checkout's real
path, canonical fetch/push origin and exact HEAD, and returns bounded JSON.
It never logs subprocess output, account emails, identifiers, credential values
or private file paths. Exit code is 0 for success and 1 for a fixed structured error.

## Connection is a separate gate

The project `.codex/config.toml` enables only the confirmed official HTTPS MCP
endpoint `https://mcp.desktopcommander.app/mcp`. It has no headers, tokens, device
IDs, local commands or model overrides. [Codex MCP documentation](https://developers.openai.com/codex/mcp)
supports trusted project configuration; **config alone does not activate a cloud
plugin**. The cloud task must actually expose and authenticate the Remote Desktop
Commander plugin, select the authorized online device and execute on that PC.
Verify those gates in the actual cloud task. This file does not register devices,
change account settings, copy credentials into cloud, or establish cloud acceptance.
The plugin's broader command interface is not restricted by this bridge; callers
must invoke the bridge and must not request password retrieval or export over MCP.

## Private profile binding

On a fresh installation bind nonsecret paths in
`~/.apex/pc-bridge/profiles.local.json`, or pass an **absolute** `--profile` path.
Do not commit the profile. Inside the checkout it must be untracked and ignored;
outside it, protect it with the local owner's file permissions. Files resolving
through symlinks/junctions are rejected. Do not put keys in this JSON.

No manual JSON editing is required for a fresh clone:

```text
node tools/pc-bridge.mjs bind --route=local --expected-head=<40hex>
node tools/pc-bridge.mjs bind --route=local --expected-head=<40hex> --fish-dpapi=<absolute-local-path> --password-csv=<absolute-local-path>
```

`bind` verifies the current checkout and exact HEAD. An absent profile gets only
the explicit Wrangler route. An existing validated profile retains provider and
CSV paths and updates only `checkout`, including a stale/nonexistent old checkout.
The optional nonsecret path flags intentionally configure/replace Fish or CSV;
they only stat the files, never decrypt/read them. No credential discovery occurs.
The previous validated profile is backed up alongside it as
`profiles.local.json.<random-id>.backup.local.json` before atomic replacement.
Backups/temp profiles remain private and ignored. Invalid/unknown-field profiles
are rejected, not overwritten. On failure retain any backup/temp file for local
recovery. Restore the previous local backup to roll back a binding; no credential
or global Codex file is changed. The CLI's response excludes all private paths.

Illustrative schema only; replace the placeholders on the device, not in Git:

```json
{
  "version": 1,
  "repository": "aljjang95/blade-surge",
  "checkout": "<absolute-PC-checkout-path>",
  "providers": {
    "cloudflare": { "route": "wrangler" },
    "fish-audio": {
      "route": "dpapi",
      "path": "<absolute-local-raw-DPAPI-file-path>",
      "keys": ["FISH_API_KEY"]
    }
  },
  "passwordCsvPath": "<absolute-local-password-CSV-path>"
}
```

Omit absent providers and the optional CSV field. There is no default media key
path or fallback route. Valid aliases are `cloudflare`, `runware`, `runway` and
`fish-audio`. Cloudflare accepts only `wrangler`, the existing local OAuth session.
Media accepts `dotenv` or Windows `dpapi`, one explicit absolute `path` and a
nonempty selected `keys` list. Allowed names: `RUNWARE_API_KEY`,
`RUNWAYML_API_SECRET` (preferred), `RUNWAY_API_SECRET` (legacy alias), `FISH_API_KEY`, `FISH_AUDIO_API_KEY`, for their respective aliases.
Unexpected fields, aliases, routes, duplicate selected keys and mismatched key
names are rejected before an authentication subprocess runs.

Dotenv sources support simple `KEY=value` lines, whole-line comments and simple
quoted values. Unknown/duplicate keys, shell syntax, interpolation, escapes and
multiline values fail closed. A source may contain other allowlisted media keys,
but only explicitly selected keys enter the child environment. Parent environment
credentials and executable options such as `NODE_OPTIONS`/`BUN_OPTIONS` are not
inherited. Only fixed system path/home/temp variables are forwarded. No env,
OAuth database, browser database or credential-directory discovery is performed.

DPAPI sources are **raw binary CurrentUser** protected bytes with null entropy,
containing one raw UTF-8 API key. They are not JSON, hex, SecureString serialization
or text ciphertext. A DPAPI entry selects exactly one key name. The supplied helper
decrypts and injects into its own process environment only, clears that variable
and byte buffers, and returns counts/status only. It cannot create, migrate, export
or re-encrypt credentials. Existing encrypted files remain untouched. Managed string
memory is not guaranteed to be securely erased; credentials remain within the local
process tree. Files with another format, account or entropy fail closed.

## Fixed commands

Run from the exact bound checkout root. Every command requires the full expected
40-character lowercase commit SHA. Example placeholders below are not runnable IDs.

```text
node tools/pc-bridge.mjs doctor --route=wrangler --expected-head=<40hex>
node tools/pc-bridge.mjs check --route=local --expected-head=<40hex>
node tools/pc-bridge.mjs build --route=local --expected-head=<40hex>
node tools/pc-bridge.mjs deploy --route=wrangler --expected-head=<40hex>
node tools/pc-bridge.mjs reconcile --route=wrangler --expected-head=<40hex>
node tools/pc-bridge.mjs media-auth --provider=fish-audio --route=dpapi --expected-head=<40hex>
node tools/pc-bridge.mjs probe-media --provider=fish-audio --route=dpapi --expected-head=<40hex>
node tools/pc-bridge.mjs password-metadata --route=chrome --expected-head=<40hex>
```

`bun run pc:bridge -- <command> ...` is also available. No arbitrary command,
URL, script, SQL, credential override, `--force` or lease bypass is accepted.

- `doctor`: installed Wrangler `whoami --json`, `d1 info apex-rsi --json` and a
  fixed SELECT of this repository's deployment lease, using the verified configured
  database UUID. It reports each check separately. It never acquires/deletes leases,
  logs accounts/session owners or logs in. Missing media providers show `unavailable`;
  configured media shows `not-probed`, never inferred success.
- `check` / `build`: the existing Bun scripts, captured output and fixed success/error.
  Diagnose source failures using the existing local scripts directly; raw output is
  intentionally unavailable across this bridge. Build success is not product acceptance.
- `deploy` / `reconcile`: clean tracked **and all nonignored untracked** files are
  mandatory. The bridge invokes only `tools/deploy.mjs --auth=wrangler`, adding
  `--reconcile` only for reconciliation. Existing guard, D1 lease, receipts, artifact
  verification and live reconciliation remain authoritative. There is no raw
  Wrangler deployment, token fallback, forced lease release or hidden retry. A child
  timeout/failure can leave an uncertain receipt/lease: inspect the existing receipt
  locally and use `reconcile` at the same clean HEAD; do not blindly redeploy.
- `media-auth`: selected key count and DPAPI-readable readiness only, **not provider
  authentication**. No provider network request or billable generation.
- `probe-media`: only Fish Audio's fixed GET
  `https://api.fish.audio/model?page_size=1&self=true`, Bearer auth from the selected child env,
  eight-second network timeout, no redirects, no response body output. It reports
  HTTP status (or null for network failure), selected count and `providerSuccess`
  for 2xx. Non-2xx/network failure exits 1. A model-list read proves this route's
  auth/injection only, not synthesis, balance, billing or all permissions. Runware
  and Runway have no fixed operational probe and return unavailable; no substitutes.
- `password-metadata`: stat/presence of the explicitly configured private CSV only.
  No reading, importing, copying, password retrieval or export. Password use stays
  in the existing Chrome password manager on the device; no profile DB copy.

Ignored local/build/runtime files are outside Git's source-clean check. Keep all
secrets ignored and local, and remember that ignore rules cannot protect files
already tracked. The bridge is a bounded interface for an authorized PC executor,
not a sandbox for a hostile device owner or concurrent source writer. Serialize
checkout mutation with execution; deploy.mjs retains its own repeated guard checks.

## Local validation

```text
bun test test/pc-bridge.test.ts
bun run typecheck
```

Tests use isolated repositories and synthetic credential fixtures. The author does
not delete fixture directories during the Windows/Bun process; bounded artifacts
remain under ignored `work/pc-bridge-fixtures/` for post-process controller cleanup.
They contain synthetic test values only, never the machine's actual credentials.
The author does
not perform deployment or generation. The controller owns independent review,
authenticated remote execution and complete candidate acceptance, including a
fresh cloud task's plugin exposure/authentication.
