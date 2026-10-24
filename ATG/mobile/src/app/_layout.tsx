import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { dehydrate, hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../auth';
import { colors } from '../theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});
const CACHE_KEY = 'atg.public-course-cache';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function PersistentCourseCache({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(CACHE_KEY)
      .then((serialized) => {
        if (serialized) hydrate(queryClient, JSON.parse(serialized));
      })
      .catch((error: unknown) => console.error('Offline course cache restoration failed:', error))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const snapshot = dehydrate(queryClient, {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' &&
            query.queryKey[0] === 'mobile' &&
            query.queryKey[1] === 'courses' &&
            query.queryKey.length === 2,
        });
        void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snapshot, (key, value: unknown) => key === 'progress' ? undefined : value))
          .catch((error: unknown) => console.error('Offline course cache save failed:', error));
      }, 250);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ready ? children : (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={{ color: colors.muted, marginTop: 12 }}>Preparing ATG Traders…</Text>
    </View>
  );
}

function useNotificationObserver() {
  const router = useRouter();

  useEffect(() => {
    const redirect = (notification: Notifications.Notification) => {
      const link = notification.request.content.data?.link;
      if (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')) {
        router.push(link as Href);
      } else {
        router.push('/notifications');
      }
    };

    const initial = Notifications.getLastNotificationResponse();
    if (initial?.notification) {
      redirect(initial.notification);
      Notifications.clearLastNotificationResponse();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(({ notification }) => {
      redirect(notification);
      Notifications.clearLastNotificationResponse();
    });
    return () => subscription.remove();
  }, [router]);
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  useNotificationObserver();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/login');
    else if (user && inAuth) router.replace('/');
  }, [loading, router, segments, user]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={{ color: colors.muted, marginTop: 12 }}>Loading ATG Traders…</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTintColor: colors.ink, headerStyle: { backgroundColor: colors.surface } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="wallet" options={{ title: 'Wallet' }} />
        <Stack.Screen name="broker-funds" options={{ title: 'Broker Funds' }} />
        <Stack.Screen name="subscription" options={{ title: 'Membership' }} />
        <Stack.Screen name="purchases" options={{ title: 'Purchase History' }} />
        <Stack.Screen name="settings" options={{ title: 'Account Settings' }} />
        <Stack.Screen name="support" options={{ title: 'Help & Support' }} />
        <Stack.Screen name="legal" options={{ title: 'Terms & Privacy' }} />
        <Stack.Screen name="saved" options={{ title: 'Saved content' }} />
        <Stack.Screen name="certificates" options={{ title: 'Certificates' }} />
        <Stack.Screen name="certificates/[id]" options={{ title: 'Certificate' }} />
        <Stack.Screen name="receipts/[id]" options={{ title: 'Receipt' }} />
        <Stack.Screen name="signal/[id]" options={{ title: 'Signal details' }} />
        <Stack.Screen name="course/[slug]" options={{ title: 'Course details' }} />
        <Stack.Screen name="community/[id]" options={{ title: 'Group chat' }} />
        <Stack.Screen name="admin" options={{ title: 'Admin dashboard' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <PersistentCourseCache>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </PersistentCourseCache>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
