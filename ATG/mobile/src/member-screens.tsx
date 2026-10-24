import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from './api';
import { useAuth } from './auth';
import { disablePushNotifications, enablePushNotifications } from './push';
import { getRealtimeSocket } from './realtime';
import type { Course, Signal, SiteSettings } from './types';
import { colors } from './theme';

type Group = {
  id: string;
  name: string;
  description?: string | null;
  accessTier?: string;
  canAccess?: boolean;
  joined?: boolean;
  _count?: { members: number; posts: number; messages?: number };
};

type Post = {
  id: string;
  body: string;
  kind: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  author: { id: string; name: string; avatarUrl?: string | null };
  group?: { id: string; name: string };
};

type Message = { id: string; body: string; createdAt: string; user: { id: string; name: string } };
type Notification = { id: string; title: string; body: string; read: boolean; createdAt: string };
type Purchase = { id: string; itemTitle: string; status: string; amount: number; currency: string; createdAt: string; provider: string; receipt?: { id: string } | null };
type Receipt = { id: string; receiptNumber: string; itemTitle: string; itemType: string; amount: number | string; currency: string; method?: string | null; paidAt: string; createdAt: string };
type Transaction = { id: string; type: string; amount: number; currency: string; status: string; reference: string; createdAt: string };
type BrokerTransaction = { id: string; direction: string; broker: string; brokerLabel: string; amount: number; currency: string; methodLabel: string; status: string; reference: string; createdAt: string; paymentReference?: string | null; destination?: string | null; feeAmount?: number };
type MembershipPackage = { id: string; title: string; description?: string; price: number | string; currency: string; durationDays: number; activationRule: 'APPROVAL' | 'AFTER_CURRENT_ACCESS'; includedRooms: string[]; saleStatus: string };
type RoomAccessRecord = { accessLevel: string; startsAt: string; expiresAt: string; approvalReference: string };
type SubscriptionSummary = { status: string; plan: string | null; expiresAt: string | null; roomAccess?: RoomAccessRecord[] };
type SignalRoomAccess = { PAID: boolean; VIP_DERIV: boolean; VIP_WELTRADE: boolean };
type PurchaseRequestSummary = { id: string; reference: string; itemTitleSnapshot: string; amountSnapshot: number | string; currencySnapshot: string; status: string; createdAt: string };
type ProofFile = { uri: string; name: string; mimeType: string; size?: number; file?: File };
type NativeFile = { uri: string; name: string; type: string };

function Page({ children, refresh, refreshing = false }: { children: React.ReactNode; refresh?: () => void; refreshing?: boolean }) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={refresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function LegalScreen() {
  return (
    <Page>
      <Card>
        <Heading>Terms & Conditions</Heading>
        <Body>By creating an ATG Traders account, you confirm that the personal details you provide are accurate and that you are legally able to enter into this agreement.</Body>
        <Body>Your account is personal. Keep your password and security answer private. You are responsible for activity performed while signed in. Trading signals and educational content are for information only and are not financial advice; you are responsible for your trading decisions.</Body>
        <Body>Accounts may be suspended for abuse, fraud, or unlawful activity. You may stop using the service at any time. Contact support to request account deletion.</Body>
      </Card>
      <Card>
        <Heading>Privacy Policy</Heading>
        <Body>We collect the details you submit when registering, including your legal name, country, nationality, phone number, date of birth, optional address, security question and answer, and password.</Body>
        <Body>Passwords and security answers are stored in an irreversibly hashed form. Recovery checks happen on our servers; your private answer is not shown back to you.</Body>
        <Body>We use your information to operate and secure your account. We do not sell your personal data. Phone numbers are used for sign-in and account recovery, not SMS or email verification codes.</Body>
        <Body>You can update your details or contact support to request access to or deletion of your personal data.</Body>
      </Card>
    </Page>
  );
}

export function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receipt = useQuery({ queryKey: ['mobile', 'receipt', id], queryFn: async () => (await api.get<Receipt>(`/payments/receipts/${id}`)).data, enabled: !!id });
  return (
    <Page>
      <QueryMessage loading={receipt.isLoading} error={receipt.error} retry={() => void receipt.refetch()} />
      {receipt.data ? (
        <Card>
          <Heading>Receipt {receipt.data.receiptNumber}</Heading>
          <Body>{receipt.data.itemTitle}</Body>
          <Body>Type: {receipt.data.itemType}</Body>
          <Body>Paid: {receipt.data.currency} {Number(receipt.data.amount).toFixed(2)}</Body>
          {receipt.data.method ? <Body>Method: {receipt.data.method}</Body> : null}
          <Body>Paid on {new Date(receipt.data.paidAt).toLocaleString()}</Body>
        </Card>
      ) : null}
    </Page>
  );
}

async function openExternalLink(url: string, label: string) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert(`Could not open ${label}`, apiError(error));
  }
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

