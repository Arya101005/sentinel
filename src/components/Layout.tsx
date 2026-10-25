import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useUnreadNotifications } from '@/lib/queries';
import { ROLE_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import { Button } from './ui/primitives';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  adminOnly?: boolean;
  staffOnly?: boolean;
  hideForInstitution?: boolean;
  badge?: 'notifications';
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Monitoring',
    items: [
      { to: '/fdrs', label: 'FDR Registry', icon: FileText },
      { to: '/maturity', label: 'Maturity Monitor', icon: CalendarClock },
      { to: '/discrepancies', label: 'Discrepancies', icon: AlertTriangle },
      { to: '/applications', label: 'Release & Renewal', icon: RefreshCcw },
    ],
  },
  {
    title: 'Insight',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
      { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
      { to: '/audit', label: 'Audit Trail', icon: ScrollText, hideForInstitution: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'Users & Roles', icon: Users, adminOnly: true },
      { to: '/institutions', label: 'Institutions', icon: Building2, adminOnly: true },
      { to: '/settings', label: 'Settings', icon: Settings, adminOnly: true },
    ],
  },
];

export function Layout() {
  const { profile, role, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { data: unread = 0 } = useUnreadNotifications();

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.adminOnly && role !== 'system_admin') return false;
          if (item.staffOnly && role === 'institution_user') return false;
          if (item.hideForInstitution && role === 'institution_user') return false;
          return true;
        }),
      })).filter((group) => group.items.length > 0),
    [role],
  );

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-900 text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-navy-900">FDR Sentinel</p>
          <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">AICTE · Regulation Bureau</p>
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link-active')}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge === 'notifications' && unread > 0 && (
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 px-3 py-3">
        <p className="px-1 text-[10px] leading-relaxed text-slate-500">
          Decision-support prototype. OCR is unverified input and no bank or AICTE verification API is connected.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-slate-200 bg-white lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-navy-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-3 rounded p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-500">
              {role === 'institution_user' && profile?.institution_id
                ? 'Institution workspace'
                : 'AICTE monitoring workspace'}
            </p>
          </div>

          <Link
            to="/notifications"
            className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100"
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          >
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>

          <div className="relative">
            <button
              type="button"
              onClick={() => setUserMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800">
                {initials(profile?.full_name, profile?.email)}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block max-w-[160px] truncate text-xs font-semibold text-navy-900">
                  {profile?.full_name || profile?.email}
                </span>
                <span className="block max-w-[160px] truncate text-[10px] text-slate-500">
                  {role ? ROLE_LABELS[role] : ''}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            </button>

            {userMenuOpen && (
              <div
                className="absolute right-0 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
                role="menu"
              >
                <p className="truncate text-sm font-semibold text-navy-900">{profile?.full_name || 'Account'}</p>
                <p className="truncate text-xs text-slate-500">{profile?.email}</p>
                <p className="mt-1 text-[11px] font-medium text-slate-600">
                  {role ? ROLE_LABELS[role] : 'No role assigned'}
                </p>
                <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                  <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleSignOut}>
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </Button>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>

        <footer className="mx-auto w-full max-w-[1400px] px-4 pb-6 text-[11px] leading-relaxed text-slate-500 sm:px-6">
          FDR Sentinel · Problem statement 26265 · Smart Automation. This prototype complements the existing AICTE FDR
          process; a matured FDR is never treated as non-compliance and no record is auto-approved or auto-released.
        </footer>
      </div>
    </div>
  );
}
