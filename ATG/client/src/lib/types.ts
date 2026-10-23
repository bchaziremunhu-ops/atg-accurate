export type Membership = 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
export type AccessTier = 'FREE' | 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  /** Canonical international number (`+263771234567`). */
  phoneE164?: string | null;
  country?: string | null;
  nationality?: string | null;
  /** ISO date string (YYYY-MM-DD) when captured at registration. */
  dateOfBirth?: string | null;
  address?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  role: 'USER' | 'ADMIN';
  membership?: Membership;
  isVip: boolean;
  vipExpiresAt?: string | null;
  wallet?: Wallet;
  subscription?: Subscription | null;
  stats?: { courses: number; signals: number; certificates: number };
}

/** Payload for POST /auth/register — no email/phone verification required. */
export interface RegisterInput {
  name: string;
  phone: string;
  country: string;
  nationality: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  /** Optional — left empty when the user skips it. */
  address?: string;
  /** Security question id from SECURITY_QUESTIONS. */
  securityQuestion: string;
  securityAnswer: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  email?: string;
}

export interface Wallet {
  id: string;
  balance: number;
  currency: string;
  providerConfigured?: boolean;
  methods?: string[];
}

export interface Signal {
  id: string;
  pair: string;
  market: string;
  direction: 'BUY' | 'SELL';
  entry: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  timeframe: string;
  tier: 'FREE' | 'VIP';
  audience: AccessTier;
  status: 'OPEN' | 'HIT_TP' | 'HIT_SL' | 'CANCELLED';
  resultPips?: number | null;
  resultPct?: number | null;
  analysis?: string | null;
  chartUrl?: string | null;
  publishedAt: string;
  closedAt?: string | null;
  locked?: boolean;
  author?: { id: string; name: string; avatarUrl?: string | null };
}

export interface Lesson {
  id: string;
  title: string;
  description?: string | null;
  videoUrl?: string | null;
  durationMin: number;
  order: number;
  isFree: boolean;
  locked?: boolean;
  completed?: boolean;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  level: string;
  price: number;
  currency?: string;
  saleStatus?: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN' | 'SOLD_OUT';
  isFree?: boolean;
  entitled?: boolean;
  isVip: boolean;
  published?: boolean;
  coverUrl?: string | null;
  lessonCount: number;
  durationMin: number;
  lessons: Lesson[];
  resources?: Resource[];
  progress: number;
  enrollmentId?: string | null;
}

export interface Resource {
  id: string;
  courseId?: string | null;
  title: string;
  type: string;
  url: string;
  sizeKb: number;
  isVip: boolean;
  locked?: boolean;
}

export interface Certificate {
  id: string;
  title: string;
  issuedAt: string;
  course?: { slug: string; title: string; level: string } | null;
}

export interface CertificateDetail extends Certificate {
  recipient: string;
}

export interface Post {
  id: string;
  kind: 'POST' | 'ANALYSIS' | 'WIN' | 'QUESTION';
  body: string;
  imageUrl?: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  author: { id: string; name: string; avatarUrl?: string | null; role: string; isVip?: boolean };
  group?: { id: string; name: string; category: string };
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  visibility: 'PUBLIC' | 'VIP';
  accessTier: AccessTier;
  roomType: 'GENERAL' | 'DERIV' | 'WELTRADE';
  isChatOpen: boolean;
  chatOpen?: boolean;
  canAccess?: boolean;
  joined?: boolean;
  _count?: { members: number; posts: number; messages?: number };
}

export interface Message {
  id: string;
  groupId: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; avatarUrl?: string | null };
}

export interface MessageHistory {
  chatOpen: boolean;
  messages: Message[];
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  link?: string | null;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'PURCHASE' | 'REFUND' | 'SUBSCRIPTION';
  method?: string | null;
  amount: number;
  fee: number;
  netAmount?: number | null;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  reference: string;
  note?: string | null;
  destination?: string | null;
  providerRef?: string | null;
  adminNote?: string | null;
  processedAt?: string | null;
  createdAt: string;
  statusHistory?: {
    id: string;
    fromStatus?: string | null;
    toStatus: string;
    actorRole: string;
    note?: string | null;
    createdAt: string;
  }[];
}

