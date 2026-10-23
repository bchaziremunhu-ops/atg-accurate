import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { Button, Card, Spinner } from './ui';
import type { ReactNode } from 'react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, authError, refreshUser } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-gold-400" />
      </div>
    );
  }
  if (!user && authError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md space-y-3 text-center">
          <h1 className="text-lg font-bold">We couldn&apos;t verify your session</h1>
          <p className="text-sm text-ink-muted">Check your connection and try again. You won&apos;t be signed out unless your session has expired.</p>
          <Button onClick={() => void refreshUser()}>Try again</Button>
          <Link to="/login" className="block text-sm font-semibold text-gold-600">Sign in again</Link>
        </Card>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/home" replace />;
  return <>{children}</>;
}
