# HANDOFF — ReachInbox Email Scheduler (D:\OutboxLab)

## Current environment (local, no Docker)
- Node v24.15.0, npm 11.12.1.
- Redis: portable `C:\Users\PC\tools\redis-5.0.14.1\redis-server.exe`, running on `:6379` (`redis-cli ping` => PONG). Redis 5.x, so BullMQ pinned to v3.16.2.
- PostgreSQL 16 portable: binaries `C:\Users\PC\tools\pgsql\pgsql\bin`, data `C:\Users\PC\tools\pgdata`, DB `reachinbox`, user `postgres`, trust auth on `:5432`. Start command used:
  `Start-Process -FilePath "C:\Users\PC\tools\pgsql\pgsql\bin\postgres.exe" -ArgumentList "-D C:\Users\PC\tools\pgdata -p 5432 -c listen_addresses=127.0.0.1" -WindowStyle Hidden`
- API + worker are running as detached `node dist/server.js` and `node dist/worker.js` from `D:\OutboxLab\backend`, logs in `C:\Users\PC\AppData\Local\Temp\opencode\reachinbox\`.
- IMPORTANT: running worker is a STALE build (see "Critical issue" below).

## Repo layout
- Root: `package.json` (npm workspaces + concurrently), `.env.example`, `HANDOFF.md`.
- `backend/`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env` (gitignored later), `prisma/schema.prisma`, `prisma/migrations/...`, `src/`.
  - Key files: `env.ts`, `db.ts`, `redis.ts`, `queue.ts`, `types.ts`, `mailer.ts`, `slack.ts`, `search.ts`, `rateLimiter.ts`, `middleware/auth.ts`, `routes/auth.ts`, `routes/emails.ts`, `utils/asyncHandler.ts`, `utils/emails.ts`, `server.ts`, `worker.ts`, `scheduler.test.ts`.
- `frontend/`: Vite + React 18 + TS + Tailwind 3. `src/pages/Login.tsx`, `src/pages/Dashboard.tsx`, `src/components/*`, `src/api.ts`, `src/types.ts`, `src/App.tsx`, `src/main.tsx`, `src/index.css`.

## What is implemented
- Prisma models: User, Sender, Batch, Email. Migration applied successfully.
- REST API: `/api/config`, `/api/health`, `/api/auth/*` (Google OAuth, Slack OAuth, dev-login, me, logout, disconnect), `/api/batches`, `/api/emails`, `/api/emails/search`, `/api/emails/:id`, DELETE cancel, `/api/stats`, `/api/batches` list, `/api/senders`, `/api/queue/stats`, `/api/queue/jobs`.
- Scheduling: DB rows first, then `emailQueue.addBulk` with `jobId = email.id`, `delay`, and priority for order. Idempotency via `Idempotency-Key` header on Batch.
- Worker: configurable concurrency, retries/backoff, Ethereal SMTP send, DB status updates, preview URL, recovery of `processing` rows on restart, graceful shutdown.
- Rate limiting source: atomic Redis Lua script that does NOT increment once limit reached; `shouldSendSlackAlert` uses `SET NX` per sender/window.
- Min delay source: BullMQ worker limiter `limiter: { max: 1, duration: env.MIN_SEND_DELAY_MS }` (source only, not built).
- Elasticsearch code: index creation, bulk index on batch create, reindex on send, search with PostgreSQL fallback. `ELASTICSEARCH_ENABLED=false` locally.
- bull-board mounted at `/admin/queues`; custom live queue view in dashboard tab.
- Frontend: login, header (name/email/avatar/Slack/logout), stats cards, tables with loading/empty states, compose modal with CSV/TXT upload + parsed count + start time + delay + hourly limit, search tab, queue tab, toasts.