export interface Purchase {
  id: string;
  itemType: string;
  itemId: string;
  itemTitle: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'DISPUTED';
  provider: string;
  method?: string | null;
  proofNote?: string | null;
  providerRef?: string | null;
  createdAt: string;
  payment?: Payment | null;
  receipt?: Receipt | null;
  refunds?: Refund[];
}

export interface Payment {
  id: string;
  purchaseId: string;
  reference: string;
  providerTransactionRef?: string | null;
  status: string;
  amount: number | string;
  currency: string;
  statusUpdates: number;
  paidAt?: string | null;
  createdAt: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  purchaseId: string;
  itemTitle: string;
  itemType: string;
  amount: number | string;
  currency: string;
  method?: string | null;
  paidAt: string;
  createdAt: string;
  purchase?: { provider: string; providerRef?: string | null; status: string };
}

export interface Refund {
  id: string;
  purchaseId: string;
  amount: number | string;
  currency: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'FAILED';
  adminNote?: string | null;
  providerRef?: string | null;
  createdAt: string;
  purchase?: { itemTitle: string; itemType: string; provider: string; providerRef?: string | null; status: string };
}

export interface SubscriptionPlan {
  id: string;
  title: string;
  price: number;
  months: number;
  membership: 'PAID' | 'VIP_DERIV' | 'VIP_WELTRADE';
  description?: string;
}

export interface Subscription {
  plan: string | null;
  status: string;
  startedAt?: string;
  expiresAt: string | null;
  autoRenew?: boolean;
  daysLeft?: number | null;
  expired?: boolean;
  roomAccess?: { accessLevel: string; startsAt: string; expiresAt: string; approvalReference: string }[];
}

export interface MembershipPackage {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  price: number | string;
  currency: string;
  durationDays: number;
  activationRule: 'APPROVAL' | 'AFTER_CURRENT_ACCESS';
  includedRooms: ('VIP_DERIV' | 'VIP_WELTRADE')[];
  saleStatus: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN' | 'SOLD_OUT';
}

