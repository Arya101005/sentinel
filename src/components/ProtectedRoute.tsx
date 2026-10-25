import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Spinner } from './ui/primitives';

export function FullPageLoader({ label = 'Loading FDR Sentinel…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-900 text-white">
        <span className="text-lg font-bold">FS</span>
      </div>
      <Spinner label={label} />
    </div>
  );
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, profileError, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-card">
          <h1 className="text-lg font-semibold text-navy-900">Account not provisioned</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {profileError ??
              'Your account is signed in but has no profile yet. A System Administrator must assign your role and institution before you can use FDR Sentinel.'}
          </p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-navy-800"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== 'system_admin') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        This area is restricted to System Administrators. If you need access, contact your AICTE administrator.
      </div>
    );
  }
  return <>{children}</>;
}
