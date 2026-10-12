param(
    [ValidateSet('Debug', 'Release')] [string]$Configuration = 'Debug',
    [ValidateSet('googleplay', 'onestore')] [string]$Channel = 'googleplay',
    [string]$JavaHome = 'C:/Program Files/Android/Android Studio/jbr',
    [string]$AndroidSdk = 'C:/Users/Administrator/AppData/Local/Android/Sdk'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$saved = @{}
$values = @{
    JAVA_HOME = $JavaHome
    ANDROID_HOME = $AndroidSdk
    BLADE_STORE_WEB_DIR = (Join-Path $repo ('work/store-builds/' + $Channel + '/web'))
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
        & node tools/build-channel.mjs $Channel
        if ($LASTEXITCODE) { throw 'Channel web build failed.' }
        & bun x cap sync android
        if ($LASTEXITCODE) { throw 'Capacitor sync failed.' }
        $variant = (Get-Culture).TextInfo.ToTitleCase($Channel) + $Configuration
        $tasks = @(('assemble' + $variant), ('bundle' + $variant), ('lint' + $variant))
        & ./android/gradlew.bat -p android @tasks --no-daemon --console=plain
        if ($LASTEXITCODE) { throw 'Android build or lint failed.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
