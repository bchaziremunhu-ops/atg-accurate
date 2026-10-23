import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { AuthShell } from '../components/AppShell';
import { Button, Field, Select } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import { COUNTRIES } from '../lib/countries';
import { SECURITY_QUESTIONS } from '../lib/securityQuestions';

interface Errors {
  [key: string]: string | undefined;
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '',
    country: 'Zimbabwe',
    nationality: 'Zimbabwe',
    phone: '',
    dateOfBirth: '',
    address: '',
    securityQuestion: SECURITY_QUESTIONS[0].id,
    securityAnswer: '',
    password: '',
    confirm: '',
    acceptTerms: false,
    acceptPrivacy: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);

  const country = COUNTRIES.find((c) => c.name === form.country);
  const dialHint = country ? `+${country.dial}` : '+263';

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  }

  function validate(): boolean {
    const e: Errors = {};
    if (form.name.trim().length < 2) e.name = 'Enter your full legal name';
    if (!form.country) e.country = 'Select your country of residence';
    if (!form.nationality.trim()) e.nationality = 'Select your nationality';
    // The phone must resolve to an international number; the server
    // normalises it, but catch the obvious problems here for fast feedback.
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) e.phone = 'Enter a valid phone number with country code';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) {
      e.dateOfBirth = 'Enter your date of birth';
    } else {
      const dob = new Date(form.dateOfBirth + 'T00:00:00Z').getTime();
      const now = Date.now();
      if (Number.isNaN(dob) || dob > now || dob < Date.UTC(1900, 0, 1)) {
        e.dateOfBirth = 'Enter a valid date of birth';
      }
    }
    if (!form.securityQuestion) e.securityQuestion = 'Choose a security question';
    if (form.securityAnswer.trim().length < 2) e.securityAnswer = 'Enter your private answer (min 2 characters)';
    if (form.password.length < 8) e.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    if (!form.acceptTerms) e.acceptTerms = 'You must accept the Terms & Conditions';
    if (!form.acceptPrivacy) e.acceptPrivacy = 'You must accept the Privacy Policy';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      await register({
        name: form.name.trim(),
        phone: form.phone.trim(),
        country: form.country,
        nationality: form.nationality.trim(),
        dateOfBirth: form.dateOfBirth,
        address: form.address.trim(),
        securityQuestion: form.securityQuestion,
        securityAnswer: form.securityAnswer,
        password: form.password,
        confirmPassword: form.confirm,
        acceptTerms: form.acceptTerms,
        acceptPrivacy: form.acceptPrivacy,
      });
      toast('Account created 🎉', 'success');
      navigate('/home', { replace: true });
    } catch (err) {
      const msg = apiError(err);
      setErrors((e) => ({ ...e, form: msg }));
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="card p-6">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="muted mt-1">
          Zimbabwe and international traders welcome.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field
            label="Full legal name"
            placeholder="As it appears on your ID"
            autoComplete="name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
          />

          <Select
            label="Country of residence"
            value={form.country}
            onChange={(e) => set('country', e.target.value)}
            error={errors.country}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code}>{c.name}</option>
            ))}
          </Select>

          <Select
            label="Nationality"
            value={form.nationality}
            onChange={(e) => set('nationality', e.target.value)}
            error={errors.nationality}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code}>{c.name}</option>
            ))}
          </Select>

          <Field
            label="Phone number (with country code)"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder={`${dialHint} 77 123 4567`}
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
            hint="Include your international country code, e.g. +263 77 123 4567"
          />

          <Field
            label="Date of birth"
            type="date"
            autoComplete="bday"
            value={form.dateOfBirth}
            onChange={(e) => set('dateOfBirth', e.target.value)}
            error={errors.dateOfBirth}
          />

          <Field
            label="Residential address (optional)"
            placeholder="Street, city, province"
            autoComplete="street-address"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            error={errors.address}
            hint="Optional — only provide it if you want it on your profile."
          />

          <Select
            label="Security question"
            value={form.securityQuestion}
            onChange={(e) => set('securityQuestion', e.target.value)}
          >
            {SECURITY_QUESTIONS.map((q) => (
              <option key={q.id} value={q.id}>
                {q.text}
              </option>
            ))}
          </Select>

          <Field
            label="Security answer (private)"
            placeholder="Your private answer"
            autoComplete="off"
            value={form.securityAnswer}
            onChange={(e) => set('securityAnswer', e.target.value)}
            error={errors.securityAnswer}
            hint="Used with your personal details to recover your password — never shared, never shown again."
          />

          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
          />
          <Field
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter password"
            value={form.confirm}
            onChange={(e) => set('confirm', e.target.value)}
            error={errors.confirm}
          />

          <label className="flex items-start gap-3 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-cream-300 text-gold-500 focus:ring-gold-300"
              checked={form.acceptTerms}
              onChange={(e) => set('acceptTerms', e.target.checked)}
            />
            <span>
              I accept the{' '}
              <Link to="/legal#terms" className="font-semibold text-gold-600">
                Terms &amp; Conditions
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms && <p className="-mt-2 text-xs text-danger">{errors.acceptTerms}</p>}

          <label className="flex items-start gap-3 text-sm text-ink-muted">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-cream-300 text-gold-500 focus:ring-gold-300"
              checked={form.acceptPrivacy}
              onChange={(e) => set('acceptPrivacy', e.target.checked)}
            />
            <span>
              I accept the{' '}
              <Link to="/legal#privacy" className="font-semibold text-gold-600">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {errors.acceptPrivacy && <p className="-mt-2 text-xs text-danger">{errors.acceptPrivacy}</p>}

          {errors.form && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{errors.form}</p>}
          <Button type="submit" size="lg" loading={loading}>
            Create Account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold-600">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
