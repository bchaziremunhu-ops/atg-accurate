import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiOrigin } from './api';

let socket: Socket | null = null;

export function getRealtimeSocket(): Socket {
  const token = getAccessToken();
  const origin = getApiOrigin();
  if (!token || !origin) {
    throw new Error('Sign in and configure the API before connecting to chat.');
  }
  if (!socket) {
    socket = io(origin, {
      auth: { token },
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  socket.auth = { token };
  if (!socket.connected) socket.connect();
  return socket;
}

export function reconnectSocket(): void {
  if (!socket) return;
  socket.auth = { token: getAccessToken() };
  socket.disconnect().connect();
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
