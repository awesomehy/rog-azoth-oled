import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runFile = promisify(execFile);
const keyReader = fileURLToPath(new URL('../native/read_usage_key.ps1', import.meta.url));
const protectedKeyFile = fileURLToPath(new URL('../.local/codex-usage-key.dpapi', import.meta.url));

export class UsageApiError extends Error {
  constructor(code, status = null) {
    // Never include response messages, credentials, headers or raw subprocess output.
    super(`Codex usage API: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.code = code;
    this.status = status;
  }
}

export function normalizeUsage(response) {
  if (!Array.isArray(response.limits)) throw new UsageApiError('INVALID_RESPONSE');
  const percent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  return response.limits.map(bucket => ({
    id: bucket.limitId ?? 'unknown', name: bucket.limitName ?? bucket.limitId ?? 'unknown',
    windows: [bucket.primary, bucket.secondary].filter(Boolean).map(window => {
      const remaining = percent(window.remainingPercent);
      const used = percent(window.usedPercent);
      const iso = typeof window.resetsAtIso === 'string' ? Date.parse(window.resetsAtIso) : NaN;
      return {
        remainingPercent: remaining ?? (used === null ? null : 100 - used),
        durationMinutes: Number.isFinite(window.windowDurationMins) ? window.windowDurationMins : null,
        resetsAt: Number.isFinite(window.resetsAt) ? window.resetsAt : Number.isFinite(iso) ? iso / 1000 : null,
      };
    }),
  }));
}

async function readApiKey() {
  const environmentKey = process.env.CODEX_USAGE_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  try {
    const { stdout } = await runFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', keyReader, '-KeyFile', protectedKeyFile,
    ], { windowsHide: true, timeout: 5000, maxBuffer: 16384 });
    if (stdout.trim()) return stdout.trim();
  } catch { /* Subprocess output could contain secrets; do not forward it. */ }
  throw new UsageApiError('API_KEY_REQUIRED');
}

export async function readCodexUsage({ baseUrl, timeoutMs = 25000, apiKey, fetchImpl = fetch } = {}) {
  let url;
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    url = new URL('/api/usage', base);
  } catch { throw new UsageApiError('INVALID_API_URL'); }
  const key = (apiKey ?? await readApiKey()).trim();
  if (!key || /[\r\n]/.test(key)) throw new UsageApiError('API_KEY_REQUIRED');
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
  } catch (error) {
    throw new UsageApiError(['TimeoutError', 'AbortError'].includes(error.name) ? 'TIMEOUT' : 'UNREACHABLE');
  }
  let body;
  try { body = await response.json(); }
  catch { throw new UsageApiError('INVALID_RESPONSE', response.status); }
  if (!response.ok || body.ok !== true) {
    const code = body.error?.code;
    throw new UsageApiError(typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'REQUEST_FAILED', response.status);
  }
  if (typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt))) throw new UsageApiError('INVALID_RESPONSE', response.status);
  const limits = normalizeUsage(body);
  if (!limits.some(bucket => bucket.windows.length)) throw new UsageApiError('NO_USAGE_DATA', response.status);
  return { fetchedAt: body.fetchedAt, limits };
}
