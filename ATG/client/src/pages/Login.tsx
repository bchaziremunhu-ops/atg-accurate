import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { AuthShell } from '../components/AppShell';
import { Button, Field } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const from = (location.state as { from?: string } | null)?.from ?? '/home';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(identifier.trim(), password);
      toast(`Welcome back, ${user.name.split(' ')[0]} 👋`, 'success');
      navigate(from, { replace: true });
    } catch (err) {
      const msg = apiError(err);
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="card p-5 sm:p-8">
        <div className="mb-3 flex justify-end" aria-hidden="true">
          <svg className="h-12 w-36" viewBox="0 0 160 56" fill="none">
            <path d="M0 12H160M0 28H160M0 44H160" stroke="#E9E0D2" strokeWidth="1" />
            <g stroke="#BF7A28" strokeWidth="2" strokeLinecap="round">
              <path d="M13 26V43M35 16V38M57 20V42M79 10V34M101 13V39M123 5V29M145 8V25" />
            </g>
            <g fill="#EFB46F" stroke="#BF7A28" strokeWidth="1">
              <rect x="9" y="31" width="8" height="7" rx="1" />
              <rect x="31" y="23" width="8" height="10" rx="1" />
              <rect x="53" y="26" width="8" height="10" rx="1" />
              <rect x="75" y="17" width="8" height="11" rx="1" />
              <rect x="97" y="21" width="8" height="12" rx="1" />
              <rect x="119" y="12" width="8" height="11" rx="1" />
              <rect x="141" y="13" width="8" height="7" rx="1" />
            </g>
          </svg>
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-700">Member sign in</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Welcome back</h1>
        <p className="muted mt-2">Sign in with your phone number or email</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field
            label="Phone number or email"
            type="text"
            autoComplete="username"
            placeholder="0771234567 or you@example.com"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="-mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-semibold text-gold-600">
              Forgot password?
            </Link>
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit" size="lg" loading={loading}>
            Sign In
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-semibold text-gold-600">
            Create one
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
