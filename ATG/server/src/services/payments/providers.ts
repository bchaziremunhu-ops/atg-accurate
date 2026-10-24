import { env } from '../../config/env.js';


export interface DepositRequest {
  userId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string;
}

export interface DepositResult {
  provider: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
  instructions?: string;
  providerRef: string;
  redirectUrl?: string;
}

export interface WithdrawalRequest {
  userId: string;
  amount: number;
  currency: string;
  method: string;
  destination: string;
  reference: string;
}

export interface WithdrawalResult {
  provider: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED';
  providerRef: string;
  message?: string;
}

export interface PaymentProvider {
  name: string;
  configured: boolean;
  createDeposit(req: DepositRequest): Promise<DepositResult>;
  createWithdrawal(req: WithdrawalRequest): Promise<WithdrawalResult>;
}

const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'local bank transfer',
  ECOCASH: 'EcoCash',
  ONEMONEY: 'OneMoney',
  INNBUCKS: 'InnBucks',
  CASHSMILE: 'CashSmile',
};

const manualProvider: PaymentProvider = {
  name: 'manual',
  configured: false,
  async createDeposit(req) {
    return {
      provider: 'manual',
      status: 'PENDING',
      providerRef: `ATHOLD-${req.reference}`,
      instructions:
        `Complete your ${METHOD_LABEL[req.method] ?? req.method} payment of ${req.currency} ${req.amount.toFixed(2)} ` +
        `using reference ${req.reference}, then submit your payment reference. ` +
        `Your wallet is credited once an administrator confirms the funds were received.`,
    };
  },
  async createWithdrawal(req) {
    return {
      provider: 'manual',
      status: 'PENDING',
      providerRef: `ATHOLD-${req.reference}`,
      message:
        `Withdrawal of ${req.currency} ${req.amount.toFixed(2)} to ${req.destination} via ` +
        `${METHOD_LABEL[req.method] ?? req.method} is awaiting administrator approval. Funds are held until then.`,
    };
  },
};

const providers: Record<string, PaymentProvider> = {
  manual: manualProvider,
  // Register real providers here, e.g.:
  //   ecocash: { name: 'ecocash', configured: true, createDeposit, createWithdrawal },
};

export function getPaymentProvider(): PaymentProvider {
  return providers[env.paymentProvider] ?? manualProvider;
}
