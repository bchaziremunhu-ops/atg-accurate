import { io, type Socket } from 'socket.io-client';
import { API_CONFIGURED, API_ORIGIN, OFFLINE_MODE, tokenStore } from './api';
import { ensureDb, getDb, id, nowIso, saveDb } from './offline/store';

let socket: Socket | null = null;

type Handler = (payload: never) => void;

class LocalSocket {
  auth: Record<string, unknown> = {};
  connected = true;
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: Handler): this {
    if (!fn) this.handlers.delete(event);
    else this.handlers.get(event)?.delete(fn);
    return this;
  }

  once(event: string, fn: Handler): this {
    const wrap: Handler = (payload) => {
      this.off(event, wrap);
      fn(payload);
    };
    return this.on(event, wrap);
  }

  emit(event: string, ...args: unknown[]): this {
    if (event === 'group:message') {
      const acknowledge = typeof args[1] === 'function' ? args[1] as (sent: boolean) => void : undefined;
      void this.sendGroupMessage(args[0] as { groupId?: string; body?: string }).then((sent) => acknowledge?.(sent));
    }
    return this;
  }

  disconnect(): this {
    this.connected = false;
    return this;
  }

  connect(): this {
    this.connected = true;
    return this;
  }

  private fire(event: string, payload: unknown): void {
    for (const fn of [...(this.handlers.get(event) ?? [])]) {
      try {
        (fn as (p: unknown) => void)(payload);
      } catch {
        /* a failing listener must not break chat */
      }
    }
  }

  private async sendGroupMessage(data: { groupId?: string; body?: string }): Promise<boolean> {
    try {
      const body = String(data?.body ?? '').trim();
      const groupId = String(data?.groupId ?? '');
      if (!body || !groupId) return false;
      await ensureDb();
      const db = getDb();
      const user = db.users.find((u) => u.id === currentUserId());
      const group = db.groups.find((g) => g.id === groupId);
      if (!user || !group) return false;
      const row = { id: id('msg'), groupId: group.id, userId: user.id, body, createdAt: nowIso() };
      db.messages.push(row);
      saveDb();
      this.fire('group:message', {
        id: row.id,
        groupId: row.groupId,
        body: row.body,
        createdAt: row.createdAt,
        user: { id: user.id, name: user.name, avatarUrl: user.avatarUrl },
      });
      return true;
    } catch {
      return false;
    }
  }
}

function currentUserId(): string | null {
  const token = tokenStore.access;
  if (!token?.startsWith('atg.local.')) return null;
  try {
    const payload = JSON.parse(atob(token.slice('atg.local.'.length))) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function getSocket(): Socket {
  if (!socket) {
    if (!OFFLINE_MODE && !API_CONFIGURED) {
      throw new Error('This mobile build is missing VITE_API_URL. Rebuild it with the shared API origin configured.');
    }
    socket = OFFLINE_MODE
      ? (new LocalSocket() as unknown as Socket)
      : io(API_ORIGIN, { auth: { token: tokenStore.access }, autoConnect: true, transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function reconnectSocket() {
  if (!socket) return;
  socket.auth = { token: tokenStore.access };
  if (!OFFLINE_MODE) socket.disconnect().connect();
}
