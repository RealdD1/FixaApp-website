(async function renewSession() {
  const t = localStorage.getItem('token');
  if (!t) return;
  try {
    const { iat, exp } = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const now = Date.now() / 1000;
    if (exp < now) { localStorage.clear(); return location.replace('SignIn.html'); }
    if (now - iat < 3 * 86400) return;
    const r = await fetch(`${FIXA_CONFIG.API_URL}/api/users/refresh`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}` }
    });
    if (r.ok) localStorage.setItem('token', (await r.json()).token);
    else if (r.status === 401) { localStorage.clear(); location.replace('SignIn.html'); }
  } catch {}
})();