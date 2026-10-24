import crypto from 'node:crypto';
import { env, integrations } from '../../config/env.js';


export const BROKERS = ['DERIV', 'WELTRADE'] as const;
export type Broker = (typeof BROKERS)[number];

export const FUNDING_METHODS = ['ECOCASH', 'ONEMONEY', 'INNBUCKS', 'CASHSMILE', 'BANK_TRANSFER', 'USDT_TRC20'] as const;
export type FundingMethod = (typeof FUNDING_METHODS)[number];

export const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'local bank transfer',
  ECOCASH: 'EcoCash',
  ONEMONEY: 'OneMoney',
  INNBUCKS: 'InnBucks',
  CASHSMILE: 'CashSmile',
  USDT_TRC20: 'USDT (TRC20)',
};

export interface BrokerAdapterRequest {
  reference: string;
  broker: Broker;
  direction: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  currency: string;
  method: string;
  destination?: string | null;
  paymentReference?: string | null;
}

export interface BrokerAdapterResult {
  provider: string;
  status: 'PENDING' | 'PROCESSING';
  providerRef?: string | null;
  instructions?: string;
  message?: string;
}

export interface BrokerAdapter {
  name: string;
  kind: 'manual' | 'automated';
  configured: boolean;
  reason: string | null;
  createFundingRequest(req: BrokerAdapterRequest): Promise<BrokerAdapterResult>;
}

export interface GatewayDescriptor {
  broker: Broker;
  name: string;
  kind: 'manual' | 'automated';
  configured: boolean;
  ready: boolean;
  reason: string | null;
}

interface BrokerConfig {
  broker: Broker;
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  appId: string;
  webhookSecret: string;
  depositPath: string;
  withdrawPath: string;
  balancePath: string;
  authHeader: string;
  authScheme: string;
  webhookHeader: string;
}

function readBrokerConfig(broker: Broker): BrokerConfig {
  if (broker === 'DERIV') {
    return {
      broker,
      baseUrl: env.derivBaseUrl,
      apiKey: env.derivApiKey,
      apiSecret: env.derivApiSecret,
      appId: env.derivAppId,
      webhookSecret: env.derivWebhookSecret,
      depositPath: env.derivFundingDepositPath,
      withdrawPath: env.derivFundingWithdrawPath,
      balancePath: env.derivFundingBalancePath,
      authHeader: env.derivFundingAuthHeader || 'Authorization',
      authScheme: env.derivFundingAuthScheme,
      webhookHeader: env.derivWebhookHeader || 'X-ATG-Signature',
    };
  }
  return {
    broker,
    baseUrl: env.weltradeBaseUrl,
    apiKey: env.weltradeApiKey,
    apiSecret: env.weltradeApiSecret,
    appId: '',
    webhookSecret: env.weltradeWebhookSecret,
    depositPath: env.weltradeFundingDepositPath,
    withdrawPath: env.weltradeFundingWithdrawPath,
    balancePath: env.weltradeFundingBalancePath,
    authHeader: env.weltradeFundingAuthHeader || 'Authorization',
    authScheme: env.weltradeFundingAuthScheme,
    webhookHeader: env.weltradeWebhookHeader || 'X-ATG-Signature',
  };
}

export function gatewayReason(broker: Broker): string | null {
  const cfg = readBrokerConfig(broker);
  if (!cfg.apiKey && !cfg.apiSecret) return 'No API credentials configured.';
  if (!cfg.apiSecret) return 'API secret missing.';
  if (!cfg.webhookSecret) return 'Webhook signing secret missing — callbacks could not be verified.';
  if (!cfg.depositPath) return 'Deposit endpoint path not mapped (see docs/BROKER_FUNDING.md).';
  if (!cfg.withdrawPath) return 'Withdrawal endpoint path not mapped (see docs/BROKER_FUNDING.md).';
  if (!cfg.baseUrl) return 'Base URL missing.';
  return null;
}

export function listFundingGateways(): GatewayDescriptor[] {
  return BROKERS.map((broker) => {
    const cfg = readBrokerConfig(broker);
    const ready = gatewayReady(broker);
    const reason = gatewayReason(broker) ?? (ready ? null : 'BROKER_FUNDING_PROVIDER is set to `manual` — automated gateways are disabled.');
    return {
      broker,
      name: broker === 'DERIV' ? 'Deriv' : 'Weltrade',
      kind: ready ? 'automated' : 'manual',
      configured: Boolean(cfg.apiKey && cfg.apiSecret && cfg.webhookSecret),
      ready,
      reason,
    };
  });
}

export function gatewayReady(broker: Broker): boolean {
  return gatewayReason(broker) === null && env.brokerFundingProvider !== 'manual';
}


const manualAdapter: BrokerAdapter = {
  name: 'manual',
  kind: 'manual',
  configured: false,
  reason: null,
  async createFundingRequest(req) {
    const label = METHOD_LABEL[req.method] ?? req.method;
    const brokerName = req.broker === 'DERIV' ? 'Deriv' : 'Weltrade';
    if (req.direction === 'DEPOSIT') {
      return {
        provider: 'manual',
        status: 'PENDING',
        providerRef: null,
        instructions:
          `Send ${req.currency} ${req.amount.toFixed(2)} to your ${brokerName} account using ${label}, ` +
          `then quote reference ${req.reference}. MANUAL PROCESSING: an administrator confirms the funds ` +
          `were received before this deposit is approved. Nothing is credited automatically.`,
      };
    }
    return {
      provider: 'manual',
      status: 'PENDING',
      providerRef: null,
      message:
        `Withdrawal of ${req.currency} ${req.amount.toFixed(2)} from your ${brokerName} account via ${label} ` +
        `is queued for administrator review. MANUAL PROCESSING: the payout is only executed after an ` +
        `administrator approves it and records real evidence of the transfer.`,
    };
  },
};


