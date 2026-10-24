import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { ApiError } from "../lib/api";

export default function ForgotPass() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("E-mail address is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/v1/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new ApiError(body.detail ?? "Request failed.");
        return body;
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <Mail className="h-8 w-8 text-teal-400" />
          <div>
            <p className="text-lg font-semibold">FDR SENTINEL</p>
            <p className="text-xs text-slate-300">Reset your password</p>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-slate-900">Forgot password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter the e-mail address associated with your account.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
              If an account exists for that e-mail, a reset link has been sent.
            </div>
          )}

          {!success && (
            <form className="mt-5" onSubmit={onSubmit}>
              <label className="mb-4 block">
                <span className="label">E-mail</span>
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
              <button className="btn-primary w-full" disabled={busy} type="submit">
                {busy ? "Sending…" : "Send reset link"}
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
