/**
 * Login — token entry OR invite-code redeem.
 *
 * Two paths:
 *  1. Existing user: paste auth_token. POSTs to /login (existing BinDrive
 *     endpoint). Sets bindrive_session cookie.
 *  2. New user (invite): display name + INV-XXXXXXXX. POSTs to
 *     /api/onboard/redeem.
 *
 * Demo mode: if GET /api/onboard/demo shows demo=true, the invite form
 * collapses to "Try the demo" (display name only, code=null).
 *
 * Spec: docs/webui-chat-design.md §10.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { redeemInvite } from '../api.js';
import { setStoredSession } from '../auth.js';
import { Loader2, ShieldCheck } from 'lucide-react';

interface LoginProps {
  onSuccess: () => void;
}

interface DemoState {
  enabled: boolean;
}

export function Login({ onSuccess }: LoginProps) {
  const [tab, setTab] = useState<'token' | 'invite'>('token');
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/onboard/demo', { credentials: 'include' })
      .then((r) => r.json())
      .then((b: DemoState & { error?: string }) => {
        if (b && typeof b.enabled === 'boolean') {
          setDemo({ enabled: b.enabled });
        } else if (b?.error) {
          setDemoError(b.error);
        }
      })
      .catch((err: unknown) => {
        setDemoError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (demo?.enabled) {
    return (
      <DemoLogin
        onRedeemed={(slug, displayName) => {
          setStoredSession({ type: 'user', slug, displayName });
          onSuccess();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="mb-5 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Invester · Web</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your portfolio analyst in the browser.
          </p>
        </header>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setTab('token')}
            className={
              'flex-1 rounded-md py-1.5 font-medium transition ' +
              (tab === 'token' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')
            }
          >
            Existing user
          </button>
          <button
            type="button"
            onClick={() => setTab('invite')}
            className={
              'flex-1 rounded-md py-1.5 font-medium transition ' +
              (tab === 'invite' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')
            }
          >
            Redeem invite
          </button>
        </div>

        {tab === 'token' ? (
          <TokenForm onSuccess={onSuccess} />
        ) : (
          <InviteForm
            onRedeemed={(slug, displayName) => {
              setStoredSession({ type: 'user', slug, displayName });
              onSuccess();
            }}
          />
        )}

        {demoError && (
          <p className="mt-3 text-xs text-slate-400">(demo state check skipped: {demoError})</p>
        )}
      </div>
    </div>
  );
}

function TokenForm({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (isAdmin) {
        if (!username || !password) {
          throw new Error('Username and password are required for admin login.');
        }
      } else {
        if (!token.trim()) {
          throw new Error('Auth token is required.');
        }
      }
      const body = isAdmin
        ? { username, password }
        : { auth_token: token.trim() };
      const res = await fetch('/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(b.error || b.message || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        type: 'user' | 'admin';
        slug: string;
        displayName?: string;
      };
      setStoredSession({
        type: json.type,
        slug: json.slug,
        displayName: json.displayName ?? (json.type === 'admin' ? 'admin' : json.slug),
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {!isAdmin && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Auth token
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="660e8400-..."
          />
        </label>
      )}
      {isAdmin && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Username
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
        </>
      )}

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={isAdmin}
          onChange={(e) => setIsAdmin(e.target.checked)}
        />
        Admin login
      </label>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {isAdmin ? 'Sign in as admin' : 'Sign in'}
      </button>
    </form>
  );
}

function InviteForm({
  onRedeemed,
}: {
  onRedeemed: (slug: string, displayName: string) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmedName = displayName.trim();
      const trimmedCode = code.trim();
      if (!trimmedName) throw new Error('Display name is required.');
      if (trimmedName.length > 60) throw new Error('Display name is too long (max 60 chars).');
      if (!trimmedCode) throw new Error('Invite code is required.');

      const res = await redeemInvite(trimmedName, trimmedCode);
      onRedeemed(res.slug, trimmedName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Display name
        </span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Alice Chen"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">
          Invite code
        </span>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="INV-XXXXXXXX"
        />
      </label>
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Redeem & start
      </button>
    </form>
  );
}

function DemoLogin({
  onRedeemed,
}: {
  onRedeemed: (slug: string, displayName: string) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = displayName.trim();
      if (!trimmed) throw new Error('Display name is required.');
      if (trimmed.length > 60) throw new Error('Display name is too long (max 60 chars).');
      const res = await redeemInvite(trimmed, null);
      onRedeemed(res.slug, trimmed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <header className="mb-2 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Invester · Demo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your name to try the agent with a sample portfolio.
          </p>
        </header>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Your name"
        />
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Try the demo
        </button>
      </form>
    </div>
  );
}
