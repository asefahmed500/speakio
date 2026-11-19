# Non-secret deployment values for the Vercel backend. Secrets live only in
# backend/.env (gitignored) and Vercel's encrypted env store - never committed.
# Usage: powershell -File .\ops\push-vercel-models.ps1
$ErrorActionPreference = "Continue"
Set-Location "D:\speakio\backend"

# ZAI_MODEL_REASONING stays @cf/zai-org/glm-4.7-flash for scoring quality.
$pairs = @{
  "ZAI_MODEL_GENERAL" = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  "ZAI_MODEL_FAST"    = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
}

foreach ($name in $pairs.Keys) {
  $null = vercel env rm $name production --yes 2>&1
  $pairs[$name] | vercel env add $name production 2>&1 | Out-Null
  Write-Host "pushed $name"
}
Write-Host "done - redeploy with: vercel --prod --yes"
