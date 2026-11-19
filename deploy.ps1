# Speakio production deployment - one command:
#   powershell -File .\deploy.ps1
# Architecture: NestJS API on Vercel (Prisma cloud Postgres), Cloudflare for
# the frontend Worker + the speakio-api reverse-proxy Worker. The tunnel and
# the local node process are no longer part of production.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "== 1/4 Backend to Vercel ==" -ForegroundColor Cyan
Push-Location (Join-Path $root "backend")
try {
  cmd /c "vercel --prod --yes > ..\.deploy\vercel-deploy.log 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "Vercel deploy failed - see .deploy\vercel-deploy.log" }
} finally { Pop-Location }

$api = $null
foreach ($i in 1..5) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-RestMethod "https://speakio-api.vercel.app/health" -TimeoutSec 20
    if ($r.status -eq "ok") { $api = "https://speakio-api.vercel.app"; break }
  } catch {}
}
if (-not $api) { throw "Vercel backend is not healthy yet - check .deploy\vercel-deploy.log" }
Write-Host "   API URL: $api" -ForegroundColor Green

Write-Host "== 2/4 API Worker repoint ==" -ForegroundColor Cyan
$enc = New-Object System.Text.UTF8Encoding($false)
$apiCfg = Join-Path $root "api-proxy\wrangler.jsonc"
$cfgText = [IO.File]::ReadAllText($apiCfg)
$cfgText = [regex]::Replace($cfgText, '"API_ORIGIN":\s*"[^"]+"', '"API_ORIGIN": "' + $api + '"')
[IO.File]::WriteAllText($apiCfg, $cfgText, $enc)
Push-Location (Join-Path $root "api-proxy")
try {
  cmd /c "npx wrangler deploy > ..\.deploy\apideploy.log 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "API Worker deploy failed - see .deploy\apideploy.log" }
} finally { Pop-Location }
Write-Host "   API Worker redeployed" -ForegroundColor Green

Write-Host "== 3/4 Frontend build (same-origin /api baked in) ==" -ForegroundColor Cyan
cmd /c "set NEXT_PUBLIC_API_URL=https://speakio-web.speakio.workers.dev/api&& npm run cf:build > .deploy\cfbuild.log 2>&1"
if ($LASTEXITCODE -ne 0) { throw "OpenNext build failed - see .deploy\cfbuild.log" }
Write-Host "   build OK" -ForegroundColor Green

Write-Host "== 4/4 Deploy to Cloudflare Workers ==" -ForegroundColor Cyan
cmd /c "npx wrangler deploy > .deploy\cfdeploy.log 2>&1"
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed - see .deploy\cfdeploy.log" }
Get-Content "$root\.deploy\cfdeploy.log" | Select-String "workers.dev|Deployed" | ForEach-Object { Write-Host "   $_" -ForegroundColor Green }

Write-Host ""
Write-Host "Verifying live endpoints..." -ForegroundColor Cyan
foreach ($u in @("https://speakio-api.speakio.workers.dev/health", "https://speakio-web.speakio.workers.dev/login")) {
  try {
    $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 20
    Write-Host "   $u -> $($r.StatusCode)" -ForegroundColor Green
  } catch {
    Write-Host "   $u -> FAIL" -ForegroundColor Red
  }
}
