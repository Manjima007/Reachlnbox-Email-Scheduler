# start-dev.ps1 — bring up the full ReachInbox stack from scratch (Windows)
# Usage:  right-click "Run with PowerShell"  OR  `powershell -ExecutionPolicy Bypass -File .\start-dev.ps1`
# It starts Postgres + Redis (if not already up), then API + worker + Vite in the background.

$ErrorActionPreference = "Stop"
$root      = "d:\OutboxLab"
$backend   = "$root\backend"
$logs      = "C:\Users\PC\AppData\Local\Temp\reachinbox"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Test-Port([int]$port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return $null -ne $c
}

# 1. Redis (portable) — start only if not already listening on 6379
if (-not (Test-Port 6379)) {
  Start-Process -FilePath "C:\Users\PC\tools\redis-5.0.14.1\redis-server.exe" -ArgumentList "--port","6379" -WindowStyle Hidden
  Start-Sleep -Seconds 1
}
Write-Host "[redis]    listening on 6379"

# 2. Postgres (portable) — start only if not already listening on 5432
if (-not (Test-Port 5432)) {
  Start-Process -FilePath "C:\Users\PC\tools\pgsql\pgsql\bin\postgres.exe" -ArgumentList "-D","C:\Users\PC\tools\pgdata","-p","5432","-c","listen_addresses=127.0.0.1" -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
Write-Host "[postgres] listening on 5432"

# 3. API + worker (from the built dist/). If you just edited src, rebuild first:
#      cd d:\OutboxLab\backend; npx prisma generate; npx tsc -p tsconfig.json
$api    = Start-Process node -ArgumentList "dist/server.js" -WorkingDirectory $backend -RedirectStandardOutput "$logs\api.log"    -RedirectStandardError "$logs\api.err"    -WindowStyle Hidden -PassThru
$worker = Start-Process node -ArgumentList "dist/worker.js" -WorkingDirectory $backend -RedirectStandardOutput "$logs\worker.log" -RedirectStandardError "$logs\worker.err" -WindowStyle Hidden -PassThru
Write-Host "[api]      pid $($api.Id)    log $logs\api.log"
Write-Host "[worker]   pid $($worker.Id)  log $logs\worker.log"

# 4. Vite dev server (frontend)
$vite = Start-Process "d:\OutboxLab\node_modules\.bin\vite.cmd" -ArgumentList "--port","5173","--strictPort" -WorkingDirectory "$root\frontend" -WindowStyle Hidden -PassThru
Write-Host "[frontend] pid $($vite.Id)    -> http://localhost:5173"

Start-Sleep -Seconds 4
Write-Host ""
Write-Host "=== All up. Open: ==="
Write-Host "  App:      http://localhost:5173"
Write-Host "  Queue UI: http://localhost:4000/admin/queues"
Write-Host "  Health:   http://localhost:4000/api/health"
Write-Host ""
Write-Host "To stop everything:  stop-dev.ps1"