function Body({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

function Button({
  title,
  onPress,
  variant = 'gold',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'gold' | 'outline' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'gold' ? styles.goldButton : variant === 'danger' ? styles.dangerButton : styles.outlineButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={variant === 'gold' ? styles.goldText : variant === 'danger' ? styles.dangerText : styles.outlineText}>{title}</Text>
    </Pressable>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
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

function QueryMessage({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  if (loading) return <Card><Body>Loading…</Body></Card>;
  if (error) return <Card><Body>{apiError(error)}</Body><Button title="Try again" variant="outline" onPress={retry} /></Card>;
  return null;
}

function LinkRow({ title, href, detail }: { title: string; href: Href; detail?: string }) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.linkRow}>
        <View style={styles.grow}>
          <Text style={styles.linkRowTitle}>{title}</Text>
          {detail ? <Text style={styles.small}>{detail}</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

function PurchaseRequestForm({
  itemType,
  itemId,
  title,
  price,
  currency,
  durationDays,
  rooms,
}: {
  itemType: 'COURSE' | 'MEMBERSHIP';
  itemId: string;
  title: string;
  price: number;
  currency: string;
  durationDays?: number;
  rooms?: string[];
}) {
  const qc = useQueryClient();
  const [amountPaid, setAmountPaid] = useState(Number(price).toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [proof, setProof] = useState<ProofFile | null>(null);
  const [error, setError] = useState('');
  const instructions = useQuery({
    queryKey: ['mobile', 'purchase-instructions'],
    queryFn: async () => (await api.get<{ instructions: string }>('/purchase-requests/instructions')).data,
  });
  const submit = useMutation({
    mutationFn: async () => {
      const amount = Number(amountPaid);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid amount paid.');
      if (paymentReference.trim().length < 2) throw new Error('Enter the payment reference.');
      if (!proof) throw new Error('Select a payment proof image.');
      const form = new FormData();
      form.append('itemType', itemType);
      form.append('itemId', itemId);
      form.append('amountPaid', String(amount));
      form.append('paymentMethod', paymentMethod);
      form.append('paymentReference', paymentReference.trim());
      if (paymentDate) form.append('paymentDate', paymentDate);
      if (customerNote.trim()) form.append('customerNote', customerNote.trim());
      if (proof.file) form.append('proof', proof.file);
      else appendNativeFile(form, 'proof', { uri: proof.uri, name: proof.name, type: proof.mimeType });
      return api.post<{ reference: string }>('/purchase-requests', form);
    },
    onSuccess: (response) => {
      setError('');
      setPaymentReference('');
      setCustomerNote('');
      setProof(null);
      Alert.alert('Request submitted', `Request ${response.data.reference} is awaiting payment verification.`);
      void qc.invalidateQueries({ queryKey: ['mobile', 'purchase-requests'] });
    },
    onError: (requestError) => setError(apiError(requestError)),
  });

  async function chooseProof() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (!selected) throw new Error('No payment proof file was selected.');
      if (selected.size !== undefined && selected.size > 5 * 1024 * 1024) {
        throw new Error('Payment proof must be 5 MB or smaller.');
      }
      const mimeType = selected.mimeType ?? '';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Choose a JPEG, PNG, or WebP image.');
      }
      setError('');
      setProof({ uri: selected.uri, name: selected.name, mimeType, size: selected.size, file: selected.file });
    } catch (pickError) {
      setError(apiError(pickError));
    }
  }

  return (
    <Card>
      <Text style={styles.cardTitle}>{title}</Text>
      <Body>{currency} {Number(price).toFixed(2)}{durationDays ? ` · ${durationDays} days` : ''}</Body>
      {rooms?.length ? <Body>Rooms: {rooms.map((room) => room.replace('_', ' ')).join(', ')}</Body> : null}
      <Text style={styles.label}>Payment instructions</Text>
      {instructions.isLoading ? <Body>Loading instructions…</Body> : null}
      {instructions.error ? <Text style={styles.error}>{apiError(instructions.error)}</Text> : null}
      {instructions.data ? <Body>{instructions.data.instructions}</Body> : null}
      <TextField label="Amount paid" value={amountPaid} onChangeText={setAmountPaid} keyboardType="decimal-pad" />
      <Text style={styles.label}>Payment method</Text>
      <View style={styles.choices}>
        {['BANK_TRANSFER', 'ECOCASH', 'INNBUCKS', 'ONEMONEY', 'CASH', 'OTHER'].map((method) => (
          <Pressable key={method} onPress={() => setPaymentMethod(method)} style={[styles.choice, paymentMethod === method && styles.choiceActive]}>
            <Text style={styles.choiceText}>{method.replace('_', ' ')}</Text>
          </Pressable>
        ))}
      </View>
      <TextField label="Transaction / payment reference" value={paymentReference} onChangeText={setPaymentReference} />
      <TextField label="Payment date (YYYY-MM-DD, optional)" value={paymentDate} onChangeText={setPaymentDate} placeholder="YYYY-MM-DD" />
      <TextField label="Note (optional)" value={customerNote} onChangeText={setCustomerNote} />
      <Button title={proof ? `Proof: ${proof.name}` : 'Choose payment proof image'} variant="outline" onPress={() => void chooseProof()} />
      <Body>Upload JPEG, PNG, or WebP up to 5 MB. Access is granted only after payment is independently verified.</Body>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button title={submit.isPending ? 'Submitting…' : 'Submit request'} disabled={submit.isPending || instructions.isLoading} onPress={() => submit.mutate()} />
    </Card>
  );
}

function appendNativeFile(form: FormData, name: string, file: NativeFile) {
  const appendFile = form as FormData & { append(name: string, value: NativeFile): void };
  appendFile.append(name, file);
}

export function ProfileScreen() {
  const { user: sessionUser, logout } = useAuth();
  const router = useRouter();
  const query = useQuery({ queryKey: ['mobile', 'profile'], queryFn: async () => (await api.get('/users/profile')).data as Record<string, unknown>, refetchOnMount: 'always' });
  const courses = useQuery({
    queryKey: ['mobile', 'courses'],
    queryFn: async () => (await api.get<Course[]>('/courses')).data,
    refetchOnMount: 'always',
  });
  const signalAccess = useQuery({
    queryKey: ['mobile', 'rooms-access'],
    queryFn: async () => (await api.get<SignalRoomAccess>('/signals/rooms/access')).data,
    refetchOnMount: 'always',
  });
  const subscription = useQuery({
    queryKey: ['mobile', 'subscription'],
    queryFn: async () => (await api.get<SubscriptionSummary>('/subscriptions')).data,
    refetchOnMount: 'always',
  });
  const profile = query.data ?? sessionUser;
  const name = typeof profile?.name === 'string' ? profile.name : 'Trader';
  const avatarUrl = typeof profile?.avatarUrl === 'string' ? profile.avatarUrl : null;
  const membership = typeof profile?.membership === 'string' ? profile.membership : 'FREE';
  const ownedCourses = (courses.data ?? []).filter((course) => !course.isFree && course.entitled);

  async function signOut() {
    const failure = await logout();
    if (failure) Alert.alert('Signed out', failure);
    router.replace('/login');
  }

  return (
    <Page
      refresh={() => {
        void query.refetch();
        void courses.refetch();
        void signalAccess.refetch();
        void subscription.refetch();
      }}
      refreshing={query.isRefetching || courses.isRefetching || signalAccess.isRefetching || subscription.isRefetching}
    >
      <QueryMessage loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      <Card>
        <View style={styles.avatar}>
          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase()}</Text>}
        </View>
        <Heading>{name}</Heading>
        <Body>{typeof profile?.email === 'string' ? profile.email : ''}</Body>
        <Text style={styles.badge}>{membership.replace('_', ' ')} MEMBER</Text>
        <Button title="Account settings" variant="outline" onPress={() => router.push('/settings')} />
      </Card>
      <Card>
        <Text style={styles.cardTitle}>Your current access</Text>
        {signalAccess.isError || subscription.isError || courses.isError ? (
          <Text style={styles.error}>Some access details could not be loaded. Pull down to refresh.</Text>
        ) : (
          <>
            <Body>Paid signals: {signalAccess.isLoading ? 'Checking…' : signalAccess.data?.PAID ? 'Available' : 'Not included'}</Body>
            <Body>
              Deriv VIP: {subscription.isLoading
                ? 'Checking…'
                : mobileRoomStatus(subscription.data?.roomAccess, 'VIP_DERIV', membership === 'VIP_DERIV' && profile?.isVip === true, subscription.dataUpdatedAt)}
            </Body>
            <Body>
              Weltrade VIP: {subscription.isLoading
                ? 'Checking…'
                : mobileRoomStatus(subscription.data?.roomAccess, 'VIP_WELTRADE', membership === 'VIP_WELTRADE' && profile?.isVip === true, subscription.dataUpdatedAt)}
            </Body>
            {courses.isLoading ? <Body>Loading course access…</Body> : ownedCourses.length ? (
              <View style={styles.accessCourses}>
                <Text style={styles.label}>Purchased courses · access confirmed</Text>
                {ownedCourses.map((course) => (
                  <LinkRow key={course.id} title={course.title} href={{ pathname: '/course/[slug]', params: { slug: course.slug } }} />
                ))}
              </View>
            ) : (
              <Body>Purchased courses appear here after payment is approved.</Body>
            )}
          </>
        )}
        <Button title="View purchase history and review status" variant="outline" onPress={() => router.push('/purchases')} />
      </Card>
      <LinkRow title="Membership & VIP access" href="/subscription" />
      <LinkRow title="Purchase history" href="/purchases" />
      <LinkRow title="Saved content" href="/saved" />
      <LinkRow title="Certificates" href="/certificates" />
      <LinkRow title="Wallet" href="/wallet" />
      <LinkRow title="Broker funds" href="/broker-funds" />
      <LinkRow title="Notifications" href="/notifications" />
      <LinkRow title="Help & Support" href="/support" />
      {sessionUser?.role === 'ADMIN' ? <LinkRow title="Admin dashboard" href="/admin" /> : null}
      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />
    </Page>
  );
}

function mobileRoomStatus(
  accessList: RoomAccessRecord[] | undefined,
  room: 'VIP_DERIV' | 'VIP_WELTRADE',
  legacyActive: boolean,
  now: number,
): string {
  const access = (accessList ?? [])
    .filter((item) => item.accessLevel === room && new Date(item.expiresAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  if (access && new Date(access.startsAt).getTime() > now) {
    return `Upcoming · starts ${new Date(access.startsAt).toLocaleDateString()}`;
  }
  if (access) return `Active · until ${new Date(access.expiresAt).toLocaleDateString()}`;
  return legacyActive ? 'Active' : 'Not active';
}

export function NotificationsScreen() {
  const qc = useQueryClient();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  useEffect(() => {
    void SecureStore.getItemAsync('atg.expo-push-token')
      .then((token) => setPushEnabled(Boolean(token)))
      .catch((error: unknown) => console.error('Could not read push registration state:', error));
  }, []);
  const query = useQuery({
    queryKey: ['mobile', 'notifications'],
    queryFn: async () => (await api.get<{ notifications: Notification[]; unread: number }>('/notifications')).data,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobile', 'notifications'] }),
    onError: (error) => Alert.alert('Could not update notifications', apiError(error)),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobile', 'notifications'] }),
    onError: (error) => Alert.alert('Could not update notification', apiError(error)),
  });
  return (
    <Page refresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <View style={styles.rowBetween}>
        <Heading>Notifications</Heading>
        <Button title="Mark all read" variant="outline" disabled={!query.data?.unread || markAll.isPending} onPress={() => markAll.mutate()} />
      </View>
      <Card>
        <Text style={styles.cardTitle}>Push notifications</Text>
        <Body>Receive ATG alerts when this app is in the background.</Body>
        <Button
          title={pushLoading ? 'Updating…' : pushEnabled ? 'Disable push alerts' : 'Enable push alerts'}
          variant={pushEnabled ? 'outline' : 'gold'}
          disabled={pushLoading}
          onPress={() => {
            setPushLoading(true);
            void (pushEnabled ? disablePushNotifications() : enablePushNotifications())
              .then(() => setPushEnabled(!pushEnabled))
              .catch((error: unknown) => Alert.alert('Could not update push notifications', apiError(error)))
              .finally(() => setPushLoading(false));
          }}
        />
      </Card>
      <QueryMessage loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      {query.data?.notifications.map((item) => (
        <Pressable key={item.id} onPress={() => { if (!item.read) markRead.mutate(item.id); }}>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              {!item.read ? <Text style={styles.unread}>NEW</Text> : null}
            </View>
            <Body>{item.body}</Body>
            <Text style={styles.small}>{new Date(item.createdAt).toLocaleString()}</Text>
          </Card>
        </Pressable>
      ))}
      {query.isSuccess && !query.data.notifications.length ? <Card><Body>You’re all caught up.</Body></Card> : null}
    </Page>
  );
}

export function WalletScreen() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ECOCASH');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const wallet = useQuery({ queryKey: ['mobile', 'wallet'], queryFn: async () => (await api.get<{ balance: number; currency: string }>('/wallet')).data });
  const config = useQuery({ queryKey: ['mobile', 'wallet-withdrawal-config'], queryFn: async () => (await api.get<{ min: number; max: number }>('/wallet/withdrawal-config')).data });
  const transactions = useQuery({ queryKey: ['mobile', 'wallet-transactions'], queryFn: async () => (await api.get<Transaction[]>('/wallet/transactions')).data });
  const submit = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) !== value * 100) throw new Error('Enter a valid amount with no more than two decimal places.');
      if (mode === 'deposit') return api.post('/wallet/deposit', { amount: value, method });
      if (!config.data) throw new Error('Withdrawal limits are not available yet. Try again.');
      if (value < config.data.min || value > config.data.max) throw new Error(`Withdrawal amount must be between ${config.data.min} and ${config.data.max}.`);
      if (wallet.isLoading) throw new Error('Your balance is still loading. Try again.');
      if (wallet.isError || !wallet.data) throw new Error('Your available balance could not be checked. Reload it before requesting a withdrawal.');
      if (value > wallet.data.balance) throw new Error('Amount exceeds your available balance.');
      if (!destination.trim()) throw new Error('Enter the payout destination.');
      return api.post('/wallet/withdraw', { amount: value, method, destination: destination.trim() }, {
        headers: { 'idempotency-key': `${Date.now()}-${Math.random().toString(36).slice(2)}` },
      });
    },
    onSuccess: () => {
      setError('');
      setAmount('');
      setDestination('');
      Alert.alert('Request submitted', 'Your wallet request has been submitted.');
      void qc.invalidateQueries({ queryKey: ['mobile', 'wallet'] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'wallet-transactions'] });
    },
    onError: (submitError) => setError(apiError(submitError)),
  });
  const paymentMethods = ['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'BANK_TRANSFER'];

  return (
    <Page refresh={() => { void wallet.refetch(); void transactions.refetch(); }} refreshing={wallet.isRefetching || transactions.isRefetching}>
      <Heading>Wallet</Heading>
      <Card>
        <Text style={styles.small}>Available balance</Text>
        <Text style={styles.balance}>{wallet.isLoading ? 'Loading…' : `${wallet.data?.currency ?? 'USD'} ${Number(wallet.data?.balance ?? 0).toFixed(2)}`}</Text>
        {wallet.isError ? <Button title="Retry" variant="outline" onPress={() => void wallet.refetch()} /> : null}
      </Card>
      <View style={styles.row}>
        <Button title="Deposit" onPress={() => { setMode('deposit'); setError(''); }} />
        <Button title="Withdraw" variant="outline" onPress={() => { setMode('withdraw'); setError(''); }} />
      </View>
      <Card>
        <Heading>{mode === 'deposit' ? 'Request a deposit' : 'Request a withdrawal'}</Heading>
        <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Text style={styles.label}>Payment method</Text>
        <View style={styles.choices}>
          {paymentMethods.map((item) => (
            <Pressable key={item} onPress={() => setMethod(item)} style={[styles.choice, method === item && styles.choiceActive]}>
              <Text style={styles.choiceText}>{item.replace('_', ' ')}</Text>
            </Pressable>
          ))}
        </View>
        {mode === 'withdraw' ? <TextField label="Payout destination" value={destination} onChangeText={setDestination} /> : null}
        {mode === 'withdraw' && config.data ? <Body>Limits: {config.data.min}–{config.data.max} {wallet.data?.currency ?? ''}.</Body> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button title={submit.isPending ? 'Submitting…' : `Submit ${mode}`} disabled={submit.isPending} onPress={() => submit.mutate()} />
      </Card>
      <Heading>Recent transactions</Heading>
      <QueryMessage loading={transactions.isLoading} error={transactions.error} retry={() => void transactions.refetch()} />
      {transactions.data?.map((tx) => <TransactionCard key={tx.id} item={tx} />)}
      {transactions.isSuccess && !transactions.data.length ? <Card><Body>No wallet transactions yet.</Body></Card> : null}
    </Page>
  );
}

function TransactionCard({ item }: { item: Transaction }) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{item.type.replace('_', ' ')}</Text>
        <Text style={styles.cardTitle}>{item.currency} {Number(item.amount).toFixed(2)}</Text>
      </View>
      <Body>{item.reference} · {item.status}</Body>
      <Text style={styles.small}>{new Date(item.createdAt).toLocaleString()}</Text>
    </Card>
  );
}

