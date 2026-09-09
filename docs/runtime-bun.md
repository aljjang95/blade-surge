# Bun runtime evidence

Current verified runtime: Bun `1.4.2` (`744846f84`). `Get-Command bun` resolves to `C:/Users/Administrator/AppData/Local/Kiro-Cli/bun.exe`; invoking that executable with `--version` returns `1.4.2`.

Executable SHA256: `15277C59CCD6C6C20F8DC9716C2B59C1776320D606B6A8658F70BE8799519CA4`.

The available executable changed during this work. Earlier runs really reported Bun1.3.13; the agent did not install or replace the current binary and does not claim its installation provenance. No PATH or global-runtime configuration was changed by this task. `packageManager` now declares `bun@1.4.2`; no dependency installation or lockfile change was needed.

Latest targeted validation under the actual1.4.2 runtime: `bun test test/expedition-economy.test.ts test/economy-recovery.test.ts` passed27 tests /215 assertions; `bun run typecheck` passed. The main agent owns the final full check after integration. These CLI results do not by themselves establish the runtime version of an already-running Vite process.

Official release reference: https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2 . The earlier IAB Windows ZIP download attempt produced no saved archive; the ZIP was absent from the page asset inventory and CDP `Browser.setDownloadBehavior` was unsupported. No archive extraction or ZIP hash is claimed. This historical download limitation no longer blocks testing because a1.4.2 executable is now available locally.

`../runtime/prepare-bun.ps1` (relative to repository) remains an unused portable-extraction fallback with a passing PowerShell syntax check. It was not run and is no longer needed for the current validation.
