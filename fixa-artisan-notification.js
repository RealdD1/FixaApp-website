/**
 * FIXA — Unified Notification + Dispute + Rating System
 * Works for BOTH Artisan and Customer
 * Drop-in: <script src="fixa-notification-system.js"></script>
 */

(function (global) {
  'use strict';

  let _socket = null;
  let _user   = null;
  let _token  = null;
  let _base   = '';
  let _role   = 'customer';           // Will be properly set in init()
  let _notifications = [];
  let _unreadCount   = 0;

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtTime(d) {
    try {
      const dt = d instanceof Date ? d : new Date(d);
      const now = new Date();
      if (dt.toDateString() === now.toDateString()) {
        return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  function authH(json = false) {
    const h = { Authorization: `Bearer ${_token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function apiFetch(path, opts = {}) {
    const r = await fetch(`${_base}${path}`, { 
      ...opts, 
      headers: { ...authH(true), ...(opts.headers || {}) } 
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${r.status}`);
    }
    return r.json();
  }

  // ─────────────────────────────────────────────
  // INJECT STYLES (same as before)
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('fixa-sys-styles')) return;
    const style = document.createElement('style');
    style.id = 'fixa-sys-styles';
    style.textContent = `/* ... your existing long CSS stays exactly the same ... */`;
    document.head.appendChild(style);
  }

  // Build DOM (notification bell, modals, etc.) — keep your existing buildDOM() function
  function buildDOM() {
    // ... your existing buildDOM code (notification bell, toast zone, dispute modal, rating modal, suspended screen) ...
    // No changes needed here unless you want to customize icons per role
  }

  // Notification icons (you can extend this)
  const NOTIF_ICONS = {
    job: '🔨', message: '💬', payment: '💳', system: 'ℹ️',
    warning: '⚠️', success: '✅', verification: '✔️', dispute: '🚨',
    urgent: '🔴', rating: '⭐', suspended: '🚫', activated: '✅', chat: '💬'
  };

  function addNotification(title, body, type = 'system', chatId = null, meta = {}) {
    const n = {
      id: Date.now() + Math.random(),
      title, body, type, chatId, meta,
      time: new Date(),
      unread: true
    };
    _notifications.unshift(n);
    if (_notifications.length > 50) _notifications.pop();
    _unreadCount++;
    updateBadge();
    renderList();
    showToast(title, body, type);
  }

  // ... keep your existing renderList(), updateBadge(), togglePanel(), showToast(), showAdminAlert() functions ...

  // ─────────────────────────────────────────────
  // SOCKET EVENT HANDLERS — ROLE AWARE
  // ─────────────────────────────────────────────
  function bindSocketEvents(socket) {
    if (!socket) return;

    socket.on('notification', (data) => {
      const { title, body, type, chatId } = data || {};
      addNotification(title || 'Fixa Notice', body || '', type || 'system', chatId);
    });

    socket.on('accountSuspended', (data) => { /* same as before */ });
    socket.on('accountActivated', (data) => { /* same as before */ });
    socket.on('verificationApproved', (data) => { /* same as before */ });
    socket.on('verificationRejected', (data) => { /* same as before */ });
    socket.on('adminAnnouncement', (data) => { /* same as before */ });
    socket.on('chatSealed', (data) => { /* same as before */ });
    socket.on('newMessage', (payload) => { /* same as before */ });

    // ── Role-specific events ──
    if (_role === 'customer') {
      socket.on('jobAccepted', (data) => {
        const { chatId, artisanName, timerDuration } = data || {};
        const mins = Math.floor((timerDuration || 1800) / 60);
        addNotification('Job Accepted! 🎉', 
          `${artisanName || 'Your artisan'} accepted your job. Chat is open for ${mins} minutes.`, 
          'job', chatId);
      });

      socket.on('bookingStatusUpdated', (data) => {
        const { status, artisanName, bookingId } = data || {};
        const msgs = {
          accepted: `Your booking was accepted by ${artisanName || 'your artisan'}.`,
          rejected: 'Your booking was declined.',
          completed: 'Your job has been marked complete. Please confirm and rate your artisan.',
          verifying: 'Job completion is being verified.',
          cancelled: 'Booking was cancelled.'
        };
        const msg = msgs[status] || `Booking status updated: ${status}`;
        addNotification('Booking Update', msg, status === 'completed' ? 'success' : 'job');

        if (status === 'completed' && data.artisanId) {
          setTimeout(() => {
            FixaSystem.openRating({
              bookingId: bookingId || data.bookingId,
              artisanId: data.artisanId,
              artisanName: artisanName || 'Artisan'
            });
          }, 1500);
        }
      });
    } 
    else if (_role === 'artisan') {
      socket.on('newJobRequest', (job) => {
        const customer = job?.customer?.name || job?.customer?.username || 'A customer';
        addNotification('New Job Request 🔨', 
          `${customer} needs your service. Check the Home page!`, 'job');
      });

      socket.on('bookingCompleted', (data) => {   // Customer confirmed completion
        addNotification('Job Completed 🎉', 
          'Customer confirmed the job. Check your earnings!', 'success');
        // You can call loadJobs() here if you expose it globally
        if (typeof window.loadJobs === 'function') window.loadJobs();
      });

      socket.on('bookingStatusUpdated', (data) => {
        const { status, customerName } = data || {};
        if (status === 'cancelled') {
          addNotification('Booking Cancelled', 
            `${customerName || 'Customer'} cancelled the booking.`, 'warning');
        }
      });
    }

    socket.on('disputeAcknowledged', (data) => {
      addNotification('Dispute Received 🚨', 
        'Your report has been received. Our team will review it soon.', 'dispute');
    });
  }

  // Keep your existing dispute and rating functions (they are already role-agnostic enough)

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  const FixaSystem = {
    init(socket, user, token, baseUrl, role = 'customer') {
      _socket = socket;
      _user   = user;
      _token  = token;
      _base   = baseUrl || '';
      _role   = role.toLowerCase();   // ← Important: properly set role

      injectStyles();
      buildDOM();
      bindSocketEvents(socket);
      loadNotificationsFromServer();

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }

      console.log(`✅ FixaSystem initialized for role: ${_role}`);
      return this;
    },

    addNotification,
    showToast,
    clearAll() { /* same as before */ },

    // Dispute
    openDispute,
    closeDispute,
    _submitDispute,

    // Rating (mainly for customers, but you can allow artisans to rate customers later)
    openRating,
    closeRating,
    _selectStar,
    _submitRating,

    showAdminAlert,
    _notifClick,
  };

  global.FixaSystem = FixaSystem;

})(window);