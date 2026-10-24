
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { handle } from './router';

function header(config: InternalAxiosRequestConfig, name: string): string | undefined {
  const h = config.headers as unknown as
    | { get?: (n: string) => unknown }
    | Record<string, unknown>
    | undefined;
  if (!h) return undefined;
  const viaGet = typeof h.get === 'function' ? h.get(name) : undefined;
  const raw = viaGet ?? (h as Record<string, unknown>)[name] ?? (h as Record<string, unknown>)[name.toLowerCase()];
  return raw === undefined || raw === null ? undefined : String(raw);
}

function splitUrl(config: InternalAxiosRequestConfig): { path: string; query: Record<string, unknown> } {
  const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
  let path = url;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = path.replace(/^https?:\/\/[^/]+/i, '');
    }
  }
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.params ?? {})) {
    if (value === undefined || value === null) continue;
    query[key] = typeof value === 'string' ? value : String(value);
  }
  const q = path.indexOf('?');
  if (q >= 0) {
    for (const [key, value] of new URLSearchParams(path.slice(q + 1))) query[key] = value;
    path = path.slice(0, q);
  }
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.startsWith('/api/')) path = path.slice('/api'.length);
  else if (path === '/api') path = '/';
  return { path: path.replace(/\/+$/, '') || '/', query };
}

function parseBody(data: unknown): Record<string, unknown> {
  if (data === undefined || data === null) return {};
  if (typeof data === 'string') {
    if (!data) return {};
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  return {};
}

export async function offlineAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const method = (config.method ?? 'get').toUpperCase();
  const { path, query } = splitUrl(config);
  const { status, data } = await handle(
    method,
    path,
    query,
    parseBody(config.data),
    header(config, 'Authorization'),
  );

  const response: AxiosResponse = {
    data,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: { 'content-type': 'application/json' },
    config,
    request: null,
  };

  if (status >= 400) {
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: string }).error)
        : typeof data === 'object' && data && 'issues' in data
          ? ((data as { issues: { message: string }[] }).issues ?? []).map((i) => i.message).join(', ')
          : `Request failed with status code ${status}`;
    const code = status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST';
    throw new AxiosError(message, code, config, null, response);
  }
  return response;
}
