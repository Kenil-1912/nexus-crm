// Small fetch wrapper. Tokens live in sessionStorage, so closing the tab logs out.

export const session = {
  get: (kind) => {
    try { return JSON.parse(sessionStorage.getItem(`nexus_${kind}`)); } catch { return null; }
  },
  set: (kind, value) => sessionStorage.setItem(`nexus_${kind}`, JSON.stringify(value)),
  clear: (kind) => sessionStorage.removeItem(`nexus_${kind}`),
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || 'Something went wrong. Please try again.');
    this.status = status;
    this.errors = body?.errors || {};
  }
}

/** kind: 'student' | 'staff' | undefined (public). */
export async function api(path, { method = 'GET', body, kind } = {}) {
  const token = kind ? session.get(kind)?.token : null;
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { message: 'Cannot reach the server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && kind) {
    session.clear(kind);
    window.location.assign(kind === 'staff' ? '/staff/login' : '/login');
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
