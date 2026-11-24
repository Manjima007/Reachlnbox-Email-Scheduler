import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Toast, type ToastState } from './components/Toast';
import type { AppConfig, AuthResponse } from './types';

export default function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, kind: ToastState['kind'] = 'info') => {
    setToast({ message, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const me = await api.me();
      setAuth(me);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuth(null);
      } else {
        notify(error instanceof Error ? error.message : 'Could not load session', 'error');
      }
    }
  }, [notify]);

  useEffect(() => {
    (async () => {
      try {
        const publicConfig = await api.config();
        setConfig(publicConfig);
      } catch {
        notify('Backend is unreachable — start the API on port 4000', 'error');
      }
      await refreshAuth();
      setLoading(false);
    })();
  }, [refreshAuth, notify]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
      </div>
    );
  }

  return (
    <>
      {auth ? (
        <Dashboard
          auth={auth}
          onLogout={() => setAuth(null)}
          onAuthChanged={() => void refreshAuth()}
          notify={notify}
        />
      ) : (
        <Login config={config} onLogin={() => void refreshAuth()} notify={notify} />
      )}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
