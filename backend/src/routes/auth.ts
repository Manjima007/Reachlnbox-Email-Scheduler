import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env, DEV_LOGIN_ENABLED, googleConfigured, slackConfigured } from '../env';
import { prisma } from '../db';
import { asyncHandler } from '../utils/asyncHandler';
import {
  AUTH_COOKIE,
  type AuthedRequest,
  requireAuth,
  setSessionCookie,
} from '../middleware/auth';
import { exchangeSlackCode, slackConnectUrl, sendSlackTestMessage, validateSlackBotToken, SLACK_BOT_TOKEN } from '../slack';

export const authRouter = Router();

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  slackAccessToken: string | null;
  slackWebhookUrl?: string | null;
  slackTeamId: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    // "Connected" means either a Slack OAuth token OR an incoming webhook is set —
    // both can deliver rate-limit alerts to the user's channel.
    slackConnected: Boolean(user.slackAccessToken || user.slackWebhookUrl),
    slackTeamId: user.slackTeamId,
  };
}

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({
    user: publicUser(req.user!),
    config: {
      googleConfigured,
      slackConfigured,
      devLoginEnabled: DEV_LOGIN_ENABLED,
      minDelayMs: env.MIN_SEND_DELAY_MS,
      maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR,
      rateLimitScope: env.RATE_LIMIT_SCOPE,
    },
  });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.post(
  '/dev-login',
  asyncHandler(async (req, res) => {
    if (!DEV_LOGIN_ENABLED) {
      res.status(404).json({ error: 'Dev login is disabled' });
      return;
    }
    const parsed = z
      .object({
        email: z.string().email().default(env.DEVELOPER_ACCESS_EMAIL),
        name: z.string().min(1).max(120).default('ReachInbox Demo'),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dev login payload' });
      return;
    }
    const user = await prisma.user.upsert({
      where: { email: parsed.data.email.toLowerCase() },
      update: {},
      create: {
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        avatarUrl: null,
      },
    });
    setSessionCookie(res, user.id);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.get('/google', (req, res) => {
  if (!googleConfigured) {
    res.redirect(`${env.FRONTEND_URL}/login?error=google_not_configured`);
    return;
  }
  const client = new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALLBACK_URL,
  );
  const state = jwt.sign({ nonce: Math.random().toString(36).slice(2) }, env.JWT_SECRET, {
    expiresIn: '10m',
  });
  res.cookie('reachinbox_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  const url = client.generateAuthUrl({
    access_type: 'online',
    prompt: 'select_account',
    scope: ['openid', 'email', 'profile'],
    state,
  });
  res.redirect(url);
});

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.redirect(`${env.FRONTEND_URL}/login?error=invalid_callback`);
      return;
    }
    try {
      jwt.verify(state, env.JWT_SECRET);
      if (req.cookies?.reachinbox_oauth_state !== state) {
        throw new Error('state mismatch');
      }
    } catch {
      res.clearCookie('reachinbox_oauth_state', { path: '/' });
      res.redirect(`${env.FRONTEND_URL}/login?error=invalid_state`);
      return;
    }
    const client = new OAuth2Client(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_CALLBACK_URL,
    );
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const profile = ticket.getPayload();
    if (!profile?.email) {
      res.redirect(`${env.FRONTEND_URL}/login?error=no_email`);
      return;
    }

    const user = await prisma.user.upsert({
      where: { googleId: profile.sub },
      update: {
        name: profile.name ?? profile.email,
        email: profile.email.toLowerCase(),
        avatarUrl: profile.picture ?? null,
      },
      create: {
        googleId: profile.sub,
        email: profile.email.toLowerCase(),
        name: profile.name ?? profile.email,
        avatarUrl: profile.picture ?? null,
      },
    });
    setSessionCookie(res, user.id);
    res.clearCookie('reachinbox_oauth_state', { path: '/' });
    res.redirect(`${env.FRONTEND_URL}/?auth=success`);
  }),
);

