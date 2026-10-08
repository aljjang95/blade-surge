param(
  [ValidateSet('status', 'install', 'check', 'build', 'browser', 'dev', 'preview', 'doctor')]
  [string]$Command = 'status'
)
$ErrorActionPreference = 'Stop'
$bladeRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $bladeRoot
try {
  # 공통 캐시만 재지정한다. 키나 인증 파일은 조회하지 않는다.
  $env:BUN_INSTALL_CACHE_DIR = 'C:\Work\cache\bun'
  $env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Work\cache\playwright'
  $bladeHead = (& git rev-parse HEAD).Trim()
  $bladeOrigin = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $bladeOrigin -ne 'https://github.com/aljjang95/blade-surge.git') {
    throw '블레이드 서지 정본 origin을 확인하세요.'
  }
  $bladeBunVersion = (& bun --version).Trim()
  $bladeRequiredBun = (Get-Content -LiteralPath package.json -Raw | ConvertFrom-Json).packageManager.Split('@')[1]
  if ($bladeBunVersion -ne $bladeRequiredBun) { throw 'packageManager에 고정된 Bun 버전이 필요합니다.' }
  switch ($Command) {
    'status' {
      [ordered]@{ repository = 'aljjang95/blade-surge'; head = $bladeHead;
        branch = (& git branch --show-current).Trim(); bun = $bladeBunVersion;
        node = (& node --version).Trim(); dependenciesInstalled = (Test-Path -LiteralPath node_modules/vite/package.json);
        runtime = 'Vite / Three.js WebGL2 / Cloudflare Worker';
        fullApexActivation = 'blocked: pinned constitutional authority missing';
        gameAcceptance = 'unverified; status is not gameplay/device/release proof'
      } | ConvertTo-Json
      exit 0
    }
    'install' { & bun install --frozen-lockfile }
    'check' { & bun run check }
    'build' { & bun run build }
    'browser' { & bun x --no-install playwright install chromium }
    'dev' { & bun run dev --host 127.0.0.1 --strictPort }
    'preview' { & bun run preview --host 127.0.0.1 --strictPort }
    'doctor' { & node tools/pc-bridge.mjs doctor --route=wrangler "--expected-head=$bladeHead" }
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
