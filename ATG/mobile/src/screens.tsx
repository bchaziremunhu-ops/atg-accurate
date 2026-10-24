import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  ActivityIndicator,
  Linking,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, apiConfigurationError, apiError } from './api';
import { useAuth } from './auth';
import type { Course, Signal, SiteSettings } from './types';
import { colors } from './theme';

type RoomAccess = { FREE: boolean; PAID: boolean; VIP_DERIV: boolean; VIP_WELTRADE: boolean; membership: string };

function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function QueryStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <Card>
        <ActivityIndicator color={colors.gold} />
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <Text style={styles.muted}>{apiError(error)}</Text>
        <ActionButton title="Try again" variant="outline" onPress={onRetry} />
      </Card>
    );
  }
  return null;
}

function ActionButton({
  title,
  onPress,
  variant = 'gold',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'gold' | 'outline';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'gold' ? styles.goldButton : styles.outlineButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={variant === 'gold' ? styles.goldButtonText : styles.outlineButtonText}>{title}</Text>
    </Pressable>
  );
}

export function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!identifier.trim() || !password) {
      setError('Enter your phone number or email and password.');
      return;
    }
    if (apiConfigurationError) {
      setError(apiConfigurationError);
      return;
    }
    setLoading(true);
    try {
      await login(identifier.trim(), password);
    } catch (loginError) {
      setError(apiError(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, styles.loginContent]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.brandMark}>
        <Text style={styles.brandMarkText}>ATG</Text>
      </View>
      <Text style={styles.brandTitle}>Accurate Trading Group</Text>
      <Text style={styles.brandSubtitle}>BEST TRADING EXPERIENCE</Text>

      <Card style={styles.loginCard}>
        <Text style={styles.loginTitle}>Welcome back</Text>
        <Text style={styles.muted}>Sign in with your phone number or email</Text>

        <Text style={styles.label}>Phone number or email</Text>
        <TextInput
          accessibilityLabel="Phone number or email"
          autoCapitalize="none"
          autoComplete="username"
          keyboardType="email-address"
          onChangeText={setIdentifier}
          placeholder="0771234567 or you@example.com"
          placeholderTextColor="#9AA0AA"
          returnKeyType="next"
          style={styles.input}
          value={identifier}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          placeholder="Password"
          placeholderTextColor="#9AA0AA"
          returnKeyType="done"
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? (
          <ActivityIndicator color={colors.gold} style={styles.loginLoading} />
        ) : (
          <ActionButton title="Sign In" onPress={() => void submit()} />
        )}
        <Pressable accessibilityRole="button" onPress={() => router.push('/register')} style={{ alignItems: 'center', marginTop: 16 }}>
          <Text style={styles.link}>Create an account</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/forgot-password')} style={{ alignItems: 'center', marginTop: 12 }}>
          <Text style={styles.link}>Forgot your password?</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const signals = useQuery({
    queryKey: ['mobile', 'signals'],
    queryFn: async () => (await api.get<Signal[]>('/signals')).data,
    refetchOnMount: 'always',
  });
  const roomAccess = useQuery({
    queryKey: ['mobile', 'rooms-access'],
    queryFn: async () => (await api.get<RoomAccess>('/signals/rooms/access')).data,
    refetchOnMount: 'always',
  });
  const courses = useQuery({
    queryKey: ['mobile', 'courses'],
    queryFn: async () => (await api.get<Course[]>('/courses')).data,
    refetchOnMount: 'always',
  });
  const siteSettings = useQuery({
    queryKey: ['mobile', 'site-settings'],
    queryFn: async () => (await api.get<SiteSettings>('/site-settings')).data,
  });
  const dashboardPosts = siteSettings.data?.dashboardPosts.filter((post) => post.enabled) ?? [];

  return (
    <Page>
      <View style={styles.welcomeRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>ATG TRADERS</Text>
          <Text style={styles.welcome}>Hello, {user?.name.split(' ')[0] ?? 'Trader'}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={styles.signOut}>
          <Text style={styles.signOutText}>Profile</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/notifications')} style={{ alignSelf: 'flex-end' }}>
        <Text style={styles.link}>Notifications</Text>
      </Pressable>

      <Card style={styles.hero}>
        <Text style={styles.heroEyebrow}>YOUR TRADING JOURNEY</Text>
        <Text style={styles.heroTitle}>Learn with clarity.{'\n'}Trade with confidence.</Text>
        <Text style={styles.heroBody}>Explore market education and signals shared by ATG Traders.</Text>
      </Card>

      {siteSettings.isError ? (
        <QueryStatus loading={false} error={siteSettings.error} onRetry={() => void siteSettings.refetch()} />
      ) : dashboardPosts.length > 0 ? (
        dashboardPosts.map((post) => (
          <Card key={post.id}>
            <Text style={styles.noticeEyebrow}>ATG UPDATE</Text>
            <Text style={styles.cardTitle}>{post.title}</Text>
            <Text style={styles.muted}>{post.body}</Text>
            {post.linkUrl ? (
              <ActionButton
                title={post.linkLabel}
                variant="outline"
                onPress={() => void openDashboardLink(post.linkUrl)}
              />
            ) : null}
          </Card>
        ))
      ) : null}

      <View style={styles.actionRow}>
        <ActionButton title="View signals" onPress={() => router.push('/signals')} />
        <ActionButton title="Browse courses" onPress={() => router.push('/education')} variant="outline" />
        <ActionButton title="Open wallet" onPress={() => router.push('/wallet')} variant="outline" />
        <ActionButton title="Broker funds" onPress={() => router.push('/broker-funds')} variant="outline" />
      </View>

      <View style={styles.sectionHeader}>
        <SectionTitle>Latest signals</SectionTitle>
        <Pressable onPress={() => router.push('/signals')}>
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <QueryStatus loading={signals.isLoading} error={signals.error} onRetry={() => void signals.refetch()} />
      {signals.data?.length ? (
        signals.data.slice(0, 2).map((signal) => <SignalCard key={signal.id} signal={signal} />)
      ) : signals.isSuccess ? (
        <Card><Text style={styles.muted}>No signals are available for your account right now.</Text></Card>
      ) : null}

      <View style={styles.sectionHeader}>
        <SectionTitle>Education</SectionTitle>
        <Pressable onPress={() => router.push('/education')}>
          <Text style={styles.link}>Browse courses</Text>
        </Pressable>
      </View>
      <QueryStatus loading={courses.isLoading} error={courses.error} onRetry={() => void courses.refetch()} />
      {courses.data?.[0] ? (
        <CourseCard
          course={courses.data.find((course) => course.isFree || !course.entitled) ?? courses.data[0]}
          owned={!courses.data.some((course) => course.isFree || !course.entitled)}
        />
      ) : courses.isSuccess ? (
        <Card><Text style={styles.muted}>No courses are available right now.</Text></Card>
      ) : null}
      <Card>
        <Text style={styles.cardTitle}>VIP signal access</Text>
        <Text style={styles.muted}>
          {roomAccess.data?.VIP_DERIV && roomAccess.data.VIP_WELTRADE
            ? 'Both VIP rooms are available to your account.'
            : 'See plans for VIP rooms you do not currently access.'}
        </Text>
        <ActionButton title="View membership status" variant="outline" onPress={() => router.push('/subscription')} />
      </Card>
      <ActionButton title="Community" onPress={() => router.push('/community')} variant="outline" />
      {user?.role === 'ADMIN' ? <ActionButton title="Admin dashboard" onPress={() => router.push('/admin')} variant="outline" /> : null}
      <Text style={styles.disclaimer}>
        Educational content only. ATG Traders does not place or execute trades.
      </Text>
    </Page>
  );
}

