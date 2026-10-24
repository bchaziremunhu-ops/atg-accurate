import { api } from './api';
import type {
  AdminBrokerAccount,
  AdminBrokerAccountList,
  AdminBrokerBalance,
  AdminBrokerFunding,
  AdminBrokerFundingDetail,
  BrokerAccount,
  BrokerAccountConfig,
  BrokerAuditEntry,
  BrokerBalanceView,
  BrokerFunding,
  BrokerFundingConfig,
  BrokerFundingDetail,
  BrokerId,
  BrokerSettingsView,
  Certificate,
  CertificateDetail,
  Course,
  Group,
  Lesson,
  Message,
  MessageHistory,
  Membership,
  Notification,
  Payment,
  Post,
  Purchase,
  Receipt,
  Refund,
  RegisterInput,
  Signal,
  SiteSettings,
  Subscription,
  SubscriptionPlan,
  MembershipPackage,
  PurchaseRequest,
  Transaction,
  User,
  Wallet,
} from './types';

export const authApi = {
  register: (data: RegisterInput) =>
    api.post('/auth/register', data).then((r) => r.data as { user: User; accessToken: string; refreshToken: string }),
  login: (data: { identifier: string; password: string }) =>
    api.post('/auth/login', data).then((r) => r.data as { user: User; accessToken: string; refreshToken: string }),
  logout: () => api.post('/auth/logout').then((r) => r.data as { ok: true }),
  forgotStart: (phone: string) => api.post('/auth/forgot/start', { phone }).then((r) => r.data as { ok: true }),
  forgotVerify: (data: { phone: string; fullName: string; dateOfBirth: string }) =>
    api.post('/auth/forgot/verify', data).then((r) => r.data as { question: { id: string; text: string } }),
  forgotReset: (data: {
    phone: string;
    fullName: string;
    dateOfBirth: string;
    answer: string;
    newPassword: string;
    confirmPassword: string;
  }) => api.post('/auth/forgot/reset', data).then((r) => r.data as { ok: true; message: string }),
  me: () => api.get('/auth/me').then((r) => r.data as User),
};

export const siteSettingsApi = {
  public: () => api.get('/site-settings').then((r) => r.data as SiteSettings),
  admin: () => api.get('/admin/site-settings').then((r) => r.data as SiteSettings),
  save: (settings: SiteSettings) => api.put('/admin/site-settings', settings).then((r) => r.data as SiteSettings),
};

export const userApi = {
  profile: () => api.get('/users/profile').then((r) => r.data as User),
  update: (data: Partial<{ name: string; phone: string; country: string; bio: string; avatarUrl: string | null }>) =>
    api.patch('/users/profile', data).then(
      (r) =>
        r.data as {
          ok: true;
          user: Pick<User, 'id' | 'name' | 'phone' | 'country' | 'bio' | 'avatarUrl'>;
        },
    ),
  uploadAvatar: (file: File) => {
    const data = new FormData();
    data.append('avatar', file);
    return api
      .post('/users/profile/avatar', data)
      .then(
        (r) =>
          r.data as {
            ok: true;
            user: Pick<User, 'id' | 'name' | 'phone' | 'country' | 'avatarUrl' | 'bio'>;
          },
      );
  },
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/users/change-password', data).then((r) => r.data),
  watchlist: () => api.get('/users/watchlist').then((r) => r.data),
  addWatch: (pair: string) => api.post('/users/watchlist', { pair }).then((r) => r.data),
  removeWatch: (pair: string) => api.delete(`/users/watchlist/${encodeURIComponent(pair)}`).then((r) => r.data),
  certificates: () => api.get('/users/certificates').then((r) => r.data as Certificate[]),
  certificate: (id: string) => api.get(`/users/certificates/${id}`).then((r) => r.data as CertificateDetail),
};

export interface RoomsAccess {
  FREE: boolean;
  PAID: boolean;
  VIP_DERIV: boolean;
  VIP_WELTRADE: boolean;
  membership: Membership;
  isAdmin: boolean;
}

export interface SignalChart {
  configured: boolean;
  provider: string;
  stale?: boolean;
  pair: string;
  timeframe: string;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  candles: { time: number; open: number; high: number; low: number; close: number }[];
}

