import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  FileText,
  Files,
  Flag,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShieldAlert,
  Users as UsersIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { ROLE_LABELS, useAuth } from "../lib/auth";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: string[];
  end?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: "Monitor",
    items: [
      { to: "/", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" />, end: true },
      { to: "/institutions", label: "Institutions", icon: <Building2 className="h-4 w-4" /> },
      { to: "/fdrs", label: "FDR Registry", icon: <FileText className="h-4 w-4" /> },
      { to: "/maturity", label: "Upcoming maturity", icon: <CalendarClock className="h-4 w-4" /> },
      {
        to: "/non-applicants",
        label: "Matured non-applicants",
        icon: <AlertOctagon className="h-4 w-4" />,
      },
    ],
  },
  {
    title: "Verification & workflow",
    items: [
      { to: "/documents", label: "Documents", icon: <Files className="h-4 w-4" /> },
      { to: "/discrepancies", label: "Discrepancy queue", icon: <Flag className="h-4 w-4" /> },
      { to: "/applications", label: "Release applications", icon: <ClipboardList className="h-4 w-4" /> },
      { to: "/clearances", label: "Clearance tracking", icon: <CheckSquare className="h-4 w-4" /> },
    ],
  },
  {
    title: "Insights",
    items: [
      { to: "/notifications", label: "Notification centre", icon: <Bell className="h-4 w-4" /> },
      { to: "/reports", label: "Reports & exports", icon: <BarChart3 className="h-4 w-4" /> },
      { to: "/audit", label: "Audit trail", icon: <History className="h-4 w-4" />, roles: ["admin", "officer", "auditor"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/users", label: "User management", icon: <UsersIcon className="h-4 w-4" />, roles: ["admin", "officer"] },
      { to: "/settings", label: "System settings", icon: <SettingsIcon className="h-4 w-4" />, roles: ["admin"] },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/institutions": "Institutions",
  "/fdrs": "FDR Registry",
  "/maturity": "Upcoming maturity",
  "/non-applicants": "Matured without application",
  "/documents": "Documents",
  "/discrepancies": "Discrepancy queue",
  "/applications": "Release applications",
  "/clearances": "Clearance tracking",
  "/notifications": "Notification centre",
  "/reports": "Reports & exports",
  "/audit": "Audit trail",
  "/users": "User management",
  "/settings": "System settings",
};

function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const base = TITLES[`/${segments[0] ?? ""}`] ?? "Dashboard";
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
      <span>FDR Sentinel</span>
      <span className="text-slate-300">/</span>
      <span className="font-medium text-slate-700">{base}</span>
      {segments.length > 1 && (
        <>
          <span className="text-slate-300">/</span>
          <span className="text-slate-600">{segments[segments.length - 1]}</span>
        </>
      )}
    </nav>
  );
}

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ["unread"],
    queryFn: () => api.get<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;
  return (
    <NavLink
      to="/notifications"
      aria-label={`Notifications (${unread} unread)`}
      className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </NavLink>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-sm font-semibold text-white">
          {user.display_name?.charAt(0) ?? "U"}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium text-slate-800">
            {user.display_name?.replace(" (DEMO)", "")}
          </span>
          <span className="block text-xs text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-64 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
            <p className="text-sm font-medium text-slate-800">{user.display_name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
            <p className="mt-1 text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            {user.institution_name && (
              <p className="mt-1 text-xs text-slate-500">{user.institution_name}</p>
            )}
            {user.is_competent_authority && (
              <p className="mt-1 inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700">
                <ShieldAlert className="h-3 w-3" /> Competent authority
              </p>
            )}
            <hr className="my-2 border-slate-200" />
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = user?.role;

  const visible = NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => !i.roles || (role && i.roles.includes(role))),
  })).filter((s) => s.items.length > 0);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform bg-navy-800 text-slate-200 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-navy-700 px-4">
          <ListChecks className="h-6 w-6 text-teal-400" />
          <div>
            <p className="text-sm font-semibold text-white">FDR SENTINEL</p>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              Deposit monitoring
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {visible.map((section) => (
            <div key={section.title}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                        isActive
                          ? "bg-navy-700 text-white"
                          : "text-slate-300 hover:bg-navy-700/60 hover:text-white"
                      }`
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-navy-700 px-4 py-3 text-[10px] text-slate-400">
          Synthetic demo · not connected to AICTE or bank systems
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
