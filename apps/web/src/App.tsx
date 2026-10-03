import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { JoinPage } from './features/auth/JoinPage';
import { LoginPage } from './features/auth/LoginPage';
import { OverviewPage } from './features/dashboard/OverviewPage';
import { TrustNetworkPage } from './features/trust-graph/TrustNetworkPage';
import { ServiceBoardPage } from './features/services/ServiceBoardPage';
import { ExchangesPage } from './features/exchanges/ExchangesPage';
import { ExchangeDetailPage } from './features/exchanges/ExchangeDetailPage';
import { CreditsPage } from './features/credits/CreditsPage';
import { CredibilityPage } from './features/credibility/CredibilityPage';
import { DisputesPage } from './features/disputes/DisputesPage';
import { DisputeDetailPage } from './features/disputes/DisputeDetailPage';
import { ActivityPage } from './features/audit/ActivityPage';
import { AccountPage } from './features/withdrawal/AccountPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { ProfilePage } from './features/profiles/ProfilePage';

// The debug panel is development-only and loaded lazily so it never ships in production bundles' main chunk.
const DebugPanel = lazy(() => import('./features/debug/DebugPanel'));
const SHOW_DEBUG = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG === 'true';

/** Routing only. Each page lives in its feature folder. */
export function App() {
  const { signedIn, loading } = useAuth();
  if (loading) return <Loading label="Signing you in…" />;
  if (!signedIn) {
    return (
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/trust" element={<TrustNetworkPage />} />
        <Route path="/services" element={<ServiceBoardPage />} />
        <Route path="/exchanges" element={<ExchangesPage />} />
        <Route path="/exchanges/:id" element={<ExchangeDetailPage />} />
        <Route path="/credits" element={<CreditsPage />} />
        <Route path="/credibility" element={<CredibilityPage />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/disputes/:id" element={<DisputeDetailPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:id" element={<ProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/join" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {SHOW_DEBUG && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
    </Layout>
  );
}