export const signalApi = {
  list: (params?: { audience?: string; status?: string; pair?: string; q?: string }) =>
    api.get('/signals', { params }).then((r) => r.data as Signal[]),
  get: (id: string) => api.get(`/signals/${id}`).then((r) => r.data as Signal),
  roomsAccess: () => api.get('/signals/rooms/access').then((r) => r.data as RoomsAccess),
  chart: (id: string, timeframe?: string) =>
    api.get(`/signals/${id}/chart`, { params: { timeframe } }).then((r) => r.data as SignalChart),
  results: () => api.get('/signals/results').then((r) => r.data as { total: number; wins: number; losses: number; open: number; winRate: number }),
  create: (data: Partial<Signal>) => api.post('/signals', data).then((r) => r.data as Signal),
  update: (id: string, data: Partial<Signal>) => api.patch(`/signals/${id}`, data).then((r) => r.data as Signal),
  remove: (id: string) => api.delete(`/signals/${id}`).then((r) => r.data),
};

export const courseApi = {
  list: (level?: string) => api.get('/courses', { params: { level } }).then((r) => r.data as Course[]),
  listAll: () => api.get('/courses', { params: { all: true } }).then((r) => r.data as Course[]),
  get: (slug: string) => api.get(`/courses/${slug}`).then((r) => r.data as Course),
  enroll: (slug: string) => api.post(`/courses/${slug}/enroll`).then((r) => r.data),
  progress: (slug: string, data: { lessonId: string; completed?: boolean; secondsSeen?: number }) =>
    api.post(`/courses/${slug}/progress`, data).then((r) => r.data as { progress: number; completed: boolean }),
  create: (data: Record<string, unknown>) => api.post('/courses', data).then((r) => r.data as Course),
  update: (slug: string, data: Record<string, unknown>) => api.patch(`/courses/${slug}`, data).then((r) => r.data as Course),
  remove: (slug: string) => api.delete(`/courses/${slug}`).then((r) => r.data),
  addLesson: (slug: string, data: Record<string, unknown>) =>
    api.post(`/courses/${slug}/lessons`, data).then((r) => r.data as Lesson),
  updateLesson: (slug: string, lessonId: string, data: Record<string, unknown>) =>
    api.patch(`/courses/${slug}/lessons/${lessonId}`, data).then((r) => r.data as Lesson),
  removeLesson: (slug: string, lessonId: string) =>
    api.delete(`/courses/${slug}/lessons/${lessonId}`).then((r) => r.data),
};

export const communityApi = {
  groups: () => api.get('/community/groups').then((r) => r.data as Group[]),
  group: (id: string) => api.get(`/community/groups/${id}`).then((r) => r.data as Group),
  join: (id: string) => api.post(`/community/groups/${id}/join`).then((r) => r.data),
  leave: (id: string) => api.delete(`/community/groups/${id}/join`).then((r) => r.data),
  posts: (params?: { category?: string; q?: string; groupId?: string }) =>
    api.get('/community/posts', { params }).then((r) => r.data as Post[]),
  createPost: (data: { groupId?: string; kind?: string; body: string; imageUrl?: string }) =>
    api.post('/community/posts', data).then((r) => r.data as Post),
  removePost: (id: string) => api.delete(`/community/posts/${id}`).then((r) => r.data as { ok: boolean }),
  like: (id: string) => api.post(`/community/posts/${id}/like`).then((r) => r.data as { liked: boolean }),
  comments: (id: string) => api.get(`/community/posts/${id}/comments`).then((r) => r.data),
  addComment: (id: string, body: string) => api.post(`/community/posts/${id}/comments`, { body }).then((r) => r.data),
  messages: (groupId: string) => api.get(`/community/groups/${groupId}/messages`).then((r) => r.data as MessageHistory),
  sendMessage: (groupId: string, body: string) =>
    api.post(`/community/groups/${groupId}/messages`, { body }).then((r) => r.data as Message),
};

export const walletApi = {
  get: () => api.get('/wallet').then((r) => r.data as Wallet),
  withdrawalConfig: () =>
    api.get('/wallet/withdrawal-config').then((r) => r.data as {
      min: number;
      max: number;
      feePct: number;
      manualReview: boolean;
      methods?: string[];
    }),
  transactions: () => api.get('/wallet/transactions').then((r) => r.data as Transaction[]),
  deposit: (data: { amount: number; method: string; currency?: string }) =>
    api.post('/wallet/deposit', data).then((r) => r.data as { transaction: Transaction; provider: string; redirectUrl?: string }),
  withdraw: (data: { amount: number; method: string; destination: string; idempotencyKey?: string }, key?: string) =>
    api
      .post('/wallet/withdraw', data, { headers: key ? { 'idempotency-key': key } : undefined })
      .then((r) => r.data as { transaction: Transaction; provider: string; duplicate?: boolean }),
};