function createHttpAdapter(cfg: BrokerConfig, reason: string | null): BrokerAdapter {
  const brokerName = cfg.broker === 'DERIV' ? 'Deriv' : 'Weltrade';
  const adapter: BrokerAdapter = {
    name: cfg.broker.toLowerCase(),
    kind: 'automated',
    configured: reason === null,
    reason,
    async createFundingRequest(req) {
      const path = req.direction === 'DEPOSIT' ? cfg.depositPath : cfg.withdrawPath;
      if (reason || !path) {
        return manualAdapter.createFundingRequest(req);
      }
      const url = `${cfg.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
      const token = cfg.apiSecret || cfg.apiKey;
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        [cfg.authHeader]: cfg.authScheme ? `${cfg.authScheme} ${token}` : token,
        'X-Idempotency-Key': req.reference,
        'X-ATG-Reference': req.reference,
      };
      if (cfg.appId) headers['X-App-Id'] = cfg.appId;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            reference: req.reference,
            broker: req.broker,
            direction: req.direction,
            amount: req.amount,
            currency: req.currency,
            method: req.method,
            destination: req.destination ?? undefined,
            paymentReference: req.paymentReference ?? undefined,
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        return {
          provider: adapter.name,
          status: 'PENDING',
          providerRef: null,
          message: `${brokerName} gateway unreachable (${(err as Error).message}). Queued for manual processing.`,
        };
      }

      const text = await res.text().catch(() => '');
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }

      if (!res.ok) {
        return {
          provider: adapter.name,
          status: 'PENDING',
          providerRef: null,
          message: `${brokerName} gateway rejected the request (HTTP ${res.status}). Queued for manual processing.`,
        };
      }

      const providerRef =
        (typeof body.reference === 'string' && body.reference) ||
        (typeof body.id === 'string' && body.id) ||
        (typeof body.transaction_id === 'string' && body.transaction_id) ||
        null;

      return {
        provider: adapter.name,
        status: providerRef ? 'PROCESSING' : 'PENDING',
        providerRef,
        message: `${brokerName} gateway accepted the request — awaiting settlement confirmation.`,
      };
    },
  };
  return adapter;
}

export function getFundingAdapter(broker: Broker): BrokerAdapter {
  const ready = gatewayReady(broker);
  const reason = gatewayReason(broker) ?? (ready ? null : 'BROKER_FUNDING_PROVIDER is set to `manual`.');
  return createHttpAdapter(readBrokerConfig(broker), reason);
}

export function describeFundingMode(broker: Broker): 'manual' | 'automated' {
  return gatewayReady(broker) ? 'automated' : 'manual';
}


export interface VerifiedWebhookEvent {
  broker: Broker;
  eventId: string;
  reference: string;
  outcome: 'COMPLETED' | 'FAILED';
  providerRef: string | null;
  reason: string | null;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyBrokerWebhook(broker: Broker, rawBody: Buffer, signatureHeader: string | undefined): VerifiedWebhookEvent {
  const cfg = readBrokerConfig(broker);
  if (!cfg.webhookSecret) {
    throw new WebhookVerificationError(`${broker} webhook secret is not configured — gateway disabled.`);
  }
  if (!signatureHeader) throw new WebhookVerificationError('Missing webhook signature.');

  const raw = rawBody.toString('utf8');
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return i === -1 ? [kv.trim(), ''] : [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );

  let ok = false;
  if (parts.v1) {
    const signed = `${parts.t ?? ''}.${raw}`;
    const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(signed).digest('hex');
    ok = safeCompare(parts.v1, expected);
  } else {
    const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex');
    ok = safeCompare(signatureHeader, expected) || safeCompare(signatureHeader, crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('base64'));
  }
  if (!ok) throw new WebhookVerificationError('Invalid webhook signature.');

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new WebhookVerificationError('Webhook body is not valid JSON.');
  }

  const str = (key: string, fallback: string | null = null): string | null => {
    const value = payload[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
    return fallback;
  };

  const rawOutcome = String(payload.outcome ?? payload.status ?? '').toUpperCase();
  const outcome: VerifiedWebhookEvent['outcome'] =
    rawOutcome === 'FAILED' || rawOutcome === 'REJECTED' || rawOutcome === 'CANCELLED' ? 'FAILED' : 'COMPLETED';

  const eventId = str('event_id') || str('id') || str('eventId');
  const reference = str('reference') || str('merchant_reference') || str('atg_reference');
  if (!eventId) throw new WebhookVerificationError('Webhook is missing an event id (idempotency key).');
  if (!reference) throw new WebhookVerificationError('Webhook is missing a funding reference.');

  return {
    broker,
    eventId,
    reference,
    outcome,
    providerRef: str('provider_ref') || str('transaction_id'),
    reason: str('reason') || str('message'),
  };
}

export function webhookSignatureHeader(broker: Broker): string {
  return readBrokerConfig(broker).webhookHeader;
}

export const integrationsState = integrations;
