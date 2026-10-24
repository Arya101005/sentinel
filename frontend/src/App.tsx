import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import { ToastProvider, Spinner, PageHeader, Card } from "./components/ui";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Verify from "./pages/Verify";
import ForgotPass from "./pages/ForgotPass";
import ResetPass from "./pages/ResetPass";
import RedirectIfAuth from "./components/RedirectIfAuth";
import Dashboard from "./pages/Dashboard";
import Institutions from "./pages/Institutions";
import InstitutionDetail from "./pages/InstitutionDetail";
import Fdrs from "./pages/Fdrs";
import FdrDetail from "./pages/FdrDetail";
import FdrForm from "./pages/FdrForm";
import Documents from "./pages/Documents";
import DocumentReview from "./pages/DocumentReview";
import Discrepancies from "./pages/Discrepancies";
import Maturity from "./pages/Maturity";
import NonApplicants from "./pages/NonApplicants";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import Clearances from "./pages/Clearances";
import Notifications from "./pages/Notifications";
import Reports from "./pages/Reports";
import Audit from "./pages/Audit";
import Users from "./pages/Users";
import Settings from "./pages/Settings";

function FullPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">{children}</div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready)
    return (
      <FullPage>
        <Spinner label="Restoring session…" />
      </FullPage>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function RoleGuard({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (user && roles.includes(user.role)) return <>{children}</>;
  return (
    <Card className="max-w-lg mx-auto mt-10">
      <div className="p-6 text-center">
        <PageHeader title="Access denied" />
        <p className="text-sm text-slate-600">
          Your role ({user?.role}) does not have permission to view this page. If you believe this
          is an error, contact an administrator.
        </p>
      </div>
    </Card>
  );
}

function NotFound() {
  return (
    <FullPage>
      <Card className="max-w-md">
        <div className="p-8 text-center">
          <p className="text-3xl font-semibold text-slate-800">404</p>
          <p className="mt-2 text-sm text-slate-600">This page does not exist.</p>
        </div>
      </Card>
    </FullPage>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<RedirectIfAuth />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/forgot" element={<ForgotPass />} />
          <Route path="/reset" element={<ResetPass />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Route>

        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/institutions" element={<Institutions />} />
          <Route path="/institutions/:id" element={<InstitutionDetail />} />

          <Route path="/fdrs" element={<Fdrs />} />
          <Route path="/fdrs/new" element={<FdrForm />} />
          <Route path="/fdrs/:id" element={<FdrDetail />} />
          <Route path="/fdrs/:id/edit" element={<FdrForm />} />

          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/:id" element={<DocumentReview />} />
          <Route path="/discrepancies" element={<Discrepancies />} />

          <Route path="/maturity" element={<Maturity />} />
          <Route path="/non-applicants" element={<NonApplicants />} />

          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          <Route path="/clearances" element={<Clearances />} />

          <Route path="/notifications" element={<Notifications />} />
          <Route path="/reports" element={<Reports />} />

          <Route
            path="/audit"
            element={
              <RoleGuard roles={["admin", "officer", "auditor"]}>
                <Audit />
              </RoleGuard>
            }
          />
          <Route
            path="/users"
            element={
              <RoleGuard roles={["admin", "officer"]}>
                <Users />
              </RoleGuard>
            }
          />
          <Route
            path="/settings"
            element={
              <RoleGuard roles={["admin"]}>
                <Settings />
              </RoleGuard>
            }
          />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  );
}