export interface PurchaseRequest {
  id: string;
  reference: string;
  itemType: 'COURSE' | 'MEMBERSHIP';
  itemTitleSnapshot: string;
  itemDescriptionSnapshot?: string | null;
  amountSnapshot: number | string;
  amountPaid: number | string;
  currencySnapshot: string;
  durationDaysSnapshot?: number | null;
  activationRuleSnapshot?: string | null;
  includedRoomsSnapshot?: string | null;
  paymentMethod: string;
  paymentReference: string;
  paymentDate?: string | null;
  customerNote?: string | null;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  duplicateReference: boolean;
  decisionAt?: string | null;
  decisionReason?: string | null;
  customerMessage?: string | null;
  approvalReference?: string | null;
  reviewer?: { id?: string; name: string } | null;
  user?: { id: string; name: string; email: string };
  proofUrl?: string;
  events: {
    id: string;
    action: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    customerMessage?: string | null;
    internalNotes?: string | null;
    createdAt: string;
    actor?: { id: string; name: string; role: string } | null;
  }[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Broker funding — deposits into / withdrawals out of a Deriv or Weltrade
// account. Deliberately a separate ledger from Wallet (ATG balance) and
// Purchase (courses / VIP): the two are never mixed.
// ---------------------------------------------------------------------------

export type BrokerId = 'DERIV' | 'WELTRADE';

export type BrokerFundingStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED';

export interface BrokerFundingConfig {
  brokers: { id: BrokerId; label: string }[];
  methods: { id: string; label: string; logo: string | null }[];
  limits: {
    currency: string;
    deposit: { min: number; max: number };
    withdrawal: { min: number; max: number; dailyMax: number };
    pendingLimit: number;
    feePct: number;
  };
  gateways: {
    broker: BrokerId;
    name: string;
    kind: 'manual' | 'automated';
    configured: boolean;
    ready: boolean;
    reason: string | null;
  }[];
  manualProcessing: boolean;
  notice: string;
}

export interface BrokerFunding {
  id: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  broker: BrokerId;
  brokerLabel: string;
  amount: number;
  currency: string;
  method: string;
  methodLabel: string;
  feePct: number;
  feeAmount: number;
  status: BrokerFundingStatus;
  reference: string;
  provider: string;
  processingMode: 'manual' | 'automated';
  providerRef?: string | null;
  paymentReference?: string | null;
  destination?: string | null;
  destinationType?: string | null;
  adminNote?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface BrokerTimelineEntry {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  source: string;
  note: string | null;
  at: string;
}

export interface BrokerFundingDetail extends BrokerFunding {
  timeline: BrokerTimelineEntry[];
}

export interface BrokerBalanceView {
  broker: BrokerId;
  brokerLabel: string;
  available: boolean;
  balance: number | null;
  currency: string;
  source: string | null;
  verifiedAt: string | null;
}

/** Admin list row — destination is masked; the raw value only exists on detail. */
export interface AdminBrokerFunding {
  id: string;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  broker: BrokerId;
  amount: number;
  currency: string;
  method: string;
  feePct: number;
  feeAmount: number;
  status: BrokerFundingStatus;
  reference: string;
  provider: string;
  processingMode: 'manual' | 'automated';
  providerRef?: string | null;
  paymentReference?: string | null;
  destinationMasked: string | null;
  hasDestination: boolean;
  internalNote?: string | null;
  adminNote?: string | null;
  failureReason?: string | null;
  createdAt: string;
  completedAt?: string | null;
  user?: { id: string; name: string; email: string; membership: string };
}

export interface AdminBrokerFundingDetail extends AdminBrokerFunding {
  destination: string | null;
  destinationType: string | null;
  evidence: string | null;
  evidenceType: string | null;
  processedAt: string | null;
  audit: BrokerAuditEntry[];
}

export interface BrokerAuditEntry {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  source: string;
  provider?: string | null;
  eventId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  note?: string | null;
  metadata?: string | null;
  at: string;
  transaction?: {
    reference: string;
    broker: string;
    direction: string;
    amount: number;
    currency: string;
    status: string;
  } | null;
}

export interface AdminBrokerBalance {
  id: string;
  userId: string;
  broker: BrokerId;
  currency: string;
  balance: number;
  source: string;
  reference?: string | null;
  verifiedAt?: string | null;
  updatedAt: string;
  user?: { id: string; name: string; email: string };
}

// Runtime-configurable broker limits & fee (env provides the defaults,
// anything stored in Setting overrides them - no redeploy needed).
export interface BrokerSettings {
  deposit: { min: number; max: number };
  withdrawal: { min: number; max: number; dailyMax: number };
  pendingLimit: number;
  feePct: number;
}

export interface BrokerSettingsView {
  settings: BrokerSettings;
  limits: BrokerSettings & { currency: string };
  currency: string;
}

// ---------------------------------------------------------------------------
// Broker ACCOUNT registration (Weltrade). Distinct from BrokerFunding above:
// this is the client id the member was issued, verified by an administrator.
// ---------------------------------------------------------------------------

export type BrokerAccountStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface BrokerAccountEvent {
  id: string;
  action: string; // SUBMITTED | UPDATED | RESUBMITTED | VERIFIED | REJECTED
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

export interface BrokerAccount {
  id: string;
  broker: BrokerId;
  clientId: string;
  status: BrokerAccountStatus;
  rejectReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface BrokerAccountConfig {
  broker: BrokerId;
  registerUrl: string | null;
  account: BrokerAccount | null;
}

export interface AdminBrokerAccount extends BrokerAccount {
  user: { id: string; name: string; email: string; phone?: string | null; membership?: Membership };
  events: BrokerAccountEvent[];
}

export interface AdminBrokerAccountList {
  accounts: AdminBrokerAccount[];
  pending: number;
  verified: number;
  rejected: number;
  registerUrl: string | null;
}
