import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ListChecks, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

const DEMO_ACCOUNTS = [
  ["admin", "System administrator"],
  ["officer", "AICTE officer"],
  ["authority", "Competent authority (approver)"],
  ["auditor", "Read-only auditor"],
  ["userdemoa", "Institution user — College A"],
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <ListChecks className="h-8 w-8 text-teal-400" />
          <div>
            <p className="text-lg font-semibold">FDR SENTINEL</p>
            <p className="text-xs text-slate-300">
              AI-assisted security deposit monitoring &amp; lifecycle management
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Use an authorised account to access the platform.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form className="mt-5" onSubmit={onSubmit}>
            <label className="mb-3 block">
              <span className="label">Username or email</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                data-testid="username"
              />
            </label>
            <label className="mb-4 block">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                data-testid="password"
              />
            </label>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <ShieldAlert className="h-3.5 w-3.5" /> Synthetic demo accounts
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-slate-500">
              {DEMO_ACCOUNTS.map(([u, d]) => (
                <li key={u} className="flex justify-between gap-2">
                  <code className="font-mono text-slate-700">{u}</code>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Password: <code className="font-mono">Demo@Sentinel123</code> · development data only
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Prototype — not connected to AICTE production systems or any bank's infrastructure.
        </p>
      </div>
    </div>
  );
}
