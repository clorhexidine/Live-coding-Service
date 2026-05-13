const API = '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  return res;
}

async function getMe() {
  const res = await apiFetch('/api/auth/me');
  if (!res.ok) return null;
  return res.json();
}
