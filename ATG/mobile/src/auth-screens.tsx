import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { api, apiError } from './api';
import { useAuth } from './auth';
import { colors } from './theme';

const questions = [
  ['city_birth', 'What city were you born in?'],
  ['first_school', 'What is the name of your first school?'],
  ['mother_maiden', "What is your mother's maiden name?"],
  ['first_pet', 'What was the name of your first pet?'],
  ['street_first', 'What street did you grow up on?'],
  ['first_job', 'What was the name of your first employer?'],
  ['nickname', 'What was your childhood nickname?'],
  ['favorite_teacher', 'Who was your favourite teacher?'],
] as const;

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor="#9AA0AA"
        secureTextEntry={secureTextEntry}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function SubmitButton({ title, loading, onPress }: { title: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={loading} onPress={onPress} style={[styles.button, loading && styles.disabled]}>
      {loading ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

function AuthPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}>
        <Text style={styles.brandMark}>ATG</Text>
        <Text style={styles.brandTitle}>Accurate Trading Group</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </View>
    </ScrollView>
  );
}

export function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: '',
    country: 'Zimbabwe',
    nationality: 'Zimbabwe',
    phone: '',
    dateOfBirth: '',
    address: '',
    securityQuestion: questions[0][0] as string,
    securityAnswer: '',
    password: '',
    confirmPassword: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError('');
    const digits = form.phone.replace(/\D/g, '');
    if (form.name.trim().length < 2) return setError('Enter your full legal name.');
    if (!form.country.trim() || !form.nationality.trim()) return setError('Enter your country and nationality.');
    if (digits.length < 8 || digits.length > 15) return setError('Enter a valid phone number with country code.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) return setError('Enter your date of birth as YYYY-MM-DD.');
    if (form.securityAnswer.trim().length < 2) return setError('Enter your security answer (at least 2 characters).');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match.');
    if (!acceptedTerms || !acceptedPrivacy) return setError('Accept the Terms & Conditions and Privacy Policy to continue.');

    setLoading(true);
    try {
      await register({
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        country: form.country.trim(),
        nationality: form.nationality.trim(),
        address: form.address.trim(),
        securityAnswer: form.securityAnswer.trim(),
        acceptTerms: acceptedTerms,
        acceptPrivacy: acceptedPrivacy,
      });
      router.replace('/');
    } catch (submitError) {
      setError(apiError(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPage title="Create your account" subtitle="Zimbabwe and international traders welcome.">
      <Field label="Full legal name" value={form.name} onChangeText={(v) => update('name', v)} placeholder="As it appears on your ID" />
      <Field label="Country of residence" value={form.country} onChangeText={(v) => update('country', v)} />
      <Field label="Nationality" value={form.nationality} onChangeText={(v) => update('nationality', v)} />
      <Field label="Phone number (include country code)" value={form.phone} onChangeText={(v) => update('phone', v)} keyboardType="phone-pad" placeholder="+263 77 123 4567" />
      <Field label="Date of birth (YYYY-MM-DD)" value={form.dateOfBirth} onChangeText={(v) => update('dateOfBirth', v)} placeholder="YYYY-MM-DD" />
      <Field label="Residential address (optional)" value={form.address} onChangeText={(v) => update('address', v)} />
      <Text style={styles.label}>Security question</Text>
      <View style={styles.choices}>
        {questions.map(([id, text]) => (
          <Pressable key={id} onPress={() => update('securityQuestion', id)} style={[styles.choice, form.securityQuestion === id && styles.choiceActive]}>
            <Text style={[styles.choiceText, form.securityQuestion === id && styles.choiceTextActive]}>{text}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Private security answer" value={form.securityAnswer} onChangeText={(v) => update('securityAnswer', v)} autoCapitalize="none" />
      <Field label="Password" value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry autoCapitalize="none" />
      <Field label="Confirm password" value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry autoCapitalize="none" />
      <Consent label="I accept the Terms & Conditions" checked={acceptedTerms} onPress={() => setAcceptedTerms((value) => !value)} />
      <Consent label="I accept the Privacy Policy" checked={acceptedPrivacy} onPress={() => setAcceptedPrivacy((value) => !value)} />
      <Pressable onPress={() => router.push('/legal')} style={styles.linkButton}>
        <Text style={styles.link}>Read Terms & Conditions and Privacy Policy</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <SubmitButton title="Create account" loading={loading} onPress={() => void submit()} />
      <Pressable onPress={() => router.replace('/login')} style={styles.linkButton}><Text style={styles.link}>Already have an account? Sign in</Text></Pressable>
    </AuthPage>
  );
}

function Consent({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={styles.consent}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.check}>{checked ? '✓' : ''}</Text></View>
      <Text style={styles.muted}>{label}</Text>
    </Pressable>
  );
}

type RecoveryStep = 'phone' | 'identity' | 'reset';

export function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<RecoveryStep>('phone');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setError('');
    setLoading(true);
    try {
      await action();
    } catch (requestError) {
      setError(apiError(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPage title="Reset your password" subtitle="Recover access using your personal details and security question. No SMS or email is required.">
      {step === 'phone' ? (
        <>
          <Field label="Registered phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+263 77 123 4567" />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <SubmitButton title="Continue" loading={loading} onPress={() => void run(async () => {
            await api.post('/auth/forgot/start', { phone: phone.trim() });
            setStep('identity');
          })} />
        </>
      ) : null}
      {step === 'identity' ? (
        <>
          <Field label="Full legal name" value={fullName} onChangeText={setFullName} />
          <Field label="Date of birth (YYYY-MM-DD)" value={dateOfBirth} onChangeText={setDateOfBirth} placeholder="YYYY-MM-DD" />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <SubmitButton title="Continue" loading={loading} onPress={() => void run(async () => {
            const result = await api.post<{ question: { text: string } }>('/auth/forgot/verify', {
              phone: phone.trim(),
              fullName: fullName.trim(),
              dateOfBirth,
            });
            setQuestion(result.data.question.text);
            setStep('reset');
          })} />
          <Pressable onPress={() => setStep('phone')} style={styles.linkButton}><Text style={styles.link}>Back</Text></Pressable>
        </>
      ) : null}
      {step === 'reset' ? (
        <>
          <View style={styles.question}><Text style={styles.label}>Security question</Text><Text style={styles.muted}>{question}</Text></View>
          <Field label="Your private answer" value={answer} onChangeText={setAnswer} autoCapitalize="none" />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
          <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <SubmitButton title="Update password" loading={loading} onPress={() => void run(async () => {
            if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
            if (newPassword !== confirmPassword) throw new Error('Passwords do not match.');
            await api.post('/auth/forgot/reset', {
              phone: phone.trim(),
              fullName: fullName.trim(),
              dateOfBirth,
              answer,
              newPassword,
              confirmPassword,
            });
            router.replace('/login');
          })} />
        </>
      ) : null}
      <Pressable onPress={() => router.replace('/login')} style={styles.linkButton}><Text style={styles.link}>Back to sign in</Text></Pressable>
    </AuthPage>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 18 },
  brand: { alignItems: 'center', gap: 8 },
  brandMark: { backgroundColor: colors.gold, borderRadius: 20, color: colors.surface, fontSize: 26, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 18, paddingVertical: 12 },
  brandTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 18, gap: 12 },
  title: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 11, borderWidth: 1, color: colors.ink, fontSize: 15, paddingHorizontal: 12, paddingVertical: 12 },
  button: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: 11, justifyContent: 'center', minHeight: 46, marginTop: 6, padding: 12 },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  choices: { gap: 6 },
  choice: { borderColor: colors.border, borderRadius: 9, borderWidth: 1, padding: 10 },
  choiceActive: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  choiceText: { color: colors.ink, fontSize: 12 },
  choiceTextActive: { fontWeight: '700' },
  consent: { alignItems: 'center', flexDirection: 'row', gap: 9, paddingVertical: 2 },
  checkbox: { alignItems: 'center', borderColor: colors.border, borderRadius: 4, borderWidth: 1, height: 20, justifyContent: 'center', width: 20 },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  check: { color: colors.surface, fontSize: 13, fontWeight: '900' },
  linkButton: { alignItems: 'center', paddingVertical: 8 },
  link: { color: colors.gold, fontSize: 13, fontWeight: '700' },
  question: { backgroundColor: colors.goldSoft, borderRadius: 10, gap: 4, padding: 12 },
});