export function BrokerFundsScreen() {
  const [broker, setBroker] = useState<'DERIV' | 'WELTRADE'>('DERIV');
  const [direction, setDirection] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('ECOCASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationType, setDestinationType] = useState<'MOBILE_WALLET' | 'BANK_ACCOUNT' | 'BROKER_ACCOUNT' | 'CRYPTO_WALLET'>('MOBILE_WALLET');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['mobile', 'broker-config'], queryFn: async () => (await api.get<{ brokers: { id: string; label: string }[]; methods: { id: string; label: string }[]; limits: { currency: string; deposit: { min: number; max: number }; withdrawal: { min: number; max: number }; feePct: number }; notice: string }>('/broker/config')).data });
  const balances = useQuery({ queryKey: ['mobile', 'broker-balances'], queryFn: async () => (await api.get<{ balances: { broker: string; brokerLabel: string; available: boolean; balance: number | null; currency: string }[] }>('/broker/balances')).data });
  const transactions = useQuery({ queryKey: ['mobile', 'broker-transactions', broker], queryFn: async () => (await api.get<BrokerTransaction[]>('/broker/transactions', { params: { broker } })).data });
  const submit = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a valid amount.');
      if (!config.data) throw new Error('Broker funding limits are not available. Try again.');
      const limits = direction === 'DEPOSIT' ? config.data.limits.deposit : config.data.limits.withdrawal;
      if (value < limits.min || value > limits.max) throw new Error(`Amount must be between ${limits.min} and ${limits.max}.`);
      if (direction === 'DEPOSIT') {
        if (paymentReference.trim().length < 2) throw new Error('Enter the payment reference.');
        return api.post('/broker/deposits', { broker, amount: value, method, paymentReference: paymentReference.trim() });
      }
      if (!destination.trim()) throw new Error('Enter the payout destination.');
      return api.post('/broker/withdrawals', {
        broker,
        amount: value,
        method,
        destination: destination.trim(),
        destinationType,
      });
    },
    onSuccess: () => {
      setError('');
      setAmount('');
      setPaymentReference('');
      setDestination('');
      Alert.alert('Request submitted', 'Your broker funding request has been submitted for processing.');
      void qc.invalidateQueries({ queryKey: ['mobile', 'broker-transactions'] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'broker-balances'] });
    },
    onError: (submitError) => setError(apiError(submitError)),
  });

  return (
    <Page refresh={() => { void balances.refetch(); void transactions.refetch(); }} refreshing={balances.isRefetching || transactions.isRefetching}>
      <Heading>Broker funds</Heading>
      <Body>Broker deposits and withdrawals use a separate ledger from your ATG wallet.</Body>
      {balances.data?.balances.map((item) => (
        <Card key={item.broker}>
          <Text style={styles.cardTitle}>{item.brokerLabel}</Text>
          <Body>{item.available && item.balance !== null ? `${item.currency} ${item.balance.toFixed(2)}` : 'Balance unavailable'}</Body>
        </Card>
      ))}
      <View style={styles.choices}>
        {(['DERIV', 'WELTRADE'] as const).map((item) => (
          <Pressable key={item} onPress={() => setBroker(item)} style={[styles.choice, broker === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Button title="Deposit" onPress={() => { setDirection('DEPOSIT'); setError(''); }} />
        <Button title="Withdraw" variant="outline" onPress={() => { setDirection('WITHDRAWAL'); setError(''); }} />
      </View>
      <Card>
        <Heading>{direction === 'DEPOSIT' ? 'Broker deposit' : 'Broker withdrawal'}</Heading>
        <TextField label={`Amount (${config.data?.limits.currency ?? ''})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Text style={styles.label}>Payment method</Text>
        <View style={styles.choices}>
          {(config.data?.methods ?? []).map((item) => (
            <Pressable key={item.id} onPress={() => setMethod(item.id)} style={[styles.choice, method === item.id && styles.choiceActive]}>
              <Text style={styles.choiceText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        {direction === 'DEPOSIT' ? <TextField label="Payment reference" value={paymentReference} onChangeText={setPaymentReference} /> : <TextField label="Payout destination" value={destination} onChangeText={setDestination} />}
        {direction === 'WITHDRAWAL' ? (
          <>
            <Text style={styles.label}>Payout destination type</Text>
            <View style={styles.choices}>
              {([
                ['MOBILE_WALLET', 'Mobile wallet'],
                ['BANK_ACCOUNT', 'Bank account'],
                ['BROKER_ACCOUNT', 'Broker account'],
                ['CRYPTO_WALLET', 'Crypto wallet'],
              ] as const).map(([value, label]) => (
                <Pressable key={value} onPress={() => setDestinationType(value)} style={[styles.choice, destinationType === value && styles.choiceActive]}>
                  <Text style={styles.choiceText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button title={submit.isPending ? 'Submitting…' : 'Submit request'} disabled={submit.isPending} onPress={() => submit.mutate()} />
        {config.data?.notice ? <Body>{config.data.notice}</Body> : null}
      </Card>
      <Heading>Recent activity</Heading>
      <QueryMessage loading={transactions.isLoading} error={transactions.error} retry={() => void transactions.refetch()} />
      {transactions.data?.map((item) => (
        <Card key={item.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{item.direction} · {item.brokerLabel}</Text>
            <Text style={styles.cardTitle}>{item.currency} {item.amount.toFixed(2)}</Text>
          </View>
          <Body>{item.reference} · {item.status} · {item.methodLabel}</Body>
          {item.paymentReference ? <Body>Payment reference: {item.paymentReference}</Body> : null}
          {item.destination ? <Body>Destination: {item.destination}</Body> : null}
          <Text style={styles.small}>{new Date(item.createdAt).toLocaleString()}</Text>
        </Card>
      ))}
    </Page>
  );
}

export function SubscriptionScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const subscription = useQuery({ queryKey: ['mobile', 'subscription'], queryFn: async () => (await api.get<SubscriptionSummary>('/subscriptions')).data, refetchOnMount: 'always' });
  const packages = useQuery({ queryKey: ['mobile', 'membership-packages'], queryFn: async () => (await api.get<MembershipPackage[]>('/purchase-requests/packages')).data, refetchOnMount: 'always' });
  const requests = useQuery({ queryKey: ['mobile', 'purchase-requests'], queryFn: async () => (await api.get<PurchaseRequestSummary[]>('/purchase-requests')).data, refetchOnMount: 'always' });
  const [message, setMessage] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<MembershipPackage | null>(null);
  const now = subscription.dataUpdatedAt;
  const roomAccess = subscription.data?.roomAccess ?? [];
  const coveredRooms = new Set(roomAccess.filter((room) => new Date(room.expiresAt).getTime() > now).map((room) => room.accessLevel));
  if (user?.isVip && user.membership === 'VIP_DERIV' && (!user.vipExpiresAt || new Date(user.vipExpiresAt).getTime() > now)) coveredRooms.add('VIP_DERIV');
  if (user?.isVip && user.membership === 'VIP_WELTRADE' && (!user.vipExpiresAt || new Date(user.vipExpiresAt).getTime() > now)) coveredRooms.add('VIP_WELTRADE');
  const availablePackages = (packages.data ?? []).filter((item) => !item.includedRooms.every((room) => coveredRooms.has(room)));
  const renewalPackages = (packages.data ?? []).filter(
    (item) => item.activationRule === 'AFTER_CURRENT_ACCESS' && item.includedRooms.every((room) => coveredRooms.has(room)),
  );
  const cancel = useMutation({
    mutationFn: () => api.post('/subscriptions/cancel'),
    onSuccess: () => { setMessage('Membership cancellation submitted.'); void qc.invalidateQueries({ queryKey: ['mobile', 'subscription'] }); },
    onError: (error) => setMessage(apiError(error)),
  });

  return (
    <Page refresh={() => { void subscription.refetch(); void packages.refetch(); void requests.refetch(); }} refreshing={subscription.isRefetching || packages.isRefetching || requests.isRefetching}>
      <Heading>ATG memberships</Heading>
      <Card>
        <Text style={styles.cardTitle}>Current membership: {subscription.data?.status ?? 'Loading'}</Text>
        <Body>{subscription.data?.expiresAt ? `Expires ${new Date(subscription.data.expiresAt).toLocaleDateString()}` : 'Access is confirmed by the server.'}</Body>
        {roomAccess.map((room) => {
          const startsAt = new Date(room.startsAt);
          const expiresAt = new Date(room.expiresAt);
          const status = startsAt.getTime() > now ? 'Upcoming' : expiresAt.getTime() > now ? 'Active' : 'Expired';
          return <Body key={room.approvalReference + room.accessLevel}>{room.accessLevel.replace('_', ' ')} · {status} · {startsAt.toLocaleDateString()} – {expiresAt.toLocaleDateString()}</Body>;
        })}
        <Button title="Cancel subscription" variant="outline" disabled={cancel.isPending} onPress={() => cancel.mutate()} />
      </Card>
      <Heading>Available VIP memberships</Heading>
      <QueryMessage loading={packages.isLoading} error={packages.error} retry={() => void packages.refetch()} />
      {packages.isSuccess && !availablePackages.length ? <Card><Body>You already have access to the rooms in the available plans. Your status is shown above.</Body></Card> : null}
      {availablePackages.map((item) => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.description ? <Body>{item.description}</Body> : null}
          <Text style={styles.balance}>{item.currency} {Number(item.price).toFixed(2)}</Text>
          <Body>{item.durationDays} days · {item.includedRooms.map((room) => room.replace('_', ' ')).join(', ')}</Body>
          <Button title="Request membership" disabled={item.saleStatus !== 'AVAILABLE'} onPress={() => setSelectedPackage(item)} />
        </Card>
      ))}
      {renewalPackages.length ? (
        <>
          <Heading>Renew your VIP access</Heading>
          <Body>Renewal access starts after your current room access ends.</Body>
          {renewalPackages.map((item) => (
            <Card key={item.id}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.balance}>{item.currency} {Number(item.price).toFixed(2)}</Text>
              <Body>{item.durationDays} days · {item.includedRooms.map((room) => room.replace('_', ' ')).join(', ')}</Body>
              <Button title="Renew after current access" disabled={item.saleStatus !== 'AVAILABLE'} onPress={() => setSelectedPackage(item)} />
            </Card>
          ))}
        </>
      ) : null}
      {selectedPackage ? (
        <PurchaseRequestForm
          itemType="MEMBERSHIP"
          itemId={selectedPackage.id}
          title={selectedPackage.title}
          price={Number(selectedPackage.price)}
          currency={selectedPackage.currency}
          durationDays={selectedPackage.durationDays}
          rooms={selectedPackage.includedRooms}
        />
      ) : null}
      {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      <Heading>Recent membership requests</Heading>
      {requests.data?.map((item) => (
        <Card key={item.id}><Text style={styles.cardTitle}>{item.itemTitleSnapshot}</Text><Body>{item.reference} · {item.status}</Body></Card>
      ))}
      <Button title="View purchase history" variant="outline" onPress={() => router.push('/purchases')} />
    </Page>
  );
}

export function PurchasesScreen() {
  const qc = useQueryClient();
  const purchases = useQuery({ queryKey: ['mobile', 'purchases'], queryFn: async () => (await api.get<Purchase[]>('/payments/purchases')).data, refetchOnMount: 'always' });
  const requests = useQuery({ queryKey: ['mobile', 'purchase-requests'], queryFn: async () => (await api.get<{ id: string; reference: string; itemTitleSnapshot: string; amountSnapshot: number | string; currencySnapshot: string; status: string; createdAt: string }[]>('/purchase-requests')).data, refetchOnMount: 'always' });
  const transactions = useQuery({ queryKey: ['mobile', 'wallet-transactions'], queryFn: async () => (await api.get<Transaction[]>('/wallet/transactions')).data });
  const receipts = useQuery({ queryKey: ['mobile', 'receipts'], queryFn: async () => (await api.get<Receipt[]>('/payments/receipts')).data });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/purchase-requests/${id}/cancel`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mobile', 'purchase-requests'] }),
    onError: (error) => Alert.alert('Could not cancel request', apiError(error)),
  });
  return (
    <Page refresh={() => { void purchases.refetch(); void requests.refetch(); void transactions.refetch(); void receipts.refetch(); }} refreshing={purchases.isRefetching || requests.isRefetching || receipts.isRefetching}>
      <Heading>Purchases</Heading>
      <QueryMessage loading={purchases.isLoading} error={purchases.error} retry={() => void purchases.refetch()} />
      {purchases.data?.map((item) => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.itemTitle}</Text>
          <Body>{item.currency} {Number(item.amount).toFixed(2)} · {item.status}</Body>
          <Text style={styles.small}>{new Date(item.createdAt).toLocaleString()} · {item.provider}</Text>
          {item.status === 'PAID' && item.receipt ? <LinkRow title="View receipt" href={{ pathname: '/receipts/[id]', params: { id: item.receipt.id } }} /> : null}
        </Card>
      ))}
      <Heading>Manual payment requests</Heading>
      <Body>Course and membership purchase requests, including payment references and proof status, are listed below.</Body>
      {requests.data?.map((item) => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.itemTitleSnapshot}</Text>
          <Body>{item.reference} · {item.currencySnapshot} {Number(item.amountSnapshot).toFixed(2)} · {item.status}</Body>
          <Text style={styles.small}>{new Date(item.createdAt).toLocaleString()}</Text>
          {item.status === 'SUBMITTED' || item.status === 'UNDER_REVIEW' ? <Button title={cancel.isPending ? 'Cancelling…' : 'Cancel request'} variant="outline" onPress={() => cancel.mutate(item.id)} /> : null}
        </Card>
      ))}
      <Heading>Wallet activity</Heading>
      {transactions.data?.map((item) => <TransactionCard key={item.id} item={item} />)}
      <Heading>Receipts</Heading>
      {receipts.data?.map((item) => (
        <LinkRow key={item.id} title={item.itemTitle} href={{ pathname: '/receipts/[id]', params: { id: item.id } }} detail={`${item.receiptNumber} · ${item.currency} ${Number(item.amount).toFixed(2)}`} />
      ))}
    </Page>
  );
}

