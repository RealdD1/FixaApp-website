// ============================================================
// FIXA — artisan-home.js  (v3 — fully working)
// ============================================================

(function () {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────
  
// after
const BASE_URL        = window.FIXA_CONFIG.API_URL;
  const SOCKET_URL      = BASE_URL;
  const ARTISAN_API_URL = `${BASE_URL}/api/artisans`;
  const JOB_API_URL     = `${BASE_URL}/api/jobs`;
  const MESSAGE_API_URL = `${BASE_URL}/api/messages`;
  const USER_API        = `${BASE_URL}/api/users`;
  const TYPING_TIMEOUT  = 2000;

  // ─── AUTH ──────────────────────────────────────────────────
  const rawUser = localStorage.getItem('user');
  const user    = rawUser ? JSON.parse(rawUser) : null;
  const token   = localStorage.getItem('token');

  if (!user || !token || user.role !== 'artisan') {
    console.warn('Auth missing — redirecting');
    window.location = 'SignIn.html';
    return;
  }
  user._id = user._id || user.id || user.userId || '';
  const artisanDatabaseId = String(user._id);

  // ─── STATE ─────────────────────────────────────────────────
  let socket = null;
  let activeChatId = null;
  let isTyping = false;
  let typingTimer = null;
  let banCountdownInterval = null;
  let peerBanCountdownInterval = null;
  let _isCurrentlyBanned = false;

  // Chat phase state
  let activeBooking = null;
  let activeBookingId = null;
  let activePaymentStatus = 'unknown';
  let activePaymentDeadline = null;
  let activeChatStatus = 'intro';
  let paymentTimerInterval = null;

  // Execution state
  let activeExecutionStatus = 'not_started';
  let locationWatchId = null;

  // Chat list state — keeps per-chat unread counts
  const chatListState = new Map();

  // Voice recorder state
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingMime = '';
  let recordingStart = 0;
  let recordingInterval = null;

  // ─── UTILITIES ─────────────────────────────────────────────
  function authHeaders(json = false) {
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalizeId(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'object') return String(v._id || v.id || '');
    return String(v);
  }

  function formatTimeShort(ts) {
    try {
      const d = new Date(ts || Date.now());
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  function fmtDate(s) {
    if (!s) return 'N/A';
    return new Date(s).toLocaleString('en-NG', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function computeIsMe(m) {
    if (m.outgoing || m.isMine || m.isLocal || m.fromCurrentUser) return true;
    if (m.incoming || m.isIncoming) return false;
    const senderId = normalizeId(m.senderId ?? m.sender ?? m.from ?? '');
    return senderId && senderId === artisanDatabaseId;
  }

  function updatePeerStatus(isOnline, lastSeen) {
    const el = document.getElementById('convStatus');
    if (!el) return;
    if (isOnline) {
      el.innerHTML = '🟢 Online';
      el.style.color = '#22c55e';
    } else if (lastSeen) {
      el.innerHTML = `Last seen ${new Date(lastSeen).toLocaleString()}`;
      el.style.color = '#9aa6b2';
    } else {
      el.innerHTML = '⚫ Offline';
      el.style.color = '#9aa6b2';
    }
  }

  function updateTotalUnreadBadge() {
    let total = 0;
    for (const state of chatListState.values()) total += state.unread || 0;
    [document.getElementById('totalUnreadBadge'), document.getElementById('navUnreadBadge')].forEach(badge => {
      if (!badge) return;
      if (total > 0) {
        badge.style.display = 'flex';
        badge.textContent = total > 99 ? '99+' : total;
      } else {
        badge.style.display = 'none';
      }
    });
  }

  // ─── STATUS TOAST ─────────────────────────────────────────
  let _statusTimeout = null, _hideTimeout = null;
  function showStatusMessage(message, type = 'success') {
    const box = document.getElementById('status-message-box');
    if (!box) { console.log(`[${type}] ${message}`); return; }
    if (_statusTimeout) clearTimeout(_statusTimeout);
    if (_hideTimeout) clearTimeout(_hideTimeout);

    const isError = type === 'error' || type === 'warning';
    const icon = isError ? '⚠️' : '✔️';
    const bg = isError ? '#dc2626' : '#16a34a';
    box.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:22px">${icon}</span>
        <div style="text-align:left;flex:1">
          <p style="font-weight:700;color:white;margin:0">${isError ? 'Error' : 'Success'}</p>
          <p style="color:white;font-size:14px;margin-top:4px">${escapeHtml(message)}</p>
        </div>
        <button id="close-status" type="button" style="background:none;border:none;color:white;font-weight:700;cursor:pointer;font-size:20px">×</button>
      </div>`;
    box.style.background = bg;
    box.style.opacity = '1';
    box.classList.remove('hidden');

    const closeBtn = document.getElementById('close-status');
    if (closeBtn) closeBtn.onclick = hideNow;
    _statusTimeout = setTimeout(hideNow, 4000);
    function hideNow() {
      box.style.opacity = '0';
      _hideTimeout = setTimeout(() => box.classList.add('hidden'), 400);
    }
  }
  window.showStatusMessage = showStatusMessage;

  // ═══════════════════════════════════════════════════════════
  // SOCKET
  // ═══════════════════════════════════════════════════════════
  function initSocket() {
    try {
      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
      window.socket = socket;

      socket.on('connect', () => {
        console.log('[Socket] connected', socket.id);
        if (artisanDatabaseId) socket.emit('register', artisanDatabaseId);
        if (activeChatId) socket.emit('joinChat', String(activeChatId));
      });

      socket.on('connect_error', err => console.warn('[Socket] connect_error:', err.message));
      socket.on('disconnect', () => console.log('[Socket] disconnected'));

      socket.on('newJobRequest', (job) => {
        try { new Audio('/sounds/new-job.mp3').play().catch(()=>{}); } catch {}
        renderNewJobCard(job);
        fetchDashboardSummary();
      });

      socket.on('peerBanned', (data) => {
        if (String(data.peerUserId) === String(window._activeChatPeerId)) {
          showPeerBanBanner(data);
          showStatusMessage('Customer has been restricted', 'warning');
        }
      });

      socket.on('peerUnbanned', (data) => {
        if (String(data.peerUserId) === String(window._activeChatPeerId)) {
          hidePeerBanBanner();
          showStatusMessage('Customer can message again', 'success');
        }
      });

      socket.on('chatUpgraded', async ({ chatId }) => {
        if (String(activeChatId) !== String(chatId)) return;
        await loadArtisanChatPhase(activeChatId);
      });

      socket.on('paymentEscrowed', async ({ bookingId }) => {
        if (String(activeBookingId) === String(bookingId)) {
          activePaymentStatus = 'paid';
          applyArtisanChatStateToUI();
          showStatusMessage('Customer paid! Funds are now in escrow.', 'success');
        }
      });

      socket.on('bookingCancelled', async ({ bookingId, reason }) => {
        if (String(activeBookingId) === String(bookingId)) {
          activeBooking = null;
          activeBookingId = null;
          activePaymentStatus = 'unknown';
          activePaymentDeadline = null;
          activeChatStatus = 'intro';
          applyArtisanChatStateToUI();
          showStatusMessage(reason || 'Booking cancelled', 'warning');
        }
      });

      socket.on('jobAccepted', async ({ chatId }) => {
        if (String(activeChatId) === String(chatId)) {
          await loadArtisanChatPhase(activeChatId);
        }
      });

      socket.on('bookingStatusUpdated', (data) => {
        const card = document.querySelector(`[data-job-id="${data.jobId || data.bookingId}"]`);
        if (card) {
          const actions = card.querySelector('.job-actions');
          if (actions) actions.innerHTML = `<em>Job ${String(data.status).toUpperCase()}</em>`;
          card.style.opacity = '0.6';
          setTimeout(fetchArtisanJobs, 500);
        }
        fetchDashboardSummary();
      });

      socket.on('newMessage', handleIncomingSocketMessage);

      socket.on('typing', ({ chatId }) => {
        if (String(activeChatId) === String(chatId)) {
          const el = document.getElementById('typingIndicator');
          if (el) el.textContent = 'Customer is typing...';
        }
      });

      socket.on('stopTyping', ({ chatId }) => {
        if (String(activeChatId) === String(chatId)) {
          const el = document.getElementById('typingIndicator');
          if (el) el.textContent = '';
        }
      });
  socket.on('messagesRead', ({ chatId }) => {
  if (String(activeChatId) !== String(chatId)) return;
  document.querySelectorAll('.msg-row.sent .bubble-meta').forEach(el => {
    if (el.dataset.seen === 'true') return; // already marked, skip
    el.dataset.seen = 'true';
    el.textContent = el.textContent.replace(/\s*[·✓]*$/, '') + ' ✓✓';
  });
});

      socket.on('userOnline', ({ userId }) => {
        if (window._activeChatPeerId && String(userId) === String(window._activeChatPeerId)) {
          updatePeerStatus(true);
        }
      });

      socket.on('userOffline', ({ userId }) => {
        if (window._activeChatPeerId && String(userId) === String(window._activeChatPeerId)) {
          updatePeerStatus(false, new Date());
        }
      });

      socket.on('accountSuspended', (data) => {
        _isCurrentlyBanned = true;
        showBanOverlay(data);
      });

      socket.on('accountActivated', () => {
        _isCurrentlyBanned = false;
        hideBanOverlay();
        showStatusMessage('Your account has been reactivated', 'success');
      });
      //Top up pay
      socket.on('topUpRejected', ({ bookingId, topUpId }) => {
  if (String(activeBookingId) === String(bookingId)) {
    showStatusMessage('Customer declined the top-up request', 'warning');
  }
  // Re-enable the button so they can try again or move on
  applyExecutionPanelState();
});

socket.on('topUpPaid', ({ bookingId, amount }) => {
  if (String(activeBookingId) === String(bookingId)) {
    showStatusMessage(`Top-up approved! ₦${amount?.toLocaleString() || ''} added to escrow`, 'success');
  }
  applyExecutionPanelState();
  loadPayoutDashboard();
});

      // Dispute events
      socket.on('disputeOpened', () => {
        if (window.FixaSystem) {
          window.FixaSystem.addNotification(
            '⚠️ Dispute Filed',
            'The customer has opened a dispute on a booking. Funds are frozen until Fixa reviews.',
            'dispute'
          );
        }
        showStatusMessage('A dispute has been filed on a booking', 'warning');
      });

      socket.on('disputeResolved', () => {
        if (window.FixaSystem) {
          window.FixaSystem.addNotification(
            '✅ Dispute Resolved',
            'A dispute has been reviewed and resolved.',
            'dispute'
          );
        }
      });

      socket.on('disputeAcknowledged', () => {
        if (window.FixaSystem) {
          window.FixaSystem.addNotification(
            '📋 Dispute Received',
            'Your dispute has been received. The Fixa team will review within 24 hours.',
            'dispute'
          );
        }
      });

    } catch (e) {
      console.error('[Socket] init failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE / PAYMENT TIMER
  // ═══════════════════════════════════════════════════════════
  function getArtisanChatPhase() {
    if (!activeBookingId) return 'intro';
    if (activePaymentStatus === 'paid' || activePaymentStatus === 'escrowed') return 'secured';
    if (activePaymentStatus === 'unpaid' && activePaymentDeadline && new Date(activePaymentDeadline) > new Date()) {
      return 'booked';
    }
    return 'intro';
  }

  function clearArtisanPaymentTimer() {
    if (paymentTimerInterval) {
      clearInterval(paymentTimerInterval);
      paymentTimerInterval = null;
    }
    const banner = document.getElementById('artisanPaymentBanner');
    if (banner) banner.style.display = 'none';
  }

  function startArtisanPaymentTimer(deadlineISO) {
    if (!deadlineISO) return;
    const deadline = new Date(deadlineISO);
    const banner = document.getElementById('artisanPaymentBanner');
    const display = document.getElementById('artisanTimerDisplay');
    if (!banner || !display) return;

    banner.style.display = 'flex';

    function tick() {
      const remaining = Math.max(0, deadline - new Date());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      display.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      display.style.color = remaining <= 300000 ? '#ff3b5c' : '#ffc107';
      if (remaining <= 0) {
        clearInterval(paymentTimerInterval);
        paymentTimerInterval = null;
      }
    }
    tick();
    paymentTimerInterval = setInterval(tick, 1000);
  }
  async function loadPayoutDashboard() {//load payout dash board
  try {
    const res = await fetch(`${BASE_URL}/api/payouts/dashboard`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    const balEl = document.getElementById('walletBalanceDisplay');
    if (balEl) balEl.textContent = `₦${Number(data.walletBalance || 0).toLocaleString()}`;

    const lastEl = document.getElementById('lastPayoutDisplay');
    if (lastEl) {
      lastEl.textContent = data.lastPayoutAt
        ? `Last payout: ${new Date(data.lastPayoutAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : 'No payouts yet';
    }

    const methodEl = document.getElementById('payoutMethodDisplay');
    if (methodEl) {
      methodEl.textContent = data.payoutSummary
        ? `Paid ${data.payoutSummary.frequency} to ${data.payoutSummary.bankName} •••• ${data.payoutSummary.last4}`
        : 'No payout method set up — visit Payout Settings';
    }
  } catch (e) {
    console.error('loadPayoutDashboard:', e);
  }
}

document.getElementById('viewPayoutHistoryBtn')?.addEventListener('click', () => {
  window.location.href = 'payout-history.html';
});

  function applyArtisanChatStateToUI() {
    const phase = getArtisanChatPhase();
    const securedBanner = document.getElementById('artisanSecuredBanner');
    const disputeBtn = document.getElementById('artisanDisputeBtn');

    clearArtisanPaymentTimer();
    if (securedBanner) securedBanner.style.display = 'none';

    if (phase === 'booked' && activePaymentDeadline) {
      startArtisanPaymentTimer(activePaymentDeadline);
    } else if (phase === 'secured') {
      if (securedBanner) securedBanner.style.display = 'flex';
    }

    if (disputeBtn) {
      const canDispute = activeBookingId && (phase === 'secured' || activeChatStatus === 'completed');
      disputeBtn.style.display = canDispute ? 'inline-block' : 'none';
    }

    applyExecutionPanelState();
  }

  async function loadArtisanChatPhase(chatId) {
    if (!chatId) return;
    try {
      const chatRes = await fetch(`${BASE_URL}/api/chats/${chatId}`, { headers: authHeaders() });
      if (chatRes.ok) {
        const chat = await chatRes.json();
        activeBooking = chat?.booking || null;
        activeBookingId = activeBooking?._id || (typeof activeBooking === 'string' ? activeBooking : null);
        activeChatStatus = chat?.status || 'intro';
        activePaymentDeadline = activeBooking?.paymentDeadline || null;
        if (activeBooking?.executionStatus) {
          activeExecutionStatus = activeBooking.executionStatus;
        }
      }

      if (activeBookingId) {
        const statusRes = await fetch(`${BASE_URL}/api/payments/status`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ chatId })
        });
        if (statusRes.ok) {
          const s = await statusRes.json();
          activePaymentStatus = s.paid ? 'paid' : 'unpaid';
        }
      } else {
        activePaymentStatus = 'unknown';
      }
    } catch (err) {
      console.warn('[loadArtisanChatPhase]', err);
    }

    applyArtisanChatStateToUI();
  }

  // ═══════════════════════════════════════════════════════════
  // BAN OVERLAY
  // ═══════════════════════════════════════════════════════════
  function showBanOverlay(data) {
    const overlay = document.getElementById('banOverlay');
    if (!overlay) return;

    const isChatOnly = data?.banType === 'chat' || (data?.chatBanned && !data?.isSuspended);
    document.getElementById('banTitle').textContent = isChatOnly
      ? '⚠️ Messaging Temporarily Restricted'
      : '🚫 Account Suspended';
    document.getElementById('banReason').textContent = data?.reason ||
      (isChatOnly
        ? 'You have been temporarily restricted from messaging due to policy violations.'
        : 'Your account has been suspended by Fixa administration.');

    overlay.style.display = 'flex';

    const chatFooter = document.getElementById('chatFooter');
    if (chatFooter) chatFooter.style.display = 'none';

    const card = document.getElementById('banCountdownCard');
    if (data?.banExpiresAt && card) {
      card.style.display = 'block';
      startBanCountdown(new Date(data.banExpiresAt));
    } else if (card) {
      card.style.display = 'none';
    }

    const logoutBtn = document.getElementById('banLogoutBtn');
    if (logoutBtn) {
      if (isChatOnly) {
        logoutBtn.textContent = 'Continue browsing Fixa';
        logoutBtn.style.background = 'rgba(255,215,0,0.15)';
        logoutBtn.style.color = '#ffd700';
        logoutBtn.style.borderColor = 'rgba(255,215,0,0.3)';
        logoutBtn.onclick = () => { overlay.style.display = 'none'; };
      } else {
        logoutBtn.textContent = 'Log out';
        logoutBtn.style.background = 'rgba(255,59,92,0.15)';
        logoutBtn.style.color = '#ff3b5c';
        logoutBtn.style.borderColor = 'rgba(255,59,92,0.3)';
        logoutBtn.onclick = () => {
          localStorage.clear();
          window.location.href = 'SignIn.html';
        };
      }
    }
  }

  function hideBanOverlay() {
    const overlay = document.getElementById('banOverlay');
    if (overlay) overlay.style.display = 'none';
    if (banCountdownInterval) {
      clearInterval(banCountdownInterval);
      banCountdownInterval = null;
    }
    const chatFooter = document.getElementById('chatFooter');
    if (chatFooter && activeChatId) chatFooter.style.display = 'flex';
  }

  function startBanCountdown(unbanDate) {
    if (banCountdownInterval) clearInterval(banCountdownInterval);
    function tick() {
      const diff = unbanDate - new Date();
      if (diff <= 0) {
        clearInterval(banCountdownInterval);
        banCountdownInterval = null;
        ['banDays','banHours','banMins','banSecs'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = '00';
        });
        checkBanStatusOnLoad();
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('banDays', String(d).padStart(2,'0'));
      set('banHours', String(h).padStart(2,'0'));
      set('banMins', String(m).padStart(2,'0'));
      set('banSecs', String(s).padStart(2,'0'));
    }
    tick();
    banCountdownInterval = setInterval(tick, 1000);
  }

  async function checkBanStatusOnLoad() {
    try {
      const res = await fetch(`${BASE_URL}/api/users/me/status`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      _isCurrentlyBanned = !!(data.isSuspended || data.chatBanned);
      if (_isCurrentlyBanned) {
        showBanOverlay({
          reason: data.reason,
          banExpiresAt: data.banExpiresAt,
          banType: data.isSuspended ? 'full' : 'chat',
          chatBanned: data.chatBanned,
          isSuspended: data.isSuspended
        });
      } else {
        hideBanOverlay();
      }
    } catch (e) {
      console.warn('[Ban check]', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PEER BAN BANNER
  // ═══════════════════════════════════════════════════════════
  function showPeerBanBanner(data) {
    const banner = document.getElementById('peerBanBanner');
    if (!banner) return;

    const isFullSuspension = data.isSuspended;
    document.getElementById('peerBanTitle').textContent = isFullSuspension
      ? '🚫 Customer account suspended'
      : '⚠️ Customer messaging restricted';
    document.getElementById('peerBanReason').textContent = data.reason ||
      (isFullSuspension
        ? 'This customer has been suspended. The booking will be reviewed by Fixa.'
        : 'This customer has been temporarily restricted from messaging.');

    banner.style.display = 'block';

    if (data.banExpiresAt) {
      startPeerBanCountdown(new Date(data.banExpiresAt));
    } else {
      document.getElementById('peerBanCountdown').innerHTML =
        '<span style="font-size:11px;color:#ef4444;font-weight:600">Indefinite ban</span>';
    }
  }

  function hidePeerBanBanner() {
    const banner = document.getElementById('peerBanBanner');
    if (banner) banner.style.display = 'none';
    if (peerBanCountdownInterval) {
      clearInterval(peerBanCountdownInterval);
      peerBanCountdownInterval = null;
    }
  }

  function startPeerBanCountdown(unbanDate) {
    const container = document.getElementById('peerBanCountdown');
    if (!container) return;
    if (peerBanCountdownInterval) clearInterval(peerBanCountdownInterval);

    function tick() {
      const diff = unbanDate - new Date();
      if (diff <= 0) {
        clearInterval(peerBanCountdownInterval);
        peerBanCountdownInterval = null;
        container.innerHTML = '<span style="font-size:11px;color:#22c55e;font-weight:600">Ban expired ✓</span>';
        setTimeout(() => hidePeerBanBanner(), 5000);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      container.innerHTML = `
        <span style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Unbans in:</span>
        <span style="font-size:12px;color:#ef4444;font-weight:700;font-family:monospace">${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s</span>
      `;
    }
    tick();
    peerBanCountdownInterval = setInterval(tick, 1000);
  }

  // ═══════════════════════════════════════════════════════════
  // PROFILE / DASHBOARD / JOBS
  // ═══════════════════════════════════════════════════════════
  async function loadArtisanProfile() {
    try {
      const res = await fetch(`${ARTISAN_API_URL}/me`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      document.querySelectorAll('.usernameDisplay').forEach(el =>
        el.textContent = data.name || user.username || 'Artisan');
      const e = document.getElementById('emailDisplay');
      if (e) e.textContent = data.email || user.email || '';
      const p = document.getElementById('phoneDisplay');
      if (p) p.textContent = data.phone || user.phone || '';
      const img = document.querySelector('.profile-img');
      if (img) img.src = data.profilePic || data.avatar || 'https://via.placeholder.com/80';
    } catch (e) { console.error('loadArtisanProfile:', e); }
  }

  async function fetchDashboardSummary() {
    try {
      const res = await fetch(`${ARTISAN_API_URL}/dashboard-summary`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const items = document.querySelectorAll('.summary-item strong');
      if (items[0]) items[0].textContent = data.activeJobsCount || 0;
      if (items[1]) items[1].textContent = data.newRequestsCount || 0;
      if (items[2]) items[2].textContent = `₦${(data.totalEarnings || 0).toLocaleString()}`;
    } catch (e) { console.error('fetchDashboardSummary:', e); }
  }

  async function fetchArtisanJobs() {
    const container = document.querySelector('.job-requests-container');
    if (!container) return;
    try {
      const res = await fetch(`${JOB_API_URL}/pending`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      container.innerHTML = '';
      if (!jobs.length) {
        container.innerHTML = '<p class="no-requests">No new requests.</p>';
        return;
      }
      jobs.slice().reverse().forEach(renderNewJobCard);
    } catch (e) {
      console.error('fetchArtisanJobs:', e);
      container.innerHTML = '<p class="no-requests">Error loading requests.</p>';
    }
  }

  function renderNewJobCard(job) {
    if (!job || !job._id) return;
    const container = document.querySelector('.job-requests-container');
    if (!container) return;
    container.querySelector('.no-requests')?.remove();
    if (container.querySelector(`[data-job-id="${job._id}"]`)) return;

    const coords = job.location?.coordinates || [];
    const lat = coords[1], lng = coords[0];
    const category = job.serviceCategory?.name || job.category || 'N/A';
    const customer = job.customer?.name || job.customer?.username || 'Customer';

    const card = document.createElement('div');
    card.className = 'job-card new-job-request';
    card.dataset.jobId = job._id;
    card.innerHTML = `
      <div class="job-header">
        <h3>New Job Request</h3>
        <span class="timestamp">${escapeHtml(fmtDate(job.createdAt))}</span>
      </div>
      <p><strong>Customer:</strong> ${escapeHtml(customer)}</p>
      <p><strong>Location:</strong> ${escapeHtml(job.address || 'N/A')}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      <p><strong>Description:</strong> ${escapeHtml(job.description || 'No description')}</p>
      <p><strong>Budget:</strong> ₦${Number(job.budget || job.price || 0).toLocaleString()}</p>
      <div class="job-actions">
        <button type="button" class="accept-btn">Accept</button>
        <button type="button" class="decline-btn">Reject</button>
        ${(lat && lng) ? `<button type="button" class="map-view-btn" data-lat="${lat}" data-lng="${lng}">View on Map</button>` : ''}
      </div>`;
    container.prepend(card);

    card.querySelector('.accept-btn').addEventListener('click', () => handleJobAction(job._id, 'accepted', card));
    card.querySelector('.decline-btn').addEventListener('click', () => handleJobAction(job._id, 'rejected', card));
    const mapBtn = card.querySelector('.map-view-btn');
    if (mapBtn) {
      mapBtn.addEventListener('click', () =>
        window.open(`https://www.google.com/maps/search/?api=1&query=${mapBtn.dataset.lat},${mapBtn.dataset.lng}`, '_blank'));
    }
  }

  async function handleJobAction(jobId, action, card) {
    if (card) card.querySelector('.job-actions').innerHTML = `<em style="color:#ffc107">Processing ${action}...</em>`;
    try {
      const res = await fetch(`${JOB_API_URL}/${encodeURIComponent(jobId)}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status: action })
      });
      if (!res.ok) {
        const txt = await res.text();
        let msg = `Server ${res.status}`;
        try { msg = JSON.parse(txt).message || msg; } catch {}
        throw new Error(msg);
      }
      const data = await res.json().catch(() => ({}));

      showStatusMessage(`Job ${action.toUpperCase()}`, 'success');
      if (card) {
        card.querySelector('.job-actions').innerHTML = `<span style="color:#38b45d;font-weight:700">Status: ${action.toUpperCase()}</span>`;
        card.style.opacity = '0.7';
      }
      fetchArtisanJobs();
      fetchDashboardSummary();

      if (action === 'accepted' && data.chatId) {
        showPage('jobsPage', document.querySelectorAll('.nav-btn')[1]);
        setTimeout(() => {
          openChat(data.chatId, data.customerName || 'Customer');
        }, 400);
      }
    } catch (e) {
      console.error('handleJobAction:', e);
      showStatusMessage(`Could not update job: ${e.message}`, 'error');
      if (card) card.querySelector('.job-actions').innerHTML = `<span style="color:#ef4444;font-weight:700">Failed — Retry</span>`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EXECUTION PANEL
  // ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// TOP-UP ELIGIBILITY
// ═══════════════════════════════════════════════════════════
function isTopUpEligible() {
  if (!activeBookingId || !activeBooking) return false;
  const status = String(activeBooking.status || '').toLowerCase();
  const allowedStatuses = ['pending', 'accepted', 'in_progress', 'in-progress'];
  if (!allowedStatuses.includes(status)) return false;
  return true; // visible pre-payment (price proposal) AND post-escrow (top-up)
}


function applyExecutionPanelState() {
  const panel = document.getElementById('executionPanel');
  if (!panel) return;

  const phase = getArtisanChatPhase();
  if (phase !== 'secured') {
    panel.style.display = 'none';
    stopLocationTracking();
  } else {
    panel.style.display = 'block';

    const map = {
      'not_started': ['execOnTheWay'],
      'on_the_way': ['execStarted'],
      'started': ['execCompleted'],
      'completed': []
    };
    const enabled = map[activeExecutionStatus] || [];
    ['execOnTheWay', 'execStarted', 'execCompleted'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const isEnabled = enabled.includes(id);
      btn.disabled = !isEnabled;
      btn.style.opacity = isEnabled ? '1' : '0.4';
      btn.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
    });
  }

  // Only toggle visibility + label here. Nothing else.
  const topUpBtn = document.getElementById('topUpRequestBtn');
  if (topUpBtn) {
    topUpBtn.style.display = isTopUpEligible() ? 'block' : 'none';
    topUpBtn.textContent = phase === 'secured'
      ? '💰 Request Top-Up'
      : '💬 Propose New Price';
  }
}
  async function updateExecutionStatus(newStatus) {
    if (!activeBookingId) {
      showStatusMessage('No active booking', 'warning');
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/bookings/${activeBookingId}/execution-status`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed');
      }
      activeExecutionStatus = newStatus;
      showStatusMessage(`Status updated: ${newStatus.replace(/_/g, ' ')}`, 'success');

      if (newStatus === 'on_the_way') startLocationTracking();
      else if (newStatus === 'started' || newStatus === 'completed') stopLocationTracking();

      applyExecutionPanelState();
    } catch (err) {
      showStatusMessage(`Could not update: ${err.message}`, 'error');
    }
  }

  function startLocationTracking() {
    if (!navigator.geolocation || locationWatchId !== null) return;
    let lastEmit = 0;
    locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastEmit < 10000) return;
        lastEmit = now;
        if (socket?.connected && activeBookingId) {
          socket.emit('artisan:location', {
            bookingId: activeBookingId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
        }
      },
      (err) => console.warn('Geolocation:', err.message),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  function stopLocationTracking() {
    if (locationWatchId !== null) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
    }
  }

  async function uploadProofPhoto(file) {
    if (!file || !activeBookingId) return;
    const type = document.getElementById('proofPhotoType')?.value || 'during';
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('type', type);

    try {
      showStatusMessage('Uploading proof photo...', 'success');
      const res = await fetch(`${BASE_URL}/api/bookings/${activeBookingId}/proof-photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Upload failed');
      }
      showStatusMessage('Photo uploaded ✓', 'success');
    } catch (err) {
      showStatusMessage(`Upload failed: ${err.message}`, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CHAT LIST
  // ═══════════════════════════════════════════════════════════
  async function loadArtisanChats() {
    const container = document.querySelector('.chat-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#9aa6b2;padding:20px">Loading conversations...</p>';
    try {
      const res = await fetch(`${MESSAGE_API_URL}/artisan-chats`, { headers: authHeaders() });
      if (!res.ok) {
        container.innerHTML = '<p style="text-align:center;color:#9aa6b2;padding:20px">No chats</p>';
        return;
      }
      const chats = await res.json();
      renderChatList(chats || []);
    } catch (e) {
      console.error('loadArtisanChats:', e);
      container.innerHTML = '<p style="color:#ef4444;text-align:center;padding:20px">Failed to load chats</p>';
    }
  }

  function renderChatList(chats) {
    const container = document.querySelector('.chat-list');
    if (!container) return;
    container.innerHTML = '';
    chatListState.clear();

    if (!Array.isArray(chats) || !chats.length) {
      container.innerHTML = '<p style="padding:30px 20px;text-align:center;color:#9aa6b2">No conversations yet.</p>';
      updateTotalUnreadBadge();
      return;
    }

    chats.forEach(chat => {
      const other = (chat.participants || []).find(p => normalizeId(p) !== artisanDatabaseId) || {};
      const name = other.username || other.name || 'Customer';
      const lastMessage = chat.latestMessage ||
        (chat.messages?.length ? chat.messages[chat.messages.length - 1] : null);
      const lastText = lastMessage ? (lastMessage.text || lastMessage.content || 'Media') : 'Say hi';
      const lastTime = lastMessage ? formatTimeShort(lastMessage.createdAt) : '';
      const unread = chat.unreadCount || 0;
      const chatId = chat._id || chat.id || chat.chatId;

      chatListState.set(String(chatId), { name, lastText, lastTime, unread });

      const el = createChatItem(chatId, name, lastText, lastTime, unread);
      container.appendChild(el);
    });

    updateTotalUnreadBadge();
  }

  function createChatItem(chatId, name, lastText, lastTime, unread) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (unread > 0 ? ' has-unread' : '');
    el.dataset.chatId = chatId;

    el.innerHTML = `
      <div style="width:46px;height:46px;border-radius:50%;background:#2a4a6b;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px">
        ${escapeHtml((name[0] || '?').toUpperCase())}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div class="chat-item-name" style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#fff">${escapeHtml(name)}</div>
          <div style="font-size:11px;color:#9aa6b2;flex-shrink:0">${escapeHtml(lastTime)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;gap:8px">
          <div class="chat-preview-text" style="font-size:12.5px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escapeHtml(lastText)}</div>
          ${unread ? `<span class="unread-badge" style="background:#ffd700;color:#000;font-weight:800;border-radius:999px;padding:2px 8px;font-size:11px;flex-shrink:0">${unread}</span>` : ''}
        </div>
      </div>
    `;

    el.addEventListener('click', () => {
      document.querySelectorAll('.chat-item.active').forEach(item => item.classList.remove('active'));
      el.classList.add('active');

      const state = chatListState.get(String(chatId));
      if (state) state.unread = 0;
      el.classList.remove('has-unread');
      el.querySelector('.unread-badge')?.remove();
      updateTotalUnreadBadge();
      openChat(chatId, name);
    });

    return el;
  }

  function updateChatPreview(chatId, message, unreadCount) {
    let item = document.querySelector(`[data-chat-id="${chatId}"]`);
    const state = chatListState.get(String(chatId)) || { name: 'Customer', unread: 0 };

    state.lastText = message.text || 'Media';
    state.lastTime = formatTimeShort(message.createdAt || Date.now());
    state.unread = unreadCount != null ? unreadCount : (state.unread + 1);
    chatListState.set(String(chatId), state);

    if (!item) {
      loadArtisanChats();
      return;
    }

    const preview = item.querySelector('.chat-preview-text');
    if (preview) preview.textContent = state.lastText;

    let badge = item.querySelector('.unread-badge');
    if (state.unread > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'unread-badge';
        badge.style.cssText = 'background:#ffd700;color:#000;font-weight:800;border-radius:999px;padding:2px 8px;font-size:11px;flex-shrink:0';
        const row = item.querySelector('div[style*="margin-top:4px"]');
        if (row) row.appendChild(badge);
      }
      badge.textContent = state.unread;
      item.classList.add('has-unread');
    } else if (badge) {
      badge.remove();
      item.classList.remove('has-unread');
    }

    const list = document.querySelector('.chat-list');
    if (list) list.prepend(item);

    updateTotalUnreadBadge();
  }

  // ═══════════════════════════════════════════════════════════
  // OPEN CHAT — properly updates header with name & avatar
  // ═══════════════════════════════════════════════════════════
  async function openChat(chatId, peerName) {
    activeChatId = chatId;
    if (socket?.connected) socket.emit('joinChat', String(chatId));

    // Show chat UI elements
    document.getElementById('chatHeaderRow').style.display = 'flex';
    document.getElementById('chatEmptyState').style.display = 'none';
    document.getElementById('messages').style.display = 'flex';
    document.getElementById('chatFooter').style.display = _isCurrentlyBanned ? 'none' : 'flex';

    // ✅ UPDATE THE HEADER (name + initial avatar)
    const nameEl = document.getElementById('chatRecipientName');
    const avatarEl = document.getElementById('chatAvatarHeader');
    if (nameEl) nameEl.textContent = peerName || 'Customer';
    if (avatarEl) avatarEl.textContent = (peerName || '?')[0].toUpperCase();

    // Collapse chat list on mobile
    if (window.innerWidth <= 768) {
      document.getElementById('chatListView').classList.add('collapsed');
    }

    const container = document.getElementById('messages');
    if (container) container.innerHTML = '<p style="text-align:center;padding:20px;color:#9aa6b2">Loading messages...</p>';

    // Fetch chat metadata for peer info
    try {
      const chatRes = await fetch(`${BASE_URL}/api/chats/${chatId}`, { headers: authHeaders() });
      if (chatRes.ok) {
        const chat = await chatRes.json();
        const peer = (chat.participants || []).find(p => normalizeId(p) !== artisanDatabaseId);
        window._activeChatPeerId = peer?._id || null;
        updatePeerStatus(peer?.isOnline, peer?.lastSeen);

        // Refresh name/avatar with actual data from server
        if (peer?.username || peer?.name) {
          const realName = peer.username || peer.name;
          if (nameEl) nameEl.textContent = realName;
          if (avatarEl) avatarEl.textContent = realName[0].toUpperCase();
        }

        if (peer?.isSuspended || peer?.chatBanned) {
          showPeerBanBanner({
            isSuspended: peer.isSuspended,
            chatBanned: peer.chatBanned,
            banExpiresAt: peer.banExpiresAt,
            reason: peer.banReason
          });
        } else {
          hidePeerBanBanner();
        }
      }
    } catch (e) {
      console.warn('openChat metadata:', e);
    }

    await loadArtisanChatPhase(chatId);

    try {
      const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(chatId)}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const messages = await res.json();
      if (container) container.innerHTML = '';
      (Array.isArray(messages) ? messages : []).forEach(appendMessage);
    } catch (e) {
      console.error('openChat messages:', e);
      if (container) container.innerHTML = '<p style="text-align:center;color:#ef4444;padding:20px">Could not load messages</p>';
    }

    if (window.ChatGuard) await window.ChatGuard.onChatOpen(chatId);
  }
  window.openChat = openChat;

  function closeChat() {
    if (activeChatId && socket?.connected) socket.emit('leaveChat', String(activeChatId));
    activeChatId = null;
    activeBookingId = null;
    activePaymentStatus = 'unknown';
    activePaymentDeadline = null;
    activeChatStatus = 'intro';
    clearArtisanPaymentTimer();
    hidePeerBanBanner();

    document.querySelectorAll('.chat-item.active').forEach(item => item.classList.remove('active'));
    document.getElementById('chatHeaderRow').style.display = 'none';
    document.getElementById('messages').style.display = 'none';
    document.getElementById('chatFooter').style.display = 'none';
    document.getElementById('chatEmptyState').style.display = 'flex';

    document.getElementById('chatListView').classList.remove('collapsed');
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER MESSAGE
  // ═══════════════════════════════════════════════════════════
  function appendMessage(m) {
    if (!m) return;
    const container = document.getElementById('messages');
    if (!container) return;

    const msgId = m._id || m.id;
    if (msgId && container.querySelector(`[data-msg-id="${msgId}"]`)) return;

    const isMe = computeIsMe(m);
    const wrapper = document.createElement('div');
    wrapper.dataset.msgId = msgId || `temp-${Date.now()}`;
    wrapper.style.cssText = `display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};margin-bottom:12px;padding:0 10px`;

    const bubble = document.createElement('div');
    bubble.style.cssText = `max-width:75%;padding:8px 12px;border-radius:${isMe ? '18px 18px 2px 18px' : '18px 18px 18px 2px'};background:${isMe ? '#ffd700' : '#4468a3'};color:${isMe ? '#000' : '#fff'};box-shadow:0 2px 5px rgba(0,0,0,0.1);display:flex;flex-direction:column;gap:8px`;

    if (m.image || (m.mediaUrl && !String(m.mediaUrl).match(/\.(webm|mp3|wav|ogg)$/i))) {
      const src = m.image || m.mediaUrl;
      const fullSrc = String(src).startsWith('blob:') || String(src).startsWith('http')
        ? src : `${BASE_URL}${String(src).startsWith('/') ? '' : '/'}${src}`;
      const img = document.createElement('img');
      img.src = fullSrc;
      img.style.cssText = 'max-width:250px;border-radius:10px;display:block;cursor:pointer';
      img.addEventListener('click', () => window.open(fullSrc, '_blank'));
      bubble.appendChild(img);
    }

    if (m.voiceNote || (m.mediaUrl && String(m.mediaUrl).match(/\.(webm|mp3|wav|ogg)$/i))) {
      const src = m.voiceNote || m.mediaUrl;
      const fullSrc = String(src).startsWith('blob:') || String(src).startsWith('http')
        ? src : `${BASE_URL}${String(src).startsWith('/') ? '' : '/'}${src}`;
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = fullSrc;
      audio.preload = 'metadata';
      audio.style.cssText = 'height:35px;max-width:220px';
      bubble.appendChild(audio);
    }

    if (m.text && m.text !== 'Voice note' && m.text !== 'Image') {
      const t = document.createElement('div');
      t.textContent = m.text;
      t.style.cssText = 'font-size:14.5px;line-height:1.4;word-break:break-word';
      bubble.appendChild(t);
    }

    wrapper.appendChild(bubble);
    container.appendChild(wrapper);
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }

  function replaceOptimisticMessage(localId, realMsg) {
    document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
    appendMessage(realMsg);
  }

  function handleIncomingSocketMessage(payload) {
    if (!payload) return;
    const { chatId, message, unreadCount } = payload;
    if (!chatId || !message) return;

    if (String(activeChatId) === String(chatId)) {
      appendMessage(message);
    } else {
      updateChatPreview(chatId, message, unreadCount);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEND TEXT
  // ═══════════════════════════════════════════════════════════
  async function sendTextMessage() {
    if (_isCurrentlyBanned) {
      if (window.FixaSystem) FixaSystem.showToast('Cannot send', 'Your messaging is currently restricted', 'warning');
      return;
    }
    const input = document.getElementById('text');
    if (!input) return;
    if (!activeChatId) { showStatusMessage('Select a chat first', 'warning'); return; }

    const text = input.value.trim();
    if (!text) return;

    if (window.ChatGuard) {
      const check = await window.ChatGuard.checkText(text);
      if (check.blocked) {
        window.ChatGuard.showBlockedToast(check.reason);
        return;
      }
    }

    input.value = '';
    const localId = `temp-text-${Date.now()}`;
    appendMessage({
      _id: localId, text,
      sender: artisanDatabaseId,
      createdAt: new Date().toISOString(),
      isLocal: true
    });

    try {
      const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.code === 'CHAT_BANNED' || err.code === 'ACCOUNT_SUSPENDED') {
          _isCurrentlyBanned = true;
          showBanOverlay({
            banType: err.code === 'ACCOUNT_SUSPENDED' ? 'full' : 'chat',
            chatBanned: err.code === 'CHAT_BANNED',
            isSuspended: err.code === 'ACCOUNT_SUSPENDED',
            banExpiresAt: err.banExpiresAt,
            reason: err.reason
          });
          document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
          return;
        }
        throw new Error(err.message || 'Failed');
      }

      const data = await res.json();
      const realMsg = data.message || data;
      replaceOptimisticMessage(localId, realMsg);
    } catch (err) {
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      showStatusMessage('Failed to send', 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SEND MEDIA
  // ═══════════════════════════════════════════════════════════
  async function sendMedia(file, isVoice = false) {
    if (_isCurrentlyBanned) {
      if (window.FixaSystem) FixaSystem.showToast('Cannot send', 'Your messaging is currently restricted', 'warning');
      return;
    }
    if (!file || !activeChatId) return;

    if (!isVoice && window.ChatGuard) {
      const check = await window.ChatGuard.checkImage(file);
      if (check.blocked) {
        window.ChatGuard.showBlockedToast(check.reason);
        return;
      }
    }
    if (isVoice && window.ChatGuard && !window.ChatGuard.isFeatureUnlocked('voice')) {
      window.ChatGuard.showBlockedToast('Voice notes unlock after escrow payment');
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    const localId = `temp-media-${Date.now()}`;
    appendMessage({
      _id: localId,
      voiceNote: isVoice ? blobUrl : null,
      image: !isVoice ? blobUrl : null,
      sender: artisanDatabaseId,
      createdAt: new Date().toISOString(),
      isLocal: true
    });

    const fd = new FormData();
    fd.append('file', file);
    if (isVoice) fd.append('type', 'voice');

    try {
      const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.code === 'CHAT_BANNED' || err.code === 'ACCOUNT_SUSPENDED') {
          _isCurrentlyBanned = true;
          showBanOverlay({
            banType: err.code === 'ACCOUNT_SUSPENDED' ? 'full' : 'chat',
            chatBanned: err.code === 'CHAT_BANNED',
            isSuspended: err.code === 'ACCOUNT_SUSPENDED',
            banExpiresAt: err.banExpiresAt,
            reason: err.reason
          });
          document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
          URL.revokeObjectURL(blobUrl);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const realMsg = await res.json();
      URL.revokeObjectURL(blobUrl);
      replaceOptimisticMessage(localId, realMsg.message || realMsg);
    } catch (err) {
      console.error('sendMedia:', err);
      showStatusMessage('Failed to send media', 'error');
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      URL.revokeObjectURL(blobUrl);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // VOICE
  // ═══════════════════════════════════════════════════════════
  function showVoiceUI() {
    const ui = document.getElementById('voiceRecordingUI');
    if (ui) ui.classList.add('active');
  }
  function hideVoiceUI() {
    const ui = document.getElementById('voiceRecordingUI');
    if (ui) ui.classList.remove('active');
  }
  function fmtTimer(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  }

  async function startRecording() {
    if (_isCurrentlyBanned) { showStatusMessage('Messaging is restricted', 'warning'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { showStatusMessage('Browser does not support audio recording', 'warning'); return; }
    if (!activeChatId) { showStatusMessage('Select a chat first', 'warning'); return; }
    if (window.ChatGuard && !window.ChatGuard.isFeatureUnlocked('voice')) {
      window.ChatGuard.showBlockedToast('Voice notes unlock after escrow payment');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingMime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                    : MediaRecorder.isTypeSupported('audio/ogg')  ? 'audio/ogg' : '';
      mediaRecorder = new MediaRecorder(stream, recordingMime ? { mimeType: recordingMime } : undefined);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        clearInterval(recordingInterval);
        const t = document.getElementById('voiceTimer');
        if (t) t.textContent = '00:00';
        stream.getTracks().forEach(tr => tr.stop());
        hideVoiceUI();

        const blob = new Blob(audioChunks, recordingMime ? { type: recordingMime } : undefined);
        if (blob.size < 500) {
          showStatusMessage('Voice note too short', 'error');
          return;
        }
        const ext = recordingMime.includes('webm') ? 'webm' : recordingMime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, recordingMime ? { type: recordingMime } : undefined);
        await sendMedia(file, true);
      };

      mediaRecorder.start();
      recordingStart = Date.now();
      showVoiceUI();
      recordingInterval = setInterval(() => {
        const t = document.getElementById('voiceTimer');
        if (t) t.textContent = fmtTimer(Date.now() - recordingStart);
        if (Date.now() - recordingStart > 120000) stopRecording();
      }, 250);
    } catch (err) {
      console.error('startRecording:', err);
      showStatusMessage('Could not access microphone', 'error');
      hideVoiceUI();
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    else hideVoiceUI();
  }

  function cancelRecording() {
    audioChunks = [];
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onstop = () => {
        clearInterval(recordingInterval);
        hideVoiceUI();
      };
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }
    hideVoiceUI();
  }

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════
function showPage(pageId, clickedBtn) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  const pg = document.getElementById(pageId);
  if (pg) {
    pg.classList.add('active');
    pg.style.display = pageId === 'jobsPage' ? 'flex' : 'block';
    if (pageId === 'jobsPage') pg.style.flexDirection = 'column';
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (clickedBtn?.classList) clickedBtn.classList.add('active');

  if (pageId === 'jobsPage')    loadArtisanChats();
  if (pageId === 'historyPage' && typeof window.loadJobs === 'function') window.loadJobs();
}
window.showPage = showPage;
  // ═══════════════════════════════════════════════════════════
  // WIRE UP UI
  // ═══════════════════════════════════════════════════════════
  function wireUp() {
    document.getElementById('sendBtn')?.addEventListener('click', e => {
      e.preventDefault();
      sendTextMessage();
    });

    const txt = document.getElementById('text');
    if (txt) {
      txt.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendTextMessage();
        }
      });
      txt.addEventListener('input', () => {
        if (!activeChatId || !socket) return;
        if (!isTyping) {
          isTyping = true;
          socket.emit('typing', { chatId: activeChatId });
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          isTyping = false;
          if (socket) socket.emit('stopTyping', { chatId: activeChatId });
        }, TYPING_TIMEOUT);
      });
      txt.addEventListener('blur', () => {
        if (isTyping && socket && activeChatId) {
          isTyping = false;
          socket.emit('stopTyping', { chatId: activeChatId });
        }
      });
    }

    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('media');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', e => {
        e.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', e => {
        e.preventDefault();
        const file = e.target.files[0];
        if (file) sendMedia(file, false);
        e.target.value = '';
      });
    }

    document.getElementById('voiceBtn')?.addEventListener('click', e => {
      e.preventDefault();
      if (mediaRecorder?.state === 'recording') stopRecording();
      else startRecording();
    });
    document.getElementById('voiceStopBtn')?.addEventListener('click', e => { e.preventDefault(); stopRecording(); });
    document.getElementById('voiceCancelBtn')?.addEventListener('click', e => { e.preventDefault(); cancelRecording(); });

    document.getElementById('logout-btn')?.addEventListener('click', () => {
      localStorage.clear();
      window.location = 'SignIn.html';
    });
    document.getElementById('banLogoutBtn')?.addEventListener('click', () => {
      localStorage.clear();
      window.location = 'SignIn.html';
    });

    // Execution buttons
    document.querySelectorAll('.exec-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        if (btn.disabled) return;
        updateExecutionStatus(btn.dataset.status);
      });
    });

    document.getElementById('uploadProofBtn')?.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('proofPhotoInput')?.click();
    });

    document.getElementById('proofPhotoInput')?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) uploadProofPhoto(file);
      e.target.value = '';
    });

  // Top-up modal open/close
  const topUpRequestBtn = document.getElementById("topUpRequestBtn");
  const topUpModal = document.getElementById("topUpModal");
  const topUpCloseBtn = document.getElementById("topUpCloseBtn");
  const topUpCancelBtn = document.getElementById("topUpCancelBtn");

  topUpRequestBtn?.addEventListener("click", () => {
    topUpModal.style.display = "flex";
  });
  topUpCloseBtn?.addEventListener("click", () => {
    topUpModal.style.display = "none";
  });
  topUpCancelBtn?.addEventListener("click", () => {
    topUpModal.style.display = "none";
  });

  // Top-up submit
document.getElementById('topUpRequestBtn')?.addEventListener('click', () => {
  if (getArtisanChatPhase() === 'secured') {
    const currentPrice = activeBooking?.totalPaid || activeBooking?.estimatedPrice || 0;
    document.getElementById('topUpCurrentPriceLine').textContent =
      `Current agreed price: ₦${Number(currentPrice).toLocaleString()}`;
    document.getElementById('topUpDiffPreview').textContent = '';
    document.getElementById('topUpModal').style.display = 'flex';
  } else {
    document.getElementById('proposalCurrentPriceLine').textContent =
      `Current quoted price: ₦${Number(activeBooking?.estimatedPrice || 0).toLocaleString()}`;
    document.getElementById('priceProposalModal').style.display = 'flex';
  }
});
document.getElementById('topUpCancelBtn')?.addEventListener('click', () => {
  document.getElementById('topUpModal').style.display = 'none';
});

document.getElementById('topUpNewPrice')?.addEventListener('input', (e) => {
  const currentPrice = activeBooking?.totalPaid || activeBooking?.estimatedPrice || 0;
  const newPrice = Number(e.target.value);
  const preview = document.getElementById('topUpDiffPreview');
  if (!newPrice || newPrice <= currentPrice) {
    preview.textContent = newPrice ? 'New price must be higher than the current price' : '';
    preview.style.color = '#ef4444';
    return;
  }
  preview.style.color = '#ffd700';
  preview.textContent = `Customer will be asked to pay an extra ₦${(newPrice - currentPrice).toLocaleString()}`;
});

document.getElementById('topUpSubmitBtn')?.addEventListener('click', async () => {
  if (!activeBookingId) { showStatusMessage('No active booking', 'warning'); return; }

  const newPrice = Number(document.getElementById('topUpNewPrice').value);
  const reason = document.getElementById('topUpReason').value.trim();
  const currentPrice = activeBooking?.totalPaid || activeBooking?.estimatedPrice || 0;

  if (!newPrice || newPrice <= currentPrice) {
    showStatusMessage('Enter a new price higher than the current price', 'warning');
    return;
  }
  if (reason.length < 10) {
    showStatusMessage('Reason must be at least 10 characters', 'warning');
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/bookings/${activeBookingId}/top-up`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ newPrice, reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to request price update');

    document.getElementById('topUpModal').style.display = 'none';
    document.getElementById('topUpNewPrice').value = '';
    document.getElementById('topUpReason').value = '';
    showStatusMessage('Price update request sent', 'success');
  } catch (err) {
    showStatusMessage(err.message, 'error');
  }
});

document.getElementById('proposalCancelBtn')?.addEventListener('click', () => {
  document.getElementById('priceProposalModal').style.display = 'none';
});

document.getElementById('proposalSubmitBtn')?.addEventListener('click', async () => {
  if (!activeBookingId) { showStatusMessage('No active booking', 'warning'); return; }

  const newPrice = Number(document.getElementById('proposalNewPrice').value);
  const reason = document.getElementById('proposalReasonInput').value.trim();
  const currentPrice = activeBooking?.estimatedPrice || 0;

  if (!newPrice || newPrice === currentPrice) {
    showStatusMessage('Enter a price different from the current quote', 'warning');
    return;
  }
  if (reason.length < 10) {
    showStatusMessage('Reason must be at least 10 characters', 'warning');
    return;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/bookings/${activeBookingId}/price-proposal`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ newPrice, reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to send price proposal');

    document.getElementById('priceProposalModal').style.display = 'none';
    document.getElementById('proposalNewPrice').value = '';
    document.getElementById('proposalReasonInput').value = '';
    showStatusMessage('Price proposal sent', 'success');
  } catch (err) {
    showStatusMessage(err.message, 'error');
  }
});
    // Dispute
    document.getElementById('artisanDisputeBtn')?.addEventListener('click', e => {
      e.preventDefault();
      if (!activeBookingId) {
        showStatusMessage('No booking on this chat yet', 'warning');
        return;
      }
      if (window.FixaSystem) FixaSystem.openDispute(activeBookingId);
    });

    // Back button
    document.getElementById('chatBackBtn')?.addEventListener('click', closeChat);

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  document.addEventListener('submit', e => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    wireUp();
    initSocket();

    if (typeof FixaSystem !== 'undefined') {
      FixaSystem.init(socket, user, token, BASE_URL, 'artisan');
    }
    if (window.ChatGuard) {
      window.ChatGuard.init(artisanDatabaseId, token);
    }

    document.querySelectorAll('#starRow .star').forEach(star => {
  star.addEventListener('click', () => {
    _selectedRating = Number(star.dataset.val);
    document.querySelectorAll('#starRow .star').forEach(s => {
      s.style.color = Number(s.dataset.val) <= _selectedRating ? '#ffd700' : '#4a5568';
    });
  });
});

document.getElementById('ratingSkipBtn')?.addEventListener('click', () => {
  document.getElementById('fixaRatingModal').style.display = 'none';
  _ratingContext = null;
});

document.getElementById('ratingSubmitBtn')?.addEventListener('click', async () => {
  if (!_ratingContext) return;
  if (!_selectedRating) {
    if (window.FixaSystem) FixaSystem.showToast('Pick a star rating first', '', 'warning');
    return;
  }
  try {
    const res = await fetch(`${BASE_URL}/api/reviews`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artisanId: _ratingContext.artisanId,
        bookingId: _ratingContext.bookingId,
        rating: _selectedRating,
        comment: document.getElementById('ratingComment').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to submit review');
    document.getElementById('fixaRatingModal').style.display = 'none';
    _ratingContext = null;
    if (window.FixaSystem) FixaSystem.showToast('Thanks for your feedback! ⭐', '', 'success');
  } catch (err) {
    if (window.FixaSystem) FixaSystem.showToast('Failed', err.message, 'warning');
  }
});
    loadArtisanProfile();
    loadPayoutDashboard();
    fetchDashboardSummary();
    fetchArtisanJobs();
    loadArtisanChats();
    checkBanStatusOnLoad();

    showPage('homePage', document.querySelector('.nav-btn'));
  });

})();