## Verified working
- `npm run typecheck` clean for backend and frontend.
- `npm run build` (root) succeeded earlier; frontend built to `frontend/dist`.
- Migration + Prisma client generation succeeded.
- Dev login works: POST `/api/auth/dev-login` with `{email, name}` using cookie session.
- Scheduling works; delayed jobs fire; Ethereal sends real emails with preview URLs (e.g. `fresh@example.com` after restart).
- Restart persistence proved: scheduled a fresh delayed job, restarted worker, job still sent at correct time.
- BullBoard route and `/api/queue/stats` respond.

## Critical issue (do this first)
- Last backend rebuild failed: `npm run build --workspace backend` ended with `npm error ... prisma generate && tsc -p tsconfig.json`. Exact reason was not captured — rerun it to see.
- Because of that failure, `backend/dist/worker.js` is stale: it still contains `reserveSendSlot(...)` and lacks the new `limiter:`. Source `backend/src/worker.ts` is correct (`limiter` present, `reserveSendSlot` removed). Source `rateLimiter.ts` has the fixed non-inflating Lua script; test expectation updated to `third.count === 2`.
- Symptom: jobs that exceed the hourly limit remain `scheduled`/`delayed` with high `attemptsMade` (e.g. `r3/r4`, `l4–l6`, `lead2`) instead of becoming `rate_limited`. No `rl:*` keys were present after tests, confirming old limiter behavior.
- Fix path: rerun build, confirm `dist/worker.js` has `limiter:` and no `reserveSendSlot`, kill stale worker process, restart from `backend/dist/worker.js`.

## Other known gaps / failures
- No real Google or Slack OAuth credentials in `backend/.env` → OAuth code implemented but not live-verified; no actual Slack message sent yet.
- Elasticsearch not installed locally → DB fallback active; ES indexing/search unverified.
- Redis 5.x emits BullMQ "minimum 6.2 recommended" warnings.
- `npm test` (vitest) not run yet.
- Frontend only typechecked/built, not opened in a browser.
- Debug emails/jobs remain in DB/Redis; clean before demo.
- Not yet created: README, `.gitignore`, `docker-compose.yml`, Ethereal credential helper script.
- Not yet done: demo video (≤5 min), private GitHub repo, grant access to `Mitrajit and Yadav036`, submit ClickUp form.
- Attached screenshot in prior message could not be viewed (model has no image input).

## Useful commands
```powershell
# Login + schedule smoke test (PowerShell)
$session=$null
Invoke-WebRequest -UseBasicParsing -SessionVariable session -Uri "http://localhost:4000/api/auth/dev-login" -Method POST -ContentType "application/json" -Body '{"email":"demo@reachinbox.ai","name":"Demo User"}' | Out-Null
$start=(Get-Date).AddSeconds(5).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$payload=@{subject="Rate test";body="Hello";fromEmail="newsender@reachinbox.ai";startTime=$start;delayMs=2000;hourlyLimit=2;recipients=@("a@example.com","b@example.com","c@example.com")}|ConvertTo-Json -Depth 5
Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "http://localhost:4000/api/batches" -Method POST -ContentType "application/json" -Body $payload
Start-Sleep 15
(Invoke-WebRequest -UseBasicParsing -WebSession $session -Uri "http://localhost:4000/api/emails?status=all").Content

# Restart worker
Stop-Process -Id <workerPid> -Force
npm run build --workspace backend
$logs="C:\Users\PC\AppData\Local\Temp\opencode\reachinbox"
Start-Process -FilePath "node" -ArgumentList "dist/worker.js" -WorkingDirectory "D:\OutboxLab\backend" -RedirectStandardOutput "$logs\worker.log" -RedirectStandardError "$logs\worker.err" -WindowStyle Hidden -PassThru
```

## Ordered next steps
1. Fix/verify backend build; restart worker with fixed code.
2. Clean stale jobs; flush `rl:*` keys; verify 2 sent + 2 `rate_limited` with a fresh sender and Slack alert log line.
3. Run `npm test`, `npm run typecheck`, `npm run build`.
4. Write README, `.gitignore`, `docker-compose.yml`, Ethereal helper.
5. Configure real OAuth/ES if available; browser-test frontend.
6. Record demo, create repo + collaborator, submit form.
