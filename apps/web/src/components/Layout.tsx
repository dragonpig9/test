import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { DemoBar } from '../features/demo/DemoBar';
import { DemoGuide } from '../features/demo/DemoGuide';
import { NotificationBell } from '../features/notifications/NotificationsPage';
import { Avatar } from './MemberChip';

const NAV = [
  { to: '/', label: 'Overview', icon: '◎' },
  { to: '/circles', label: 'Circles', icon: '◍' },
  { to: '/trust', label: 'Trust Network', icon: '⟁' },
  { to: '/services', label: 'Service Board', icon: '▦' },
  { to: '/exchanges', label: 'My Exchanges', icon: '⇄' },
  { to: '/credits', label: 'Time Credits', icon: '◷' },
  { to: '/credibility', label: 'My Credibility', icon: '★' },
  { to: '/disputes', label: 'Disputes', icon: '⚖' },
  { to: '/activity', label: 'Activity', icon: '☰' },
  { to: '/notifications', label: 'Notifications', icon: '🔔' },
  { to: '/profile', label: 'My Profile', icon: '☺' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [guide, setGuide] = useState(false);
  const loc = useLocation();
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      {me?.demoMode && <DemoBar onToggleGuide={() => setGuide((g) => !g)} />}
      <div className="flex">
        <aside className={clsx('fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0', menuOpen ? 'translate-x-0' : '-translate-x-full')} aria-label="Main navigation">
          <div className="flex h-16 items-center gap-2 px-5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-white" aria-hidden>
              ◷
            </span>
            <span className="text-lg font-semibold tracking-tight text-slate-900">CommonHours</span>
            <span className="ml-auto">
              <NotificationBell onNavigate={() => setMenuOpen(false)} />
            </span>
          </div>
          <nav className="space-y-0.5 px-3">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50')
                }
              >
                <span aria-hidden className="w-4 text-center text-base">
                  {n.icon}
                </span>
                {n.label}
              </NavLink>
            ))}
          </nav>
          {me && (
            <div className="absolute inset-x-0 bottom-0 border-t border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <Avatar m={me.member} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{me.member.displayName}</p>
                  <p className="truncate text-xs text-slate-500">@{me.member.handle}{me.member.status === 'LEFT' ? ' · left' : ''}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-3 text-xs">
                <NavLink to="/account" className="text-slate-600 hover:text-slate-900" onClick={() => setMenuOpen(false)}>
                  Account & leaving
                </NavLink>
                <button type="button" onClick={signOut} className="text-slate-600 hover:text-slate-900">
                  Sign out
                </button>
              </div>
            </div>
          )}
        </aside>
        {menuOpen && <div className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
        <div className="min-w-0 flex-1">
          <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
            <button type="button" className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
              ☰
            </button>
            <span className="font-semibold">CommonHours</span>
            <span className="ml-auto truncate text-xs text-slate-500">{NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)))?.label}</span>
            <NotificationBell />
          </header>
          <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      {guide && <DemoGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
