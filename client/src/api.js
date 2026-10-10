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

export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Upload one application document (student). The file itself is the request body. */
export async function uploadDocument(documentType, file) {
  if (!FILE_TYPES.includes(file.type)) throw new ApiError(415, { message: 'Upload a PDF, JPG or PNG file.' });
  if (file.size > MAX_FILE_BYTES) throw new ApiError(413, { message: 'That file is too large. The limit is 10 MB.' });
  let res;
  try {
    res = await fetch(`/api/student/application/documents?type=${encodeURIComponent(documentType)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
        Authorization: `Bearer ${session.get('student')?.token}`,
      },
      body: file,
    });
  } catch {
    throw new ApiError(0, { message: 'Cannot reach the server. Check your connection and try again.' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Download a document through the API (needs the login token, so a plain link will not do). */
export async function downloadDocument(id, kind, fileName) {
  const res = await fetch(`/api/${kind}/documents/${id}`, { headers: { Authorization: `Bearer ${session.get(kind)?.token}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
