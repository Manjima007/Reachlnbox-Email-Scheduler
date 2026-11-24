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

## Current status
- Backend rebuild succeeds; restart recovery now runs in both standalone and inline (Render) worker modes.
- Sends use a lease-guarded DB claim (`lockedAt`/`lockOwner`, `SEND_LOCK_TTL_MS`) plus startup reconciliation from DB to Redis.
- Rate-limit spills create a new delayed job for the next window instead of consuming BullMQ retry attempts, and failed sends release their reserved slot.
- Slack alert flag is only claimed for connected users and released when delivery fails; OAuth `state` is now verified for Google and Slack.
- `npm test` passes (2 tests); `npm run typecheck` passes; frontend production build succeeds.

## Remaining external checks
- Real Google/Slack OAuth credentials must still be live-verified in the target environment.
- Elasticsearch indexing/search should be verified if `ELASTICSEARCH_ENABLED=true`.
- Redis 5.x emits BullMQ "minimum 6.2 recommended" warnings; use Redis 7 for a clean run.
- Clean debug emails/jobs before demo.
- Demo video (≤5 min), private GitHub repo, grant access to `Mitrajit and Yadav036`, submit ClickUp form.
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
1. Apply the new Prisma migration (`npx prisma migrate deploy --schema backend/prisma/schema.prisma`) and rebuild before restarting the worker/API.
2. Clean stale jobs; verify 2 sent + remaining `rate_limited` with a fresh sender and a live Slack alert.
3. Configure real OAuth/ES if available; browser-test frontend.
4. Record demo, create repo + collaborator, submit form.
