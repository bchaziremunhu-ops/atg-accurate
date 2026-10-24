import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './api';

const TOKEN_KEY = 'atg.expo-push-token';

export async function enablePushNotifications(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    throw new Error('Push notifications require a physical iOS or Android device.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ATG Traders',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#A67C00',
    });
  }

  const permission = await Notifications.getPermissionsAsync();
  const status = permission.granted
    ? permission.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) {
    throw new Error('Configure the EAS project ID before registering mobile push notifications.');
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.post('/notifications/push/expo-token', { token });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function disablePushNotifications(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  await api.delete('/notifications/push/expo-token', { data: { token } });
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
