# 원시 CurrentUser DPAPI 바이너리를 이 자식 프로세스 안에서만 해독한다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$selectedNames = @()
$encryptedBytes = $null
$plainBytes = $null
$secretValue = $null
try {
  $inputText = [Console]::In.ReadToEnd()
  if ($inputText.Length -gt 8192) { throw 'Invalid request' }
  $request = ConvertFrom-Json -InputObject $inputText
  $fields = @($request.PSObject.Properties.Name)
  if ($fields.Count -ne 4 -or @($fields | Where-Object { $_ -notin @('path', 'keys', 'provider', 'action') }).Count -ne 0) { throw 'Invalid request' }
  $allowed = @{ 'runware' = @('RUNWARE_API_KEY'); 'runway' = @('RUNWAYML_API_SECRET', 'RUNWAY_API_SECRET'); 'fish-audio' = @('FISH_API_KEY', 'FISH_AUDIO_API_KEY') }
  if (-not $allowed.ContainsKey($request.provider) -or $request.action -notin @('media-auth', 'probe-media')) { throw 'Invalid request' }
  if ($request.action -eq 'probe-media' -and $request.provider -ne 'fish-audio') { throw 'Invalid request' }
  $selectedNames = @($request.keys)
  if ($selectedNames.Count -ne 1 -or $selectedNames[0] -notin $allowed[$request.provider]) { throw 'Invalid request' }
  if (-not [IO.Path]::IsPathRooted($request.path)) { throw 'Invalid request' }
  $sourceFile = Get-Item -LiteralPath $request.path
  if ($sourceFile.PSIsContainer -or $sourceFile.Length -gt 65536 -or ($sourceFile.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid source' }
  Add-Type -AssemblyName System.Security
  $encryptedBytes = [IO.File]::ReadAllBytes($sourceFile.FullName)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect($encryptedBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $decoder = New-Object Text.UTF8Encoding($false, $true)
  $secretValue = $decoder.GetString($plainBytes)
  if ($secretValue.Length -lt 1 -or $secretValue.Length -gt 8192 -or $secretValue -match '[\s\x00-\x1f\x7f]') { throw 'Invalid source' }
  [Environment]::SetEnvironmentVariable($selectedNames[0], $secretValue, 'Process')
  $summary = @{ selectedKeyCount = 1; dpapiReadable = $true; providerSuccess = $false }
  if ($request.action -eq 'probe-media') {
    Add-Type -AssemblyName System.Net.Http
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', [Environment]::GetEnvironmentVariable($selectedNames[0], 'Process'))
    $response = $null
    try {
      $response = $client.GetAsync('https://api.fish.audio/model?page_size=1&self=true', [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      $summary.httpStatus = [int]$response.StatusCode
      $summary.providerSuccess = $summary.httpStatus -ge 200 -and $summary.httpStatus -lt 300
    } catch { $summary.httpStatus = $null }
    finally { if ($response) { $response.Dispose() }; $client.Dispose(); $handler.Dispose() }
  }
  [Console]::Out.Write((ConvertTo-Json -InputObject $summary -Compress))
} catch {
  [Console]::Out.Write('{"ok":false,"code":"SOURCE","message":"Configured credential source is unavailable or invalid."}')
  exit 1
} finally {
  foreach ($selectedName in $selectedNames) { if ($selectedName -in @('RUNWARE_API_KEY', 'RUNWAYML_API_SECRET', 'RUNWAY_API_SECRET', 'FISH_API_KEY', 'FISH_AUDIO_API_KEY')) { [Environment]::SetEnvironmentVariable($selectedName, $null, 'Process') } }
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($encryptedBytes) { [Array]::Clear($encryptedBytes, 0, $encryptedBytes.Length) }
  $secretValue = $null
}
