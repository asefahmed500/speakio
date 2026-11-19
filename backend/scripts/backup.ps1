# Speakio PostgreSQL backup with retention.
#   powershell -File .\scripts\backup.ps1
# Set BACKUP_DIR and DATABASE_URL in the environment (or backend\.env is read).
# Restores: pg_restore -d <db> <backup-file>

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root "backend\.env"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^([A-Z_]+)="?([^"]+)"?$' -and -not (Test-Path "env:$($Matches[1])")) {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
    }
  }
}
$url = $env:DATABASE_URL
if (-not $url) { throw "DATABASE_URL is not set" }
$dir = $env:BACKUP_DIR
if (-not $dir) { $dir = Join-Path $root "backups" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $dir "speakio-$stamp.dump"
pg_dump --format=custom --dbname=$url --file=$file
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
Get-ChildItem $dir -Filter "speakio-*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
Write-Host "Backup saved: $file"
