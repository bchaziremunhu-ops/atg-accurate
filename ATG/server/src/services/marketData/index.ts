import { env, integrations } from '../../config/env.js';

/**
 * Live market data (OPTIONAL, DISABLED BY DEFAULT).
 *
 * Signals are published manually by an administrator — the platform never
 * invents prices, candles or results. A chart is only drawn when a real market
 * data feed is connected.
 *
 * Enable a feed by setting MARKET_DATA_PROVIDER + MARKET_DATA_URL (and
 * MARKET_DATA_API_KEY if required) in `.env`. Until then `getMarketDataProvider`
 * returns a disabled provider and the chart endpoint reports `configured: false`
 * so the UI shows an honest "not connected" state instead of fake candles.
 */

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketDataProvider {
  name: string;
  configured: boolean;
  /** Returns candles, or null when the feed is unreachable. */
  getCandles(pair: string, timeframe: string, limit: number): Promise<Candle[] | null>;
}

const disabledProvider: MarketDataProvider = {
  name: 'disabled',
  configured: false,
  async getCandles() {
    return null;
  },
};

/**
 * Generic REST market-data adapter. Point MARKET_DATA_URL at an endpoint that
 * returns OHLC candles, e.g. `GET {URL}?symbol=EURUSD&interval=1h&limit=200`
 * with an array of `{ time, open, high, low, close }` objects.
 */
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
