# stop-dev.ps1 — shut down the ReachInbox stack
# Stops API + worker (node on dist/), the Vite dev server, Redis and Postgres.

$ErrorActionPreference = "Continue"

# Find and stop our node processes (api/worker/vite) by their working directory / port
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -match 'dist\\(server|worker)\.js|vite\.cmd|vite/dist'
} | ForEach-Object {
  Write-Host "[node]   stopping pid $($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Stop Redis
$redis = Get-Process redis-server -ErrorAction SilentlyContinue
if ($redis) { Write-Host "[redis]  stopping"; Stop-Process -Name redis-server -Force }

# Stop Postgres (portable)
$pg = Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -ErrorAction SilentlyContinue
if ($pg) {
  Write-Host "[postgres] stopping"
  $pg | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Write-Host "Stopped. (Your Postgres data in C:\Users\PC\tools\pgdata and DB rows are preserved.)"
