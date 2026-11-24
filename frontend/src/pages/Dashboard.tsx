import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ListFilter,
  MailPlus,
  RefreshCw,
  Search,
  Send,
  BarChart3,
} from 'lucide-react';
import { api } from '../api';
import type { AuthResponse, Email, QueueJob, QueueStats, SearchResult, Sender, Stats } from '../types';
import { Button } from '../components/Button';
import { Compose } from '../components/Compose';
import { EmailTable } from '../components/EmailTable';
import { EmptyState, LoadingRows } from '../components/EmptyState';
import { Header } from '../components/Header';
import { StatusBadge } from '../components/StatusBadge';

type Tab = 'scheduled' | 'sent' | 'failed' | 'search' | 'queue';

interface Props {
  auth: AuthResponse;
  onLogout: () => void;
  onAuthChanged: () => void;
  notify: (message: string, kind: 'success' | 'error' | 'info') => void;
}

const tabs: { id: Tab; label: string; icon: typeof Clock3 }[] = [
  { id: 'scheduled', label: 'Scheduled Emails', icon: Clock3 },
  { id: 'sent', label: 'Sent Emails', icon: Send },
  { id: 'failed', label: 'Failed', icon: AlertTriangle },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'queue', label: 'Queue', icon: Activity },
];

export function Dashboard({ auth, onLogout, onAuthChanged, notify }: Props) {
  const [tab, setTab] = useState<Tab>('scheduled');
  const [emails, setEmails] = useState<Email[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>([]);
  const [queueState, setQueueState] = useState('delayed');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchSource, setSearchSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [statsResult, sendersResult] = await Promise.all([api.stats(), api.senders()]);
      setStats(statsResult);
      setSenders(sendersResult.data);
      if (tab === 'queue') {
        const [queue, jobs] = await Promise.all([api.queueStats(), api.queueJobs(queueState)]);
        setQueueStats(queue);
        setQueueJobs(jobs.data);
      } else if (tab !== 'search') {
        const result = await api.emails(tab);
        setEmails(result.data);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not refresh data', 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, queueState, notify]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab === 'search') return;
    const interval = window.setInterval(() => void refresh(), tab === 'queue' ? 2000 : 5000);
    return () => window.clearInterval(interval);
  }, [tab, refresh]);

  useEffect(() => {
    if (tab !== 'search' || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.search(query.trim());
        setSearchResults(result.data);
        setSearchSource(result.source);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Search failed', 'error');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, tab, notify]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    const slackStatus = params.get('slack');
    if (authStatus === 'success') notify('Signed in with Google successfully', 'success');
    if (slackStatus === 'connected') {
      notify('Slack connected — rate-limit alerts will be sent to your workspace', 'success');
      onAuthChanged();
    }
    if (slackStatus === 'not_configured') notify('Configure Slack OAuth credentials first (see README)', 'error');
    if (slackStatus && slackStatus !== 'connected' && slackStatus !== 'not_configured') {
      notify(`Slack connection ${slackStatus.replace(/_/g, ' ')}`, 'error');
    }
  }, [notify, onAuthChanged]);

  async function cancel(id: string) {
    setBusy(true);
    try {
      await api.cancelEmail(id);
      notify('Scheduled email cancelled', 'success');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Cancel failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.logout();
    onLogout();
  }

  async function refreshAuthAndNotify(message: string, kind: 'success' | 'error' | 'info') {
    onAuthChanged();
    notify(message, kind);
  }

  // Compose is a full page, not a modal — render it in place of the dashboard.
  if (composeOpen) {
    return (
      <Compose
        config={auth.config}
        senders={senders}
        onBack={() => setComposeOpen(false)}
        onScheduled={() => void refresh()}
        notify={notify}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        user={auth.user}
        config={auth.config}
        onLogout={() => void logout()}
        onConnected={() => void refreshAuthAndNotify('Slack connected', 'success')}
        onDisconnected={() => void refreshAuthAndNotify('Slack disconnected', 'info')}
        onNotify={notify}
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Email Scheduler</h1>
            <p className="mt-1 text-sm text-slate-500">Schedule, monitor and search every email in one place.</p>
          </div>
          <Button icon={<MailPlus size={17} />} onClick={() => setComposeOpen(true)}>Compose new email</Button>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Scheduled', value: stats?.scheduled, icon: Clock3, tone: 'text-brand-700 bg-brand-50' },
            { label: 'Sent', value: stats?.sent, icon: CheckCircle2, tone: 'text-brand-600 bg-brand-50' },
            { label: 'Failed', value: stats?.failed, icon: AlertTriangle, tone: 'text-rose-600 bg-rose-50' },
            { label: 'Total', value: stats?.total, icon: BarChart3, tone: 'text-slate-700 bg-slate-100' },
          ].map((card) => (
            <div key={card.label} className="card flex items-center gap-4 p-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${card.tone}`}>
                <card.icon size={20} />
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">{card.value ?? '—'}</div>
                <div className="text-xs font-medium text-slate-500">{card.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 pt-3">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  tab === item.id
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <item.icon size={15} /> {item.label}
              </button>
            ))}
            <button
              onClick={() => void refresh()}
              title="Refresh now"
              className="ml-auto mb-2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {(tab === 'scheduled' || tab === 'sent' || tab === 'failed') && (
            <EmailTable emails={emails} mode={tab} loading={loading} onCancel={tab === 'scheduled' ? (id) => void cancel(id) : undefined} />
          )}

          {tab === 'search' && (
            <div>
              <div className="flex flex-wrap items-center gap-3 p-5">
                <div className="relative min-w-[260px] flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input !pl-9"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search recipient, subject, body or sender…"
                  />
                </div>
                {searchSource && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                    <ListFilter size={13} /> via {searchSource === 'elasticsearch' ? 'Elasticsearch' : 'PostgreSQL fallback'}
                  </span>
                )}
              </div>
              {query.trim().length < 2 ? (
                <EmptyState title="Search your emails" description="Type at least two characters to search across all scheduled and sent emails." />
              ) : searchResults.length === 0 ? (
                <EmptyState title="No matches" description="Try a different recipient, subject or keyword." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Email</th>
                        <th className="px-6 py-3">Subject</th>
                        <th className="px-6 py-3">Scheduled</th>
                        <th className="px-6 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {searchResults.map((result) => (
                        <tr key={result.id} className="hover:bg-slate-50/70">
                          <td className="px-6 py-4 font-medium text-slate-800">{result.toEmail}</td>
                          <td className="max-w-xs truncate px-6 py-4 text-slate-600">{result.subject}</td>
                          <td className="px-6 py-4 text-slate-500">{new Date(result.sendAt).toLocaleString()}</td>
                          <td className="px-6 py-4"><StatusBadge status={result.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'queue' && (
            <div className="p-5">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(queueStats?.counts ?? {}).map(([state, count]) => (
                    <span key={state} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
                      {state}: {count}
                    </span>
                  ))}
                </div>
                <a href="/admin/queues" target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                  Open BullMQ dashboard <ExternalLink size={13} />
                </a>
              </div>
              <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span>Concurrency: <b className="text-slate-700">{queueStats?.concurrency ?? '—'}</b></span>
                <span>Min delay: <b className="text-slate-700">{queueStats?.minDelayMs ?? '—'} ms</b></span>
                <span>Hourly cap: <b className="text-slate-700">{queueStats?.maxEmailsPerHour ?? '—'}</b></span>
                <span>Scope: <b className="text-slate-700">{queueStats?.rateLimitScope ?? '—'}</b></span>
              </div>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Job state</label>
                <select className="input !w-40 !py-1.5" value={queueState} onChange={(event) => setQueueState(event.target.value)}>
                  {['delayed', 'waiting', 'active', 'completed', 'failed'].map((state) => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400">Live refresh every 2s</span>
              </div>
              {loading && queueJobs.length === 0 ? (
                <LoadingRows columns={4} />
              ) : queueJobs.length === 0 ? (
                <EmptyState title={`No ${queueState} jobs`} description="BullMQ jobs in this state will appear here automatically." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Recipient</th>
                        <th className="px-6 py-3">Subject</th>
                        <th className="px-6 py-3">Run at</th>
                        <th className="px-6 py-3">Attempts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {queueJobs.map((job) => (
                        <tr key={job.id ?? Math.random()} className="hover:bg-slate-50/70">
                          <td className="px-6 py-3 text-slate-800">{job.toEmail}</td>
                          <td className="max-w-xs truncate px-6 py-3 text-slate-600">{job.subject}</td>
                          <td className="px-6 py-3 text-slate-500">{new Date(job.sendAt).toLocaleString()}</td>
                          <td className="px-6 py-3 text-slate-500">{job.attemptsMade}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Persistent BullMQ jobs · Redis counters for throttling · Ethereal SMTP previews · {busy ? 'working…' : 'all systems ready'}
        </p>
      </main>
    </div>
  );
}
