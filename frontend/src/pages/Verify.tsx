import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Verify() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Verification token is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(token.trim(), "");
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed. Please try again.");
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
            <p className="text-xs text-slate-300">Verify your e-mail</p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">Verify account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter the token sent to your e-mail to complete verification.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form className="mt-5" onSubmit={onSubmit}>
            <label className="mb-4 block">
              <span className="label">Verification token</span>
              <input
                className="input"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="one-time-code"
                required
                data-testid="token"
              />
            </label>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? "Verifying…" : "Verify"}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-slate-500">
            Already verified?{" "}
            <a className="text-teal-600 underline hover:text-teal-700" href="/login">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
