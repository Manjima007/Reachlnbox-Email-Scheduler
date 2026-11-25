import { useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Lock, Slack, Unplug, Webhook } from 'lucide-react';
import { api } from '../api';
import type { AuthUser } from '../types';
import { Button } from './Button';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  user: AuthUser;
  onClose: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
  notify: (message: string, kind: 'success' | 'error' | 'info') => void;
}

type Tab = 'oauth' | 'webhook' | 'token';

/**
 * Three ways to connect Slack:
 *  - OAuth: the real authorize flow (flaky if your Slack sign-in email differs).
 *  - Token: paste your Bot User OAuth Token (xoxb-…) — skips sign-in, most reliable.
 *  - Webhook: paste an Incoming Webhook URL — no OAuth secret required.
 * All store per-user; rate-limit alerts use whichever is configured.
 */
export function SlackConnectDialog({ open, user, onClose, onConnected, onDisconnected, notify }: Props) {
  const [tab, setTab] = useState<Tab>('webhook');
  const [webhook, setWebhook] = useState(user.slackWebhookUrl ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ delivered: boolean; channel: string | null; botName?: string } | null>(null);

  async function connectToken() {
    setBusy(true);
    setLastResult(null);
    try {
      const result = await api.setSlackToken(token.trim());
      setLastResult({ delivered: result.delivered, channel: result.delivered ? 'https://app.slack.com/client' : null, botName: result.botName });
      onConnected();
      if (result.delivered) {
        notify(`Slack connected via ${result.botName} — a proof message just posted to your channel.`, 'success');
        window.open('https://app.slack.com/client', '_blank', 'noopener');
      } else {
        notify('Token connected, but the proof message did not post to the channel. Check the bot has channel access.', 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not connect Slack with token', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function connectWebhook() {
    setBusy(true);
    setLastResult(null);
    try {
      await api.setSlackWebhook(webhook.trim());
      const test = await api.testSlack();
      setLastResult({ delivered: test.delivered, channel: test.channel });
      onConnected();
      if (test.delivered) {
        notify('Slack connected — a proof message just posted to your channel.', 'success');
        if (test.channel) window.open(test.channel, '_blank', 'noopener');
      } else {
        notify('Webhook saved, but the proof message did not post. Check the channel access.', 'error');
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not connect Slack', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.disconnectSlack();
      notify('Slack disconnected', 'info');
      onDisconnected();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not disconnect Slack', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Connect Slack" subtitle="Link your channel so rate-limit alerts post there">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
          <button
            onClick={() => setTab('oauth')}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === 'oauth' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sign in with Slack
          </button>
          <button
            onClick={() => setTab('webhook')}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === 'webhook' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Webhook <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] font-bold text-brand-700">Recommended</span>
          </button>
          <button
            onClick={() => setTab('token')}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${tab === 'token' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Token
          </button>
        </div>

        {tab === 'oauth' ? (
          <>
            <div className="rounded-lg bg-brand-50 p-3 text-xs leading-relaxed text-brand-800 ring-1 ring-brand-100">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <Slack size={13} /> Real OAuth flow
              </p>
              <p>
                Opens Slack's authorize page, picks your workspace, and stores a token + webhook for your account.
                Alerts then post live to the configured channel.
              </p>
              <p className="mt-1.5 text-brand-700">
                Slack requires an <b>HTTPS</b> redirect URL, so OAuth cannot complete on plain localhost. Use the{' '}
                <b>Webhook</b> or <b>Token</b> tab locally, or point{' '}
                <code className="rounded bg-white px-1 py-0.5">SLACK_REDIRECT_URI</code> at an HTTPS tunnel / deployed URL
                that is also listed under your app's Redirect URLs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/api/auth/slack"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
              >
                <Slack size={15} /> Connect with Slack OAuth
              </a>
              {user.slackConnected && (
                <Button variant="secondary" loading={busy} onClick={() => void disconnect()} icon={<Unplug size={15} />}>
                  Disconnect
                </Button>
              )}
              <button
                onClick={() => window.open('https://app.slack.com', '_blank', 'noopener')}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <ExternalLink size={13} /> Open Slack
              </button>
            </div>

            {user.slackConnected && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-brand-700">
                <CheckCircle2 size={14} /> Connected — alerts will post to your channel
              </div>
            )}
          </>
        ) : tab === 'token' ? (
          <>
            <div className="rounded-lg bg-brand-50 p-3 text-xs leading-relaxed text-brand-800 ring-1 ring-brand-100">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <Slack size={13} /> Connect with a Bot User Token
              </p>
              <p>
                Paste the <b>Bot User OAuth Token</b> from your Slack app's <b>OAuth &amp; Permissions</b> page
                (starts with <code>xoxb-</code>). It skips the sign-in step entirely and is the most reliable option.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="slack-token">Bot User OAuth Token</label>
              <input
                id="slack-token"
                className="input font-mono !text-xs"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="xoxb-12432935771094-…"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={busy} onClick={() => void connectToken()} icon={<Slack size={15} />}>
                Connect with token
              </Button>
              {user.slackConnected && (
                <Button variant="secondary" loading={busy} onClick={() => void disconnect()} icon={<Unplug size={15} />}>
                  Disconnect
                </Button>
              )}
            </div>
            {busy && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Validating token…
              </p>
            )}
            {lastResult?.delivered && lastResult.botName && (
              <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-800 ring-1 ring-brand-100">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Connected as {lastResult.botName} — proof message just posted to your channel.</p>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rounded-lg bg-brand-50 p-3 text-xs leading-relaxed text-brand-800 ring-1 ring-brand-100">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <Webhook size={13} /> How to get the webhook URL
              </p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>In your channel, click <b>⋯ → Integrations → Incoming Webhooks</b></li>
                <li><b>Add New Webhook</b> → pick the channel → <b>Install</b></li>
                <li>Copy the <code>hooks.slack.com/services/…</code> URL and paste it below</li>
              </ol>
            </div>

            <div>
              <label className="label" htmlFor="slack-webhook">
                <Lock size={11} className="mr-1" /> Incoming Webhook URL
              </label>
              <input
                id="slack-webhook"
                className="input font-mono !text-xs"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button loading={busy} onClick={() => void connectWebhook()} icon={<Slack size={15} />}>
                Connect & send proof message
              </Button>
              {user.slackConnected && (
                <Button variant="secondary" loading={busy} onClick={() => void disconnect()} icon={<Unplug size={15} />}>
                  Disconnect
                </Button>
              )}
              <button
                onClick={() => window.open('https://app.slack.com', '_blank', 'noopener')}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <ExternalLink size={13} /> Open Slack
              </button>
            </div>

            {busy && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Verifying your channel…
              </p>
            )}

            {lastResult?.delivered && (
              <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-800 ring-1 ring-brand-100">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Proof message delivered to your channel just now.</p>
                  <p className="mt-0.5 text-brand-700">
                    Open it to verify:
                    <a
                      href={lastResult.channel ?? 'https://app.slack.com'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 inline-flex items-center gap-1 underline hover:text-brand-800"
                    >
                      view channel <ExternalLink size={11} />
                    </a>
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
