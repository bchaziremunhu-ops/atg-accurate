import { env, integrations } from '../../config/env.js';


export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketDataProvider {
  name: string;
  configured: boolean;
  getCandles(pair: string, timeframe: string, limit: number): Promise<Candle[] | null>;
}

const disabledProvider: MarketDataProvider = {
  name: 'disabled',
  configured: false,
  async getCandles() {
    return null;
  },
};

function httpProvider(): MarketDataProvider {
  return {
    name: env.marketDataProvider,
    configured: integrations.marketData,
    async getCandles(pair, timeframe, limit) {
      const url = new URL(env.marketDataUrl);
      url.searchParams.set('symbol', pair);
      url.searchParams.set('interval', timeframe);
      url.searchParams.set('limit', String(limit));
      const headers: Record<string, string> = {};
      if (env.marketDataApiKey) headers.authorization = `Bearer ${env.marketDataApiKey}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as unknown;
      const rows = Array.isArray(data) ? data : ((data as { candles?: unknown[] })?.candles ?? []);
      const candles = (rows as Record<string, unknown>[])
        .map((r) => ({
          time: Number(r.time),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
        }))
        .filter((c) => [c.time, c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n)));
      return candles.length ? candles : null;
    },
  };
}

export function getMarketDataProvider(): MarketDataProvider {
  return integrations.marketData ? httpProvider() : disabledProvider;
}
