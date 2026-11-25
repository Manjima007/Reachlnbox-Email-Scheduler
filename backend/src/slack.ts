import { env, slackConfigured } from './env';
import type { User } from '@prisma/client';

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_POST_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_AUTH_TEST_URL = 'https://slack.com/api/auth.test';

// A bot token configured in .env (SLACK_BOT_TOKEN) that can be used as the
// connection fallback when the OAuth code exchange fails — which happens on
// private/trial workspaces, where Slack won't honor the redirect_uri for
// oauth.v2.access. The bot token still posts to channels the bot is in.
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? env.SLACK_BOT_TOKEN;
export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? env.SLACK_WEBHOOK_URL;

/**
 * Validates a Bot User OAuth Token (xoxb-…) and returns the team + bot name.
 * Used by the "connect with a token" flow, which skips Slack's flaky
 * browser sign-in entirely.
 */
export async function validateSlackBotToken(
  token: string,
): Promise<{ teamId: string; botId: string; botName: string }> {
  const response = await fetch(SLACK_AUTH_TEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    team_id?: string;
    bot_id?: string;
    bot_user_id?: string;
    user?: string;
  };
  if (!payload.ok || !payload.team_id) {
    throw new Error(payload.error === 'invalid_auth' ? 'That token is not valid (or has expired).' : payload.error ?? 'Could not validate token');
  }
  return {
    teamId: payload.team_id,
    botId: payload.bot_id ?? payload.bot_user_id ?? '',
    botName: payload.user ?? 'Slack bot',
  };
}

export function slackConnectUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? '',
    redirect_uri: env.SLACK_REDIRECT_URI,
    response_type: 'code',
    scope: 'chat:write,chat:write.public,channels:read,groups:read',
    state,
  });
  // Pin the install to the app's deployed workspace. Private apps' OAuth
  // "workspace-signin" only matches the workspace the app was created in, so
  // without this the user lands on a sign-in that rejects their email.
  // Set SLACK_TEAM_ID in .env to your workspace's Team ID (T…).
  const teamId = process.env.SLACK_TEAM_ID ?? env.SLACK_TEAM_ID ?? '';
  if (teamId) params.set('team', teamId);
  params.set('install_redirect', '1');
  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

export async function exchangeSlackCode(code: string): Promise<{
  accessToken: string;
  teamId: string | null;
  userId: string | null;
  webhookUrl: string | null;
}> {
  if (!slackConfigured) throw new Error('Slack OAuth is not configured');
  const response = await fetch(SLACK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${env.SLACK_CLIENT_SECRET}`,
    },
    body: new URLSearchParams({
      code,
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });
  const payload = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string };
    authed_user?: { id: string };
    incoming_webhook?: { url: string };
  };
  if (!payload.ok || !payload.access_token) {
    // Surface Slack's real error + the most common causes so the user can fix
    // it instead of hitting a dead-end. The #1 cause of invalid_auth on a
    // working secret is a redirect_uri that doesn't match the app's config.
    const hint =
      payload.error === 'invalid_auth'
        ? ' — most often a redirect_uri mismatch. Confirm your Slack app\'s "Redirect URLs" include: ' +
          env.SLACK_REDIRECT_URI
        : payload.error === 'invalid_client_id'
          ? ' — the client_id (SLACK_CLIENT_ID) does not exist. Regenerate it in your app.'
          : '';
    throw new Error(`${payload.error ?? 'Slack token exchange failed'}${hint}`);
  }
  return {
    accessToken: payload.access_token,
    teamId: payload.team?.id ?? null,
    userId: payload.authed_user?.id ?? null,
    webhookUrl: payload.incoming_webhook?.url ?? null,
  };
}

/**
 * Posts an arbitrary test / status message to the user's connected Slack
 * (webhook first, then the OAuth token). Used by the "connect now" flow so
 * the user can verify a live, verifiable call landed in their channel.
 */
export async function sendSlackTestMessage(
  user: Pick<User, 'slackAccessToken' | 'slackWebhookUrl'> | null | undefined,
  text: string,
): Promise<{ delivered: boolean; channel: string | null }> {
  if (!user || (!user.slackAccessToken && !user.slackWebhookUrl)) {
    return { delivered: false, channel: null };
  }
  try {
    if (user.slackWebhookUrl) {
      const response = await fetch(user.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      // The webhook is bound to the channel the user chose when installing it;
      // return a deep link they can open to "see the channel".
      return { delivered: response.ok, channel: 'https://app.slack.com/client' };
    }
    const response = await fetch(SLACK_POST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${user.slackAccessToken}`,
      },
      body: JSON.stringify({ channel: env.SLACK_CHANNEL, text }),
    });
    const payload = (await response.json()) as { ok: boolean; channel?: string; error?: string };
    if (!payload.ok) console.warn('[slack] test message failed:', payload.error);
    return { delivered: payload.ok, channel: payload.channel ? `#${payload.channel}` : null };
  } catch (error) {
    console.warn('[slack] test message failed:', error instanceof Error ? error.message : error);
    return { delivered: false, channel: null };
  }
}

export async function notifySlackRateLimit(
  user: Pick<User, 'slackAccessToken' | 'slackWebhookUrl'> | null | undefined,
  detail: { fromEmail: string; limit: number; count: number; retryAt: number },
): Promise<boolean> {
  if (!user || (!user.slackAccessToken && !user.slackWebhookUrl)) {
    return false;
  }

  const retryTime = new Date(detail.retryAt).toISOString();
  const text =
    `:rotating_light: *ReachInbox — hourly limit reached*\n` +
    `*Sender:* \`${detail.fromEmail}\`\n` +
    `*Sent this hour:* ${detail.count}/${detail.limit}\n` +
    `*Blocked jobs rescheduled to:* ${retryTime}\n` +
    `:white_check_mark: This alert was posted live at ${new Date().toISOString()}.`;

  try {
    if (user.slackWebhookUrl) {
      const response = await fetch(user.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return response.ok;
    }

    // Discover the channel the bot is installed into, so we post where alerts
    // can actually land instead of hardcoding a channel the bot may not join.
    const channel = await resolveBotChannel(user.slackAccessToken!, env.SLACK_CHANNEL);
    const response = await fetch(SLACK_POST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${user.slackAccessToken}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const payload = (await response.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      console.warn('[slack] chat.postMessage failed:', payload.error, `(channel=${channel})`);
    }
    return payload.ok;
  } catch (error) {
    console.warn('[slack] notification failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Returns the channel id/name to post to for a bot token. Prefers the
 * configured SLACK_CHANNEL if the bot is installed there, otherwise falls
 * back to the first public channel the bot can see. Avoids the
 * "not_in_channel" failure when the configured channel isn't one the bot is
 * a member of.
 */
export async function resolveBotChannel(token: string, configured: string): Promise<string> {
  try {
    const list = await fetch('https://slack.com/api/conversations.list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ types: 'public_channel', exclude_archived: true }),
    }).then((r) => r.json()) as { ok: boolean; channels?: { id: string; name: string }[] };
    if (list.ok && list.channels?.length) {
      // Match by name first (SLACK_CHANNEL may be "#new-channel" or "new-channel").
      const cfg = configured.replace(/^#/, '');
      const match = list.channels.find((c) => c.name === cfg || c.name === configured);
      if (match) return match.id;
      return list.channels[0].id;
    }
  } catch {
    /* fall through to the configured name */
  }
  return configured;
}
