import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { ApiError } from "../lib/api";

export default function ResetPass() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim() || !password) {
      setError("Token and new password are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/v1/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new ApiError(r.status, body.detail ?? "Password reset failed.", String(body.code));
        return body;
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Password reset failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <Lock className="h-8 w-8 text-teal-400" />
          <div>
            <p className="text-lg font-semibold">FDR SENTINEL</p>
            <p className="text-xs text-slate-300">Set a new password</p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">Reset password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose a new password for your account.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
              Your password has been updated. You can now sign in.
            </div>
          )}

          {!success && (
            <form className="mt-5" onSubmit={onSubmit}>
              <label className="mb-3 block">
                <span className="label">Reset token</span>
                <input
                  className="input"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="one-time-code"
                  required
                  data-testid="token"
                />
              </label>
              <label className="mb-4 block">
                <span className="label">New password</span>
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
                {busy ? "Resetting…" : "Reset password"}
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-xs text-slate-500">
            Remember your password?{" "}
            <a className="text-teal-600 underline hover:text-teal-700" href="/login">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
