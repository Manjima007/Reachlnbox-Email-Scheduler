# ReachInbox — Email Job Scheduler

Schedule, monitor and search email sequences with persistence, throttling and live queue visibility.

| Layer | Tech |
|---|---|
| Backend | Node 20+ / TypeScript / Express |
| Queue | BullMQ v3 (pinned for Redis 5.x) + Redis (ioredis) |
| DB | PostgreSQL 16 + Prisma 6 |
| Search | Elasticsearch 8 (optional; falls back to Postgres) |
| SMTP | Ethereal (auto test account) or any SMTP |
| Auth | Google OAuth2 + Slack OAuth2, httpOnly JWT sessions |
| Frontend | React 18 + Vite + Tailwind 3, TypeScript |
| Live queue UI | bull-board at `/admin/queues` |

---

## 1. Architecture

```
                 ┌──────────────────────────────────────────────────┐
   Frontend ───► │  Express API (:4000)                            │
                 │  /api/auth /api/batches /api/emails …           │
                 │      │                                          │
                 │      ├─ Prisma ─► PostgreSQL  (source of truth)│
                 │      ├─ ioredis ─► Redis      (RL counters)    │
                 │      └─ Queue.addBulk (jobId = email.id)       │
                 └──────────────────────┬───────────────────────────┘
                                        │
                                        ▼
                 ┌──────────────────────────────────────────────────┐
                 │  BullMQ worker (:4001, separate process)        │
                 │  limiter: max 1 send / MIN_SEND_DELAY_MS        │
                 │  checkRateLimit() ── Lua INCR/GET/PEXPIRE ─────► │
                 │  allowed ► SMTP send ─► status 'sent'            │
                 │  blocked ► status 'rate_limited' + re-delay job  │
                 │          ► Slack alert (once per window)         │
                 └──────────────────────────────────────────────────┘
```

### How scheduling works
- `POST /api/batches` validates with zod, creates **DB rows first** (`scheduled` status), then calls `Queue.addBulk` with `jobId = email.id` so the queue and DB stay idempotent under retry.
- Each email gets `sendAt = startTime + (i × delayMs)` and a BullMQ `delay`, so jobs fire in order.
- `Idempotency-Key` on the request (or `batch.idempotencyKey` in DB) means a duplicate retry returns the original batch — no double-send.

### How persistence on restart is handled
- BullMQ jobs live in Redis (not in memory), so a delayed job scheduled for 5pm still fires at 5pm even after the worker process is killed and restarted.
- On startup the worker runs `prisma.email.updateMany({ where: { status: 'processing' }, data: { status: 'scheduled' } })` — any row stuck in `processing` from a hard kill is recovered as scheduled, not lost.
- `SIGINT`/`SIGTERM` handlers close the worker, queue, Prisma and Redis connections in order before exit.

### How rate limiting & concurrency are implemented
- **Hourly cap** — a Redis counter per sender + window, updated by an atomic Lua script (`RATE_LIMIT_SCRIPT` in [backend/src/rateLimiter.ts](backend/src/rateLimiter.ts)). The script **does not increment when the counter is already at the limit** — that's the bug the old slot-reservation approach had (it kept inflating the counter on every retry and never let the sender back into the next window).
- **Minimum spacing** — BullMQ v3 worker `limiter: { max: 1, duration: MIN_SEND_DELAY_MS }`, which paces active jobs through the worker globally. No per-slot Redis keys.
- **Concurrency** — `WORKER_CONCURRENCY` controls how many jobs run in parallel per worker process. The limiter still enforces the spacing, so raising concurrency only makes the pipeline faster, not the send rate.
- **Slack alert** — `shouldSendSlackAlert` uses `SET key:alert NX PX hour` to fire **once per sender/window**, then `notifySlackRateLimit` POSTs to the user's Slack webhook or `chat.postMessage` with the stored OAuth token. If Slack isn't connected, the alert is just logged — the scheduler never blocks on it.

---

## 2. How to run

### Prerequisites
- Node ≥ 20, Redis ≥ 5.0 on `:6379`, PostgreSQL on `:5432`.

### Redis
Docker: `docker run -d -p 6379:6379 redis:5`.
Or any local Redis 5.x/6.x.

### PostgreSQL
```sql
CREATE DATABASE reachinbox;
```
For a fully reproducible stack see [docker-compose.yml](docker-compose.yml).

### Env
```bash
cp .env.example backend/.env
# Fill in SMTP_USER/SMTP_PASS or leave empty to auto-create an Ethereal account.
# DEV_LOGIN_ENABLED=true is the default in .env.example — flip to false to force Google OAuth.
```

### Build + start
```bash
npm install
npm run build                # backend tsc + frontend vite
npm start                   # API :4000 + worker :4001
# or dev mode:
npm run dev                 # tsx watch + vite
```

### Run the test suite
```bash
npm test                    # vitest (needs Redis running; DB not needed)
```

---

## 3. Elasticsearch (optional)

Default config ships with `ELASTICSEARCH_ENABLED=false` so the app works with just Postgres. To turn it on:

