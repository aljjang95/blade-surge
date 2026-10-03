# Citadel TRELLIS.2 canary

The owner requested GPT reference images → TRELLIS → Blender, alongside the
parallel product team. This record separates actual generation from setup.

## Verified source and free route

- Existing owned adapter: `aljjang95/valorx-dungeon` at
  `f73b4449f5e33e72681b7795c46094afc65ceb08`,
  `Tools/ProductionMCP/hosted_entry.py` and `hosted_trellis.py`.
- Official service: <https://microsoft-trellis-2.hf.space>,
  `microsoft/TRELLIS.2`, source/deployment revision
  `ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d`.
- Pinned app SHA-256:
  `97edffac5d1c78992643551cc2d7daab6d9b3d7c0f049ddb5d9640ad11cfd4c3`.
- Read-only official metadata and Gradio schema returned HTTP 200. The Space
  was RUNNING; all four expected endpoints were present.
- Model and Space metadata identify MIT licensing. The official Microsoft
  source [license](https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE)
  is MIT. This does not establish the identity of in-memory server weights.
- [Official ZeroGPU documentation](https://huggingface.co/docs/hub/spaces-zerogpu)
  says existing ZeroGPU Spaces are free for all users; unauthenticated users
  receive two minutes daily. Credit-funded overage applies to signed-in
  PRO/Team/Enterprise users. This runner uses `token=False`, `auth=None`, no
  cookies or account authorization headers, and never switches to a paid route.
- Both generation and extraction declare a 120-second GPU duration. Free
  quota may therefore reject this pipeline; no success or available quota is
  inferred from service availability.

## Linux adaptation and input

`tools/trellis-citadel-canary.py` retains the fixed source/schema checks, explicit
transparent-input preprocessing, one session, one generation, bounded downloads,
four SDK threads, and anonymous cancel/reset transport. It supports Linux
Python 3.12 rather than the owned adapter's Windows-specific Python path.
The official `gradio-client==2.0.0` wheel supports Python >=3.10 and was installed
from PyPI into `/workspace/.blade-surge-tools/trellis-env`; no model weights or
local GPU runtime were downloaded.

The owner-approved GPT reference is
`work/art/citadel-hub-v1/glass-garden-trellis-reference.png`,
SHA-256 `2f2b397e30aa742346c1dea4097470667fddcf65984803c1359342880bf02fa0`.
It contains one complete gateway, RGBA 1190×1322, alpha range 0–255.
Transparent input bypasses the app's BRIA background-removal inference; the
server still constructs its BRIA client.

## Current execution

The initial Linux read-only preflight returned ConnectError using the owned
adapter's no-proxy transport. Both fixed
metadata/config URLs returned HTTP 200 with the cloud platform's supplied proxy
and trusted CA configuration. The Linux adaptation therefore honors this
platform egress configuration for all normal/cancel/reset requests, retaining
TLS verification and explicit HF anonymous authentication. A preprocessing PNG
alone will not count as a 3D output. The corrected preflight passed with the real
Linux Gradio client, matching source/app/schema pins and anonymous headers.

One actual canary was then executed. Session creation and preprocessing
succeeded. `/image_to_3d` was submitted exactly once and failed with sanitized
`quota`; process exit status was 1. **No GLB was generated.** No extraction was
submitted and no authenticated/paid fallback or retry occurred.
The input hash matched the authorized GPT reference. Original and preprocessed
PNGs plus the sanitized result are retained in
`/workspace/.blade-surge-tools/trellis-citadel/090408fc-b5ed-4408-975a-ed1f0c97804b/`.
The persistent GPU-attempt marker remains in place.

The run deadline is five minutes plus any in-flight 30-second HTTP read.
The persistent attempt marker prevents a second GPU submission for this request.
Artifacts and sanitized status remain under
`/workspace/.blade-surge-tools/trellis-citadel/`; successful GLB output still
requires Blender/game appearance review.

## ACP evidence

The native host's product workers are running in parallel. The separate owned
ACP route is `gjc acp` / `gjc --mode acp`, stdio JSON-RPC
`initialize` → `session/new` → `session/prompt`.
The latest official `@gajae-code/coding-agent@0.18.6` has verified upstream
SHA `d46fdc5fe531f9abc5160cfbe1263c51a08870a9` and Linux/Bun support.
Its startup eagerly reads home/config environment files and resolves auth
storage; isolating only `GJC_CODING_AGENT_DIR` does not prevent those reads.
The official pinned npm package was therefore installed locally with install
hooks disabled, without modifying the product dependency manifests or lockfile.

Actual protocol activation was verified using the installed package and Bun
inside an existing `bwrap` namespace: network unshared/disabled, inherited
environment cleared, real `/root` masked with private tmpfs, private `/tmp`, and
the remaining filesystem read-only. No `HOME` override, real credential-store
access, account setup, session dispatch, or provider request was needed.
`initialize` returned JSON-RPC 2.0, protocolVersion 1, agentInfo
`gajae-code` / `Gajae Code` / `0.18.6`, auth method `agent`, and process exit 0.
This establishes a working Linux ACP protocol interface. Authenticated external
worker sessions and prompts were not run; the native host's parallel workers
remain the workers performing this product change.

The exact isolated launch shape was:

```sh
bwrap --unshare-all --die-with-parent --ro-bind / / \
  --tmpfs /root --tmpfs /tmp --proc /proc --dev /dev --clearenv \
  --setenv GJC_CODING_AGENT_DIR /tmp/gjc-acp-agent --chdir /tmp \
  <existing-absolute-bun-path> \
  /workspace/.blade-surge-tools/gjc-acp/node_modules/@gajae-code/coding-agent/bin/gjc.js acp
```

One newline-terminated `initialize` JSON-RPC request was supplied on stdin; the
tool wrapper inspected only the response metadata. No raw transcript was saved.