async function openDashboardLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch (error) {
    Alert.alert('Could not open link', apiError(error));
  }
}

export function SignalsScreen() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['mobile', 'signals'],
    queryFn: async () => (await api.get<Signal[]>('/signals')).data,
    refetchOnMount: 'always',
  });
  const access = useQuery({
    queryKey: ['mobile', 'rooms-access'],
    queryFn: async () => (await api.get<RoomAccess>('/signals/rooms/access')).data,
    refetchOnMount: 'always',
  });

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.gold} />
      }
    >
      <Text style={styles.pageTitle}>Signals</Text>
      <Text style={styles.muted}>Updates shared for your membership.</Text>
      {access.data ? (
        <Card>
          <Text style={styles.cardTitle}>Current signal access</Text>
          <Text style={styles.muted}>Paid: {access.data.PAID ? 'Available' : 'Not included'}</Text>
          <Text style={styles.muted}>Deriv VIP: {access.data.VIP_DERIV ? 'Active' : 'Not active'}</Text>
          <Text style={styles.muted}>Weltrade VIP: {access.data.VIP_WELTRADE ? 'Active' : 'Not active'}</Text>
          {!access.data.VIP_DERIV || !access.data.VIP_WELTRADE ? (
            <ActionButton title="View available VIP plans" variant="outline" onPress={() => router.push('/subscription')} />
          ) : null}
        </Card>
      ) : null}
      <QueryStatus loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      {query.data?.length ? (
        query.data.map((signal) => <SignalCard key={signal.id} signal={signal} />)
      ) : query.isSuccess ? (
        <Card><Text style={styles.muted}>No signals are available for your account right now.</Text></Card>
      ) : null}
    </ScrollView>
  );
}

