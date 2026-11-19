# Speakio API self-healing watchdog.
# Detects a dead quick-tunnel origin, restarts cloudflared, updates the
# speakio-api Worker's API_ORIGIN and redeploys it. Runs every 5 minutes.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$apiWorker = "https://speakio-api.speakio.workers.dev/health"
$log = Join-Path $root ".deploy\watchdog.log"
function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $log -Value $line -ErrorAction SilentlyContinue
  Write-Host $line
}

$healthy = $false
try {
  $r = Invoke-RestMethod -Uri $apiWorker -TimeoutSec 12 -ErrorAction Stop
  $healthy = ($r.status -eq "ok")
} catch { $healthy = $false }

if ($healthy) { Write-Log "API worker healthy - no action"; exit 0 }
Write-Log "API worker unhealthy - starting recovery"

# 1. Ensure the backend process is listening on :4040
$backend = Get-NetTCPConnection -LocalPort 4040 -State Listen -ErrorAction SilentlyContinue
if (-not $backend) {
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c","node dist/src/main.js > .srv-out.log 2> .srv-err.log" -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden
  foreach ($i in 1..15) {
    Start-Sleep -Seconds 2
    try { Invoke-RestMethod -Uri "http://localhost:4040/health" -TimeoutSec 3 | Out-Null; break } catch {}
  }
  Write-Log "Backend restarted"
}

# 2. Restart the tunnel and capture the new URL
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -FilePath (Join-Path $root ".deploy\cloudflared.exe") -ArgumentList "tunnel","--url","http://localhost:4040","--no-autoupdate" -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ".deploy\tunnel-out.log") -RedirectStandardError (Join-Path $root ".deploy\tunnel-err.log")
$url = $null
foreach ($i in 1..15) {
  Start-Sleep -Seconds 3
  $m = Select-String -Path (Join-Path $root ".deploy\tunnel-err.log") -Pattern "https://[a-z-]+\.trycloudflare\.com" | Select-Object -Last 1
  if ($m) { $url = $m.Matches[0].Value; break }
}
if (-not $url) { Write-Log "ERROR: no tunnel URL"; exit 1 }

$originOk = $false
foreach ($i in 1..8) {
  Start-Sleep -Seconds 3
  try { if ((Invoke-RestMethod -Uri "$url/health" -TimeoutSec 5).status -eq "ok") { $originOk = $true; break } } catch {}
}
if (-not $originOk) { Write-Log "ERROR: origin unreachable"; exit 1 }

# 3. Repoint and redeploy the API Worker
$enc = New-Object System.Text.UTF8Encoding($false)
$cfg = Join-Path $root "api-proxy\wrangler.jsonc"
$t = [IO.File]::ReadAllText($cfg)
$t = [regex]::Replace($t, '"API_ORIGIN": "[^"]+"', '"API_ORIGIN": "' + $url + '"')
[IO.File]::WriteAllText($cfg, $t, $enc)
Push-Location (Join-Path $root "api-proxy")
try {
  cmd /c "npx wrangler deploy > ..\.deploy\watchdog-deploy.log 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Log "ERROR: wrangler deploy failed"; exit 1 }
} finally { Pop-Location }

foreach ($i in 1..8) {
  Start-Sleep -Seconds 4
  try { if ((Invoke-RestMethod -Uri $apiWorker -TimeoutSec 10).status -eq "ok") { Write-Log "Recovered - new origin $url"; exit 0 } } catch {}
}
Write-Log "ERROR: API still unhealthy after recovery"
exit 1
