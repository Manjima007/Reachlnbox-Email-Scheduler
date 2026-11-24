import { useState } from 'react';
import { LogOut, Mail, MessageSquare, Slack, CheckCircle2 } from 'lucide-react';
import { Button } from './Button';
import { SlackConnectDialog } from './SlackConnectDialog';
import type { AppConfig, AuthUser } from '../types';

interface Props {
  user: AuthUser;
  config?: AppConfig;
  onLogout: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onNotify?: (message: string, kind: 'success' | 'error' | 'info') => void;
}

export function Header({ user, onLogout, onConnected, onDisconnected, onNotify }: Props) {
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
              <Mail size={18} />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight text-slate-900">ReachInbox</div>
              <div className="text-[11px] leading-tight text-slate-500">Email Scheduler</div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <button
              onClick={() => setConnectOpen(true)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                user.slackConnected
                  ? 'border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
              title="Connect a Slack channel via Incoming Webhook"
            >
              <Slack size={15} />
              {user.slackConnected ? 'Slack connected' : 'Connect Slack'}
              {user.slackConnected && <CheckCircle2 size={13} className="text-brand-600" />}
            </button>

            <div className="h-8 w-px bg-slate-200" />

            <div className="flex items-center gap-2.5">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:block">
                <div className="text-sm font-semibold leading-tight text-slate-900">{user.name}</div>
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <MessageSquare size={10} /> {user.email}
                </div>
              </div>
            </div>

            <Button variant="ghost" icon={<LogOut size={15} />} onClick={onLogout} className="!px-2 !py-2">
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <SlackConnectDialog
        open={connectOpen}
        user={user}
        onClose={() => setConnectOpen(false)}
        onConnected={onConnected}
        onDisconnected={onDisconnected}
        notify={(msg, kind) => onNotify?.(msg, kind)}
      />
    </>
  );
}
