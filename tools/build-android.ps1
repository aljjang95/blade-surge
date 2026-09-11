param(
    [ValidateSet('Debug', 'Release')] [string]$Configuration = 'Debug',
    [string]$JavaHome = 'C:/Program Files/Android/Android Studio/jbr',
    [string]$AndroidSdk = 'C:/Users/Administrator/AppData/Local/Android/Sdk'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$saved = @{}
$values = @{
    JAVA_HOME = $JavaHome
    ANDROID_HOME = $AndroidSdk
    JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:/Windows/Temp -Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.WindowsSelectorProvider'
}
if (!(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) { throw 'Java 21 runtime missing.' }
if (!(Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms/android-36/android.jar'))) { throw 'Android SDK 36 missing.' }
if ($Configuration -eq 'Release' -and (!$env:BLADESURGE_KEYSTORE -or !$env:BLADESURGE_KEYSTORE_PASSWORD)) {
    throw 'Inject BLADESURGE_KEYSTORE and BLADESURGE_KEYSTORE_PASSWORD before release. Debug signing is never substituted.'
}
try {
    foreach ($name in $values.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process')
    }
    Push-Location $repo
    try {
        & bun run typecheck
        if ($LASTEXITCODE) { throw 'Typecheck failed.' }
        # Vite owns this generated directory; exclude stale web chunks from APKs.
        & bunx vite build --mode native --emptyOutDir
        if ($LASTEXITCODE) { throw 'Native web build failed.' }
        & node tools/write-version.mjs
        if ($LASTEXITCODE) { throw 'Version stamp failed.' }
        & bunx cap sync android
        if ($LASTEXITCODE) { throw 'Capacitor sync failed.' }
        $tasks = if ($Configuration -eq 'Release') { @('assembleRelease','bundleRelease','lintRelease') } else { @('assembleDebug','lintDebug') }
        & ./android/gradlew.bat -p android @tasks --no-daemon --console=plain
        if ($LASTEXITCODE) { throw 'Android build or lint failed.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