export function SettingsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const { updateUser } = useAuth();
  const profile = useQuery({ queryKey: ['mobile', 'profile'], queryFn: async () => (await api.get<{ id: string; name: string; phone?: string | null; country?: string | null; bio?: string | null; avatarUrl?: string | null }>('/users/profile')).data, refetchOnMount: 'always' });
  const [changes, setChanges] = useState<Partial<{ name: string; phone: string; country: string; bio: string }>>({});
  const [avatarFile, setAvatarFile] = useState<ProofFile | null>(null);
  const name = changes.name ?? profile.data?.name ?? '';
  const phone = changes.phone ?? profile.data?.phone ?? '';
  const country = changes.country ?? profile.data?.country ?? '';
  const bio = changes.bio ?? profile.data?.bio ?? '';
  function applyProfileUpdate(updated: {
    id: string;
    name: string;
    phone: string | null;
    country: string | null;
    bio: string | null;
    avatarUrl: string | null;
  }) {
    updateUser(updated);
    qc.setQueryData(['mobile', 'profile'], (current: typeof profile.data) =>
      current ? { ...current, ...updated } : current,
    );
    void qc.invalidateQueries({ queryKey: ['mobile', 'posts'] });
    void qc.invalidateQueries({ queryKey: ['mobile', 'signals'] });
    void qc.invalidateQueries({ queryKey: ['mobile', 'signal'] });
  }
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const save = useMutation({
    mutationFn: async () => (await api.patch('/users/profile', { name: name.trim(), phone: phone.trim(), country: country.trim(), bio: bio.trim() })).data as { ok: true; user: Parameters<typeof applyProfileUpdate>[0] },
    onSuccess: ({ user }) => {
      applyProfileUpdate(user);
      setChanges({});
      setMessage('Profile updated.');
    },
    onError: (error) => setMessage(apiError(error)),
  });
  const uploadAvatar = useMutation({
    mutationFn: async () => {
      if (!avatarFile) throw new Error('Choose a profile picture first.');
      const form = new FormData();
      if (avatarFile.file) form.append('avatar', avatarFile.file);
      else appendNativeFile(form, 'avatar', { uri: avatarFile.uri, name: avatarFile.name, type: avatarFile.mimeType });
      return (await api.post('/users/profile/avatar', form)).data as { ok: true; user: Parameters<typeof applyProfileUpdate>[0] };
    },
    onSuccess: ({ user }) => {
      setAvatarFile(null);
      applyProfileUpdate(user);
      setMessage('Profile picture updated.');
    },
    onError: (error) => setMessage(apiError(error)),
  });
  const removeAvatar = useMutation({
    mutationFn: async () => (await api.patch('/users/profile', { avatarUrl: null })).data as { ok: true; user: Parameters<typeof applyProfileUpdate>[0] },
    onSuccess: ({ user }) => {
      applyProfileUpdate(user);
      setMessage('Profile picture removed.');
    },
    onError: (error) => setMessage(apiError(error)),
  });
  const changePassword = useMutation({
    mutationFn: () => api.post('/users/change-password', { currentPassword, newPassword }),
    onSuccess: () => { setMessage('Password changed.'); setCurrentPassword(''); setNewPassword(''); },
    onError: (error) => setMessage(apiError(error)),
  });
  return (
    <Page>
      <Heading>Account settings</Heading>
      <Card>
        <Text style={styles.cardTitle}>Profile picture</Text>
        <View style={styles.avatarPickerRow}>
          <View style={styles.avatar}>
            {avatarFile ? <Image source={{ uri: avatarFile.uri }} style={styles.avatarImage} /> : profile.data?.avatarUrl ? <Image source={{ uri: profile.data.avatarUrl }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase()}</Text>}
          </View>
          <View style={styles.avatarActions}>
            <Button title="Choose picture" variant="outline" onPress={() => {
              void DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true })
                .then((result) => {
                  if (result.canceled) return;
                  const image = result.assets[0];
                  if (!image) throw new Error('No picture was selected.');
                  if (image.size !== undefined && image.size > 5 * 1024 * 1024) throw new Error('Choose a picture smaller than 5 MB.');
                  const mimeType = image.mimeType ?? '';
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Choose a JPEG, PNG, or WebP picture.');
                  setMessage('');
                  setAvatarFile({ uri: image.uri, name: image.name, mimeType, size: image.size, file: image.file });
                })
                .catch((error: unknown) => setMessage(apiError(error)));
            }} />
            {avatarFile ? <Button title={uploadAvatar.isPending ? 'Uploading…' : 'Upload picture'} disabled={uploadAvatar.isPending} onPress={() => uploadAvatar.mutate()} /> : null}
            {!avatarFile && profile.data?.avatarUrl ? <Button title="Remove picture" variant="outline" disabled={removeAvatar.isPending} onPress={() => removeAvatar.mutate()} /> : null}
          </View>
        </View>
        <TextField label="Full name" value={name} onChangeText={(value) => setChanges((current) => ({ ...current, name: value }))} />
        <TextField label="Phone" value={phone} onChangeText={(value) => setChanges((current) => ({ ...current, phone: value }))} keyboardType="phone-pad" />
        <TextField label="Country" value={country} onChangeText={(value) => setChanges((current) => ({ ...current, country: value }))} />
        <TextField label="Bio" value={bio} onChangeText={(value) => setChanges((current) => ({ ...current, bio: value }))} />
        <Button title={save.isPending ? 'Saving…' : 'Save profile'} disabled={save.isPending} onPress={() => save.mutate()} />
      </Card>
      <Card>
        <Heading>Change password</Heading>
        <TextField label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <TextField label="New password (at least 8 characters)" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Button title={changePassword.isPending ? 'Updating…' : 'Change password'} disabled={changePassword.isPending} onPress={() => {
          if (newPassword.length < 8) setMessage('New password must be at least 8 characters.');
          else changePassword.mutate();
        }} />
      </Card>
      {message ? <Text style={message.includes('updated') || message.includes('changed') ? styles.success : styles.error}>{message}</Text> : null}
      <Button title="View profile" variant="outline" onPress={() => router.push('/profile')} />
    </Page>
  );
}

export function SupportScreen() {
  const settings = useQuery({
    queryKey: ['mobile', 'site-settings'],
    queryFn: async () => (await api.get<SiteSettings>('/site-settings')).data,
  });
  const email = settings.data?.support.email;
  const whatsappPhone = settings.data?.support.whatsappPhone;

  return (
    <Page>
      <Heading>Help & Support</Heading>
      <QueryMessage loading={settings.isLoading} error={settings.error} retry={() => void settings.refetch()} />
      <Card>
        <Text style={styles.cardTitle}>Need assistance?</Text>
        <Body>Contact the ATG Traders team for account, payment, or course assistance.</Body>
        {email ? <Body>{email}</Body> : <Body>Email support is not configured yet.</Body>}
        <Button title="Email support" variant="outline" disabled={!email} onPress={() => email && void openExternalLink(`mailto:${email}`, 'email')} />
        {whatsappPhone ? <Body>+{whatsappPhone}</Body> : <Body>WhatsApp support is not configured yet.</Body>}
        <Button title="Chat on WhatsApp" variant="outline" disabled={!whatsappPhone} onPress={() => whatsappPhone && void openExternalLink(`https://wa.me/${whatsappPhone}`, 'WhatsApp')} />
      </Card>
      <Heading>FAQ</Heading>
      <Card><Text style={styles.cardTitle}>What is a trading signal?</Text><Body>A signal is a suggested trade with entry, stop-loss, and take-profit levels. Always apply your own risk management.</Body></Card>
      <Card><Text style={styles.cardTitle}>How do VIP signals differ?</Text><Body>VIP signals include additional analysis and live updates. Access depends on your approved membership.</Body></Card>
      <Card><Text style={styles.cardTitle}>How do deposits work?</Text><Body>Submit a deposit request in Wallet. The payment provider or administrator verifies it before funds are credited.</Body></Card>
      <Card><Text style={styles.cardTitle}>Can I cancel my subscription?</Text><Body>Use Profile → Membership to manage or cancel eligible subscriptions. Access may continue until expiry.</Body></Card>
      <Card><Body>Risk warning: trading synthetic indices and CFDs carries a high level of risk. ATG Traders provides education and signals, not financial advice. Only trade with money you can afford to lose.</Body></Card>
    </Page>
  );
}

