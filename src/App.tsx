import { useCallback, useEffect, useState } from 'react';
import { apiRequest, getStoredToken, setStoredToken } from './api/client';
import { BrokerConnection, DashboardResponse, NavRoute, UserProfile } from './types/trading';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { TopTickerBar } from './components/TopTickerBar';
import { OrderTicketModal } from './components/OrderTicketModal';
import { DashboardPage } from './pages/DashboardPage';
import { BrokersPage } from './pages/BrokersPage';
import { StrategiesPage } from './pages/StrategiesPage';
import { BacktestPage } from './pages/BacktestPage';
import { PnlPage } from './pages/PnlPage';
import { LogsPage } from './pages/LogsPage';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [route, setRoute] = useState<NavRoute>('dashboard');
  const [backtestInitialSlug, setBacktestInitialSlug] = useState<string | undefined>(undefined);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [brokers, setBrokers] = useState<BrokerConnection[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [killModalOpen, setKillModalOpen] = useState(false);
  const [killing, setKilling] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dash, brk] = await Promise.all([
        apiRequest<DashboardResponse>('/api/dashboard'),
        apiRequest<{ brokers: BrokerConnection[] }>('/api/brokers'),
      ]);
      setDashboard(dash);
      setUser(dash.user);
      setBrokers(brk.brokers);
    } catch {
      // keep existing state on transient error
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    apiRequest<{ user: UserProfile }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
      })
      .catch(() => {
        setStoredToken('');
        setUser(null);
      })
      .finally(() => setAuthChecking(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadWorkspace();
    const timer = setInterval(loadWorkspace, 15000);
    return () => clearInterval(timer);
  }, [user?.id, loadWorkspace]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // ignore
    }
    setStoredToken('');
    setUser(null);
    setDashboard(null);
  };

  const handleKillSwitch = async () => {
    setKilling(true);
    try {
      await apiRequest('/api/kill-switch', { method: 'POST', body: '{}' });
      setKillModalOpen(false);
      await loadWorkspace();
    } finally {
      setKilling(false);
    }
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090B0E] text-sm text-slate-400">
        Verifying session…
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        onAuthenticated={(u) => {
          setUser(u);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#090B0E] text-[#E6E9EF]">
      <Sidebar
        activeRoute={route}
        onNavigate={(r) => setRoute(r)}
        user={user}
        onLogout={handleLogout}
        primaryBroker={dashboard?.primary_broker || null}
        feedLatencyMs={dashboard?.market.latency_ms || 0}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopTickerBar
          market={dashboard?.market || null}
          onRefresh={loadWorkspace}
          refreshing={refreshing}
          onOpenOrderTicket={() => setOrderModalOpen(true)}
          onOpenKillSwitch={() => setKillModalOpen(true)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {!dashboard ? (
            <div className="space-y-4">
              <div className="h-8 w-56 animate-pulse rounded bg-[#151921]" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl border border-[#1E232B] bg-[#111418]" />
                ))}
              </div>
              <div className="h-96 animate-pulse rounded-xl border border-[#1E232B] bg-[#111418]" />
            </div>
          ) : (
            <>
              {route === 'dashboard' && (
                <DashboardPage
                  data={dashboard}
                  onRefresh={loadWorkspace}
                  onNavigate={(r) => setRoute(r)}
                  onOpenOrderTicket={() => setOrderModalOpen(true)}
                />
              )}
              {route === 'brokers' && (
                <BrokersPage
                  paperCapital={dashboard.user.paper_capital}
                  onRefreshParent={loadWorkspace}
                />
              )}
              {route === 'strategies' && (
                <StrategiesPage
                  onOpenBacktest={(slug) => {
                    setBacktestInitialSlug(slug);
                    setRoute('backtest');
                  }}
                  onRefreshParent={loadWorkspace}
                />
              )}
              {route === 'backtest' && (
                <BacktestPage
                  strategies={dashboard.strategies}
                  initialSlug={backtestInitialSlug}
                />
              )}
              {route === 'pnl' && <PnlPage />}
              {route === 'logs' && <LogsPage />}
            </>
          )}
        </main>
      </div>

      <OrderTicketModal
        open={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        brokers={brokers}
        paperCapital={dashboard?.user.paper_capital || user.paper_capital}
        onOrderSuccess={loadWorkspace}
      />

      {killModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kill-switch-title"
            className="w-full max-w-md rounded-xl border border-rose-500/40 bg-[#111419] p-6"
          >
            <h2 id="kill-switch-title" className="text-base font-bold text-rose-400">
              Activate Emergency Kill Switch?
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              This immediately pauses all running LIVE and PAPER Python strategies and squares off all open positions at current market prices.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setKillModalOpen(false)}
                className="rounded-lg border border-[#242A34] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleKillSwitch}
                disabled={killing}
                className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
              >
                {killing ? 'Halting…' : 'Confirm Kill Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
