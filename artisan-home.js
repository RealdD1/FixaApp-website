/**
 * FIXA — Artisan Home (rewritten, schema-aligned)
 * Uses User schema fields: isSuspended, chatBanned, banExpiresAt
 */
(function () {
  'use strict';

  const BASE_URL    = 'http://localhost:5000';
  const SOCKET_URL  = BASE_URL;
  const ARTISAN_API = `${BASE_URL}/api/artisans`;
  const JOB_API     = `${BASE_URL}/api/jobs`;
  const BOOKING_API = `${BASE_URL}/api/bookings`;
  const MSG_API     = `${BASE_URL}/api/messages`;
  const USER_API    = `${BASE_URL}/api/users`;

  const rawUser = localStorage.getItem('user');
  const user    = rawUser ? JSON.parse(rawUser) : null;
  const token   = localStorage.getItem('token');

  if (!user || !token || user.role !== 'artisan') {
    window.location.href = 'SignIn.html';
    return;
  }
  user._id = user._id || user.id || user.userId || '';
  const myId = String(user._id);

  let socket = null;
  let activeChatId = null;
  let isTyping = false;
  let typingTimer = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordStart = 0;
  let recordingInterval = null;
  let bookings = [];
  let banCountdownInterval = null;

  // ─────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────
  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function authH(json = false) {
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function normalizeId(v) {
    if (!v) return '';
    if (typeof v === 'object') return String(v._id || v.id || '');
    return String(v);
  }
  function fmtTime(d) {
    try {
      const dt = d instanceof Date ? d : new Date(d);
      const now = new Date();
      if (dt.toDateString() === now.toDateString())
        return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }
  function fmtMoney(n) { return `₦${Number(n || 0).toLocaleString()}`; }
  function computeIsMe(m) {
    if (m.outgoing || m.isMine || m.isLocal) return true;
    const senderId = normalizeId(m.senderId ?? m.sender ?? m.from ?? '');
    return senderId && senderId === myId;
  }
  function notify(msg, type = 'info') {
    if (window.FixaSystem) window.FixaSystem.showToast(msg, '', type === 'error' ? 'warning' : 'success');
  }

  // ─────────────────────────────────────────────
  // PAGE NAVIGATION
  // ─────────────────────────────────────────────
  function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (btn) btn.classList.add('active');
    if (pageId === 'messagesPage') loadChatList();
    if (pageId === 'historyPage')  loadBookings();
  }
  window.showPage = showPage;

  // ─────────────────────────────────────────────
  // SOCKET
  // ─────────────────────────────────────────────
  function initSocket() {
    try {
      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
      window.socket = socket;

      socket.on('connect', () => {
        socket.emit('register', myId);
        if (activeChatId) socket.emit('joinChat', String(activeChatId));
      });
      socket.on('connect_error', e => console.warn('[Socket]', e.message));

      socket.on('newJobRequest', (job) => {
        renderNewJobCard(job);
        fetchDashboardSummary();
        if (window.FixaSystem) {
          const customer = job?.customer?.name || job?.customer?.username || 'A customer';
          window.FixaSystem.addNotification('New Job Request 🔨', `${customer} needs your service.`, 'job');
        }
      });

      socket.on('bookingStatusUpdated', (data) => {
        const card = document.querySelector(`[data-job-id="${data.jobId || data.bookingId}"]`);
        if (card) {
          const actions = card.querySelector('.job-actions');
          if (actions) actions.innerHTML = `<em>Job ${String(data.status).toUpperCase()}</em>`;
          card.style.opacity = '0.6';
          setTimeout(fetchPendingJobs, 500);
        }
        fetchDashboardSummary();
        if (document.getElementById('historyPage').classList.contains('active')) loadBookings();
      });

      socket.on('newMessage', (payload) => {
        const { chatId, message } = payload || {};
        if (!chatId || !message) return;
        if (String(activeChatId) === String(chatId)) {
          appendMessage(message);
        } else {
          updateChatPreview(chatId, message);
          if (window.FixaSystem) {
            const sender = message.senderName || 'Customer';
            window.FixaSystem.addNotification(`New message from ${sender}`, message.text || 'Sent media', 'message', chatId);
          }
        }
      });

      socket.on('typing', ({ chatId }) => {
        if (String(activeChatId) === String(chatId))
          document.getElementById('typingIndicator').textContent = 'Customer is typing...';
      });
      socket.on('stopTyping', ({ chatId }) => {
        if (String(activeChatId) === String(chatId))
          document.getElementById('typingIndicator').textContent = '';
      });

      socket.on('bookingCompleted', () => {
        notify('Customer confirmed completion! 🎉');
        if (document.getElementById('historyPage').classList.contains('active')) loadBookings();
      });

      // ── BAN events (schema-aligned) ──
      socket.on('accountSuspended', (data) => {
        showBanOverlay(data);
      });
      socket.on('accountActivated', () => {
        hideBanOverlay();
        const footer = document.querySelector('.chat-footer');
        if (footer) footer.style.display = '';
        notify('Your account has been reactivated!');
      });

      // ── New rating ──
      socket.on('newRating', (data) => {
        const { rating, customerName, comment } = data || {};
        if (window.FixaSystem) {
          window.FixaSystem.addNotification(
            `New Review ${'⭐'.repeat(rating || 0)}`,
            `${customerName || 'A customer'} gave you ${rating}/5${comment ? ': "' + comment + '"' : ''}`,
            'rating'
          );
        }
      });

      // ── Payment update ──
      socket.on('paymentUpdate', (data) => {
        const { status, amount, type } = data || {};
        const titles = { payout: 'Payout Sent 💸', received: 'Payment Received 💰', failed: 'Payment Failed ❌' };
        if (window.FixaSystem) {
          window.FixaSystem.addNotification(
            titles[type] || 'Payment Update',
            amount ? `₦${Number(amount).toLocaleString()} — ${status || ''}` : (status || ''),
            type === 'failed' ? 'warning' : 'payment'
          );
        }
      });

    } catch (e) { console.warn('[Socket] init failed:', e); }
  }

  function safeEmit(event, data) {
    if (socket && socket.connected) { socket.emit(event, data); return true; }
    return false;
  }

  // ─────────────────────────────────────────────
  // BAN COUNTDOWN — SCHEMA ALIGNED
  // ─────────────────────────────────────────────
  
  // ─────────────────────────────────────────────
  // PROFILE
  // ─────────────────────────────────────────────
  async function loadProfile() {
    try {
      const res = await fetch(`${ARTISAN_API}/me`, { headers: authH() });
      if (!res.ok) throw new Error('Profile fetch failed');
      const data = await res.json();
      const name = data.name || data.username || user.username || 'Artisan';
      document.querySelectorAll('.usernameDisplay').forEach(el => el.textContent = name);
      document.getElementById('emailDisplay').textContent = data.email || user.email || '—';
      document.getElementById('phoneDisplay').textContent = data.phone || user.phone || '—';
      const initial = document.getElementById('profileInitial');
      if (initial) initial.textContent = name[0]?.toUpperCase() || 'A';
      const verified = data.verified === true;
      const badge = document.getElementById('verificationBadge');
      const text  = document.getElementById('badgeText');
      const icon  = document.getElementById('badgeIcon');
      if (badge && text && icon) {
        badge.className = `verification-badge ${verified ? 'verified' : 'not-verified'}`;
        text.textContent = verified ? 'Verified' : 'Not Verified';
        icon.textContent = verified ? '✓' : '✕';
      }
    } catch (e) { console.error('loadProfile:', e); }
  }

  async function fetchDashboardSummary() {
    try {
      const res = await fetch(`${ARTISAN_API}/dashboard-summary`, { headers: authH() });
      if (!res.ok) return;
      const data = await res.json();
      document.getElementById('activeJobsCount').textContent = data.activeJobsCount || 0;
      document.getElementById('newRequestsCount').textContent = data.newRequestsCount || 0;
      document.getElementById('totalEarnings').textContent = fmtMoney(data.totalEarnings);
    } catch (e) { console.error(e); }
  }

  // ─────────────────────────────────────────────
  // PENDING JOBS
  // ─────────────────────────────────────────────
  async function fetchPendingJobs() {
    const container = document.getElementById('newJobRequests');
    try {
      const res = await fetch(`${JOB_API}/pending`, { headers: authH() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      container.innerHTML = '';
      if (!jobs.length) { container.innerHTML = '<p class="no-requests">No new requests found.</p>'; return; }
      jobs.slice().reverse().forEach(renderNewJobCard);
    } catch {
      container.innerHTML = '<p class="no-requests">Error loading requests.</p>';
    }
  }

  function renderNewJobCard(job) {
    if (!job || !job._id) return;
    const container = document.getElementById('newJobRequests');
    if (!container) return;
    container.querySelector('.no-requests')?.remove();
    if (container.querySelector(`[data-job-id="${job._id}"]`)) return;

    const coords = job.location?.coordinates || [];
    const lat = coords[1], lng = coords[0];
    const category = job.serviceCategory?.name || job.category || 'N/A';
    const customerName = job.customer?.name || job.customer?.username || 'Customer';

    const card = document.createElement('div');
    card.className = 'job-card new-job-request';
    card.dataset.jobId = job._id;
    card.innerHTML = `
      <div class="job-header">
        <h3>New Job Request</h3>
        <span class="timestamp">${fmtTime(job.createdAt || Date.now())}</span>
      </div>
      <p><strong>Customer:</strong> ${escHtml(customerName)}</p>
      <p><strong>Location:</strong> ${escHtml(job.address || 'N/A')}</p>
      <p><strong>Category:</strong> ${escHtml(category)}</p>
      <p><strong>Description:</strong> ${escHtml(job.description || 'No description')}</p>
      <p><strong>Budget:</strong> ${fmtMoney(job.budget || job.price)}</p>
      <div class="job-actions">
        <button type="button" class="accept-btn">Accept</button>
        <button type="button" class="decline-btn">Decline</button>
        ${(lat && lng) ? `<button type="button" class="map-view-btn" data-lat="${lat}" data-lng="${lng}">Map</button>` : ''}
      </div>
    `;
    container.prepend(card);

    card.querySelector('.accept-btn').addEventListener('click', () => handleJobAction(job._id, 'accepted', card));
    card.querySelector('.decline-btn').addEventListener('click', () => handleJobAction(job._id, 'rejected', card));
    const mapBtn = card.querySelector('.map-view-btn');
    if (mapBtn) {
      mapBtn.addEventListener('click', () => {
        window.open(`https://www.google.com/maps/search/?api=1&query=${mapBtn.dataset.lat},${mapBtn.dataset.lng}`, '_blank');
      });
    }
  }

  async function handleJobAction(jobId, action, card) {
    if (card) card.querySelector('.job-actions').innerHTML = `<em style="color:var(--gold)">Processing ${action}...</em>`;
    try {
      const res = await fetch(`${JOB_API}/${encodeURIComponent(jobId)}`, {
        method: 'PUT', headers: authH(true), body: JSON.stringify({ status: action })
      });
      if (!res.ok) {
        let msg = `Server ${res.status}`;
        try { msg = (await res.json()).message || msg; } catch {}
        throw new Error(msg);
      }
      notify(`Job ${action.toUpperCase()}`);
      if (card) {
        card.querySelector('.job-actions').innerHTML = `<span style="color:var(--green);font-weight:700">Status: ${action.toUpperCase()}</span>`;
        card.style.opacity = '0.7';
      }
      fetchPendingJobs(); fetchDashboardSummary();
    } catch (e) {
      notify(`Could not update job: ${e.message}`, 'error');
      if (card) card.querySelector('.job-actions').innerHTML = `<span style="color:var(--danger);font-weight:700">Failed — Retry</span>`;
    }
  }

  // ─────────────────────────────────────────────
  // CHAT (same as before — no changes needed)
  // ─────────────────────────────────────────────
  async function loadChatList() {
    const container = document.getElementById('chatList');
    container.innerHTML = '<div class="empty-state"><p>Loading conversations...</p></div>';
    try {
      const res = await fetch(`${MSG_API}/artisan-chats`, { headers: authH() });
      if (!res.ok) throw new Error();
      const chats = await res.json();
      renderChatList(Array.isArray(chats) ? chats : []);
    } catch {
      container.innerHTML = '<div class="empty-state"><p style="color:var(--danger)">Failed to load chats</p></div>';
    }
  }

  function renderChatList(chats) {
    const container = document.getElementById('chatList');
    if (!chats.length) {
      container.innerHTML = '<div class="empty-state"><span class="material-icons">forum</span><p>No conversations yet</p></div>';
      return;
    }
    container.innerHTML = '';
    chats.forEach(chat => {
      const other = (chat.participants || []).find(p => normalizeId(p) !== myId) || {};
      const name = other.username || other.name || 'Customer';
      const lastMsg = chat.latestMessage || (chat.messages?.slice(-1)[0]) || {};
      const lastText = lastMsg.text || lastMsg.content || 'Say hi 👋';
      const lastTime = lastMsg.createdAt ? fmtTime(new Date(lastMsg.createdAt)) : '';
      const unread = chat.unreadCount || 0;

      const el = document.createElement('div');
      el.className = 'chat-item';
      el.dataset.chatId = chat._id || chat.id;
      el.innerHTML = `
        <div class="chat-avatar">${escHtml((name[0] || '?').toUpperCase())}</div>
        <div class="chat-info">
          <div class="chat-name">
            <span>${escHtml(name)}</span>
            <span style="font-size:10px;color:var(--text-muted);font-weight:400">${escHtml(lastTime)}</span>
          </div>
          <div class="chat-preview">
            <span class="chat-preview-text">${escHtml(lastText)}</span>
            ${unread ? `<span class="unread-badge">${unread}</span>` : ''}
          </div>
        </div>
      `;
      el.addEventListener('click', () => openChat(el.dataset.chatId, name));
      container.appendChild(el);
    });
  }

  function updateChatPreview(chatId, message) {
    const item = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (!item) { loadChatList(); return; }
    const preview = item.querySelector('.chat-preview-text');
    if (preview) preview.textContent = message.text || 'Media';
    let badge = item.querySelector('.unread-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'unread-badge';
      item.querySelector('.chat-preview').appendChild(badge);
    }
    badge.textContent = parseInt(badge.textContent || '0') + 1;
    document.getElementById('chatList').prepend(item);
  }

  async function openChat(chatId, peerName) {
    activeChatId = chatId;
    document.getElementById('chatListView').style.display = 'none';
    document.getElementById('chatConvView').style.display = 'flex';
    document.getElementById('chatConvView').style.flexDirection = 'column';
    document.getElementById('convName').textContent = peerName || 'Chat';
    document.getElementById('convAvatar').textContent = (peerName || 'C')[0].toUpperCase();

    safeEmit('joinChat', String(chatId));

    const msgsEl = document.getElementById('messagesContainer');
    msgsEl.innerHTML = '<div class="empty-state"><p>Loading messages...</p></div>';
    try {
      const res = await fetch(`${MSG_API}/${encodeURIComponent(chatId)}`, { headers: authH() });
      if (!res.ok) throw new Error();
      const msgs = await res.json();
      msgsEl.innerHTML = '';
      (Array.isArray(msgs) ? msgs : []).forEach(appendMessage);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch {
      msgsEl.innerHTML = '<div class="empty-state"><p style="color:var(--danger)">Could not load messages</p></div>';
    }
    const item = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (item) item.querySelector('.unread-badge')?.remove();
  }
  window.openChat = openChat;

  function closeChat() {
    if (activeChatId) safeEmit('leaveChat', String(activeChatId));
    activeChatId = null;

  // ... existing code ...
  document.getElementById('executionTimeline').style.display = 'none';
  document.getElementById('proofPhotoGallery').innerHTML = '';
   document.getElementById('chatConvView').style.display = 'none';
    document.getElementById('chatListView').style.display = 'flex';
  }

  function appendMessage(m) {
    if (!m) return;
    const msgsEl = document.getElementById('messagesContainer');
    const msgId = m._id || m.id;
    if (msgId && msgsEl.querySelector(`[data-msg-id="${msgId}"]`)) {
      msgsEl.querySelector(`[data-msg-id="${msgId}"]`).remove();
    }
    const isMe = computeIsMe(m);
    const msgDate = new Date(m.createdAt || Date.now());
    const dateStr = msgDate.toDateString();
    const lastSep = msgsEl.querySelector('.date-sep:last-of-type');
    if (!lastSep || lastSep.dataset.date !== dateStr) {
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.dataset.date = dateStr;
      sep.innerHTML = `<span>${dateStr === new Date().toDateString() ? 'Today' : msgDate.toLocaleDateString()}</span>`;
      msgsEl.appendChild(sep);
    }
    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'sent' : 'recv'}`;
    row.dataset.msgId = msgId || `local-${Date.now()}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const mediaSrc = m.voiceNote || m.image || m.mediaUrl;
    if (mediaSrc) {
      const isAudio = String(mediaSrc).toLowerCase().match(/\.(webm|mp3|wav|ogg)$/i);
      const fullSrc = String(mediaSrc).startsWith('blob:') || String(mediaSrc).startsWith('http')
        ? mediaSrc
        : `${BASE_URL}${String(mediaSrc).startsWith('/') ? '' : '/'}${mediaSrc}`;
      if (m.voiceNote || isAudio) {
        const audio = document.createElement('audio');
        audio.controls = true; audio.src = fullSrc; audio.preload = 'metadata';
        bubble.appendChild(audio);
      } else {
        const img = document.createElement('img');
        img.src = fullSrc; img.loading = 'lazy'; img.style.cursor = 'pointer';
        img.addEventListener('click', () => window.open(fullSrc, '_blank'));
        bubble.appendChild(img);
      }
    }
    const text = m.text || m.content;
    if (text && text !== 'Voice note' && text !== 'Image') {
      const t = document.createElement('div');
      t.textContent = text;
      bubble.appendChild(t);
    }
    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.textContent = fmtTime(new Date(m.createdAt || Date.now()));
    if (isMe) meta.textContent += m.seen ? ' ✓✓' : m.delivered ? ' ✓' : ' ·';
    bubble.appendChild(meta);
    row.appendChild(bubble);
    msgsEl.appendChild(row);
    const nearBottom = (msgsEl.scrollHeight - msgsEl.clientHeight - msgsEl.scrollTop) < 120;
    if (nearBottom || isMe) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function sendTextMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    input.value = '';
    const localId = `temp-${Date.now()}`;
    appendMessage({ _id: localId, text, sender: myId, createdAt: new Date().toISOString(), isLocal: true });
    try {
      const res = await fetch(`${MSG_API}/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST', headers: authH(true), body: JSON.stringify({ text })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const real = data.message || data;
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      appendMessage(real);
      safeEmit('newMessage', { chatId: activeChatId, message: real });
    } catch {
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      notify('Failed to send', 'error');
    }
  }

  async function sendMedia(file, isVoice = false) {
    if (!file || !activeChatId) return;
    const blobUrl = URL.createObjectURL(file);
    const localId = `temp-media-${Date.now()}`;
    appendMessage({
      _id: localId, [isVoice ? 'voiceNote' : 'image']: blobUrl,
      sender: myId, createdAt: new Date().toISOString(), isLocal: true
    });
    const fd = new FormData();
    fd.append('file', file);
    if (isVoice) fd.append('type', 'voice');
    try {
      const res = await fetch(`${MSG_API}/${encodeURIComponent(activeChatId)}/media`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
      });
      if (!res.ok) throw new Error();
      const real = await res.json();
      URL.revokeObjectURL(blobUrl);
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      appendMessage(real);
      safeEmit('newMessage', { chatId: activeChatId, message: real });
    } catch {
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      URL.revokeObjectURL(blobUrl);
      notify('Failed to send media', 'error');
    }
  }

  function handleTyping() {
    if (!activeChatId) return;
    if (!isTyping) { isTyping = true; safeEmit('typing', { chatId: activeChatId }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTyping = false; safeEmit('stopTyping', { chatId: activeChatId });
    }, 2000);
  }

  async function startVoiceRecording() {
    if (!activeChatId) { notify('Open a chat first', 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      audioChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        clearInterval(recordingInterval);
        document.getElementById('voiceTimer').textContent = '00:00';
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks, { type: mime });
        if (blob.size < 500) return;
        const ext = mime.includes('webm') ? 'webm' : 'ogg';
        await sendMedia(new File([blob], `voice-${Date.now()}.${ext}`, { type: mime }), true);
      };
      mediaRecorder.start(250);
      recordStart = Date.now();
      document.getElementById('voiceUI').classList.add('active');
      recordingInterval = setInterval(() => {
        const s = Math.floor((Date.now() - recordStart) / 1000);
        document.getElementById('voiceTimer').textContent =
          `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
        if (Date.now() - recordStart > 120000) stopVoiceRecording();
      }, 250);
    } catch (e) { notify('Could not access microphone', 'error'); }
  }

  function stopVoiceRecording() {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    document.getElementById('voiceUI').classList.remove('active');
  }

  function cancelVoiceRecording() {
    audioChunks = [];
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onstop = null;
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }
    document.getElementById('voiceUI').classList.remove('active');
  }

  // ─────────────────────────────────────────────
  // BOOKINGS
  // ─────────────────────────────────────────────
  async function loadBookings() {
    const container = document.getElementById('bookingsList');
    container.innerHTML = '<div class="empty-state"><p>Loading bookings...</p></div>';
    try {
      const res = await fetch(`${BOOKING_API}/artisan`, { headers: authH() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      bookings = (Array.isArray(data) ? data : []).map(j => ({
        id: j._id,
        customerName: j.customerId?.username || j.customer?.username || 'Customer',
        service: j.category || j.serviceCategory?.name || 'General Service',
        status: mapStatus(j.status),
        price: j.estimatedPrice ? fmtMoney(j.estimatedPrice) : 'Price TBD',
        date: new Date(j.createdAt).toLocaleDateString(),
        rawStatus: j.status
      }));
      renderBookings('all');
    } catch {
      container.innerHTML = '<div class="empty-state"><p style="color:var(--danger)">Failed to load bookings</p></div>';
    }
  }

  function mapStatus(s) {
    if (!s) return 'ongoing';
    s = String(s).toLowerCase();
    if (s === 'completed' || s === 'confirmed') return 'completed';
    if (s === 'verifying') return 'verifying';
    if (s === 'rejected' || s === 'cancelled') return 'cancelled';
    return 'ongoing';
  }

  function renderBookings(filter) {
    const container = document.getElementById('bookingsList');
    const filtered = bookings.filter(j => filter === 'all' || j.status === filter);
    if (!filtered.length) {
      container.innerHTML = '<div class="empty-state"><span class="material-icons">history</span><p>No bookings here</p></div>';
      return;
    }
    container.innerHTML = filtered.map(job => {
      let actions = '';
      if (job.status === 'ongoing') {
        actions = `
          <button class="btn-outline" data-action="message" data-id="${job.id}">Message</button>
          <button class="btn-fill" data-action="complete" data-id="${job.id}">Mark Done</button>
        `;
      } else if (job.status === 'verifying') {
        actions = `<button class="btn-outline" disabled>Waiting for customer...</button>`;
      } else {
        actions = `<button class="btn-fill" data-action="details" data-id="${job.id}">View Details</button>`;
      }
      return `
        <div class="booking-card ${job.status}">
          <div class="booking-header">
            <h4>${escHtml(job.service)}</h4>
            <span class="badge ${job.status}">${escHtml(job.status)}</span>
          </div>
          <div class="booking-details">
            Customer: ${escHtml(job.customerName)}<br>
            <span style="font-size:11px">Date: ${escHtml(job.date)}</span>
            <div class="booking-price">${escHtml(job.price)}</div>
          </div>
          <div class="booking-btns">${actions}</div>
        </div>`;
    }).join('');
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleBookingAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function handleBookingAction(action, id) {
    if (action === 'message') { showPage('messagesPage'); return; }
    if (action === 'complete') {
      if (!confirm('Mark this job as done?')) return;
      try {
        const res = await fetch(`${BOOKING_API}/${id}/mark-done`, { method: 'PUT', headers: authH() });
        if (!res.ok) throw new Error();
        notify('Waiting for customer confirmation ⏳');
        loadBookings();
      } catch { notify('Failed to mark done', 'error'); }
      return;
    }
    if (action === 'details') {
      try {
        const res = await fetch(`${BOOKING_API}/${id}`, { headers: authH() });
        const job = await res.json();
        alert(`Service: ${job.category}\n\nDescription: ${job.description || '—'}\nStatus: ${job.status}\nPrice: ₦${(job.estimatedPrice || 0).toLocaleString()}\nAddress: ${job.address || '—'}`);
      } catch { notify('Failed to load details', 'error'); }
    }
  }

  // ─────────────────────────────────────────────
  // WIRE UP
  // ─────────────────────────────────────────────
  function wireUp() {
    document.querySelectorAll('.nav-btn').forEach(btn =>
      btn.addEventListener('click', () => showPage(btn.dataset.page)));

    document.querySelectorAll('.history-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderBookings(tab.dataset.filter);
      });
    });

    document.getElementById('backBtn').addEventListener('click', closeChat);
    document.getElementById('sendBtn').addEventListener('click', sendTextMessage);

    const input = document.getElementById('msgInput');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
    });
    input.addEventListener('input', handleTyping);
    input.addEventListener('blur', () => {
      if (isTyping && activeChatId) {
        isTyping = false; safeEmit('stopTyping', { chatId: activeChatId });
      }
    });

    document.getElementById('attachBtn').addEventListener('click', e => {
      e.preventDefault(); document.getElementById('mediaInput').click();
    });
    document.getElementById('mediaInput').addEventListener('change', function (e) {
      e.preventDefault();
      const file = this.files[0];
      if (file) sendMedia(file, false);
      this.value = '';
    });

    document.getElementById('voiceBtn').addEventListener('click', e => {
      e.preventDefault();
      if (mediaRecorder?.state === 'recording') stopVoiceRecording();
      else startVoiceRecording();
    });
    document.getElementById('voiceStopBtn').addEventListener('click', stopVoiceRecording);
    document.getElementById('voiceCancelBtn').addEventListener('click', cancelVoiceRecording);

    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.clear(); window.location.href = 'SignIn.html';
    });
    document.getElementById('banLogoutBtn').addEventListener('click', () => {
      localStorage.clear(); window.location.href = 'SignIn.html';
    });

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireUp();
    initSocket();
    if (window.FixaSystem) window.FixaSystem.init(socket, user, token, BASE_URL, 'artisan');
    loadProfile();
    fetchDashboardSummary();
    fetchPendingJobs();
    checkBanStatusOnLoad();
    showPage('homePage');
  });

})();