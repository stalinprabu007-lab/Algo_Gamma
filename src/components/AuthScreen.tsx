import React, { useState } from 'react';
import { Zap, Lock, Mail, User, ArrowRight, ShieldCheck } from 'lucide-react';
import { apiRequest, setStoredToken } from '../api/client';
import { UserProfile } from '../types/trading';

interface AuthScreenProps {
  onAuthenticated: (user: UserProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'register' && fullName.trim().length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email: email.trim(), password }
          : { email: email.trim(), full_name: fullName.trim(), password };
      const res = await apiRequest<{ user: UserProfile; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090B0E] px-4 py-12 text-[#E6E9EF]">
      <div className="w-full max-w-md rounded-xl border border-[#222730] bg-[#111418] p-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400 text-[#090B0E]">
            <Zap className="h-5 w-5 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">GammaDesk</h1>
            <p className="text-xs text-slate-400">NIFTY · SENSEX Live & Paper Trading Terminal</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-[#0B0D11] p-1 border border-[#1E232B]">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-[#1A1F27] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError('');
            }}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              mode === 'register'
                ? 'bg-[#1A1F27] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-fullname" className="mb-1.5 block text-xs font-medium text-slate-300">
                Trader Full Name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="auth-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Arjun Mehta"
                  className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-slate-300">
              Email Address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="trader@desk.in"
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password" className="mb-1.5 block text-xs font-medium text-slate-300">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full rounded-lg border border-[#242A34] bg-[#0B0D11] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-[#090B0E] transition-colors hover:bg-amber-300 disabled:opacity-50"
          >
            {loading ? 'Authenticating…' : mode === 'login' ? 'Sign In to Desk' : 'Create Trader Profile'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-6 flex items-start gap-2.5 border-t border-[#1E232B] pt-4 text-xs text-slate-400">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            Sessions are authenticated via the Python SQLite backend. Broker API tokens (Zerodha, Dhan, Angel One) are scoped strictly to your profile.
          </p>
        </div>
      </div>
    </div>
  );
};
