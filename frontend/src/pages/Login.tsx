import { useState, type FormEvent } from 'react';
import { Lock, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { AppConfig } from '../types';
import { Button } from '../components/Button';

interface Props {
  config: AppConfig | null;
  onLogin: () => void;
  notify: (message: string, kind: 'success' | 'error' | 'info') => void;
}

export function Login({ config, onLogin, notify }: Props) {
  const [email, setEmail] = useState('demo@reachinbox.ai');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function devLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      await api.devLogin(email, email.split('@')[0]);
      onLogin();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
            <Mail size={22} />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">ReachInbox</div>
            <div className="text-xs text-slate-500">Email Job Scheduler</div>
          </div>
        </div>

        <div className="card p-8">
          <h1 className="mb-1 text-2xl font-bold text-slate-900">Login</h1>
          <p className="mb-6 text-sm text-slate-500">Sign in to schedule, track and search your email sequences.</p>

          <a
            href="/api/auth/google"
            aria-disabled={config ? !config.googleConfigured : true}
            onClick={(event) => {
              if (!config?.googleConfigured) event.preventDefault();
            }}
            title={config?.googleConfigured ? 'Continue with Google' : 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable'}
            className={`flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition ${
              config?.googleConfigured
                ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                : 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.75 24c0-1.6.27-3.14.78-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            Log in with Google
          </a>

          {!config?.googleConfigured && (
            <p className="mt-2 text-center text-xs text-amber-600">Google OAuth not configured — see README.</p>
          )}

          {config?.devLoginEnabled && (
            <>
              <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                or sign up through email
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <form onSubmit={devLogin} className="space-y-4">
                <div>
                  <label className="label" htmlFor="login-email">Email ID</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-email"
                      type="email"
                      className="input !pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="login-password">Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="login-password"
                      type="password"
                      className="input !pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">Demo access — any password works.</p>
                </div>
                <Button type="submit" loading={loading} className="w-full">
                  Login
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={13} /> Sessions are stored in secure httpOnly cookies
          </div>
        </div>
      </div>
    </div>
  );
}
