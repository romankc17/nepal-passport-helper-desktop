import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { AppLayout } from './components/AppLayout';
import { Spinner } from './components/Spinner';
import { OperationsProvider } from './operations';
import { ActivityPage } from './pages/ActivityPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { BookingLabPage } from './pages/BookingLabPage';
import { ClientsPage } from './pages/ClientsPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { QueuePage } from './pages/QueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { WatchersPage } from './pages/WatchersPage';
import { WatcherRuntimeProvider } from './runtime';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, booting } = useAuth();
  const location = useLocation();

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-navy">
        <Spinner size="lg" invert label="Restoring session" />
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

function LoginRoute() {
  const { session, booting } = useAuth();
  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-navy">
        <Spinner size="lg" invert label="Restoring session" />
      </div>
    );
  }
  if (session) {
    return <Navigate to="/" replace />;
  }
  return <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <WatcherRuntimeProvider>
        <OperationsProvider>
          <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<OverviewPage />} />
          <Route path="/watchers" element={<WatchersPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/booking-lab" element={<BookingLabPage />} />
          <Route path="/appointments" element={<AppointmentsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </OperationsProvider>
      </WatcherRuntimeProvider>
    </AuthProvider>
  );
}
