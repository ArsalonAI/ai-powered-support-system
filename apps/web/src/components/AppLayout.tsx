import { NavLink, Outlet } from 'react-router';
import { HealthIndicator } from '../features/health/HealthIndicator';

const NAV = [
  { to: '/tickets', label: 'Tickets' },
  { to: '/dashboard', label: 'Dashboard' },
];

export function AppLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
          <span className="text-sm font-semibold tracking-tight">Support</span>
          <nav className="flex items-center gap-1" aria-label="Main">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <HealthIndicator />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
