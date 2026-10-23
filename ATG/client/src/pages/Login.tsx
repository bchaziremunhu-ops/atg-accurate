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
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="muted mt-1">Sign in with your phone number or email</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
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
