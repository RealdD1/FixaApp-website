// artisan-home.js — Full implementation: job requests UI + chat integrated
// Save as artisan-home.js and include in your artisan dashboard HTML.

(function () {
  'use strict';

  // ----- CONFIG -----
  const BASE_URL = 'http://localhost:5000';
  const ARTISAN_API_URL = `${BASE_URL}/api/artisans`;
  const JOB_API_URL = `${BASE_URL}/api/jobs`;
  const MESSAGE_API_URL = `${BASE_URL}/api/messages`;
  const SOCKET_URL = BASE_URL;

  // ----- AUTH & USER -----
  const rawUser = localStorage.getItem('user');
  const user = rawUser ? JSON.parse(rawUser) : null;
  const token = localStorage.getItem('token');

  if (!user || !token || user.role !== 'artisan') {
    // In production redirect. For development you may comment this out.
    // window.location.href = 'signin.html';
    console.warn('Auth missing — production would redirect to signin.');
    window.location ="SignIn.html";
  }

  const artisanDatabaseId = user ? (user._id || user.id) : null;

  // ----- DOM SHORTCUTS -----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ----- STATE -----
  let socket = null;
  let activeChatId = null;

  // ----- HELPERS -----
  function authHeaders(json = true) {
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function safeJson(res) {
    return res.text().then((t) => { try { return JSON.parse(t); } catch (e) { return t; } });
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString(); } catch { return ts; }
  }

  function escapeHtml(s){ if (!s) return ''; return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  // ----- SOCKET -----
  function initSocket() {
    try {
      socket = io(SOCKET_URL, { auth: { token } });

      socket.on('connect', () => {
        console.log('[SOCKET] connected', socket.id);
        if (artisanDatabaseId) socket.emit('register', artisanDatabaseId);
      });

      socket.on('connect_error', (err) => console.error('[SOCKET] connect_error', err && err.message));
      socket.on('error', (err) => console.error('[SOCKET] error', err));

      socket.on('newJobRequest', (job) => {
        console.log('[SOCKET] newJobRequest received:', job); // Added log
        tryPlaySound();
        updateNewJobCard(job);
        fetchDashboardSummary();
      });

      socket.on('bookingStatusUpdated', (data) => {
        console.log('[SOCKET] bookingStatusUpdated', data);
        const jobCard = document.querySelector(`[data-job-id="${data.jobId}"]`);
        if (jobCard) {
          const actions = jobCard.querySelector('.job-actions');
          if (actions) actions.innerHTML = `<em>Job ${String(data.status).toUpperCase()}</em>`;
          jobCard.style.opacity = '0.6';
          setTimeout(fetchArtisanJobs, 500);
          fetchDashboardSummary();
        }
      });

      socket.on('newMessage', (payload) => {
        // payload: { chatId, message }
        console.log('[SOCKET] newMessage', payload);
        if (!payload) return;
        handleIncomingSocketMessage(payload);
      });

    } catch (e) {
      console.warn('[SOCKET] init failed', e);
      socket = null;
    }
  }

  function tryPlaySound() {
    try {
      // NOTE: This assumes you have a sound file at this path. If not, it will fail silently.
      const s = new Audio('/sounds/new-job.mp3'); 
      s.play().catch(() => {});
    } catch (e) {}
  }

  // ----- JOB UI (Updated) -----
  function updateNewJobCard(job) {
    
    // --- 1. Log incoming data for debugging ---
    console.log('Rendering Job:', job._id, job.description);
    if (!job || !job._id) {
      console.error('Cannot render job: Invalid or missing job object.');
      return;
    }
    console.log('Job object (Customer/Category structure):', { 
      customer: job.customer, 
      serviceCategory: job.serviceCategory 
    });


    const container = document.querySelector('.job-requests-container');
    if (!container) return console.error('Job requests container missing. Cannot display job card.');

    const location = job.address || 'N/A';
    const coordinates = job.location?.coordinates || [];
    const lat = coordinates[1];
    const lng = coordinates[0];

    // --- 2. Safe data extraction ---
    // Use the populated 'name' or fallback to the ID string if population failed
    const category = job.serviceCategory?.name || String(job.serviceCategory) || 'N/A';
    // Use the populated 'name'/'username', or the customerId string
    const customer = job.customer?.name || job.customer?.username || String(job.customer) || 'N/A';

    console.log(`[RENDER] Extracted Data: Category=${category}, Customer=${customer}`);

    const jobCard = document.createElement('div');
    jobCard.className = 'job-card new-job-request';
    jobCard.dataset.jobId = job._id || job.id;

    jobCard.innerHTML = `
      <div class="job-header">
        <h3>New Job Request</h3>
        <span class="timestamp">${fmtDate(job.createdAt || job.created_at || Date.now())}</span>
      </div>
      <p><strong>Customer:</strong> ${escapeHtml(customer)}</p>
      <p><strong>Location:</strong> ${escapeHtml(location)}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      <p><strong>Description:</strong> ${escapeHtml(job.description || 'No description')}</p>
      <p><strong>Budget:</strong> ₦${Number(job.budget || job.price || 0).toLocaleString()}</p>
      <div class="job-actions">
        <button class="accept-btn">Accept</button>
        <button class="decline-btn">Reject</button>
        ${lat && lng ? `<button class="map-view-btn" data-lat="${lat}" data-lng="${lng}">View on Map</button>` : ''}
      </div>
    `;

    const noMsg = container.querySelector('.no-requests');
    if (noMsg) noMsg.remove();

    container.prepend(jobCard); // <-- Prepends the job card successfully

    jobCard.querySelector('.accept-btn')?.addEventListener('click', () => handleJobAction(jobCard.dataset.jobId, 'accepted', jobCard));
    jobCard.querySelector('.decline-btn')?.addEventListener('click', () => handleJobAction(jobCard.dataset.jobId, 'rejected', jobCard));

    const mapBtn = jobCard.querySelector('.map-view-btn');
    if (mapBtn) mapBtn.addEventListener('click', () => {
      const lat = mapBtn.dataset.lat; const lng = mapBtn.dataset.lng;
      if (lat && lng) window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
    });
  }
 
(function () {
  let _statusTimeout = null;
  let _hideTimeout = null;

  window.showStatusMessage = function(message, type = "success") {
    const messageBox = document.getElementById("status-message-box");
    if (!messageBox) return console.error("status-message-box missing");

    // Clear running timers
    if (_statusTimeout) clearTimeout(_statusTimeout);
    if (_hideTimeout) clearTimeout(_hideTimeout);

    const isError = type === "error";
    const title = isError ? "Error" : "Success";
    const icon = isError ? "⚠️" : "✔️";
    const bg = isError ? "bg-red-600" : "bg-green-600";

    // Card structure
    messageBox.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-2xl">${icon}</span>
        <div class="text-left">
          <p class="font-bold text-white text-lg">${title}</p>
          <p class="text-white text-sm leading-snug">${message}</p>
        </div>
        <button id="close-status" class="text-white font-bold text-lg ml-3 hover:scale-110 transition">×</button>
      </div>
    `;

    // Classes
    const base =
      "fixed top-5 right-5 z-50 min-w-[320px] max-w-[350px] shadow-2xl rounded-xl p-4" +
      " transition-all duration-500 ease-in-out transform";
    messageBox.className = `${base} ${bg}`;

    // Visibility ON (initial state hidden)
    messageBox.classList.remove("hidden");
    messageBox.style.opacity = "0";
    messageBox.style.transform = "translateY(-15px)";

    void messageBox.offsetHeight;
    requestAnimationFrame(() => {
      messageBox.style.opacity = "1";
      messageBox.style.transform = "translateY(0)";
    });

    // Close button
    document.getElementById("close-status").onclick = hideNow;

    // Auto hide after 4 sec
    _statusTimeout = setTimeout(hideNow, 4000);

    function hideNow() {
      messageBox.style.opacity = "0";
      messageBox.style.transform = "translateY(-15px)";
      _hideTimeout = setTimeout(() => {
        messageBox.classList.add("hidden");
      }, 520);
    }
  };
})();

 async function handleJobAction(jobId, action, jobCard) {
    // 1. Set immediate visual feedback
    if (jobCard) {
        jobCard.querySelector('.job-actions').innerHTML = `<em class="text-indigo-600">Processing ${action}...</em>`;
    }

    try {
        const res = await fetch(`${JOB_API_URL}/${encodeURIComponent(jobId)}`, {
            method: 'PUT', 
            headers: authHeaders(true), 
            body: JSON.stringify({ status: action })
        });
        
        // 2. Handle non-OK responses (400s, 500s)
        if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = `Server responded with status ${res.status}.`;
            try {
                // Try to parse JSON response for a detailed message
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.message || errorMessage;
            } catch {
                // If not JSON, use the raw text or status
                errorMessage = errorText || errorMessage;
            }
            throw new Error(errorMessage);
        }

        // 3. Successful update
        const data = await res.json();
        console.log('Job action response', data);
        
        showStatusMessage(`Job successfully marked as ${action.toUpperCase()}.`, 'success');
socket.on("bookingAccepted", () => {
  showToast("Customer confirmed job ✅");
  loadJobs();
});
        if (jobCard) {
            // Update the card display to reflect the change
            jobCard.querySelector('.job-actions').innerHTML = `<span class="text-green-600 font-bold">Status: ${action.toUpperCase()}</span>`;
            jobCard.style.opacity = '0.7';
        }

        // 4. Refresh Data
        fetchArtisanJobs();
        fetchDashboardSummary();

    } catch (e) { 
        console.error('handleJobAction error', e); 
        const displayError = e.message.includes('Server responded with status 404') 
            ? 'Error: Could not find job or unauthorized.' 
            : `Error: ${e.message}`;
        showStatusMessage(`Could not update job: ${displayError}`, 'error');
        
        if (jobCard) {
            // Revert button text on error
             jobCard.querySelector('.job-actions').innerHTML = `<span class="text-red-600 font-semibold">Failed! Try again.</span>`;
        }
    }
}


  // Fetch pending jobs
  async function fetchArtisanJobs() {
    try {
      const res = await fetch(`${JOB_API_URL}/pending`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to fetch pending jobs');
      const data = await res.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      const container = document.querySelector('.job-requests-container');
      if (!container) return;
      container.innerHTML = '';
      if (jobs.length === 0) {
        container.innerHTML = '<p class="no-requests">No new requests.</p>';
        return;
      }
      // newest first
      jobs.slice().reverse().forEach(updateNewJobCard);
    } catch (e) { console.error('fetchArtisanJobs error', e); const c = document.querySelector('.job-requests-container'); if (c) c.innerHTML = '<p class="no-requests">Error loading requests.</p>'; }
  }

  // Dashboard summary
  async function fetchDashboardSummary() {
    try {
      const res = await fetch(`${ARTISAN_API_URL}/dashboard-summary`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to fetch summary');
      const data = await res.json();
      const items = document.querySelectorAll('.summary-item strong');
      if (items[0]) items[0].textContent = data.activeJobsCount || 0;
      if (items[1]) items[1].textContent = data.newRequestsCount || 0;
      if (items[2]) items[2].textContent = `₦${(data.totalEarnings || 0).toLocaleString()}`;
    } catch (e) { console.error('fetchDashboardSummary error', e); }
  }

  // Job history
  async function fetchJobHistory() {
    try {
      const res = await fetch(`${JOB_API_URL}/job-history`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      renderJobHistory(jobs);
    } catch (e) { console.error('fetchJobHistory error', e); }
  }

  function renderJobHistory(jobs) {
    const container = document.getElementById('jobHistoryList');
    if (!container) return;
    container.innerHTML = '';
    if (!jobs.length) { container.innerHTML = '<p>No completed jobs.</p>'; return; }
    jobs.forEach(job => {
      const category = job.serviceCategory?.name || job.serviceCategory || 'N/A';
      const item = document.createElement('div');
      item.className = 'job-history-item';
      item.innerHTML = `
        <h3>${escapeHtml(category)}</h3>
        <p>Customer: ${escapeHtml(job.customer?.name || 'N/A')}</p>
        <p>Date: ${escapeHtml(new Date(job.completedAt || job.createdAt || job.date || Date.now()).toLocaleDateString())}</p>
        <p>Earnings: <strong style="color:#ffc107;">₦${Number(job.price || job.budget || 0).toLocaleString()}</strong></p>
        <p>Status: <span style="color:#38b45d">${escapeHtml(job.status || 'done')}</span></p>
      `;
      container.appendChild(item);
    });
  }

  // Load profile
  async function loadArtisanProfile() {
    try {
      const res = await fetch(`${ARTISAN_API_URL}/me`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('Failed to fetch profile');
      const data = await res.json();
      document.querySelectorAll('.usernameDisplay').forEach(el => el.textContent = data.name || user.username || 'Artisan');
      document.getElementById('emailDisplay').textContent = data.email || user.email || '';
      document.getElementById('phoneDisplay').textContent = data.phone || user.phone || '';
      document.querySelector('.profile-img').src = data.profilePic || data.avatar || 'https://via.placeholder.com/80';
      const v = document.querySelector('.verified');
      if (v) { v.textContent = data.verification ? '✅ Verified Professional' : 'Not Verified'; v.style.color = data.verification ? '#ffc107' : '#aaa'; }
    } catch (e) { console.error('loadArtisanProfile error', e); }
  }

  // ----- CHAT -----

  async function loadArtisanChats() {
    const container = document.querySelector('.chat-list');
    if (!container) return console.error('chat-list not found');
    container.innerHTML = '<p style="text-align:center;color:#9aa6b2">Loading conversations...</p>';
    if (!token) { container.innerHTML = '<p style="color:red;text-align:center">No token</p>'; return; }
    try {
      const res = await fetch(`${MESSAGE_API_URL}/artisan-chats`, { headers: authHeaders(true) });
      if (!res.ok) { const b = await safeJson(res); console.warn('artisan-chats', res.status, b); container.innerHTML = '<p style="text-align:center;color:#9aa6b2">No chats</p>'; return; }
      const chats = await res.json();
      renderChatList(chats || []);
    } catch (e) { console.error('loadArtisanChats', e); container.innerHTML = '<p style="color:red;text-align:center">Failed to load chats.</p>'; }
  }

  function renderChatList(chats) {
    const container = document.querySelector('.chat-list');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(chats) || chats.length === 0) { container.innerHTML = '<p class="no-chats" style="text-align:center;color:#9aa6b2">No ongoing conversations.</p>'; return; }
    chats.forEach(chat => {
      const other = (chat.participants || []).find(p => (p._id || p.id) !== (user._id || user.id));
      const name = other?.username || other?.name || 'Customer';
      const last = chat.messages && chat.messages.length ? chat.messages[chat.messages.length -1].text : chat.latestMessage?.content || 'Start chat';
      const el = document.createElement('div');
      el.className = 'chat-item';
      el.dataset.chatId = chat._id || chat.id || chat.chatId;
      el.innerHTML = `
        <div class="chat-avatar">${escapeHtml((name[0]||'?').toUpperCase())}</div>
        <div class="chat-details"><div class="chat-name">${escapeHtml(name)}</div><div class="chat-last-msg">${escapeHtml(last)}</div></div>
      `;
      el.addEventListener('click', () => openChat(el.dataset.chatId));
      container.appendChild(el);
    });
  }

  async function openChat(chatId) {
    if (!chatId) return;
    activeChatId = chatId;
    const view = document.getElementById('individualChatView');
    if (view) view.style.display = 'block';
    const msgsEl = document.getElementById('messages');
    if (!msgsEl) return;
    msgsEl.innerHTML = '<p style="text-align:center;color:#9aa6b2">Loading messages...</p>';
    try {
// artisan-home.js (FIXED line in openChat)
const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(chatId)}`, { headers: authHeaders(true) });
      if (!res.ok) { console.warn('openChat fetch failed', res.status); msgsEl.innerHTML = '<p style="color:red;text-align:center">Could not load messages.</p>'; return; }
      const msgs = await res.json();
      renderMessages(msgs || []);
      // set recipient name
      const participant = msgs && msgs.length && (msgs.find(m => m.senderName || m.senderUsername));
      if (participant) document.getElementById('chatRecipientName').textContent = participant.senderName || participant.senderUsername || 'Chat';
    } catch (e) { console.error('openChat error', e); msgsEl.innerHTML = '<p style="color:red;text-align:center">Error loading messages.</p>'; }
  }

  function renderMessages(messages) {
    const msgsEl = document.getElementById('messages');
    if (!msgsEl) return;
    msgsEl.innerHTML = '';
    if (!Array.isArray(messages) || messages.length === 0) { msgsEl.innerHTML = '<p style="text-align:center;color:#9aa6b2">No messages yet.</p>'; return; }
    messages.forEach(m => {
      const isMe = (m.senderId === user._id) || (m.senderId === user.id) || (m.sender === user._id);
      const w = document.createElement('div');
      w.className = 'message-item';
      w.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
      w.style.background = isMe ? '#ffc107' : 'rgba(255,255,255,0.06)';
      w.style.color = isMe ? '#00172b' : '#fff';
      w.style.padding = '6px 8px';
      w.style.marginBottom = '6px';
      w.style.borderRadius = '8px';
      const time = m.createdAt ? fmtDate(m.createdAt) : fmtDate(new Date());
      w.innerHTML = `<div>${escapeHtml(m.text || m.content || '')}</div><div style="font-size:0.7em;opacity:0.75;margin-top:4px">${escapeHtml(time)}</div>`;
      msgsEl.appendChild(w);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById('text');
    const fileInput = document.getElementById('media');
    if (!activeChatId) return alert('Select a chat first');
    const text = input?.value?.trim();
    const file = fileInput?.files && fileInput.files[0];
    if (!text && !file) return;

    try {
      // If file exists, upload
      if (file) {
        const fd = new FormData(); fd.append('file', file);
        const up = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
        if (!up.ok) { console.warn('Media upload failed', up.status); }
        else {
          const info = await up.json();
          // server may push a socket event or return a message — append if provided
          if (info && info.message) appendMessageLocally(info.message);
        }
      }

      if (text) {
        const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/messages`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ text }) });
        if (!res.ok) { const b = await safeJson(res); console.error('send message failed', res.status, b); alert('Failed to send'); return; }
        const sent = await res.json();
        appendMessageLocally(sent.message || sent);
      }

      if (input) input.value = '';
      if (fileInput) fileInput.value = null;
    } catch (e) { console.error('sendMessage error', e); alert('Error sending message'); }
  }

  function appendMessageLocally(msg) {
    if (!msg) return;
    const msgsEl = document.getElementById('messages'); if (!msgsEl) return;
    const isMe = (msg.senderId === user._id) || (msg.senderId === user.id) || (msg.sender === user._id);
    const w = document.createElement('div');
    w.className = 'message-item';
    w.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
    w.style.background = isMe ? '#ffc107' : 'rgba(255,255,255,0.06)';
    w.style.color = isMe ? '#00172b' : '#fff';
    w.style.padding = '6px 8px';
    w.style.marginBottom = '6px';
    w.style.borderRadius = '8px';
    const time = msg.createdAt ? fmtDate(msg.createdAt) : fmtDate(new Date());
    w.innerHTML = `<div>${escapeHtml(msg.text || msg.content || '')}</div><div style="font-size:0.7em;opacity:0.75;margin-top:4px">${escapeHtml(time)}</div>`;
    msgsEl.appendChild(w);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function handleIncomingSocketMessage(payload) {
    const { chatId, message } = payload;
    if (!chatId || !message) return;
    if (String(activeChatId) === String(chatId)) appendMessageLocally(message);
    else {
      // mark unread dot on chat list
      const item = document.querySelector(`[data-chat-id="${chatId}"]`);
      if (item) {
        if (!item.querySelector('.unread-dot')) {
          const dot = document.createElement('span'); dot.className = 'unread-dot'; dot.textContent = ' •'; dot.style.color = '#ffc107'; dot.style.marginLeft = '6px'; item.querySelector('.chat-name')?.appendChild(dot);
        }
      } else {
        // reload list to show new chat
        loadArtisanChats();
      }
    }
  }

  // ----- UI Events -----
  function attachUI() {
    document.getElementById('chatBackBtn')?.addEventListener('click', () => { document.getElementById('individualChatView').style.display = 'none'; activeChatId = null; });
    document.getElementById('sendBtn')?.addEventListener('click', (e) => { e.preventDefault(); sendMessage(); });
    const txt = document.getElementById('text'); if (txt) txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  }

  // ----- NAVIGATION -----
  function showPage(pageId, clickedBtn) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const pg = document.getElementById(pageId); if (pg) pg.style.display = 'block';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (clickedBtn && clickedBtn.classList) clickedBtn.classList.add('active');
    if (pageId === 'historyPage') fetchJobHistory();
    if (pageId === 'jobsPage') loadArtisanChats();
  }
  window.showPage = showPage;

  // ----- INIT -----
  document.addEventListener('DOMContentLoaded', () => {
    attachUI();
    initSocket();
    showPage('homePage', document.querySelector('.nav-btn'));
    loadArtisanProfile();
    fetchDashboardSummary();
    fetchArtisanJobs();
    loadArtisanChats();
  });

})();