authRouter.get('/slack', requireAuth, (req: AuthedRequest, res) => {
  if (!slackConfigured) {
    res.redirect(`${env.FRONTEND_URL}/?slack=not_configured`);
    return;
  }
  const state = jwt.sign({ sub: req.user!.id }, env.JWT_SECRET, { expiresIn: '10m' });
  res.cookie('reachinbox_slack_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
  res.redirect(slackConnectUrl(state));
});

authRouter.get(
  '/slack/callback',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (typeof code !== 'string' || typeof state !== 'string') {
      res.redirect(`${env.FRONTEND_URL}/?slack=invalid_callback`);
      return;
    }
    try {
      jwt.verify(state, env.JWT_SECRET);
      if (req.cookies?.reachinbox_slack_state !== state) {
        throw new Error('state mismatch');
      }
    } catch {
      res.clearCookie('reachinbox_slack_state', { path: '/' });
      res.redirect(`${env.FRONTEND_URL}/?slack=invalid_state`);
      return;
    }
    res.clearCookie('reachinbox_slack_state', { path: '/' });
    try {
      const tokens = await exchangeSlackCode(code);
      await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          slackAccessToken: tokens.accessToken,
          // Only overwrite the webhook if the exchange actually returned one;
          // otherwise keep any pre-set webhook so alerts keep working.
          slackWebhookUrl: tokens.webhookUrl ?? undefined,
          slackTeamId: tokens.teamId,
          slackUserId: tokens.userId,
          slackConnectedAt: new Date(),
        },
      });
      res.redirect(`${env.FRONTEND_URL}/?slack=connected`);
    } catch (error) {
      // The OAuth code exchange can fail on private/trial workspaces (Slack
      // won't honor the redirect_uri there). In that case, fall back in order:
      //   1. the user's stored incoming webhook
      //   2. the app's configured bot token (SLACK_BOT_TOKEN)
      // Either one still delivers live rate-limit alerts, so we can mark the
      // user connected instead of dead-ending on "?slack=failed".
      console.error('[slack] oauth exchange failed, falling back:', (error as Error).message);
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

      if (user?.slackWebhookUrl) {
        await prisma.user.update({ where: { id: user.id }, data: { slackConnectedAt: new Date() } });
        res.redirect(`${env.FRONTEND_URL}/?slack=connected`);
        return;
      }

      if (SLACK_BOT_TOKEN) {
        try {
          const info = await validateSlackBotToken(SLACK_BOT_TOKEN);
          await prisma.user.update({
            where: { id: req.user!.id },
            data: {
              slackAccessToken: SLACK_BOT_TOKEN,
              slackTeamId: info.teamId,
              slackConnectedAt: new Date(),
            },
          });
          res.redirect(`${env.FRONTEND_URL}/?slack=connected`);
          return;
        } catch (botErr) {
          console.warn('[slack] bot token fallback failed:', (botErr as Error).message);
        }
      }

      res.redirect(`${env.FRONTEND_URL}/?slack=failed`);
    }
  }),
);

// Set / update the Slack Incoming Webhook directly. This is the reliable way
// to "connect" Slack without the OAuth secret — alerts will post to this URL.
authRouter.post(
  '/slack/webhook',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const webhook = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl.trim() : '';
    if (!webhook || !webhook.startsWith('https://hooks.slack.com/services/')) {
      res.status(400).json({ error: 'Provide a valid Slack Incoming Webhook URL' });
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { slackWebhookUrl: webhook, slackConnectedAt: new Date() },
    });
    res.json({
      ok: true,
      slackConnected: true,
      user: {
        ...publicUser(user),
        slackConnected: true,
      },
    });
  }),
);

// Verify the stored Slack webhook (or token) can actually post to a channel.
// A live, verifiable call — the user can open the channel and see it land.
authRouter.post(
  '/slack/test',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { delivered, channel } = await sendSlackTestMessage(
      user,
      `⚙️ *ReachInbox connection test* — Slack is wired up. Hourly rate-limit alerts will post here.\n` +
        `:white_check_mark: This message was just delivered live.`,
    );
    res.json({ ok: delivered, delivered, channel });
  }),
);

// Connect with a Bot User OAuth Token (xoxb-…) directly. This skips Slack's
// browser sign-in (which is flaky when the signing-in email isn't a workspace
// member) and just validates + stores the token. Alerts post via this token.
authRouter.post(
  '/slack/token',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!/^xoxb-[0-9A-Za-z-]+$/.test(token)) {
      res.status(400).json({ error: 'Provide a valid Bot User OAuth Token (starts with xoxb-)' });
      return;
    }
    try {
      const info = await validateSlackBotToken(token);
      const user = await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          slackAccessToken: token,
          slackTeamId: info.teamId,
          slackUserId: info.botId || undefined,
          slackConnectedAt: new Date(),
        },
      });
      const ok = await sendSlackTestMessage(
        { slackAccessToken: token, slackWebhookUrl: user.slackWebhookUrl },
        '⚙️ *ReachInbox connected* — rate-limit alerts will post here.',
      );
      res.json({
        ok: true,
        delivered: ok,
        botName: info.botName,
        teamId: info.teamId,
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  }),
);

authRouter.post(
  '/slack/disconnect',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        slackAccessToken: null,
        slackWebhookUrl: null,
        slackTeamId: null,
        slackUserId: null,
        slackConnectedAt: null,
      },
    });
    res.json({ ok: true });
  }),
);
