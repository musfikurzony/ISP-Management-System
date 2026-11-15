// Every screen talks to the backend through this one small helper.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON answer */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

// Builds "?a=1&b=2", skipping empty values.
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') p.set(k, val);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

// Downloads a report that the server delivers in chunks of 1000 rows.
export async function fetchAllRows(path, params = {}) {
  let offset = 0;
  let first = null;
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const data = await api.get(path + qs({ ...params, offset }));
    if (!first) first = data;
    rows.push(...data.rows);
    if (!data.more) break;
    offset = data.next_offset;
  }
  return { ...first, rows };
}