export interface PaymentConfig {
  paymentsAvailable: boolean;
  currency: string;
  vipPriceMonthly: number;
  plans: SubscriptionPlan[];
}

export const paymentApi = {
  config: () => api.get('/payments/config').then((r) => r.data as PaymentConfig),
  purchases: () => api.get('/payments/purchases').then((r) => r.data as Purchase[]),
  checkout: (data: { itemType: 'COURSE' | 'RESOURCE' | 'SUBSCRIPTION'; itemId: string }) =>
    api
      .post('/payments/checkout', data)
      .then(
        (r) =>
          r.data as {
            provider: string;
            checkoutUrl?: string;
            purchaseId: string;
            reference?: string;
            status: string;
            instructions?: string;
            completed?: boolean;
          },
      ),
  order: (id: string) => api.get(`/payments/orders/${id}`).then((r) => r.data as Purchase),
  receipts: () => api.get('/payments/receipts').then((r) => r.data as Receipt[]),
  receipt: (id: string) => api.get(`/payments/receipts/${id}`).then((r) => r.data as Receipt),
  refunds: () => api.get('/payments/refunds').then((r) => r.data as Refund[]),
  requestRefund: (purchaseId: string, reason: string) =>
    api.post(`/payments/purchases/${purchaseId}/refund-request`, { reason }).then((r) => r.data as Refund),
};

export const purchaseRequestApi = {
  packages: () => api.get('/purchase-requests/packages').then((r) => r.data as MembershipPackage[]),
  instructions: () => api.get('/purchase-requests/instructions').then((r) => r.data as { instructions: string }),
  create: (data: FormData) =>
    api.post('/purchase-requests', data).then((r) => r.data as Pick<PurchaseRequest, 'id' | 'reference' | 'status'>),
  list: () => api.get('/purchase-requests').then((r) => r.data as PurchaseRequest[]),
  cancel: (id: string) => api.post(`/purchase-requests/${id}/cancel`).then((r) => r.data as PurchaseRequest),
  proof: (id: string) =>
    api.get(`/purchase-requests/${id}/proof`, { responseType: 'blob' }).then((r) => r.data as Blob),
  adminPackages: () => api.get('/purchase-requests/admin/packages').then((r) => r.data as MembershipPackage[]),
  createPackage: (data: Omit<MembershipPackage, 'id'>) =>
    api.post('/purchase-requests/admin/packages', data).then((r) => r.data as MembershipPackage),
  updatePackage: (id: string, data: Partial<Omit<MembershipPackage, 'id'>>) =>
    api.patch(`/purchase-requests/admin/packages/${id}`, data).then((r) => r.data as MembershipPackage),
  adminInstructions: () =>
    api.get('/purchase-requests/admin/instructions').then((r) => r.data as { instructions: string }),
  updateInstructions: (instructions: string) =>
    api.put('/purchase-requests/admin/instructions', { instructions }).then((r) => r.data as { instructions: string }),
  adminRequests: (status?: string) =>
    api.get('/purchase-requests/admin', { params: { status } }).then((r) => r.data as PurchaseRequest[]),
  review: (id: string, data: {
    action: 'UNDER_REVIEW' | 'APPROVE' | 'REJECT';
    reason?: string;
    customerMessage?: string;
    internalNotes?: string;
    paymentChecked?: boolean;
    duplicateReferenceResolved?: boolean;
  }) => api.post(`/purchase-requests/admin/${id}/review`, data).then((r) => r.data as PurchaseRequest),
};

export const subscriptionApi = {
  get: () => api.get('/subscriptions').then((r) => r.data as Subscription),
  plans: () => api.get('/subscriptions/plans').then((r) => r.data as SubscriptionPlan[]),
  cancel: () => api.post('/subscriptions/cancel').then((r) => r.data),
  renew: (planId?: string) =>
    api
      .post('/subscriptions/renew', planId ? { planId } : {})
      .then(
        (r) =>
          r.data as {
            provider: string;
            checkoutUrl?: string;
            purchaseId: string;
            reference?: string;
            instructions?: string;
          },
      ),
};

export const notificationApi = {
  list: () => api.get('/notifications').then((r) => r.data as { notifications: Notification[]; unread: number }),
  read: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
  readAll: () => api.post('/notifications/read-all').then((r) => r.data),
  pushKey: () => api.get('/notifications/push/public-key').then((r) => r.data as { publicKey: string }),
  subscribePush: (sub: PushSubscriptionJSON) => api.post('/notifications/push/subscribe', sub).then((r) => r.data),
};

interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  membership: Membership;
  isVip: boolean;
  vipExpiresAt?: string | null;
  wallet?: { balance: number };
  _count?: { purchases: number };
}

export const adminApi = {
  stats: () => api.get('/admin/stats').then((r) => r.data),
  users: (q?: string, membership?: string) =>
    api.get('/admin/users', { params: { q, membership } }).then((r) => r.data as AdminUser[]),
  updateUser: (id: string, data: { role?: string; membership?: Membership; vipDays?: number }) =>
    api.patch(`/admin/users/${id}`, data).then((r) => r.data),
  transactions: (params?: { status?: string; type?: string }) =>
    api.get('/admin/transactions', { params }).then((r) => r.data as (Transaction & { user: { name: string; email: string } })[]),
  updateTransaction: (
    id: string,
    data: { action: 'approve' | 'reject' | 'processing' | 'paid'; adminNote?: string; providerRef?: string },
  ) =>
    api.patch(`/admin/transactions/${id}`, data).then((r) => r.data),
  broadcast: (data: { title: string; body: string; type?: string; link?: string; audience?: string }) =>
    api.post('/admin/broadcast', data).then((r) => r.data),
  purchases: (status?: string) => api.get('/admin/purchases', { params: { status } }).then((r) => r.data as (Purchase & { user: { name: string; email: string } })[]),
  updatePurchase: (id: string, data: { action: 'verify' | 'reject'; adminNote?: string }) =>
    api.patch(`/admin/purchases/${id}`, data).then((r) => r.data),
  payments: (params?: { status?: string; provider?: string; q?: string; from?: string; to?: string }) =>
    api
      .get('/admin/payments', { params })
      .then(
        (r) =>
          r.data as (Purchase & {
            user: { name: string; email: string; phone?: string | null; membership: string };
            payment?: Payment | null;
            receipt?: { receiptNumber: string } | null;
            refunds?: Refund[];
          })[],
      ),
  paymentAudit: (purchaseId?: string) =>
    api
      .get('/admin/payments/audit', { params: { purchaseId } })
      .then(
        (r) =>
          r.data as {
            id: string;
            action: string;
            source: string;
            purchaseId?: string | null;
            note?: string | null;
            actorRole?: string | null;
            createdAt: string;
          }[],
      ),
  refunds: (status?: string) =>
    api
      .get('/admin/refunds', { params: { status } })
      .then(
        (r) =>
          r.data as (Refund & {
            user: { name: string; email: string; phone?: string | null };
            purchase: { itemTitle: string; itemType: string; provider: string; providerRef?: string | null; status: string };
          })[],
      ),
  refundAction: (id: string, data: { action: 'APPROVE' | 'REJECT' | 'COMPLETE' | 'FAIL'; reason?: string; providerRef?: string }) =>
    api.post(`/admin/refunds/${id}`, data).then((r) => r.data as Refund),
  groups: () => api.get('/admin/groups').then((r) => r.data as Group[]),
  createGroup: (data: Record<string, unknown>) => api.post('/admin/groups', data).then((r) => r.data),
  updateGroup: (id: string, data: Record<string, unknown>) => api.patch(`/admin/groups/${id}`, data).then((r) => r.data),
  deleteGroup: (id: string) => api.delete(`/admin/groups/${id}`).then((r) => r.data),
  createResource: (data: Record<string, unknown>) => api.post('/admin/resources', data).then((r) => r.data),
  deleteResource: (id: string) => api.delete(`/admin/resources/${id}`).then((r) => r.data),
};


export type BrokerFundingQuery = {
  broker?: string;
  status?: string;
  q?: string;
  minAmount?: string;
  maxAmount?: string;
  from?: string;
  to?: string;
};

export interface BrokerSubmitResult {
  transaction: BrokerFunding;
  duplicate: boolean;
  mode: 'manual' | 'automated';
  provider: string;
  instructions?: string | null;
}

