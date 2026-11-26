const TOKEN_KEY = 'nextitops_token';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent('nextitops:unauthorized'));
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  raw?: boolean;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return await response.text();
}

export async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers: customHeaders, ...rest } = options;
  const headers = new Headers(customHeaders || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, { ...rest, headers, body: payload });
  } catch (error) {
    throw new ApiError('无法连接服务器，请检查网络或服务状态', 0, error);
  }
  if (response.status === 401 && !path.includes('/auth/login')) {
    clearSession();
  }
  if (!response.ok) {
    const data = await parseResponse(response);
    const message = (data && typeof data === 'object' && (data.message || data.error)) || `请求失败（${response.status}）`;
    throw new ApiError(message, response.status, data?.details ?? data);
  }
  if (raw) return response as T;
  return (await parseResponse(response)) as T;
}

export const api = {
  get: <T = any>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T = any>(path: string, body: unknown = {}, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T = any>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};

function filenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) return decodeURIComponent(utf8[1]);
  const basic = /filename="?([^";]+)"?/i.exec(disposition);
  if (basic) return basic[1];
  return fallback;
}

export async function downloadFile(path: string, fallbackName?: string) {
  const response = await request<Response>(path, { raw: true, method: 'GET' });
  const blob = await response.blob();
  const filename = filenameFromResponse(response, fallbackName || 'download');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const string = query.toString();
  return string ? `?${string}` : '';
}
