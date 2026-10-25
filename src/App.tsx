import { Navigate, Route, Routes } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { env } from './lib/env';
import { Layout } from './components/Layout';
import { ProtectedRoute, RequireAdmin, FullPageLoader } from './components/ProtectedRoute';

const LoginPage = lazy(() => import('./pages/auth/Login'));
const SignupPage = lazy(() => import('./pages/auth/Signup'));
const BootstrapPage = lazy(() => import('./pages/auth/Bootstrap'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPassword'));
const DashboardPage = lazy(() => import('./pages/Dashboard'));
const FdrListPage = lazy(() => import('./pages/Fdrs'));
const FdrDetailPage = lazy(() => import('./pages/FdrDetail'));
const MaturityPage = lazy(() => import('./pages/Maturity'));
const DiscrepanciesPage = lazy(() => import('./pages/Discrepancies'));
const ApplicationsPage = lazy(() => import('./pages/Applications'));
const ApplicationDetailPage = lazy(() => import('./pages/ApplicationDetail'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const AuditPage = lazy(() => import('./pages/Audit'));
const UsersPage = lazy(() => import('./pages/Users'));
const InstitutionsPage = lazy(() => import('./pages/Institutions'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const NotFoundPage = lazy(() => import('./pages/NotFound'));

function ConfigurationError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl rounded-lg border border-red-200 bg-white p-6 shadow-card">
        <h1 className="text-lg font-semibold text-navy-900">Supabase configuration is missing</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          The application needs <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">VITE_SUPABASE_PUBLISHABLE_KEY</code> at build time.
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
          <li>Copy <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.example</code> to <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env</code>.</li>
          <li>Set the Supabase project URL and publishable key.</li>
          <li>Restart the development server, or re-deploy after adding the variables in Vercel.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">
          Only publishable values belong in the browser bundle. The service-role key must stay in server-side settings.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!env.isConfigured) return <ConfigurationError />;

  return (
    <Suspense fallback={<FullPageLoader label="Loading module…" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/bootstrap" element={<BootstrapPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="fdrs" element={<FdrListPage />} />
          <Route path="fdrs/new" element={<FdrDetailPage mode="create" />} />
          <Route path="fdrs/:id" element={<FdrDetailPage mode="view" />} />
          <Route path="maturity" element={<MaturityPage />} />
          <Route path="discrepancies" element={<DiscrepanciesPage />} />
          <Route path="applications" element={<ApplicationsPage />} />
          <Route path="applications/:id" element={<ApplicationDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route
            path="users"
            element={
              <RequireAdmin>
                <UsersPage />
              </RequireAdmin>
            }
          />
          <Route
            path="institutions"
            element={
              <RequireAdmin>
                <InstitutionsPage />
              </RequireAdmin>
            }
          />
          <Route
            path="settings"
            element={
              <RequireAdmin>
                <SettingsPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