export const brokerApi = {
  config: () => api.get('/broker/config').then((r) => r.data as BrokerFundingConfig),
  balances: () => api.get('/broker/balances').then((r) => r.data as { balances: BrokerBalanceView[]; notice: string }),
  deposits: (broker?: BrokerId) => api.get('/broker/deposits', { params: { broker } }).then((r) => r.data as BrokerFunding[]),
  withdrawals: (broker?: BrokerId) => api.get('/broker/withdrawals', { params: { broker } }).then((r) => r.data as BrokerFunding[]),
  transactions: (params?: { direction?: 'DEPOSIT' | 'WITHDRAWAL'; broker?: BrokerId; status?: string }) =>
    api.get('/broker/transactions', { params }).then((r) => r.data as BrokerFunding[]),
  transaction: (id: string) => api.get(`/broker/transactions/${id}`).then((r) => r.data as BrokerFundingDetail),
  deposit: (
    data: { broker: BrokerId; amount: number; method: string; paymentReference: string; idempotencyKey?: string },
    key?: string,
  ) =>
    api
      .post('/broker/deposits', data, { headers: key ? { 'idempotency-key': key } : undefined })
      .then((r) => r.data as BrokerSubmitResult),
  withdraw: (
    data: {
      broker: BrokerId;
      amount: number;
      method: string;
      destination: string;
      destinationType: 'MOBILE_WALLET' | 'BANK_ACCOUNT' | 'BROKER_ACCOUNT' | 'CRYPTO_WALLET';
      paymentReference?: string;
      idempotencyKey?: string;
    },
    key?: string,
  ) =>
    api
      .post('/broker/withdrawals', data, { headers: key ? { 'idempotency-key': key } : undefined })
      .then((r) => r.data as BrokerSubmitResult),
};

export interface BrokerFundingStats {
  deposits: Record<string, number>;
  withdrawals: Record<string, number>;
  completed: { count: number; amount: number };
  gateways: BrokerFundingConfig['gateways'];
  currency: string;
}

export const brokerAdminApi = {
  deposits: (params?: BrokerFundingQuery) =>
    api.get('/admin/broker/deposits', { params }).then((r) => r.data as AdminBrokerFunding[]),
  withdrawals: (params?: BrokerFundingQuery) =>
    api.get('/admin/broker/withdrawals', { params }).then((r) => r.data as AdminBrokerFunding[]),
  stats: () => api.get('/admin/broker/stats').then((r) => r.data as BrokerFundingStats),
  transaction: (id: string) => api.get(`/admin/broker/transactions/${id}`).then((r) => r.data as AdminBrokerFundingDetail),
  update: (
    id: string,
    data: {
      action: 'review' | 'approve' | 'start_processing' | 'complete' | 'reject' | 'fail';
      adminNote?: string;
      internalNote?: string;
      providerRef?: string;
      evidence?: string;
      failureReason?: string;
    },
  ) => api.patch(`/admin/broker/transactions/${id}`, data).then((r) => r.data as AdminBrokerFunding),
  addNote: (id: string, note: string) => api.post(`/admin/broker/transactions/${id}/notes`, { note }).then((r) => r.data),
  audit: (params?: { action?: string; source?: string; transactionId?: string; broker?: string; from?: string; to?: string }) =>
    api.get('/admin/broker/audit', { params }).then((r) => r.data as BrokerAuditEntry[]),
  balances: (broker?: BrokerId) =>
    api.get('/admin/broker/balances', { params: { broker } }).then((r) => r.data as AdminBrokerBalance[]),
  saveBalance: (data: { userId: string; broker: BrokerId; balance: number; source: string; reference: string }) =>
    api.post('/admin/broker/balances', data).then((r) => r.data),
  settings: () => api.get('/admin/broker/settings').then((r) => r.data as BrokerSettingsView),
  saveSettings: (data: {
    deposit?: { min?: number; max?: number };
    withdrawal?: { min?: number; max?: number; dailyMax?: number };
    pendingLimit?: number;
    feePct?: number;
  }) => api.put('/admin/broker/settings', data).then((r) => r.data as BrokerSettingsView),
};


export const weltradeAccountApi = {
  get: () => api.get('/weltrade-account').then((r) => r.data as BrokerAccountConfig),
  submit: (clientId: string) =>
    api
      .post('/weltrade-account', { clientId })
      .then((r) => r.data as { account: BrokerAccount; registerUrl: string | null; message: string }),
};

export const weltradeAccountAdminApi = {
  list: (params?: { status?: string; q?: string }) =>
    api.get('/admin/weltrade-accounts', { params }).then((r) => r.data as AdminBrokerAccountList),
  update: (id: string, data: { action: 'verify' | 'reject'; reason?: string }) =>
    api.patch(`/admin/weltrade-accounts/${id}`, data).then((r) => r.data as AdminBrokerAccount),
  saveConfig: (registerUrl: string) =>
    api
      .put('/admin/weltrade-accounts/config', { registerUrl })
      .then((r) => r.data as { registerUrl: string | null }),
};
