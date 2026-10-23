import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AppShell';
import { Button, Field } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import { authApi } from '../lib/endpoints';

/**
 * Account recovery — no SMS, no email, no OTP.
 *
 * Three steps, all verified server-side:
 *   1. phone number
 *   2. full legal name + date of birth  →  reveals the security question
 *   3. security answer + new password
 * The server never tells the client whether an account exists until the
 * personal details check out, so this page always shows generic errors for
 * failed checks and only renders the question after step 2 succeeds.
 */
type Step = 'phone' | 'identity' | 'reset' | 'done';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function fail(err: unknown) {
    const msg = apiError(err);
    setError(msg);
    toast(msg, 'error');
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.forgotStart(phone.trim());
      setStep('identity');
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.forgotVerify({
        phone: phone.trim(),
        fullName: fullName.trim(),
        dateOfBirth,
      });
      setQuestion(res.question.text);
      setStep('reset');
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.forgotReset({
        phone: phone.trim(),
        fullName: fullName.trim(),
        dateOfBirth,
        answer,
        newPassword,
        confirmPassword,
      });
      toast(res.message, 'success');
      setStep('done');
      setTimeout(() => navigate('/login', { replace: true }), 2200);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="muted mt-1">
          Recover access with your phone number, personal details and security question — no SMS or email
          needed.
        </p>

        {/* Progress */}
        <ol className="mt-5 flex items-center gap-2 text-xs text-ink-muted">
          {(['phone', 'identity', 'reset'] as const).map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${
                  step === s || (step === 'done' && i < 2)
                    ? 'bg-gold-500 text-white'
                    : 'bg-cream-200 text-ink-muted'
                }`}
              >
                {i + 1}
              </span>
              {i < 2 && <span className="h-px w-4 bg-cream-300" />}
            </li>
          ))}
        </ol>

        {step === 'phone' && (
          <form onSubmit={submitPhone} className="mt-5 space-y-4" noValidate>
            <Field
              label="Registered phone number"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+263 77 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint="Include the international country code, exactly as you registered it."
              required
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" loading={loading}>
              Continue
            </Button>
          </form>
        )}

        {step === 'identity' && (
          <form onSubmit={submitIdentity} className="mt-5 space-y-4" noValidate>
            <Field
              label="Full legal name"
              placeholder="As it appears on your ID"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <Field
              label="Date of birth"
              type="date"
              autoComplete="bday"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" loading={loading}>
              Continue
            </Button>
            <button
              type="button"
              className="w-full rounded-xl py-2 text-sm font-semibold text-ink-muted"
              onClick={() => {
                setStep('phone');
                setError('');
              }}
            >
              Back
            </button>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={submitReset} className="mt-5 space-y-4" noValidate>
            <div className="rounded-xl bg-cream-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Security question</p>
              <p className="mt-1 text-sm font-medium text-ink">{question}</p>
            </div>
            <Field
              label="Your private answer"
              placeholder="Type the answer you chose"
              autoComplete="off"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              required
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <Field
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" size="lg" loading={loading}>
              Update Password
            </Button>
            <button
              type="button"
              className="w-full rounded-xl py-2 text-sm font-semibold text-ink-muted"
              onClick={() => {
                setStep('identity');
                setError('');
              }}
            >
              Back
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="mt-6 space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-2xl">
              ✅
            </div>
            <p className="text-sm text-ink">Password updated. Taking you to the sign-in screen…</p>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-ink-muted">
          Remembered it?{' '}
          <Link to="/login" className="font-semibold text-gold-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