export function EducationScreen() {
  const query = useQuery({
    queryKey: ['mobile', 'courses'],
    queryFn: async () => (await api.get<Course[]>('/courses')).data,
    refetchOnMount: 'always',
  });
  const ownedCourses = (query.data ?? []).filter((course) => !course.isFree && course.entitled);
  const catalogCourses = (query.data ?? []).filter((course) => course.isFree || !course.entitled);

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.gold} />
      }
    >
      <Text style={styles.pageTitle}>Education</Text>
      <Text style={styles.muted}>Build your knowledge with ATG courses.</Text>
      <QueryStatus loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} />
      <SectionTitle>Your courses</SectionTitle>
      {ownedCourses.length ? (
        ownedCourses.map((course) => <CourseCard key={course.id} course={course} owned />)
      ) : query.isSuccess ? (
        <Card><Text style={styles.muted}>Purchased courses appear here after payment is approved.</Text></Card>
      ) : null}
      <SectionTitle>Course catalogue</SectionTitle>
      {catalogCourses.length ? (
        catalogCourses.map((course) => <CourseCard key={course.id} course={course} />)
      ) : query.isSuccess ? (
        <Card><Text style={styles.muted}>{ownedCourses.length ? 'You have purchased all available courses. Your access is listed above.' : 'No courses are available right now.'}</Text></Card>
      ) : null}
    </ScrollView>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  const router = useRouter();
  const directionColor = signal.direction === 'BUY' ? colors.success : colors.danger;
  return (
    <Pressable onPress={() => router.push({ pathname: '/signal/[id]', params: { id: signal.id } })}>
    <Card>
      <View style={styles.cardHeading}>
        <View style={styles.grow}>
          <Text style={styles.cardTitle}>{signal.pair}</Text>
          <Text style={styles.muted}>{signal.market} · {signal.timeframe}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: `${directionColor}15` }]}>
          <Text style={[styles.pillText, { color: directionColor }]}>{signal.direction}</Text>
        </View>
      </View>
      <View style={styles.dataRow}>
        <DataPoint label="Entry" value={formatPrice(signal.entry)} />
        <DataPoint label="Take profit" value={formatPrice(signal.takeProfit)} />
        <DataPoint label="Stop loss" value={formatPrice(signal.stopLoss)} />
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.smallMuted}>{signal.status.replace('_', ' ')}</Text>
        {signal.locked ? <Text style={styles.locked}>VIP</Text> : null}
      </View>
      {signal.author ? (
        <View style={styles.signalAuthor}>
          {signal.author.avatarUrl ? (
            <Image source={{ uri: signal.author.avatarUrl }} style={styles.signalAuthorAvatar} />
          ) : (
            <View style={styles.signalAuthorFallback}>
              <Text style={styles.signalAuthorInitials}>{signal.author.name.slice(0, 2).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.smallMuted}>Shared by {signal.author.name}{signal.author.role === 'ADMIN' ? ' · ATG Admin' : ''}</Text>
        </View>
      ) : null}
    </Card>
    </Pressable>
  );
}

