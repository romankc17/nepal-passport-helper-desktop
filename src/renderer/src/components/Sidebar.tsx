import {
  Activity,
  CalendarCheck,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  Radar,
  Settings,
  Users,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/watchers', label: 'Slot Watchers', icon: Radar },
  { to: '/queue', label: 'Booking Queue', icon: ListOrdered },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/booking-lab', label: 'Booking Lab', icon: FlaskConical },
  { to: '/appointments', label: 'Appointments', icon: CalendarCheck },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { session } = useAuth();

  return (
    <nav aria-label="Main navigation" className="flex w-60 shrink-0 flex-col bg-navy">
      <div className="flex h-14 items-center gap-2 px-5">
        <Radar className="h-5 w-5 text-blue-300" aria-hidden="true" />
        <span className="text-sm font-semibold tracking-wide text-white">
          Nepal Passport Helper
        </span>
      </div>
      <ul className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
        {navItems
          .filter((item) => item.to !== '/booking-lab' || session?.access.booking_lab)
          .map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
                    isActive
                      ? 'bg-navy-light text-white'
                      : 'text-slate-300 hover:bg-navy-light/60 hover:text-white',
                  )
                }
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}
