# Speakio deployment - one command after any reboot:
#   powershell -File .\deploy.ps1
# Restores: backend API (local node), public tunnel URL, frontend Worker redeploy.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

Write-Host "== 1/4 Backend API ==" -ForegroundColor Cyan
$back = Get-NetTCPConnection -LocalPort 4040 -State Listen -ErrorAction SilentlyContinue
if (-not $back) {
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd backend && node dist/src/main.js > .srv-out.log 2> .srv-err.log" -WorkingDirectory $root -WindowStyle Hidden
  $ok = $false
  foreach ($i in 1..15) { Start-Sleep -Seconds 3; try { Invoke-RestMethod "http://localhost:4040/health" -TimeoutSec 3 | Out-Null; $ok = $true; break } catch {} }
  if (-not $ok) { throw "Backend failed to start - see backend\.srv-err.log" }
}
Write-Host "   backend OK on :4040" -ForegroundColor Green

Write-Host "== 2/4 Public tunnel ==" -ForegroundColor Cyan
$cf = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cf) { Stop-Process -Id $cf.Id -Force; Start-Sleep -Seconds 2 }
Start-Process -FilePath "$root\.deploy\cloudflared.exe" -ArgumentList "tunnel", "--url", "http://localhost:4040", "--no-autoupdate" -WindowStyle Hidden -RedirectStandardOutput "$root\.deploy\tunnel-out.log" -RedirectStandardError "$root\.deploy\tunnel-err.log"
Start-Sleep -Seconds 10
$api = $null
foreach ($i in 1..10) {
  Start-Sleep -Seconds 3
  $m = Select-String -Path "$root\.deploy\tunnel-err.log" -Pattern "https://[a-z-]+\.trycloudflare\.com" | Select-Object -Last 1
  if ($m) { $api = $m.Matches[0].Value; break }
}
if (-not $api) { throw "Tunnel URL not found - see .deploy\tunnel-err.log" }
$health = $null
foreach ($i in 1..6) {
  Start-Sleep -Seconds 5
  $health = try { (Invoke-RestMethod "$api/health" -TimeoutSec 30).status } catch { $null }
  if ($health -eq "ok") { break }
}
if ($health -ne "ok") { throw "Tunnel is up but origin is unreachable" }
Write-Host "   API URL: $api" -ForegroundColor Green

Write-Host "== 3/4 Frontend build (API URL baked in) ==" -ForegroundColor Cyan
cmd /c "set NEXT_PUBLIC_API_URL=$api&& npm run cf:build > .deploy\cfbuild.log 2>&1"
if ($LASTEXITCODE -ne 0) { throw "OpenNext build failed - see .deploy\cfbuild.log" }
Write-Host "   build OK" -ForegroundColor Green

Write-Host "== 4/4 Deploy to Cloudflare Workers ==" -ForegroundColor Cyan
cmd /c "npx wrangler deploy > .deploy\cfdeploy.log 2>&1"
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed - see .deploy\cfdeploy.log" }
Get-Content "$root\.deploy\cfdeploy.log" | Select-String "workers.dev|Deployed" | ForEach-Object { Write-Host "   $_" -ForegroundColor Green }
Write-Host ""
Write-Host "DEPLOYED. Frontend: https://speakio-web.speakio.workers.dev" -ForegroundColor Cyan
Write-Host "NOTE: the tunnel URL changes on every reboot - rerun this script whenever the machine restarts." -ForegroundColor Yellow
Write-Host "Stable production path: add a domain to Cloudflare -> named tunnel (or Workers paid + Containers + Neon DB)." -ForegroundColor Yellow
