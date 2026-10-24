import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Signup() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Account creation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <ShieldCheck className="h-8 w-8 text-teal-400" />
          <div>
            <p className="text-lg font-semibold">FDR SENTINEL</p>
            <p className="text-xs text-slate-300">Create an authorised account</p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">Create account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Use a valid institutional email and a secure password.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form className="mt-5" onSubmit={onSubmit}>
            <label className="mb-3 block">
              <span className="label">Username</span>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                data-testid="username"
              />
            </label>
            <label className="mb-3 block">
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                data-testid="email"
              />
            </label>
            <label className="mb-4 block">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                data-testid="password"
              />
            </label>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            Already have an account?{" "}
            <a className="text-teal-600 underline hover:text-teal-700" href="/login">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
