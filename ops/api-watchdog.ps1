# Speakio self-healing watchdog.
# Production architecture: the NestJS API runs on Vercel; Cloudflare serves the
# frontend Worker and the speakio-api reverse-proxy Worker. There is no local
# backend or tunnel any more, so this task only VERIFIES the public endpoints
# (and restores the API Worker if someone deployed it with a stale origin).
# Runs every 5 minutes.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$apiWorker = "https://speakio-api.speakio.workers.dev/health"
$log = Join-Path $root ".deploy\watchdog.log"
function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $log -Value $line -ErrorAction SilentlyContinue
  Write-Host $line
}

$apiOk = $false
try {
  $r = Invoke-RestMethod -Uri $apiWorker -TimeoutSec 15 -ErrorAction Stop
  $apiOk = ($r.status -eq "ok")
} catch { $apiOk = $false }

# The Vercel origin is stable, so a 503 here almost always means the Worker
# itself is stale (e.g. someone reverted the origin). Redeploy it as-is.
if ($apiOk) {
  Write-Log "API worker healthy - no action"
} else {
  Write-Log "API worker unhealthy - redeploying from api-proxy/wrangler.jsonc"
  Push-Location (Join-Path $root "api-proxy")
  try {
    cmd /c "npx wrangler deploy > ..\.deploy\watchdog-deploy.log 2>&1"
    if ($LASTEXITCODE -eq 0) {
      Start-Sleep -Seconds 5
      try {
        $r2 = Invoke-RestMethod -Uri $apiWorker -TimeoutSec 15
        if ($r2.status -eq "ok") { Write-Log "Recovered after redeploy"; exit 0 }
      } catch {}
    }
  } finally { Pop-Location }
  Write-Log "ERROR: API worker still unhealthy (check Vercel project speakio-api)"
}

$webOk = $false
try {
  $r3 = Invoke-WebRequest -Uri "https://speakio-web.speakio.workers.dev/login" -UseBasicParsing -TimeoutSec 15
  $webOk = ($r3.StatusCode -eq 200)
} catch { $webOk = $false }
if (-not $webOk) { Write-Log "WARNING: frontend /login is not 200" }