export function SavedScreen() {
  const qc = useQueryClient();
  const watchlist = useQuery({ queryKey: ['mobile', 'watchlist'], queryFn: async () => (await api.get<{ id: string; pair: string }[]>('/users/watchlist')).data });
  const remove = useMutation({
    mutationFn: (pair: string) => api.delete(`/users/watchlist/${encodeURIComponent(pair)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mobile', 'watchlist'] }),
    onError: (error) => Alert.alert('Could not remove saved pair', apiError(error)),
  });
  return (
    <Page refresh={() => void watchlist.refetch()} refreshing={watchlist.isRefetching}>
      <Heading>Saved content</Heading>
      <QueryMessage loading={watchlist.isLoading} error={watchlist.error} retry={() => void watchlist.refetch()} />
      {watchlist.data?.map((item) => (
        <Card key={item.id}>
          <Text style={styles.cardTitle}>{item.pair}</Text>
          <View style={styles.row}>
            <LinkRow title="Browse signals" href="/signals" />
            <Button title="Remove" variant="danger" disabled={remove.isPending} onPress={() => remove.mutate(item.pair)} />
          </View>
        </Card>
      ))}
      {watchlist.isSuccess && !watchlist.data.length ? <Card><Body>No saved pairs yet. Save a pair from its signal details.</Body></Card> : null}
    </Page>
  );
}

type Certificate = { id: string; title: string; issuedAt: string; course?: { title: string; level: string } | null };

export function CertificatesScreen() {
  const certificates = useQuery({ queryKey: ['mobile', 'certificates'], queryFn: async () => (await api.get<Certificate[]>('/users/certificates')).data });
  return (
    <Page refresh={() => void certificates.refetch()} refreshing={certificates.isRefetching}>
      <Heading>My certificates</Heading>
      <QueryMessage loading={certificates.isLoading} error={certificates.error} retry={() => void certificates.refetch()} />
      {certificates.data?.map((item) => (
        <LinkRow key={item.id} title={item.course?.title ?? item.title} href={{ pathname: '/certificates/[id]', params: { id: item.id } }} detail={`Issued ${new Date(item.issuedAt).toLocaleDateString()}`} />
      ))}
      {certificates.isSuccess && !certificates.data.length ? <Card><Body>Complete a course to earn your first certificate.</Body></Card> : null}
    </Page>
  );
}

export function CertificateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const certificate = useQuery({ queryKey: ['mobile', 'certificate', id], queryFn: async () => (await api.get<Certificate & { recipient: string }>(`/users/certificates/${id}`)).data, enabled: !!id });
  const [sharing, setSharing] = useState(false);
  async function shareCertificate() {
    if (!certificate.data) return;
    setSharing(true);
    try {
      const courseTitle = certificate.data.course?.title ?? certificate.data.title;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;text-align:center;padding:70px 48px;color:#1b1b1b;border:12px solid #a67c00}h1{font-size:34px;margin:20px 0}p{font-size:18px;line-height:1.6}.issuer{margin-top:60px;color:#7a5b00;font-weight:bold}</style></head><body><p>ATG TRADERS</p><h1>Certificate of Completion</h1><p>This certificate is presented to</p><h2>${escapeHtml(certificate.data.recipient)}</h2><p>for successfully completing</p><h2>${escapeHtml(courseTitle)}</h2><p>${escapeHtml(certificate.data.course?.level ?? '')}</p><p>Issued ${escapeHtml(new Date(certificate.data.issuedAt).toLocaleDateString())}</p><p class="issuer">Accurate Trading Group</p></body></html>`;
      const file = await Print.printToFileAsync({ html });
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available on this device.');
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share certificate' });
    } catch (error) {
      Alert.alert('Could not share certificate', apiError(error));
    } finally {
      setSharing(false);
    }
  }
  return (
    <Page>
      <QueryMessage loading={certificate.isLoading} error={certificate.error} retry={() => void certificate.refetch()} />
      {certificate.data ? (
        <Card>
          <Heading>{certificate.data.course?.title ?? certificate.data.title}</Heading>
          <Body>Presented to {certificate.data.recipient}</Body>
          {certificate.data.course?.level ? <Body>{certificate.data.course.level}</Body> : null}
          <Body>Issued {new Date(certificate.data.issuedAt).toLocaleDateString()}</Body>
          <Button title={sharing ? 'Preparing certificate…' : 'Share certificate PDF'} disabled={sharing} onPress={() => void shareCertificate()} />
        </Card>
      ) : null}
    </Page>
  );
}

export function CommunityScreen() {
  const qc = useQueryClient();
  const [category, setCategory] = useState('All');
  const [body, setBody] = useState('');
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState('');
  const groups = useQuery({ queryKey: ['mobile', 'groups'], queryFn: async () => (await api.get<Group[]>('/community/groups')).data });
  const posts = useQuery({ queryKey: ['mobile', 'posts', category], queryFn: async () => (await api.get<Post[]>('/community/posts', { params: { category } })).data });
  const createPost = useMutation({
    mutationFn: () => api.post('/community/posts', { body: body.trim(), kind: 'POST' }),
    onSuccess: () => { setBody(''); setError(''); void qc.invalidateQueries({ queryKey: ['mobile', 'posts'] }); },
    onError: (requestError) => setError(apiError(requestError)),
  });
  const like = useMutation({
    mutationFn: (id: string) => api.post(`/community/posts/${id}/like`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mobile', 'posts'] }),
    onError: (requestError) => setError(apiError(requestError)),
  });
  const comments = useQuery({
    queryKey: ['mobile', 'comments', expandedPost],
    queryFn: async () => (await api.get<{ id: string; body: string; user: { name: string; role?: string } }[]>(`/community/posts/${expandedPost}/comments`)).data,
    enabled: !!expandedPost,
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`/community/posts/${expandedPost}/comments`, { body: commentText.trim() }),
    onSuccess: () => {
      setCommentText('');
      void qc.invalidateQueries({ queryKey: ['mobile', 'comments', expandedPost] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'posts'] });
    },
    onError: (requestError) => setError(apiError(requestError)),
  });
  return (
    <Page refresh={() => { void groups.refetch(); void posts.refetch(); }} refreshing={groups.isRefetching || posts.isRefetching}>
      <Heading>Community</Heading>
      <Body>Connect, learn, and share with the ATG Traders community.</Body>
      <Heading>Chat rooms</Heading>
      {groups.data?.map((group) => group.canAccess ? (
        <LinkRow key={group.id} title={group.name} href={`/community/${group.id}`} detail={`${group.accessTier ?? 'FREE'} · ${group._count?.members ?? 0} members`} />
      ) : (
        <Card key={group.id}><Text style={styles.cardTitle}>{group.name} · Locked</Text><Body>{group.description ?? 'This room requires a different membership.'}</Body></Card>
      ))}
      <Card>
        <Text style={styles.cardTitle}>Share with the community</Text>
        <TextInput accessibilityLabel="Community post" multiline maxLength={4000} onChangeText={setBody} placeholder="Write a post…" style={[styles.input, styles.multiline]} value={body} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title={createPost.isPending ? 'Posting…' : 'Post'} disabled={!body.trim() || createPost.isPending} onPress={() => createPost.mutate()} />
      </Card>
      <View style={styles.choices}>
        {['All', 'Analysis', 'Wins', 'Questions'].map((item) => (
          <Pressable key={item} onPress={() => setCategory(item)} style={[styles.choice, category === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>
        ))}
      </View>
      <QueryMessage loading={posts.isLoading} error={posts.error} retry={() => void posts.refetch()} />
      {posts.data?.map((post) => (
        <Card key={post.id}>
          <View style={styles.postAuthorRow}>
            {post.author.avatarUrl ? (
              <Image source={{ uri: post.author.avatarUrl }} style={styles.postAuthorAvatar} />
            ) : (
              <View style={styles.postAuthorAvatarFallback}>
                <Text style={styles.postAuthorInitials}>{post.author.name.slice(0, 2).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.cardTitle}>{post.author.name}{post.group?.name ? ` · ${post.group.name}` : ''}</Text>
          </View>
          <Text style={styles.postBody}>{post.body}</Text>
          <View style={styles.rowBetween}>
            <Button title={`${post.likedByMe ? 'Liked' : 'Like'} · ${post.likeCount}`} variant="outline" onPress={() => like.mutate(post.id)} />
            <Button title={`${post.commentCount} comments`} variant="outline" onPress={() => {
              setExpandedPost((current) => current === post.id ? null : post.id);
              setError('');
            }} />
          </View>
          {expandedPost === post.id ? (
            <View style={[styles.commentList, { width: '100%' }]}>
              <QueryMessage loading={comments.isLoading} error={comments.error} retry={() => void comments.refetch()} />
              {comments.data?.map((comment) => <Card key={comment.id}><Text style={styles.cardTitle}>{comment.user.name}</Text><Body>{comment.body}</Body></Card>)}
              <TextInput accessibilityLabel="Write a comment" maxLength={1000} onChangeText={setCommentText} placeholder="Write a reply…" style={styles.input} value={commentText} />
              <Button title={addComment.isPending ? 'Replying…' : 'Reply'} disabled={!commentText.trim() || addComment.isPending} onPress={() => addComment.mutate()} />
            </View>
          ) : <Text style={styles.small}>{new Date(post.createdAt).toLocaleString()}</Text>}
        </Card>
      ))}
    </Page>
  );
}

export function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ['mobile', 'group', id], queryFn: async () => (await api.get<Group>(`/community/groups/${id}`)).data, enabled: !!id });
  const history = useQuery({
    queryKey: ['mobile', 'messages', id],
    queryFn: async () => (await api.get<{ chatOpen: boolean; messages: Message[] }>(`/community/groups/${id}/messages`)).data,
    enabled: !!id,
  });
  useEffect(() => {
    if (!id) return;
    let socket: ReturnType<typeof getRealtimeSocket>;
    try {
      socket = getRealtimeSocket();
    } catch (socketError) {
      Alert.alert('Chat unavailable', apiError(socketError));
      return;
    }
    const join = () => {
      socket.emit('group:join', id, (joined: boolean) => {
        if (!joined) setError('You do not have access to this chat room.');
        else setError('');
      });
    };
    const connectionFailure = (connectionError: Error) => {
      setError(apiError(connectionError));
      if (connectionError.message === 'Invalid token') {
        void api.get('/auth/me').catch((refreshError: unknown) => setError(apiError(refreshError)));
      }
    };
    const receive = (message: Message & { groupId?: string }) => {
      if (message.groupId && message.groupId !== id) return;
      qc.setQueryData<{ chatOpen: boolean; messages: Message[] }>(['mobile', 'messages', id], (current) => {
        if (!current || current.messages.some((item) => item.id === message.id)) return current;
        return { ...current, messages: [...current.messages, message] };
      });
    };
    socket.on('connect', join);
    socket.on('connect_error', connectionFailure);
    socket.on('group:message', receive);
    if (socket.connected) join();
    return () => {
      socket.emit('group:leave', id);
      socket.off('connect', join);
      socket.off('connect_error', connectionFailure);
      socket.off('group:message', receive);
    };
  }, [id, qc]);
  const send = useMutation({
    mutationFn: () => new Promise<void>((resolve, reject) => {
      try {
        const socket = getRealtimeSocket();
        socket.timeout(10_000).emit('group:message', { groupId: id, body: body.trim() }, (error: Error | null, sent: boolean) => {
          if (error) reject(new Error('Chat server did not respond. Check your connection and try again.'));
          else if (!sent) reject(new Error('The message was not accepted. Check room access and chat availability.'));
          else resolve();
        });
      } catch (socketError) {
        reject(socketError);
      }
    }),
    onSuccess: () => { setBody(''); setError(''); },
    onError: (requestError) => setError(apiError(requestError)),
  });
  return (
    <Page refresh={() => void history.refetch()} refreshing={history.isRefetching}>
      <Heading>{group.data?.name ?? 'Group chat'}</Heading>
      {group.data?.description ? <Body>{group.data.description}</Body> : null}
      <QueryMessage loading={history.isLoading} error={history.error} retry={() => void history.refetch()} />
      {history.data?.messages.map((message) => (
        <Card key={message.id}>
          <Text style={styles.cardTitle}>{message.user.name}</Text>
          <Body>{message.body}</Body>
          <Text style={styles.small}>{new Date(message.createdAt).toLocaleString()}</Text>
        </Card>
      ))}
      {history.data?.chatOpen === false ? <Card><Body>This chat is currently closed by an administrator.</Body></Card> : (
        <Card>
          <TextInput accessibilityLabel="Chat message" multiline maxLength={2000} onChangeText={setBody} placeholder="Type a message…" style={[styles.input, styles.multiline]} value={body} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={send.isPending ? 'Sending…' : 'Send'} disabled={!body.trim() || send.isPending} onPress={() => send.mutate()} />
        </Card>
      )}
    </Page>
  );
}

export function SignalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['mobile', 'signal', id], queryFn: async () => (await api.get<Signal>(`/signals/${id}`)).data, enabled: !!id });
  const watchlist = useQuery({ queryKey: ['mobile', 'watchlist'], queryFn: async () => (await api.get<{ id: string; pair: string }[]>('/users/watchlist')).data });
  const isSaved = query.data ? watchlist.data?.some((item) => item.pair === query.data?.pair) ?? false : false;
  const save = useMutation({
    mutationFn: () => isSaved
      ? api.delete(`/users/watchlist/${encodeURIComponent(query.data!.pair)}`)
      : api.post('/users/watchlist', { pair: query.data!.pair }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mobile', 'watchlist'] }),
    onError: (error) => Alert.alert('Could not update saved pairs', apiError(error)),
  });
  return (
    <Page refresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <QueryMessage loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      {query.data ? (
        <Card>
          <Heading>{query.data.pair}</Heading>
          <Body>{query.data.market} · {query.data.timeframe} · {query.data.direction}</Body>
          <Body>Entry: {query.data.entry ?? '—'}</Body>
          <Body>Take profit: {query.data.takeProfit ?? '—'}</Body>
          <Body>Stop loss: {query.data.stopLoss ?? '—'}</Body>
          <Body>Status: {query.data.status.replace('_', ' ')}</Body>
          {query.data.analysis ? <Body>{query.data.analysis}</Body> : null}
          {query.data.author ? (
            <View style={styles.postAuthorRow}>
              {query.data.author.avatarUrl ? (
                <Image source={{ uri: query.data.author.avatarUrl }} style={styles.postAuthorAvatar} />
              ) : (
                <View style={styles.postAuthorAvatarFallback}>
                  <Text style={styles.postAuthorInitials}>{query.data.author.name.slice(0, 2).toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.small}>Shared by {query.data.author.name}{query.data.author.role === 'ADMIN' ? ' · ATG Admin' : ''}</Text>
            </View>
          ) : null}
          {query.data.locked ? <Text style={styles.badge}>VIP ACCESS REQUIRED</Text> : null}
          {watchlist.error ? <Text style={styles.error}>Saved pairs could not be checked. Retry before changing this pair.</Text> : null}
          <Button title={isSaved ? 'Remove saved pair' : 'Save pair'} variant="outline" disabled={save.isPending || watchlist.isLoading || Boolean(watchlist.error)} onPress={() => save.mutate()} />
          <Text style={styles.small}>Signals are educational, not investment advice.</Text>
        </Card>
      ) : null}
    </Page>
  );
}

export function CourseDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['mobile', 'course', slug],
    queryFn: async () => (await api.get<Course>(`/courses/${slug}`)).data,
    enabled: !!slug,
    refetchOnMount: 'always',
  });
  const enroll = useMutation({
    mutationFn: () => api.post(`/courses/${slug}/enroll`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mobile', 'course', slug] }),
    onError: (error) => Alert.alert('Could not enroll', apiError(error)),
  });
  const progress = useMutation({
    mutationFn: (lessonId: string) => api.post(`/courses/${slug}/progress`, { lessonId, completed: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mobile', 'course', slug] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'courses'] });
    },
    onError: (error) => Alert.alert('Could not update course progress', apiError(error)),
  });
  return (
    <Page refresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <QueryMessage loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
      {query.data ? (
        <Card>
          <Heading>{query.data.title}</Heading>
          <Body>{query.data.description ?? ''}</Body>
          <Body>{query.data.level} · {query.data.lessonCount} lessons · {query.data.durationMin} minutes</Body>
          <Text style={styles.badge}>{query.data.isFree ? 'FREE' : `${query.data.currency ?? 'USD'} ${query.data.price}`}</Text>
          {query.data.progress > 0 ? <Body>Progress: {query.data.progress}%</Body> : null}
          {!query.data.entitled && (query.data.isFree || query.data.price <= 0) ? <Button title={enroll.isPending ? 'Enrolling…' : 'Enroll'} disabled={enroll.isPending} onPress={() => enroll.mutate()} /> : null}
          {!query.data.entitled && query.data.price > 0 ? (
            <PurchaseRequestForm itemType="COURSE" itemId={query.data.id} title={query.data.title} price={query.data.price} currency={query.data.currency ?? 'USD'} />
          ) : null}
          {query.data.lessons?.map((lesson) => (
            <Card key={lesson.id}>
              <Text style={styles.cardTitle}>{lesson.order}. {lesson.title}</Text>
              {lesson.description ? <Body>{lesson.description}</Body> : null}
              <Body>{lesson.durationMin} min{lesson.locked ? ' · Locked' : ''}{lesson.completed ? ' · Completed' : ''}</Body>
              {lesson.videoUrl && !lesson.locked ? <LessonVideo url={lesson.videoUrl} /> : null}
              {query.data.entitled && !lesson.completed && !lesson.locked ? <Button title={progress.isPending ? 'Saving…' : 'Mark complete'} disabled={progress.isPending} onPress={() => progress.mutate(lesson.id)} /> : null}
            </Card>
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

function LessonVideo({ url }: { url: string }) {
  const [visible, setVisible] = useState(false);
  const player = useVideoPlayer(url);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  return (
    <View style={{ gap: 8 }}>
      <Button
        title={visible ? (isPlaying ? 'Pause lesson' : 'Play lesson') : 'Play lesson video'}
        variant="outline"
        onPress={() => {
          if (!visible) setVisible(true);
          if (isPlaying) player.pause();
          else player.play();
        }}
      />
      {visible ? <VideoView player={player} style={{ width: '100%', height: 220, borderRadius: 12 }} fullscreenOptions={{ enable: true }} allowsPictureInPicture /> : null}
    </View>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

export function AdminScreen() {
  const tabs = ['Overview', 'Signals', 'Rooms', 'Courses', 'Purchase Requests', 'Users', 'Payments', 'Transactions', 'Broker Funds', 'Weltrade Accounts', 'Broadcast'];
  const [tab, setTab] = useState('Overview');
  const [queue, setQueue] = useState('Deposits');
  const [form, setForm] = useState<Record<string, string>>({});
  const [courseToolsSlug, setCourseToolsSlug] = useState<string | null>(null);
  const [paymentAuditFor, setPaymentAuditFor] = useState<string | null>(null);
  const qc = useQueryClient();
  const refunds = useQuery({
    queryKey: ['mobile', 'admin-refunds'],
    queryFn: async () => (await api.get<AdminRecord[]>('/admin/refunds')).data,
    enabled: tab === 'Payments',
  });
  const paymentAudit = useQuery({
    queryKey: ['mobile', 'admin-payment-audit', paymentAuditFor],
    queryFn: async () => (await api.get<AdminRecord[]>('/admin/payments/audit', { params: { purchaseId: paymentAuditFor } })).data,
    enabled: Boolean(paymentAuditFor),
  });
  const query = useQuery({
    queryKey: ['mobile', 'admin', tab, queue, form.paymentStatus, form.provider, form.search],
    enabled: tab !== 'Broadcast',
    queryFn: async () => {
      const path: Record<string, string> = {
        Overview: '/admin/stats',
        Signals: '/signals',
        Rooms: '/admin/groups',
        Courses: '/courses',
        'Purchase Requests': '/admin/purchases',
        Users: '/admin/users',
        Payments: '/admin/payments',
        Transactions: '/admin/transactions',
        'Broker Funds': queue === 'Withdrawals' ? '/admin/broker/withdrawals' : queue === 'Audit' ? '/admin/broker/audit' : queue === 'Balances' ? '/admin/broker/balances' : queue === 'Limits' ? '/admin/broker/settings' : '/admin/broker/deposits',
        'Weltrade Accounts': '/admin/weltrade-accounts',
      };
      const params = tab === 'Courses'
        ? { all: true }
        : tab === 'Payments'
          ? { status: form.paymentStatus || undefined, provider: form.provider || undefined, q: form.search || undefined }
          : undefined;
      return (await api.get(path[tab], { params })).data as unknown;
    },
  });
  const action = useMutation({
    mutationFn: async (input: { method: 'post' | 'patch' | 'delete' | 'put'; path: string; data?: Record<string, unknown> }) =>
      (await api.request({ method: input.method, url: input.path, data: input.data })).data as unknown,
    onSuccess: (result: unknown) => {
      setForm({});
      void qc.invalidateQueries({ queryKey: ['mobile', 'admin'] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'admin-course-detail'] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'signals'] });
      void qc.invalidateQueries({ queryKey: ['mobile', 'courses'] });
      Alert.alert(
        tab === 'Broadcast' ? 'Broadcast sent' : 'Admin action complete',
        tab === 'Broadcast' && isRecord(result) ? `Delivered to ${String(result.delivered ?? 0)} members.` : 'Changes were saved.',
      );
    },
    onError: (error) => Alert.alert('Admin action failed', apiError(error)),
  });
  const items = recordsFrom(query.data);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const send = (method: 'post' | 'patch' | 'delete' | 'put', path: string, data?: Record<string, unknown>) => action.mutate({ method, path, data });
  const refresh = () => void query.refetch();
  const titleField = <AdminField label="Title" value={form.title ?? ''} onChangeText={(value) => set('title', value)} />;

  function renderCreateForm() {
    if (tab === 'Signals') {
      const entry = Number(form.entry);
      const takeProfit = Number(form.takeProfit);
      const stopLoss = Number(form.stopLoss);
      const validPrices = [entry, takeProfit, stopLoss].every((value) => Number.isFinite(value) && value > 0)
        && (form.direction === 'SELL' ? takeProfit < entry && entry < stopLoss : stopLoss < entry && entry < takeProfit);
      return <Card>
        <Text style={styles.cardTitle}>Publish signal</Text>
        <AdminField label="Pair" value={form.pair ?? ''} onChangeText={(value) => set('pair', value)} />
        <AdminField label="Entry" value={form.entry ?? ''} onChangeText={(value) => set('entry', value)} keyboardType="decimal-pad" />
        <AdminField label="Take profit" value={form.takeProfit ?? ''} onChangeText={(value) => set('takeProfit', value)} keyboardType="decimal-pad" />
        <AdminField label="Stop loss" value={form.stopLoss ?? ''} onChangeText={(value) => set('stopLoss', value)} keyboardType="decimal-pad" />
        <AdminField label="Analysis" value={form.analysis ?? ''} onChangeText={(value) => set('analysis', value)} />
        <AdminChoices label="Direction" options={['BUY', 'SELL']} value={form.direction ?? 'BUY'} onChange={(value) => set('direction', value)} />
        <AdminChoices label="Market" options={['Derived', 'Forex', 'Commodities', 'Crypto', 'Indices', 'Stocks']} value={form.market ?? 'Derived'} onChange={(value) => set('market', value)} />
        <AdminChoices label="Audience" options={['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE']} value={form.audience ?? 'VIP_DERIV'} onChange={(value) => set('audience', value)} />
        <AdminChoices label="Timeframe" options={['1m', '5m', '15m', '30m', '1H', '4H']} value={form.timeframe ?? '15m'} onChange={(value) => set('timeframe', value)} />
        <Body>{validPrices ? 'Price order looks valid.' : form.direction === 'SELL' ? 'For SELL, TP must be below entry and SL above entry.' : 'For BUY, SL must be below entry and TP above entry.'}</Body>
        <Button title="Publish signal" disabled={!form.pair?.trim() || !validPrices || action.isPending} onPress={() => send('post', '/signals', {
          pair: form.pair?.trim(), market: form.market ?? 'Derived', direction: form.direction ?? 'BUY', audience: form.audience ?? 'VIP_DERIV',
          timeframe: form.timeframe ?? '15m', entry: Number(form.entry), takeProfit: Number(form.takeProfit), stopLoss: Number(form.stopLoss), analysis: form.analysis?.trim() ?? '',
        })} />
      </Card>;
    }
    if (tab === 'Rooms') {
      return <Card>
        <Text style={styles.cardTitle}>Create room</Text>
        <AdminField label="Name" value={form.name ?? ''} onChangeText={(value) => set('name', value)} />
        <AdminField label="Description" value={form.description ?? ''} onChangeText={(value) => set('description', value)} />
        <AdminChoices label="Access tier" options={['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE']} value={form.accessTier ?? 'FREE'} onChange={(value) => set('accessTier', value)} />
        <AdminChoices label="Room type" options={['GENERAL', 'DERIV', 'WELTRADE']} value={form.roomType ?? 'GENERAL'} onChange={(value) => set('roomType', value)} />
        <Button title="Create room" disabled={!form.name?.trim() || action.isPending} onPress={() => send('post', '/admin/groups', { name: form.name?.trim(), description: form.description?.trim(), accessTier: form.accessTier ?? 'FREE', roomType: form.roomType ?? 'GENERAL' })} />
      </Card>;
    }
    if (tab === 'Courses') {
      const editingSlug = form.editCourseSlug;
      return <Card>
        <Text style={styles.cardTitle}>{editingSlug ? 'Edit course' : 'Create course'}</Text>
        {titleField}
        {!editingSlug ? <AdminField label="Slug" value={form.slug ?? ''} onChangeText={(value) => set('slug', value)} /> : null}
        <AdminField label="Description" value={form.description ?? ''} onChangeText={(value) => set('description', value)} />
        <AdminField label="Price" value={form.price ?? '0'} onChangeText={(value) => set('price', value)} keyboardType="decimal-pad" />
        <AdminChoices label="Level" options={['Beginner', 'Intermediate', 'Advanced']} value={form.level ?? 'Beginner'} onChange={(value) => set('level', value)} />
        <Button title={editingSlug ? 'Save course changes' : 'Create course'} disabled={!form.title?.trim() || (!editingSlug && !form.slug?.trim()) || action.isPending} onPress={() => send(editingSlug ? 'patch' : 'post', editingSlug ? `/courses/${encodeURIComponent(editingSlug)}` : '/courses', {
          title: form.title?.trim(), ...(!editingSlug ? { slug: form.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') } : {}),
          description: form.description?.trim() ?? '', price: Number(form.price ?? 0), level: form.level ?? 'Beginner', currency: 'USD',
          ...(!editingSlug ? { published: false } : {}),
        })} />
        {editingSlug ? <Button title="Cancel edit" variant="outline" onPress={() => setForm({})} /> : null}
        {editingSlug ? <>
          <Text style={styles.cardTitle}>Add lesson</Text>
          <AdminField label="Lesson title" value={form.lessonTitle ?? ''} onChangeText={(value) => set('lessonTitle', value)} />
          <AdminField label="Video URL (optional)" value={form.videoUrl ?? ''} onChangeText={(value) => set('videoUrl', value)} />
          <AdminField label="Duration (minutes)" value={form.durationMin ?? '0'} onChangeText={(value) => set('durationMin', value)} keyboardType="decimal-pad" />
          <AdminField label="Lesson description" value={form.lessonDescription ?? ''} onChangeText={(value) => set('lessonDescription', value)} />
          <Button title="Add lesson" disabled={!form.lessonTitle?.trim() || action.isPending} onPress={() => send('post', `/courses/${encodeURIComponent(editingSlug)}/lessons`, {
            title: form.lessonTitle?.trim(), description: form.lessonDescription?.trim(), videoUrl: form.videoUrl?.trim() || null, durationMin: Number(form.durationMin ?? 0),
          })} />
        </> : null}
      </Card>;
    }
    if (tab === 'Broker Funds' && queue === 'Balances') {
      return <Card>
        <Text style={styles.cardTitle}>Record broker balance</Text>
        <AdminField label="User ID" value={form.userId ?? ''} onChangeText={(value) => set('userId', value)} />
        <AdminChoices label="Broker" options={['DERIV', 'WELTRADE']} value={form.broker ?? 'DERIV'} onChange={(value) => set('broker', value)} />
        <AdminField label="Balance" value={form.balance ?? ''} onChangeText={(value) => set('balance', value)} keyboardType="decimal-pad" />
        <AdminField label="Verification reference" value={form.reference ?? ''} onChangeText={(value) => set('reference', value)} />
        <Button title="Save verified balance" disabled={!form.userId?.trim() || !form.balance || !form.reference?.trim() || action.isPending} onPress={() => send('post', '/admin/broker/balances', {
          userId: form.userId?.trim(), broker: form.broker ?? 'DERIV', balance: Number(form.balance), source: 'MANUAL_VERIFICATION', reference: form.reference?.trim(),
        })} />
      </Card>;
    }
    if (tab === 'Broker Funds' && queue === 'Limits') {
      return <Card>
        <Text style={styles.cardTitle}>Broker funding limits</Text>
        {['depositMin', 'depositMax', 'withdrawalMin', 'withdrawalMax', 'dailyMax', 'pendingLimit', 'feePct'].map((key) => (
          <AdminField key={key} label={key.replace(/([A-Z])/g, ' $1')} value={form[key] ?? ''} onChangeText={(value) => set(key, value)} keyboardType="decimal-pad" />
        ))}
        <Button title="Save limits" disabled={['depositMin', 'depositMax', 'withdrawalMin', 'withdrawalMax', 'dailyMax', 'pendingLimit', 'feePct'].some((key) => !form[key]) || action.isPending} onPress={() => send('put', '/admin/broker/settings', {
          deposit: { min: Number(form.depositMin), max: Number(form.depositMax) },
          withdrawal: { min: Number(form.withdrawalMin), max: Number(form.withdrawalMax), dailyMax: Number(form.dailyMax) },
          pendingLimit: Number(form.pendingLimit), feePct: Number(form.feePct),
        })} />
      </Card>;
    }
    if (tab === 'Weltrade Accounts') {
      return <Card>
        <Text style={styles.cardTitle}>Weltrade registration link</Text>
        <AdminField label="Official registration URL" value={form.registerUrl ?? ''} onChangeText={(value) => set('registerUrl', value)} />
        <Button title="Save registration link" disabled={!form.registerUrl?.trim() || action.isPending} onPress={() => send('put', '/admin/weltrade-accounts/config', { registerUrl: form.registerUrl?.trim() })} />
        <Button title="Clear registration link" variant="outline" disabled={action.isPending} onPress={() => send('put', '/admin/weltrade-accounts/config', { registerUrl: '' })} />
      </Card>;
    }
    if (tab === 'Broadcast') {
      return <Card>
        <Text style={styles.cardTitle}>Broadcast notification</Text>
        {titleField}
        <AdminField label="Message" value={form.body ?? ''} onChangeText={(value) => set('body', value)} />
        <AdminChoices label="Audience" options={['Everyone', 'FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE']} value={form.audience ?? 'Everyone'} onChange={(value) => set('audience', value)} />
        <Button title="Send broadcast" disabled={!form.title?.trim() || !form.body?.trim() || action.isPending} onPress={() => send('post', '/admin/broadcast', {
          title: form.title?.trim(), body: form.body?.trim(), type: 'SYSTEM', ...(form.audience && form.audience !== 'Everyone' ? { audience: form.audience } : {}),
        })} />
      </Card>;
    }
    return null;
  }

  function renderAdminItem(item: AdminRecord) {
    const id = String(item.id ?? item.slug ?? item.reference ?? '');
    const name = String(item.name ?? item.title ?? item.itemTitle ?? item.pair ?? item.reference ?? item.clientId ?? item.id ?? 'Record');
    const meta = Object.entries(item)
      .filter(([key, value]) => !['id', 'name', 'title', 'itemTitle', 'pair', 'body', 'description'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 5)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ');
    const pathId = encodeURIComponent(id);
    return <Card key={id || name}>
      <Text style={styles.cardTitle}>{name}</Text>
      {typeof item.body === 'string' ? <Body>{item.body}</Body> : null}
      {typeof item.description === 'string' ? <Body>{item.description}</Body> : null}
      {isRecord(item.user) ? <Body>{String(item.user.name ?? '')}{item.user.email ? ` · ${String(item.user.email)}` : ''}</Body> : null}
      {meta ? <Body>{meta}</Body> : null}
      <View style={styles.row}>
        {tab === 'Signals' && item.status === 'OPEN' ? <>
          <Button title="Hit TP" variant="outline" onPress={() => send('patch', `/signals/${pathId}`, { status: 'HIT_TP' })} />
          <Button title="Hit SL" variant="outline" onPress={() => send('patch', `/signals/${pathId}`, { status: 'HIT_SL' })} />
          <Button title="Cancel" variant="outline" onPress={() => send('patch', `/signals/${pathId}`, { status: 'CANCELLED' })} />
        </> : null}
        {tab === 'Signals' ? <Button title="Delete" variant="danger" onPress={() => Alert.alert('Delete signal?', name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => send('delete', `/signals/${pathId}`) }])} /> : null}
        {tab === 'Rooms' ? <>
          <Button title={item.isChatOpen ? 'Close chat' : 'Open chat'} variant="outline" onPress={() => send('patch', `/admin/groups/${pathId}`, { isChatOpen: !item.isChatOpen })} />
          <Button title="Delete" variant="danger" onPress={() => Alert.alert('Delete room?', name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => send('delete', `/admin/groups/${pathId}`) }])} />
        </> : null}
        {tab === 'Courses' ? <>
          <Button title="Edit course" variant="outline" onPress={() => setForm({
            editCourseSlug: String(item.slug), title: String(item.title ?? ''), description: String(item.description ?? ''),
            price: String(item.price ?? 0), level: String(item.level ?? 'Beginner'),
          })} />
          <Button title={item.published ? 'Unpublish' : 'Publish'} variant="outline" onPress={() => send('patch', `/courses/${encodeURIComponent(String(item.slug))}`, { published: !item.published })} />
          <Button title="Delete" variant="danger" onPress={() => Alert.alert('Delete course?', name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => send('delete', `/courses/${encodeURIComponent(String(item.slug))}`) }])} />
          <Button title={courseToolsSlug === String(item.slug) ? 'Hide lessons & resources' : 'Manage lessons & resources'} variant="outline" onPress={() => setCourseToolsSlug((current) => current === String(item.slug) ? null : String(item.slug))} />
          {courseToolsSlug === String(item.slug) ? <AdminCourseTools slug={String(item.slug)} send={send} /> : null}
        </> : null}
        {tab === 'Users' ? <>
          {['FREE', 'PAID', 'VIP_DERIV', 'VIP_WELTRADE'].map((membership) => <Button key={membership} title={`Set ${membership}`} variant="outline" onPress={() => send('patch', `/admin/users/${pathId}`, { membership, vipDays: 30 })} />)}
          <Button title={item.role === 'ADMIN' ? 'Revoke admin' : 'Make admin'} variant="outline" onPress={() => Alert.alert('Change administrator role?', String(item.email ?? name), [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => send('patch', `/admin/users/${pathId}`, { role: item.role === 'ADMIN' ? 'USER' : 'ADMIN' }) }])} />
        </> : null}
        {['Purchase Requests', 'Payments'].includes(tab) && ['PENDING', 'PROCESSING', 'PAYMENT_PENDING'].includes(String(item.status)) ? <>
          <Button title="Verify payment" onPress={() => send('patch', `/admin/purchases/${pathId}`, { action: 'verify' })} />
          <Button title="Reject" variant="danger" onPress={() => send('patch', `/admin/purchases/${pathId}`, { action: 'reject', adminNote: 'Rejected from the mobile admin app' })} />
        </> : null}
        {tab === 'Payments' && typeof item.id === 'string' ? <Button title="View payment audit" variant="outline" onPress={() => setPaymentAuditFor(String(item.id))} /> : null}
        {tab === 'Transactions' && item.status !== 'COMPLETED' && item.status !== 'FAILED' ? <>
          {item.type === 'WITHDRAWAL' ? (
            item.status === 'PROCESSING'
              ? <View style={{ flex: 1 }}>
                <AdminField label={item.method === 'USDT_TRC20' ? 'Verified TRC20 transaction hash' : 'Verified payout reference'} value={form.providerRef ?? ''} onChangeText={(value) => set('providerRef', value)} />
                {item.method === 'USDT_TRC20' ? <Body>Verify the 64-character transaction hash on a TRON explorer. A screenshot is not sufficient proof of payment.</Body> : null}
                <Button title="Mark paid" disabled={action.isPending || (item.method === 'USDT_TRC20' ? !/^[a-fA-F0-9]{64}$/.test(form.providerRef?.trim() ?? '') : (form.providerRef?.trim().length ?? 0) < 3)} onPress={() => send('patch', `/admin/transactions/${pathId}`, { action: 'paid', providerRef: form.providerRef?.trim() })} />
              </View>
              : <Button title="Start payout" onPress={() => send('patch', `/admin/transactions/${pathId}`, { action: 'processing' })} />
          ) : <Button title="Approve deposit" onPress={() => send('patch', `/admin/transactions/${pathId}`, { action: 'approve' })} />}
          <Button title="Reject" variant="danger" onPress={() => send('patch', `/admin/transactions/${pathId}`, { action: 'reject', adminNote: 'Rejected from the mobile admin app' })} />
        </> : null}
        {tab === 'Broker Funds' && item.status ? <>
          {['PENDING', 'UNDER_REVIEW'].includes(String(item.status)) ? <Button title="Approve" onPress={() => send('patch', `/admin/broker/transactions/${pathId}`, { action: 'approve' })} /> : null}
          {item.status === 'PENDING' ? <Button title="Review" variant="outline" onPress={() => send('patch', `/admin/broker/transactions/${pathId}`, { action: 'review' })} /> : null}
          {item.status === 'APPROVED' ? <Button title="Start processing" variant="outline" onPress={() => send('patch', `/admin/broker/transactions/${pathId}`, { action: 'start_processing' })} /> : null}
          {item.status === 'PROCESSING' ? <View style={{ flex: 1 }}>
            <AdminField label={item.method === 'USDT_TRC20' ? 'Verified TRC20 transaction hash' : 'Provider reference'} value={form.providerRef ?? ''} onChangeText={(value) => set('providerRef', value)} />
            <AdminField label="Evidence URL (optional)" value={form.evidence ?? ''} onChangeText={(value) => set('evidence', value)} />
            {item.method === 'USDT_TRC20' ? <Body>Verify the 64-character hash on a TRON explorer before completion.</Body> : null}
            <Button title="Complete transaction" disabled={action.isPending || (item.method === 'USDT_TRC20' ? !/^[a-fA-F0-9]{64}$/.test(form.providerRef?.trim() ?? '') : (form.providerRef?.trim().length ?? 0) < 1)} onPress={() => send('patch', `/admin/broker/transactions/${pathId}`, { action: 'complete', providerRef: form.providerRef?.trim(), evidence: form.evidence?.trim() })} />
          </View> : null}
          <Button title="Reject" variant="danger" onPress={() => send('patch', `/admin/broker/transactions/${pathId}`, { action: 'reject', failureReason: 'Rejected by administrator' })} />
        </> : null}
        {tab === 'Weltrade Accounts' && item.status === 'PENDING' ? <>
          <Button title="Verify" onPress={() => send('patch', `/admin/weltrade-accounts/${pathId}`, { action: 'verify' })} />
          <Button title="Reject" variant="danger" onPress={() => send('patch', `/admin/weltrade-accounts/${pathId}`, { action: 'reject', reason: 'Rejected by administrator' })} />
        </> : null}
      </View>
    </Card>;
  }

  return (
    <Page refresh={refresh} refreshing={query.isRefetching}>
      <Heading>Admin dashboard</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
        {tabs.map((item) => <Pressable key={item} onPress={() => { setTab(item); setForm({}); }} style={[styles.choice, tab === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}
      </ScrollView>
      {tab === 'Broker Funds' ? <View style={styles.choices}>{['Deposits', 'Withdrawals', 'Audit', 'Balances', 'Limits'].map((item) => <Pressable key={item} onPress={() => { setQueue(item); setForm({}); }} style={[styles.choice, queue === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View> : null}
      {tab === 'Payments' ? <Card>
        <AdminField label="Search name, email or reference" value={form.search ?? ''} onChangeText={(value) => set('search', value)} />
        <AdminChoices label="Payment status" options={['', 'PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'DISPUTED']} value={form.paymentStatus ?? ''} onChange={(value) => set('paymentStatus', value)} />
        <AdminChoices label="Provider" options={['', 'manual', 'stripe', 'free']} value={form.provider ?? ''} onChange={(value) => set('provider', value)} />
      </Card> : null}
      {tab !== 'Broadcast' ? <QueryMessage loading={query.isLoading} error={query.error} retry={refresh} /> : null}
      {tab === 'Overview' && isRecord(query.data) ? <Card>{Object.entries(query.data).map(([key, value]) => <Body key={key}>{key.replace(/([A-Z])/g, ' $1')}: {formatAdminValue(value)}</Body>)}</Card> : null}
      {tab === 'Broker Funds' && queue === 'Limits' && query.data ? <Card><Text style={styles.cardTitle}>Current settings</Text><Body>{formatAdminValue(query.data)}</Body></Card> : null}
      {tab === 'Weltrade Accounts' && isRecord(query.data) && typeof query.data.registerUrl === 'string' ? <Card><Body>Current registration link: {query.data.registerUrl || 'Not configured'}</Body></Card> : null}
      {tab === 'Payments' ? <>
        <Heading>Refund requests</Heading>
        <QueryMessage loading={refunds.isLoading} error={refunds.error} retry={() => void refunds.refetch()} />
        {refunds.data?.map((refund) => {
          const purchase = isRecord(refund.purchase) ? refund.purchase : {};
          const user = isRecord(refund.user) ? refund.user : {};
          const refundId = String(refund.id ?? '');
          return <Card key={refundId}>
          <Text style={styles.cardTitle}>{String(purchase.itemTitle ?? refundId)} · {String(refund.status)}</Text>
          <Body>{String(user.name ?? '')} · {String(user.email ?? '')} · {String(refund.reason ?? '')}</Body>
          {refund.status === 'REQUESTED' ? <View style={styles.row}>
            <Button title="Approve refund" onPress={() => send('post', `/admin/refunds/${encodeURIComponent(refundId)}`, { action: 'APPROVE' })} />
            <Button title="Reject" variant="danger" onPress={() => send('post', `/admin/refunds/${encodeURIComponent(refundId)}`, { action: 'REJECT', reason: 'Rejected by administrator' })} />
          </View> : null}
          {refund.status === 'APPROVED' ? <>
            <AdminField label="Provider refund reference" value={form.refundRef ?? ''} onChangeText={(value) => set('refundRef', value)} />
            <Button title="Record completed refund" disabled={!form.refundRef?.trim()} onPress={() => send('post', `/admin/refunds/${encodeURIComponent(refundId)}`, { action: 'COMPLETE', providerRef: form.refundRef?.trim() })} />
            <Button title="Mark refund failed" variant="danger" onPress={() => send('post', `/admin/refunds/${encodeURIComponent(refundId)}`, { action: 'FAIL', reason: 'Refund failed at provider' })} />
          </> : null}
        </Card>;
        })}
        {paymentAuditFor ? <Card>
          <Text style={styles.cardTitle}>Payment audit trail · {paymentAuditFor}</Text>
          <QueryMessage loading={paymentAudit.isLoading} error={paymentAudit.error} retry={() => void paymentAudit.refetch()} />
          {paymentAudit.data?.map((event) => <Body key={String(event.id)}>{String(event.action)} · {String(event.source)} · {String(event.note ?? '')} · {String(event.createdAt)}</Body>)}
          <Button title="Close audit trail" variant="outline" onPress={() => setPaymentAuditFor(null)} />
        </Card> : null}
      </> : null}
      {tab !== 'Overview' && tab !== 'Broadcast' && !(tab === 'Broker Funds' && queue === 'Limits') ? items.map(renderAdminItem) : null}
      {['Signals', 'Rooms', 'Courses', 'Broadcast', 'Broker Funds', 'Weltrade Accounts'].includes(tab) ? renderCreateForm() : null}
    </Page>
  );
}

type AdminRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AdminRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsFrom(value: unknown): AdminRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    const list = Object.values(value).find(Array.isArray);
    return Array.isArray(list) ? list.filter(isRecord) : [];
  }
  return [];
}

function AdminField({ label, value, onChangeText, keyboardType = 'default' }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'decimal-pad' }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} keyboardType={keyboardType} onChangeText={onChangeText} placeholder={label} placeholderTextColor="#9AA0AA" style={styles.input} value={value} />
  </View>;
}

function AdminChoices({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
      {options.map((item) => <Pressable key={item} onPress={() => onChange(item)} style={[styles.choice, value === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}
    </ScrollView>
  </View>;
}

function AdminCourseTools({
  slug,
  send,
}: {
  slug: string;
  send: (method: 'post' | 'patch' | 'delete' | 'put', path: string, data?: Record<string, unknown>) => void;
}) {
  const query = useQuery({
    queryKey: ['mobile', 'admin-course-detail', slug],
    queryFn: async () => (await api.get<AdminRecord>(`/courses/${encodeURIComponent(slug)}`)).data,
  });
  const [lesson, setLesson] = useState<Record<string, string>>({});
  const [resource, setResource] = useState<Record<string, string>>({});
  const course = query.data;
  const saveLesson = useMutation({
    mutationFn: async (data: Record<string, unknown>) => lesson.id
      ? api.patch(`/courses/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lesson.id)}`, data)
      : api.post(`/courses/${encodeURIComponent(slug)}/lessons`, data),
    onSuccess: () => {
      setLesson({});
      void query.refetch();
      Alert.alert('Lesson saved', 'Course lesson changes were saved.');
    },
    onError: (error) => Alert.alert('Could not save lesson', apiError(error)),
  });
  const addResource = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post('/admin/resources', data),
    onSuccess: () => {
      setResource({});
      void query.refetch();
      Alert.alert('Resource added', 'Course resource was saved.');
    },
    onError: (error) => Alert.alert('Could not add resource', apiError(error)),
  });

  return <View style={styles.commentList}>
    <Text style={styles.cardTitle}>Lessons & resources</Text>
    <QueryMessage loading={query.isLoading} error={query.error} retry={() => void query.refetch()} />
    {recordsFrom(course?.lessons).map((item) => {
      const lessonId = String(item.id ?? '');
      return <Card key={lessonId}>
        <Text style={styles.cardTitle}>{String(item.order ?? '')}. {String(item.title ?? 'Lesson')}</Text>
        <Body>{String(item.durationMin ?? 0)} min · {item.isFree ? 'free preview' : 'paid'}{item.videoUrl ? ' · video attached' : ' · no video'}</Body>
        <Button title="Edit lesson" variant="outline" onPress={() => setLesson({
          id: lessonId, title: String(item.title ?? ''), description: String(item.description ?? ''),
          videoUrl: String(item.videoUrl ?? ''), durationMin: String(item.durationMin ?? 0),
          order: String(item.order ?? 0), isFree: String(Boolean(item.isFree)),
        })} />
        <Button title="Remove lesson" variant="danger" onPress={() => Alert.alert('Remove lesson?', String(item.title ?? ''), [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => send('delete', `/courses/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonId)}`) },
        ])} />
      </Card>;
    })}
    <AdminField label={lesson.id ? 'Edit lesson title' : 'New lesson title'} value={lesson.title ?? ''} onChangeText={(value) => setLesson((current) => ({ ...current, title: value }))} />
    <AdminField label="Lesson description" value={lesson.description ?? ''} onChangeText={(value) => setLesson((current) => ({ ...current, description: value }))} />
    <AdminField label="Video URL" value={lesson.videoUrl ?? ''} onChangeText={(value) => setLesson((current) => ({ ...current, videoUrl: value }))} />
    <AdminField label="Duration (minutes)" value={lesson.durationMin ?? '0'} onChangeText={(value) => setLesson((current) => ({ ...current, durationMin: value }))} keyboardType="decimal-pad" />
    <AdminField label="Lesson order" value={lesson.order ?? String(recordsFrom(course?.lessons).length)} onChangeText={(value) => setLesson((current) => ({ ...current, order: value }))} keyboardType="decimal-pad" />
    <AdminChoices label="Free preview" options={['No', 'Yes']} value={lesson.isFree === 'true' ? 'Yes' : 'No'} onChange={(value) => setLesson((current) => ({ ...current, isFree: String(value === 'Yes') }))} />
    <Button title={saveLesson.isPending ? 'Saving…' : lesson.id ? 'Save lesson' : 'Add lesson'} disabled={!course || !lesson.title?.trim() || saveLesson.isPending} onPress={() => {
      const data = {
        title: lesson.title?.trim(), description: lesson.description?.trim() || null,
        videoUrl: lesson.videoUrl?.trim() || null, durationMin: Number(lesson.durationMin ?? 0),
        order: Number(lesson.order ?? recordsFrom(course?.lessons).length), isFree: lesson.isFree === 'true',
      };
      saveLesson.mutate(data);
    }} />

    <Text style={styles.cardTitle}>Course resources</Text>
    {recordsFrom(course?.resources).map((item) => <Card key={String(item.id)}>
      <Text style={styles.cardTitle}>{String(item.title ?? 'Resource')} · {String(item.type ?? '')}</Text>
      <Body>{String(item.url ?? '')}</Body>
      <Button title="Remove resource" variant="danger" onPress={() => Alert.alert('Remove resource?', String(item.title ?? ''), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => send('delete', `/admin/resources/${encodeURIComponent(String(item.id))}`) },
      ])} />
    </Card>)}
    <AdminField label="Resource title" value={resource.title ?? ''} onChangeText={(value) => setResource((current) => ({ ...current, title: value }))} />
    <AdminField label="Resource URL (HTTPS)" value={resource.url ?? ''} onChangeText={(value) => setResource((current) => ({ ...current, url: value }))} />
    <AdminField label="Resource size (KB)" value={resource.sizeKb ?? '0'} onChangeText={(value) => setResource((current) => ({ ...current, sizeKb: value }))} keyboardType="decimal-pad" />
    <AdminChoices label="Resource type" options={['PDF', 'EBOOK', 'SHEET']} value={resource.type ?? 'PDF'} onChange={(value) => setResource((current) => ({ ...current, type: value }))} />
    <AdminChoices label="VIP resource" options={['No', 'Yes']} value={resource.isVip === 'true' ? 'Yes' : 'No'} onChange={(value) => setResource((current) => ({ ...current, isVip: String(value === 'Yes') }))} />
    <Button title={addResource.isPending ? 'Adding…' : 'Add course resource'} disabled={!course?.id || !resource.title?.trim() || !/^https:\/\//i.test(resource.url ?? '') || addResource.isPending} onPress={() => {
      addResource.mutate({
        courseId: course?.id, title: resource.title?.trim(), url: resource.url?.trim(),
        type: resource.type ?? 'PDF', sizeKb: Number(resource.sizeKb ?? 0), isVip: resource.isVip === 'true',
      });
    }} />
  </View>;
}

function formatAdminValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, gap: 9, padding: 15 },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  field: { gap: 6 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 10, borderWidth: 1, color: colors.ink, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  multiline: { minHeight: 84, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  grow: { flex: 1 },
  button: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 42, paddingHorizontal: 12, paddingVertical: 10 },
  goldButton: { backgroundColor: colors.gold },
  outlineButton: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  dangerButton: { backgroundColor: '#FEE4E2' },
  goldText: { color: colors.surface, fontSize: 12, fontWeight: '800' },
  outlineText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  dangerText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  linkRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', minHeight: 54, paddingHorizontal: 14, paddingVertical: 10 },
  accessCourses: { borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 10 },
  avatarPickerRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  avatarActions: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatarImage: { height: '100%', width: '100%' },
  linkRowTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  chevron: { color: colors.gold, fontSize: 24, paddingHorizontal: 5 },
  avatar: { alignItems: 'center', alignSelf: 'center', backgroundColor: colors.ink, borderColor: colors.gold, borderRadius: 50, borderWidth: 2, height: 82, justifyContent: 'center', width: 82 },
  avatarText: { color: colors.goldSoft, fontSize: 23, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: 99, color: colors.gold, fontSize: 11, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 6 },
  unread: { color: colors.gold, fontSize: 10, fontWeight: '900' },
  balance: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { borderColor: colors.border, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  choiceActive: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  choiceText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  success: { color: colors.success, fontSize: 12, lineHeight: 18 },
  postBody: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  postAuthorRow: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  postAuthorAvatar: { borderRadius: 16, height: 32, width: 32 },
  postAuthorAvatarFallback: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  postAuthorInitials: { color: colors.goldSoft, fontSize: 10, fontWeight: '800' },
  commentList: { borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 10 },
});
