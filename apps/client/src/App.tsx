import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './routes/DashboardPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { TicketsPage } from './routes/TicketsPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/tickets" replace />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