1. `docker run -d -p 9200:9200 docker.elastic.co/elasticsearch/elasticsearch:8.17.0`
2. `backend/.env` → `ELASTICSEARCH_ENABLED=true`
3. Restart the API + worker. The index is auto-created with the right mappings on first use; bulk indexing happens on batch creation and per-email on send.

`/api/emails/search` transparently uses ES when available, Postgres otherwise.

---

## 4. Features → where they live

| Feature | File |
|---|---|
| Scheduler, delay + priority | [backend/src/routes/emails.ts](backend/src/routes/emails.ts) |
| BullMQ queue, worker, limiter, retry | [backend/src/worker.ts](backend/src/worker.ts), [backend/src/queue.ts](backend/src/queue.ts) |
| Hourly RL (atomic Lua) | [backend/src/rateLimiter.ts](backend/src/rateLimiter.ts) |
| Restart recovery | [backend/src/worker.ts](backend/src/worker.ts) `bootstrap()` |
| Google / Slack OAuth | [backend/src/routes/auth.ts](backend/src/routes/auth.ts), [backend/src/slack.ts](backend/src/slack.ts) |
| Dev-login fallback | [backend/src/routes/auth.ts](backend/src/routes/auth.ts) |
| Ethereal SMTP | [backend/src/mailer.ts](backend/src/mailer.ts) |
| ES index + fallback | [backend/src/search.ts](backend/src/search.ts) |
| Live queue UI | [backend/src/server.ts](backend/src/server.ts) (bull-board) + [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx) Queue tab |
| Frontend compose, tabs, toasts | [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx), [frontend/src/components/ComposeModal.tsx](frontend/src/components/ComposeModal.tsx) |

---

## 5. Behavior under load (1000+ emails at ~the same time)

When a large batch is scheduled for the same moment (e.g. 1000 recipients, `delayMs` small), the system does **not** fire 1000 sends at once. It degrades gracefully by design:

1. **Staggered enqueue.** `POST /api/batches` spreads the N jobs across `N × delayMs` starting at `startTime`, so even before the worker runs, jobs land in Redis with increasing `delay` — the queue itself is a timeline, not a burst.
2. **Concurrency + limiter.** The worker runs `WORKER_CONCURRENCY` in parallel, but the BullMQ **limiter** (`max: 1, duration: MIN_SEND_DELAY_MS`) caps *actual* sends to one per `MIN_SEND_DELAY_MS` ms per instance. Raising concurrency only speeds up rate-limited/rescheduled jobs, never the send rate.
3. **Rate limit spills to the next window.** Each send checks the Redis counter. When the per-sender (or global) hourly cap is hit, the job is `moveToDelayed`'d to the next window boundary and re-tried — **never dropped**, order preserved by the original `sequence` number.
4. **One Slack alert per window.** The first limit-hit in a window posts the live Slack alert (`SET key:alert NX PX hour`); subsequent hits in the same window stay quiet.
5. **Safe across instances.** Counters and the limiter key live in Redis, so multiple worker processes share the throttle — no in-memory drift.

You don't need to blast 1000 through Ethereal to demo it: schedule a big batch with a small hourly limit and watch the Queue tab — most jobs sit in `delayed`, a few send, and the rest roll into the next window.

## 6. Assumptions & trade-offs

- **DB is the source of truth**, not the queue. A job's `emailId` is its `jobId`, so the two can never disagree on which emails exist. If you kill Redis and re-init, the DB rows still say `scheduled` and the worker will re-enqueue them on next API call.
- **BullMQ v3** is pinned because the local Redis is 5.x (BullMQ v5 needs Redis ≥ 6.2). If you use Docker with Redis 7, bump `bullmq` to `^5` and `@bull-board/*` to `^6` in [backend/package.json](backend/package.json).
- **`jobId = email.id`** means a single email can never be double-sent even if the queue retries enqueue calls.
- **Slack alerts are fire-and-forget.** A Slack API failure logs a warning but never blocks or retries the email itself.
- **Slack OAuth `invalid_auth`** — the token exchange validates `client_id` + `client_secret` + a **redirect_uri that matches your app's registered "Redirect URLs" exactly**. If the exchange fails with `invalid_auth` on an otherwise-valid secret, the cause is almost always a redirect_uri mismatch (e.g. the app has `https://…` but the code posts to `http://localhost:4000/api/auth/slack/callback`). The callback now returns the exact registered URL to check. The **Incoming Webhook** path (`POST /api/auth/slack/webhook`) is the reliable fallback and needs no OAuth secret — alerts post to the channel the hook is bound to. Run `node backend/scripts/diag-slack-oauth.mjs` to surface Slack's real error + the exact authorize URL.
- **Dev login** is gated by `DEV_LOGIN_ENABLED` — defaults to `true` in `.env.example` for demo convenience, set `false` in any real deployment.
- **Ethereal auto-creates a fresh test account on first send** and re-creates it on crash. For production, set `SMTP_USER`/`SMTP_PASS`/`SMTP_HOST` explicitly.
- **Search** — when ES is disabled, search is a `LIKE` over to/from/subject/body in Postgres, which is fine for the demo data volume and degrades gracefully.
