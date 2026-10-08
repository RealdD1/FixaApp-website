// socket-connection.js — load AFTER config.js and socket.io.min.js
(function () {
  if (window.globalSocket) return;
  const token = localStorage.getItem('token');
  if (!token || typeof io === 'undefined') return;

  let user = null;
  try { user = JSON.parse(localStorage.getItem('user')); } catch {}
  const uid = user && (user._id || user.id || user.userId);
  const url = (window.FIXA_CONFIG && window.FIXA_CONFIG.API_URL) || 'http://localhost:5000';

  const s = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
  });
  window.globalSocket = s;

  s.on('connect', () => { if (uid) s.emit('register', uid); });
  s.on('connect_error', (e) => console.warn('Socket error:', e.message));

  // Reconnect immediately when the phone gets signal or the app returns to the foreground
  window.addEventListener('online', () => { if (!s.connected) s.connect(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !s.connected) s.connect(); });
})();