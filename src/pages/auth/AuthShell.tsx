import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { env } from '@/lib/env';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-base font-semibold">FDR Sentinel</span>
              <span className="block text-[11px] uppercase tracking-wider text-white/60">
                {env.organization}
              </span>
            </span>
          </Link>

          <h1 className="mt-16 max-w-sm text-3xl font-semibold leading-tight">
            Monitor Smarter.
            <br />
            Verify Better.
            <br />
            Act on Time.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/70">
            AI-assisted monitoring of security deposit Fixed Deposit Receipts: maturity intelligence, OCR-assisted
            document comparison, explainable discrepancy flags and traceable administrative action.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-white/75">
            {[
              'Proactive maturity and non-application monitoring',
              'OCR-assisted field comparison, never automatic authenticity claims',
              'Institution-isolated records enforced by database policies',
              'Append-only audit trail for every significant action',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-300" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative text-[11px] leading-relaxed text-white/45">
          <p>
            Decision-support prototype for {env.department}. Not connected to AICTE's production portal or to any bank's
            systems. No record is auto-approved or auto-released.
          </p>
          <p className="mt-2">Problem statement {env.problemStatementId} · Theme: {env.theme}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-900 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-navy-900">FDR Sentinel</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">{env.organization}</p>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{subtitle}</p>
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 border-t border-slate-200 pt-4">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
