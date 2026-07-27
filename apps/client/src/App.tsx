import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { RequireSession } from './features/auth/RequireSession';
import { DashboardPage } from './routes/DashboardPage';
import { LoginPage } from './routes/LoginPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { TicketDetailPage } from './routes/TicketDetailPage';
import { TicketsPage } from './routes/TicketsPage';

export function App() {
  return (
    <Routes>
      {/* Outside the guard, and outside the app chrome: there is no nav to show
          someone who is not signed in. */}
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireSession />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/tickets" replace />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:number" element={<TicketDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