function CourseCard({ course, owned = false }: { course: Course; owned?: boolean }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push({ pathname: '/course/[slug]', params: { slug: course.slug } })}>
    <Card>
      <View style={styles.cardHeading}>
        <View style={styles.grow}>
          <Text style={styles.cardTitle}>{course.title}</Text>
          <Text style={styles.muted}>{course.level} · {course.lessonCount} lessons</Text>
        </View>
        <Text style={styles.coursePrice}>
          {course.isFree ? 'FREE' : `${course.currency ?? '$'} ${course.price}`}
        </Text>
      </View>
      {course.description ? <Text style={styles.courseDescription}>{course.description}</Text> : null}
      {owned ? <Text style={styles.purchasedLabel}>Purchased · access confirmed</Text> : null}
      <Text style={styles.smallMuted}>{course.durationMin} min</Text>
    </Card>
    </Pressable>
  );
}

function DataPoint({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataPoint}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : String(value);
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 32, gap: 14 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, gap: 0 },
  brandMark: {
    width: 78,
    height: 78,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: colors.gold,
    marginBottom: 18,
  },
  brandMarkText: { color: colors.surface, fontSize: 27, fontWeight: '900', letterSpacing: 1 },
  brandTitle: { color: colors.ink, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  brandSubtitle: { color: colors.gold, fontSize: 9, fontWeight: '700', letterSpacing: 2.2, textAlign: 'center', marginTop: 5 },
  loginCard: { marginTop: 28 },
  loginTitle: { color: colors.ink, fontSize: 23, fontWeight: '800', marginBottom: 4 },
  label: { color: colors.ink, fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 7 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
  loginLoading: { marginTop: 20, paddingVertical: 12 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  button: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  goldButton: { backgroundColor: colors.gold },
  outlineButton: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  goldButtonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  outlineButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  welcomeRow: { alignItems: 'center', flexDirection: 'row', marginBottom: 2 },
  grow: { flex: 1 },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.7 },
  noticeEyebrow: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 5 },
  welcome: { color: colors.ink, fontSize: 23, fontWeight: '800', marginTop: 3 },
  signOut: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  signOutText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  hero: { backgroundColor: '#2A2B2E', borderColor: '#2A2B2E', padding: 20 },
  heroEyebrow: { color: '#EAD895', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  heroTitle: { color: colors.surface, fontSize: 23, fontWeight: '800', lineHeight: 30, marginTop: 10 },
  heroBody: { color: '#E0E0E0', fontSize: 13, lineHeight: 20, marginTop: 8 },
  actionRow: { gap: 10 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  link: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  pageTitle: { color: colors.ink, fontSize: 25, fontWeight: '800' },
  cardHeading: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  pill: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { fontSize: 11, fontWeight: '800' },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  dataPoint: { gap: 4 },
  dataLabel: { color: colors.muted, fontSize: 10 },
  dataValue: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  cardFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  signalAuthor: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingTop: 8 },
  signalAuthorAvatar: { borderRadius: 14, height: 28, width: 28 },
  signalAuthorFallback: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  signalAuthorInitials: { color: colors.goldSoft, fontSize: 9, fontWeight: '800' },
  smallMuted: { color: colors.muted, fontSize: 11 },
  locked: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  coursePrice: { color: colors.gold, fontSize: 12, fontWeight: '800' },
  courseDescription: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  purchasedLabel: { color: colors.success, fontSize: 11, fontWeight: '700' },
  disclaimer: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 8, textAlign: 'center' },
});
