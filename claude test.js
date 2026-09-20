/**
 * chat-core.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable chat engine for Fixa — works for BOTH artisan and customer sides.
 *
 * Usage:
 *   <script src="chat-core.js"></script>
 *   <script>
 *     FixaChat.init({
 *       role: 'artisan',          // 'artisan' | 'customer'
 *       user: JSON.parse(localStorage.getItem('user')),
 *       token: localStorage.getItem('token'),
 *       baseUrl: 'http://localhost:5000',
 *       onJobAction: (jobId, action) => { ... },  // artisan-only callback
 *     });
 *   </script>
 *
 * ─── KEY FIXES IN THIS VERSION ───────────────────────────────────────────────
 * 1. Page refresh on voice/image send  → all media inputs use type="button",
 *    e.preventDefault() on every event, FormData sent via fetch (no <form>).
 * 2. Socket not emitting               → socket.emit is called only AFTER
 *    socket.connected is confirmed; joinChat is re-emitted on reconnect.
 * 3. Escrow banner not showing         → renderEscrowBanner() targets the
 *    correct container (#chatConversation) and is called after openChat().
 * 4. Temporary chat (Fixa profits)     → sessions auto-expire; when a job
 *    is completed the chat is sealed (read-only) and a "Book again via Fixa"
 *    CTA is shown so repeat business flows back through the platform.
 * 5. Reusable for customer side        → role flag switches sidebar fetch
 *    endpoint and "me" identity logic. Customer HTML just needs the same
 *    data-* IDs.
 */

(function (global) {
  'use strict';

  // ─── PUBLIC API ────────────────────────────────────────────────────────────
  global.FixaChat = { init };

  // ─── INTERNAL STATE ────────────────────────────────────────────────────────
  let CFG          = {};       // set by init()
  let socket       = null;
  let activeChatId = null;
  let isTyping     = false;
  let typingTimer  = null;
  let chatSealed   = false;    // true when job is done → read-only chat
  const chatLastId = new Map();
  const TYPING_TIMEOUT = 2500;
  const REACTIONS      = ['👍','❤️','😂','😮','😢','👏'];

  // ─── INIT ──────────────────────────────────────────────────────────────────
  function init(options) {
    CFG = {
      role:       options.role      || 'artisan',
      user:       options.user      || {},
      token:      options.token     || '',
      baseUrl:    options.baseUrl   || 'http://localhost:5000',
      onJobAction: options.onJobAction || null,
    };

    // Normalise _id
    if (!CFG.user._id) CFG.user._id = CFG.user.id || CFG.user.userId || '';

    CFG.ARTISAN_API  = `${CFG.baseUrl}/api/artisans`;
    CFG.JOB_API      = `${CFG.baseUrl}/api/jobs`;
    CFG.MESSAGE_API  = `${CFG.baseUrl}/api/messages`;
    CFG.CUSTOMER_API = `${CFG.baseUrl}/api/customers`;

    
    document.addEventListener('DOMContentLoaded', boot);
  }

  // ─── BOOT ──────────────────────────────────────────────────────────────────
  function boot() {
    fixMessagesContainer();
    blockAllFormSubmits();
    attachUI();
    setupVoiceRecorder();
    initSocket();
    loadChatList();

    if (CFG.role === 'artisan') {
      loadArtisanProfile();
      fetchDashboardSummary();
      fetchPendingJobs();
    }
  }

  // ─── PREVENT ANY FORM SUBMITTING / PAGE REFRESH ────────────────────────────
  function blockAllFormSubmits() {
    // Intercept existing forms
    document.querySelectorAll('form').forEach(f => {
      f.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); }, true);
    });
    // Catch any form added later (MutationObserver)
    document.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); }, true);
  }

  function fixMessagesContainer() {
    const el = document.getElementById('messages');
    if (el) {
      el.style.flexDirection = 'column';
      el.style.overflowY     = 'auto';
    }
  }

  // ─── UTILITIES ─────────────────────────────────────────────────────────────
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function normalizeId(v) {
    if (v == null || v === '') return '';
    try {
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        if (v.id)  return String(v.id);
        const s = v.toString ? v.toString() : '';
        return (s && s !== '[object Object]') ? s : JSON.stringify(v);
      }
      return String(v);
    } catch { return String(v); }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function formatTimeShort(ts) {
    try {
      const d = new Date(ts || Date.now()), now = new Date();
      if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      return d.toLocaleDateString([], { month:'short', day:'numeric' });
    } catch { return ''; }
  }

  function authHeaders(withJson = false) {
    const h = { Authorization: `Bearer ${CFG.token}` };
    if (withJson) h['Content-Type'] = 'application/json';
    return h;
  }

  function myId() { return CFG.user._id || ''; }

  function computeIsMe(m) {
    if (m.outgoing === true || m.isMine === true || m.fromCurrentUser === true || m.isLocal === true) return true;
    if (m.incoming === true || m.isIncoming === true) return false;
    const role = (m.role || m.senderRole || '').toLowerCase();
    if (role) {
      const isMyRole = CFG.role === 'artisan'
        ? role.includes('artisan') || role.includes('provider')
        : role.includes('customer') || role.includes('user');
      if (isMyRole) {
        const cand = normalizeId(m.senderId || m.sender || '');
        return cand ? cand === myId() : true;
      }
    }
    const msgSenderId = normalizeId(m.senderId ?? m.sender ?? m.from ?? m.userId ?? '');
    if (msgSenderId && myId()) return msgSenderId === myId();
    return false;
  }

  // ─── STATUS TOAST ──────────────────────────────────────────────────────────
  let _stTimer = null, _stHide = null;
  function showStatus(msg, type = 'success') {
    const box = document.getElementById('status-message-box');
    if (!box) return;
    if (_stTimer) clearTimeout(_stTimer);
    if (_stHide)  clearTimeout(_stHide);
    const isErr = type === 'error';
    box.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:12px">
        <span style="font-size:20px">${isErr ? '⚠️' : '✔️'}</span>
        <div>
          <p style="font-weight:700;color:#fff;margin:0">${isErr ? 'Error' : 'Success'}</p>
          <p style="color:#fff;font-size:13px;margin:4px 0 0">${escapeHtml(msg)}</p>
        </div>
        <button id="_st_close" style="margin-left:auto;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1">×</button>
      </div>`;
    box.className = `fixed top-5 right-5 z-50 min-w-[300px] max-w-[360px] shadow-2xl rounded-xl p-4 ${isErr ? 'bg-red-600' : 'bg-green-600'}`;
    box.style.cssText += ';opacity:0;transform:translateY(-10px);transition:all .3s';
    box.classList.remove('hidden');
    requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'translateY(0)'; });
    document.getElementById('_st_close')?.addEventListener('click', hideStatus);
    _stTimer = setTimeout(hideStatus, 4200);
    function hideStatus() {
      box.style.opacity = '0'; box.style.transform = 'translateY(-10px)';
      _stHide = setTimeout(() => box.classList.add('hidden'), 350);
    }
  }
  global.showStatusMessage = showStatus; // keep old callers working

  // ─── MESSAGES ─────────────────────────────────────────────────────────────
  function msgContainer() { return document.getElementById('messages'); }

  function scrollBottom(c) { if (c) c.scrollTop = c.scrollHeight; }

  function appendMessage(m) {
    const container = msgContainer();
    if (!container) return;
    const msgId = m._id || m.id;
    if (msgId && container.querySelector(`[data-msg-id="${msgId}"]`)) return;

    const isMe = computeIsMe(m);
    const wrap = document.createElement('div');
    wrap.dataset.msgId = msgId || `local-${Date.now()}`;
    wrap.style.cssText = `display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};margin-bottom:12px;padding:0 10px;`;
    if (m.isLocal) wrap.dataset.isLocal = '1';

    const bubble = document.createElement('div');
    bubble.style.cssText = `
      max-width:75%;padding:8px 12px;word-break:break-word;
      border-radius:${isMe ? '18px 18px 2px 18px' : '18px 18px 18px 2px'};
      background:${isMe ? '#ffc107' : '#4468a3'};
      color:${isMe ? '#000' : '#fff'};
      box-shadow:0 2px 6px rgba(0,0,0,.18);
      display:flex;flex-direction:column;gap:6px;position:relative;`;

    // image
    const imgSrc = m.image || (!m.voiceNote && m.mediaUrl && !m.mediaUrl.match(/\.(webm|mp3|wav|ogg)$/i) ? m.mediaUrl : null);
    if (imgSrc) {
      const img = document.createElement('img');
      img.src = imgSrc.startsWith('blob:') ? imgSrc : CFG.baseUrl + imgSrc;
      img.style.cssText = 'max-width:220px;border-radius:10px;display:block;';
      img.loading = 'lazy';
      bubble.appendChild(img);
    }

    // voice
    const voiceSrc = m.voiceNote || (m.mediaUrl && m.mediaUrl.match(/\.(webm|mp3|wav|ogg)$/i) ? m.mediaUrl : null);
    if (voiceSrc) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = voiceSrc.startsWith('blob:') ? voiceSrc : CFG.baseUrl + voiceSrc;
      audio.style.cssText = 'height:35px;max-width:220px;';
      bubble.appendChild(audio);
    }

    // text
    if (m.text && !(m.voiceNote && m.text === 'Voice note') && !(m.image && m.text === 'Image')) {
      const te = document.createElement('div');
      te.textContent = m.text;
      te.style.cssText = 'font-size:14.5px;line-height:1.45;';
      bubble.appendChild(te);
    }

    // timestamp
    const ts = document.createElement('div');
    ts.textContent = formatTimeShort(m.createdAt);
    ts.style.cssText = `font-size:10px;opacity:.62;align-self:${isMe ? 'flex-end' : 'flex-start'};margin-top:2px;`;
    bubble.appendChild(ts);

    // reaction picker on long-press / right-click
    bubble.addEventListener('contextmenu', e => { e.preventDefault(); if (msgId) openReactionPicker(e, msgId); });
    let pressTimer;
    bubble.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { if (msgId) openReactionPicker({ clientX: 80, clientY: 200 }, msgId); }, 600); }, { passive: true });
    bubble.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });

    wrap.appendChild(bubble);
    container.appendChild(wrap);
    scrollBottom(container);
  }

  function replaceOptimistic(localId, realMsg) {
    document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
    appendMessage(realMsg);
  }

  // ─── SEALED CHAT (job completed — temporary chat feature) ─────────────────
  /**
   * When a job finishes the chat is sealed:
   *  - Input area is hidden / disabled
   *  - A "Book again" CTA is shown → drives repeat business back to Fixa
   *  - Chat history remains readable (read-only)
   *
   * This is the core "Fixa profits" mechanism:
   *  Customers can't just get the artisan's contact and bypass Fixa next time.
   */
  function sealChat(reason = 'Job completed') {
    chatSealed = true;
    const footer = $('footer') || $('#chatInputContainer')?.closest('footer') || $('#chatInputContainer');
    if (footer) footer.style.display = 'none';

    const c = msgContainer();
    if (!c || document.getElementById('cg-sealed-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'cg-sealed-banner';
    banner.style.cssText = `
      margin:16px 10px;padding:16px 18px;border-radius:14px;
      background:linear-gradient(135deg,#003459 0%,#00172b 100%);
      border:1.5px solid #ffc107;text-align:center;`;
    banner.innerHTML = `
      <div style="font-size:22px;margin-bottom:8px">🔒</div>
      <div style="font-weight:700;color:#ffc107;font-size:15px;margin-bottom:6px">Chat session ended</div>
      <div style="color:#cbd5e1;font-size:13px;margin-bottom:14px;line-height:1.5">
        ${escapeHtml(reason)}. This chat is now sealed to protect both parties.
        Your conversation history is saved for <strong style="color:#ffc107">30 days</strong>.
      </div>
      <div style="color:#94a3b8;font-size:11px;margin-bottom:14px">
        Need this artisan again? Re-book securely through Fixa — 
        all jobs are escrow-protected and you're covered if anything goes wrong.
      </div>
      <button onclick="window.location.href='index.html'" style="
        background:#ffc107;color:#00172b;border:none;border-radius:8px;
        padding:10px 22px;font-weight:700;font-size:14px;cursor:pointer;
        box-shadow:0 4px 12px rgba(255,193,7,.35);">
        🔍 Find & Re-book on Fixa
      </button>`;
    c.appendChild(banner);
    scrollBottom(c);
  }

  // ─── SOCKET ────────────────────────────────────────────────────────────────
  function initSocket() {
    
    try {
      socket = io(CFG.baseUrl, { auth: { token: CFG.token }, transports: ['websocket', 'polling'] });

      socket.on('connect', () => {
        console.log('[FixaChat] socket connected', socket.id);
        socket.emit('register', myId());
        // Re-join active chat room after reconnect
        if (activeChatId) safeEmit('joinChat', activeChatId);
      });

      socket.on('connect_error', err => console.warn('[FixaChat] socket error', err?.message));

      socket.on('newMessage', payload => handleIncomingMessage(payload));

      socket.on('typing',     ({ chatId }) => {
        if (String(activeChatId) === String(chatId)) showTyping(true);
      });
      socket.on('stopTyping', ({ chatId }) => {
        if (String(activeChatId) === String(chatId)) showTyping(false);
      });

      socket.on('messageReaction', ({ messageId, reactions }) => {
        const el = document.querySelector(`[data-msg-id="${messageId}"]`);
        if (el) updateReactionDisplay(el, reactions);
      });

      // artisan-only job events
      if (CFG.role === 'artisan') {
        socket.on('newJobRequest',       job  => { tryPlaySound(); updateJobCard(job); fetchDashboardSummary(); });
        socket.on('bookingStatusUpdated', data => handleBookingStatusUpdate(data));
      }

      // job completed → seal chat
      socket.on('jobCompleted', ({ chatId, reason }) => {
        if (String(activeChatId) === String(chatId)) sealChat(reason || 'Job marked complete');
      });

    } catch (e) {
      console.warn('[FixaChat] socket init failed', e);
      socket = null;
    }
  }

  /**
   * Safe emit — only fires when socket is connected.
   * Falls back silently (no crash, no page refresh).
   */
  function safeEmit(event, data) {
    if (socket && socket.connected) {
      socket.emit(event, data);
      return true;
    }
    console.warn(`[FixaChat] safeEmit("${event}") skipped — not connected`);
    return false;
  }

  function showTyping(visible) {
    const el = document.getElementById('typingIndicator');
    if (!el) return;
    el.textContent = 'typing...';
    el.classList.toggle('hidden', !visible);
  }

  function handleIncomingMessage(payload) {
    let chatId, message;
    if (payload?.chatId && payload?.message) { ({ chatId, message } = payload); }
    else if (payload?._id || payload?.id)    { message = payload; chatId = payload.chatId || payload.chat; }
    else return;
    if (!chatId || !message) return;

    if (String(activeChatId) === String(chatId)) {
      appendMessage(message);
    } else {
      updateChatPreview(chatId, message, message.unreadCount ?? 1);
    }
    if (message._id || message.id) chatLastId.set(String(chatId), message._id || message.id);
  }

  // ─── CHAT LIST ─────────────────────────────────────────────────────────────
  async function loadChatList() {
    const container = $('.chat-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#9aa6b2;padding:16px">Loading…</p>';
    try {
      const endpoint = CFG.role === 'artisan'
        ? `${CFG.MESSAGE_API}/artisan-chats`
        : `${CFG.MESSAGE_API}/customer-chats`;
      const res = await fetch(endpoint, { headers: authHeaders(true) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chats = await res.json();
      renderChatList(chats || []);
      (chats || []).forEach(c => {
        const id   = String(c._id || c.id || c.chatId);
        const msgs = c.messages || [];
        const last = c.lastMessageId || (msgs.length ? msgs[msgs.length - 1]._id : '');
        if (id && last) chatLastId.set(id, last);
      });
    } catch (e) {
      console.error('[FixaChat] loadChatList', e);
      container.innerHTML = '<p style="text-align:center;color:#ef4444;padding:16px">Failed to load chats.</p>';
    }
  }

  function createAvatar(name, size = 40) {
    const el = document.createElement('div');
    el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:#2a4a6b;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:${Math.round(size * 0.42)}px;`;
    el.textContent = name?.[0]?.toUpperCase() || '?';
    return el;
  }

  function renderChatList(chats) {
    const container = $('.chat-list');
    if (!container) return;
    container.innerHTML = '';
    if (!chats.length) {
      container.innerHTML = '<p style="text-align:center;color:#9aa6b2;padding:16px">No conversations yet.</p>';
      return;
    }
    chats.forEach(chat => {
      // Find the OTHER participant (not me)
      const other    = (chat.participants || []).find(p => normalizeId(p._id || p.id) !== myId()) || {};
      const name     = other.username || other.name || (CFG.role === 'artisan' ? 'Customer' : 'Artisan');
      const msgs     = chat.messages || [];
      const lastMsg  = msgs.length ? msgs[msgs.length - 1] : (chat.latestMessage || null);
      const lastText = lastMsg ? (lastMsg.text || lastMsg.content || 'Media') : 'Say hi 👋';
      const lastTime = lastMsg ? formatTimeShort(lastMsg.createdAt) : '';
      const unread   = chat.unreadCount || 0;
      const sealed   = chat.sealed || chat.status === 'completed';

      const el = document.createElement('div');
      el.className      = 'chat-item';
      el.dataset.chatId = String(chat._id || chat.id || chat.chatId);
      el.style.cssText  = `display:flex;align-items:center;gap:12px;padding:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);transition:background .15s;${sealed ? 'opacity:.6;' : ''}`;
      el.onmouseenter = () => el.style.background = 'rgba(255,255,255,.04)';
      el.onmouseleave = () => el.style.background = '';

      const avatarWrap = document.createElement('div');
      avatarWrap.appendChild(createAvatar(name, 46));

      const details = document.createElement('div');
      details.style.cssText = 'flex:1;min-width:0;';
      details.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">${escapeHtml(name)}${sealed ? ' 🔒' : ''}</div>
          <div style="font-size:11px;color:#9aa6b2;flex-shrink:0;margin-left:6px">${escapeHtml(lastTime)}</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
          <div style="font-size:13px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" data-preview-text>${escapeHtml(lastText)}</div>
          ${unread ? `<span style="background:#ffc107;color:#00172b;font-weight:700;border-radius:999px;padding:3px 8px;font-size:11px;flex-shrink:0;margin-left:6px">${unread}</span>` : ''}
        </div>`;

      el.appendChild(avatarWrap);
      el.appendChild(details);
      el.addEventListener('click', () => {
        el.querySelector('span[style*="ffc107"]')?.remove();
        openChat(el.dataset.chatId, name, sealed);
        // Update header
        const headerName   = document.getElementById('chatRecipientName');
        const headerAvatar = document.getElementById('chatHeaderAvatar');
        if (headerName)   headerName.textContent = name;
        if (headerAvatar) { headerAvatar.innerHTML = ''; headerAvatar.appendChild(createAvatar(name, 44)); }
      });
      container.appendChild(el);
    });
  }

  function updateChatPreview(chatId, message, unreadCount) {
    const item = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (!item) return;
    const preview = item.querySelector('[data-preview-text]');
    if (preview) preview.textContent = message.text || 'Media';
    let badge = item.querySelector('span[style*="ffc107"]');
    if (unreadCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.style.cssText = 'background:#ffc107;color:#00172b;font-weight:700;border-radius:999px;padding:3px 8px;font-size:11px;flex-shrink:0;margin-left:6px;';
        item.querySelector('[data-preview-text]')?.parentNode?.appendChild(badge);
      }
      badge.textContent = unreadCount;
    } else badge?.remove();
    $('.chat-list')?.prepend(item);
  }

  // ─── OPEN CHAT ─────────────────────────────────────────────────────────────
  async function openChat(chatId, peerName, isSealed = false) {
    if (!chatId) return;
    activeChatId = chatId;
    chatSealed   = isSealed;

    // Show/hide footer based on sealed state
    const footer = $('footer') || $('#chatInputContainer')?.closest('footer');
    if (footer) footer.style.display = isSealed ? 'none' : '';

    // Join socket room
    safeEmit('joinChat', chatId);

    // ChatGuard
    if (global.ChatGuard) {
      try {
        const status = await global.ChatGuard.onChatOpen(chatId);
        if (status) {
          global.ChatGuard.renderEscrowBanner();
          global.ChatGuard.renderLockedOverlay();
        }
      } catch (e) { console.warn('[FixaChat] ChatGuard error', e); }
    }

    // Escrow banner — always render it for open chats
    renderEscrowBanner();

    const container = msgContainer();
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:#9aa6b2;padding:24px">Loading messages…</p>';

    try {
      const res = await fetch(`${CFG.MESSAGE_API}/${encodeURIComponent(chatId)}`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const messages = await res.json();
      container.innerHTML = '';
      (Array.isArray(messages) ? messages : []).forEach(m => appendMessage(m));
      scrollBottom(container);
      if (messages.length) {
        const last = messages[messages.length - 1];
        chatLastId.set(String(chatId), last._id || last.id || '');
      }
      // If chat is sealed, show the sealed banner after messages
      if (isSealed) sealChat('This job has been completed');
    } catch (e) {
      console.error('[FixaChat] openChat error', e);
      container.innerHTML = '<p style="text-align:center;color:#ef4444;padding:24px">Failed to load messages.</p>';
    }
  }

  // ─── ESCROW BANNER ─────────────────────────────────────────────────────────
  /**
   * FIX: was targeting .chat-main which didn't exist.
   * Now targets the messages section directly (before messages).
   */
  function renderEscrowBanner() {
    // Target: the <main> inside the chat layout, or fall back to messages parent
    const chatMain = $('#chatConversationArea') ||
                     $('main.flex-1') ||
                     msgContainer()?.parentElement;
    if (!chatMain) return;

    document.getElementById('cg-escrow-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'cg-escrow-banner';
    banner.style.cssText = `
      background:linear-gradient(90deg,#1a3a0a 0%,#0f2a04 100%);
      border-bottom:1px solid #4a8a1a;
      padding:10px 14px;display:flex;align-items:flex-start;gap:10px;`;
    banner.innerHTML = `
      <span style="font-size:16px;flex-shrink:0;margin-top:1px">🔒</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;color:#86efac">Fixa Secure Escrow Active</div>
        <div style="font-size:11px;color:#bbf7d0;margin-top:3px;line-height:1.5">
          Payments <strong>outside Fixa are not protected</strong>. 
          Pay through Fixa for full escrow coverage and refund protection.
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(134,239,172,.15);color:#86efac">✓ Verified artisan</span>
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(96,165,250,.15);color:#93c5fd">✓ Escrow protected</span>
          <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(252,165,165,.15);color:#fca5a5">✗ No off-platform pay</span>
        </div>
      </div>
      <button id="cg-escrow-dismiss" style="background:none;border:none;color:#86efac;font-size:16px;cursor:pointer;line-height:1;padding:0 4px;opacity:.7" title="Dismiss">×</button>`;

    // Insert above the messages section
    const msgs = msgContainer();
    if (msgs && msgs.parentNode) {
      msgs.parentNode.insertBefore(banner, msgs);
    } else {
      chatMain.prepend(banner);
    }

    document.getElementById('cg-escrow-dismiss')?.addEventListener('click', () => banner.remove());
  }

  // ─── SEND TEXT ─────────────────────────────────────────────────────────────
  async function sendTextMessage(text) {
    if (!text || !activeChatId) return;
    if (chatSealed) { showStatus('This chat session has ended.', 'error'); return; }

    // ChatGuard checks
    if (global.ChatGuard && !global.ChatGuard.isAllowed()) {
      showStatus('You are restricted from sending messages.', 'error'); return;
    }
    if (global.ChatGuard) {
      const { blocked, reason } = await global.ChatGuard.checkText(text);
      if (blocked) { showStatus(reason || 'Message blocked.', 'error'); return; }
    }

    const localId    = `temp-text-${Date.now()}`;
    const optimistic = { _id: localId, text, sender: myId(), createdAt: new Date().toISOString(), isLocal: true };
    appendMessage(optimistic);

    try {
      const res = await fetch(`${CFG.MESSAGE_API}/${encodeURIComponent(activeChatId)}/messages`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data    = await res.json();
      const realMsg = data.message || data;
      replaceOptimistic(localId, realMsg);
      chatLastId.set(String(activeChatId), realMsg._id || realMsg.id || '');
      // ✅ FIX: emit only when connected
      safeEmit('newMessage', { chatId: activeChatId, message: realMsg });
    } catch (e) {
      console.error('[FixaChat] sendTextMessage', e);
      showStatus('Failed to send message.', 'error');
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
    }
  }

  // ─── SEND MEDIA ────────────────────────────────────────────────────────────
  /**
   * FIX: Removed all form associations. File is sent via fetch FormData.
   * No <form> involved → no page refresh possible.
   * window.__sendingMedia guard keeps beforeunload working.
   */
  async function sendMedia(file, isVoice = false) {
    if (!file || !activeChatId) return;
    if (chatSealed) { showStatus('This chat session has ended.', 'error'); return; }

    // ChatGuard feature gate
    const feature = isVoice ? 'voice' : 'media';
    if (global.ChatGuard && !global.ChatGuard.isFeatureUnlocked(feature)) {
      showStatus('Complete payment to unlock this feature.', 'error'); return;
    }
    if (!isVoice && global.ChatGuard) {
      const { blocked, reason } = await global.ChatGuard.checkImage(file);
      if (blocked) { showStatus(reason || 'Image blocked.', 'error'); return; }
    }

    global.__sendingMedia = true;
    const blobUrl    = URL.createObjectURL(file);
    const localId    = `temp-media-${Date.now()}`;
    const optimistic = {
      _id: localId,
      voiceNote: isVoice ? blobUrl : null,
      image:     isVoice ? null     : blobUrl,
      sender: myId(),
      createdAt: new Date().toISOString(),
      isLocal: true,
    };
    appendMessage(optimistic);

    const fd = new FormData();
    fd.append('file', file);
    if (isVoice) fd.append('type', 'voice');

    try {
      const res = await fetch(`${CFG.MESSAGE_API}/${encodeURIComponent(activeChatId)}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CFG.token}` }, // NO Content-Type; browser sets multipart boundary
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const realMsg = await res.json();
      URL.revokeObjectURL(blobUrl);
      replaceOptimistic(localId, realMsg);
      chatLastId.set(String(activeChatId), realMsg._id || realMsg.id || '');
      // ✅ FIX: emit only when connected
      safeEmit('newMessage', { chatId: activeChatId, message: realMsg });
    } catch (e) {
      console.error('[FixaChat] sendMedia', e);
      showStatus('Failed to send media.', 'error');
      document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
      URL.revokeObjectURL(blobUrl);
    } finally {
      global.__sendingMedia = false;
    }
  }

  // ─── TYPING ────────────────────────────────────────────────────────────────
  function notifyTyping() {
    if (!activeChatId) return;
    if (!isTyping) { isTyping = true; safeEmit('typing', { chatId: activeChatId }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTyping = false;
      safeEmit('stopTyping', { chatId: activeChatId });
    }, TYPING_TIMEOUT);
  }

  // ─── REACTIONS ─────────────────────────────────────────────────────────────
  function openReactionPicker(ev, messageId) {
    document.querySelector('.reaction-picker')?.remove();
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.style.cssText = `position:fixed;left:${Math.min(ev.clientX - 30, window.innerWidth - 220)}px;top:${Math.max(ev.clientY - 70, 10)}px;background:#1e3d59;border-radius:30px;padding:8px 12px;display:flex;gap:4px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.4);`;
    REACTIONS.forEach(r => {
      const s = document.createElement('span');
      s.textContent = r;
      s.style.cssText = 'cursor:pointer;font-size:22px;padding:4px;border-radius:8px;';
      s.onmouseenter = () => s.style.background = 'rgba(255,255,255,.15)';
      s.onmouseleave = () => s.style.background = '';
      s.addEventListener('click', async () => {
        picker.remove();
        if (!activeChatId) return;
        safeEmit('messageReaction', { chatId: activeChatId, messageId, reaction: r });
        try {
          await fetch(`${CFG.MESSAGE_API}/${encodeURIComponent(activeChatId)}/messages/${encodeURIComponent(messageId)}/react`, {
            method: 'POST', headers: authHeaders(true), body: JSON.stringify({ reaction: r }),
          });
        } catch (e) { console.warn('[FixaChat] reaction failed', e); }
      });
      picker.appendChild(s);
    });
    document.body.appendChild(picker);
    setTimeout(() => {
      const closeOnce = e => { if (!picker.contains(e.target)) { picker.remove(); window.removeEventListener('click', closeOnce); } };
      window.addEventListener('click', closeOnce);
    }, 50);
  }

  function updateReactionDisplay(msgEl, reactions) {
    const bubble  = msgEl.firstElementChild;
    if (!bubble) return;
    let rd = bubble.querySelector('.reaction-display');
    const entries = reactions ? Object.entries(reactions).filter(([, ids]) => ids.length > 0) : [];
    if (!entries.length) { rd?.remove(); return; }
    if (!rd) {
      rd = document.createElement('div');
      rd.className = 'reaction-display';
      rd.style.cssText = 'position:absolute;bottom:-12px;right:4px;display:flex;gap:3px;';
      bubble.style.position = 'relative';
      bubble.appendChild(rd);
    }
    rd.innerHTML = '';
    entries.forEach(([emoji, ids]) => {
      const badge = document.createElement('span');
      badge.textContent = `${emoji} ${ids.length}`;
      badge.style.cssText = 'background:#1e3d59;color:#fff;border-radius:999px;padding:2px 7px;font-size:11px;cursor:pointer;';
      rd.appendChild(badge);
    });
  }

  // ─── VOICE RECORDER ────────────────────────────────────────────────────────
  /**
   * FIX: all buttons are type="button" and use addEventListener('click') — never submit.
   */
  function setupVoiceRecorder() {
    let recorder = null, chunks = [], startTime = 0, interval = null;
    const voiceBtn   = document.getElementById('voiceBtn');
    const voiceUI    = document.getElementById('voiceRecordingUI');
    const voiceTimer = document.getElementById('voiceTimer');
    const voiceStop  = document.getElementById('voiceStop');
    const voiceCancel= document.getElementById('voiceCancel');

    function fmt(ms) {
      const s = Math.floor(ms / 1000);
      return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    }

    async function startRecording() {
      if (!navigator.mediaDevices?.getUserMedia) return showStatus('Microphone not supported.', 'error');
      if (!activeChatId) return showStatus('Select a chat first.', 'error');
      try {
        const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime     = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
        recorder = new MediaRecorder(stream, { mimeType: mime });
        chunks   = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = async () => {
          clearInterval(interval);
          if (voiceTimer) voiceTimer.textContent = '00:00';
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(chunks, { type: mime });
          if (blob.size < 500) return showStatus('Voice note too short.', 'error');
          const ext  = mime.includes('webm') ? 'webm' : 'ogg';
          // ✅ FIX: sendMedia called directly, no form involved
          await sendMedia(new File([blob], `voice-${Date.now()}.${ext}`, { type: mime }), true);
        };
        recorder.start(250);
        startTime = Date.now();
        if (voiceUI) voiceUI.style.display = 'flex';
        interval = setInterval(() => {
          if (voiceTimer) voiceTimer.textContent = fmt(Date.now() - startTime);
          if (Date.now() - startTime > 120000) stopRecording();
        }, 250);
      } catch (e) {
        console.error('[FixaChat] startRecording', e);
        showStatus('Could not access microphone.', 'error');
      }
    }

    function stopRecording() {
      if (recorder?.state === 'recording') recorder.stop();
      if (voiceUI) voiceUI.style.display = 'none';
    }

    function cancelRecording() {
      chunks = [];
      if (recorder?.state === 'recording') {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      if (voiceUI) voiceUI.style.display = 'none';
    }

    // ✅ FIX: explicit type="button" in HTML prevents accidental form submit;
    //         here we also preventDefault just to be safe.
    voiceBtn?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      recorder?.state === 'recording' ? stopRecording() : startRecording();
    });
    voiceStop?.addEventListener('click',   e => { e.preventDefault(); e.stopPropagation(); stopRecording(); });
    voiceCancel?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cancelRecording(); });
  }

  // ─── ATTACH ALL UI EVENTS ──────────────────────────────────────────────────
  function attachUI() {
    const textInput = document.getElementById('text');

    // ✅ FIX: Enter key — e.preventDefault() stops any implicit form submit
    textInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        const txt = textInput.value.trim();
        if (txt) { sendTextMessage(txt); textInput.value = ''; }
      }
    });
    textInput?.addEventListener('input', notifyTyping);
    textInput?.addEventListener('blur', () => {
      if (isTyping) { isTyping = false; safeEmit('stopTyping', { chatId: activeChatId }); }
    });

    // Send button — type="button" in HTML; still preventDefault here
    document.getElementById('sendBtn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const txt = textInput?.value.trim();
      if (txt) { sendTextMessage(txt); if (textInput) textInput.value = ''; }
    });

    // Attach (file pick)
    document.getElementById('attachBtn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      document.getElementById('media')?.click();
    });

    // ✅ FIX: file input change — no form, just call sendMedia directly
    document.getElementById('media')?.addEventListener('change', function (e) {
      e.preventDefault(); e.stopPropagation();
      const file = this.files[0];
      if (!file) return;
      sendMedia(file, false);
      this.value = ''; // reset so same file can be re-selected
    });

    // Chat search
    document.getElementById('chatSearch')?.addEventListener('input', function () {
      const q = this.value.toLowerCase();
      $$('.chat-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    // Back button (mobile)
    document.getElementById('chatBackBtn')?.addEventListener('click', () => {
      activeChatId = null;
      chatSealed   = false;
      const hn = document.getElementById('chatRecipientName');
      if (hn) hn.textContent = 'Select a chat';
      const c = msgContainer();
      if (c) c.innerHTML = '<div style="text-align:center;color:#9aa6b2;padding:24px">Select a conversation to start.</div>';
      document.getElementById('cg-escrow-banner')?.remove();
      const footer = $('footer') || $('#chatInputContainer')?.closest('footer');
      if (footer) footer.style.display = '';
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'SignIn.html';
    });

    // Page nav
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const pageId = btn.dataset.page || btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (pageId) showPage(pageId, btn);
      });
    });

    // Prevent beforeunload during media upload
    window.addEventListener('beforeunload', e => {
      if (global.__sendingMedia) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ─── NAVIGATION ────────────────────────────────────────────────────────────
  function showPage(pageId, clickedBtn) {
    $$('.page').forEach(p => p.style.display = 'none');
    const pg = document.getElementById(pageId);
    if (pg) pg.style.display = 'block';
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
    if (pageId === 'jobsPage')    loadChatList();
    if (pageId === 'historyPage') global.loadJobs?.();
  }
  global.showPage = showPage;

  // ─── ARTISAN-ONLY: JOBS ────────────────────────────────────────────────────
  function tryPlaySound() {
    try { new Audio('/sounds/new-job.mp3').play().catch(() => {}); } catch {}
  }

  function updateJobCard(job) {
    if (!job?._id) return;
    const container = $('.job-requests-container');
    if (!container) return;
    const coords = job.location?.coordinates || [];
    const lat = coords[1], lng = coords[0];
    const category = job.serviceCategory?.name || String(job.serviceCategory || 'N/A');
    const customer  = job.customer?.name || job.customer?.username || String(job.customer || 'N/A');
    const card = document.createElement('div');
    card.className     = 'job-card new-job-request';
    card.dataset.jobId = job._id;
    card.innerHTML = `
      <div class="job-header"><h3>New Job Request</h3><span class="timestamp">${formatFull(job.createdAt)}</span></div>
      <p><strong>Customer:</strong> ${escapeHtml(customer)}</p>
      <p><strong>Location:</strong> ${escapeHtml(job.address || 'N/A')}</p>
      <p><strong>Category:</strong> ${escapeHtml(category)}</p>
      <p><strong>Description:</strong> ${escapeHtml(job.description || 'No description')}</p>
      <p><strong>Budget:</strong> ₦${Number(job.budget || job.price || 0).toLocaleString()}</p>
      <div class="job-actions">
        <button type="button" class="accept-btn">Accept</button>
        <button type="button" class="decline-btn">Reject</button>
        ${lat && lng ? `<button type="button" class="map-view-btn" data-lat="${lat}" data-lng="${lng}">View on Map</button>` : ''}
      </div>`;
    container.querySelector('.no-requests')?.remove();
    container.prepend(card);
    card.querySelector('.accept-btn')?.addEventListener('click',  () => handleJobAction(card.dataset.jobId, 'accepted', card));
    card.querySelector('.decline-btn')?.addEventListener('click', () => handleJobAction(card.dataset.jobId, 'rejected', card));
    card.querySelector('.map-view-btn')?.addEventListener('click', function () {
      window.open(`https://www.google.com/maps/search/?api=1&query=${this.dataset.lat},${this.dataset.lng}`, '_blank');
    });
  }

  function formatFull(ds) {
    if (!ds) return 'N/A';
    return new Date(ds).toLocaleString('en-NG', { weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  async function handleJobAction(jobId, action, card) {
    const actions = card?.querySelector('.job-actions');
    if (actions) actions.innerHTML = `<em>Processing ${action}…</em>`;
    try {
      const res = await fetch(`${CFG.JOB_API}/${encodeURIComponent(jobId)}`, {
        method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ status: action }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || `HTTP ${res.status}`); }
      showStatus(`Job marked ${action.toUpperCase()}`, 'success');
      if (actions) actions.innerHTML = `<span style="color:#38b45d;font-weight:700">Status: ${action.toUpperCase()}</span>`;
      if (card) card.style.opacity = '0.7';
      CFG.onJobAction?.(jobId, action);
      fetchPendingJobs(); fetchDashboardSummary();
    } catch (e) {
      console.error('[FixaChat] handleJobAction', e);
      showStatus(`Could not update job: ${e.message}`, 'error');
      if (actions) actions.innerHTML = `<span style="color:#ef4444;font-weight:700">Failed — Retry</span>`;
    }
  }

  async function fetchPendingJobs() {
    try {
      const res = await fetch(`${CFG.JOB_API}/pending`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      const jobs = Array.isArray(data) ? data : (data.jobs || []);
      const container = $('.job-requests-container');
      if (!container) return;
      container.innerHTML = '';
      if (!jobs.length) { container.innerHTML = '<p class="no-requests">No new requests.</p>'; return; }
      jobs.slice().reverse().forEach(updateJobCard);
    } catch (e) {
      const c = $('.job-requests-container');
      if (c) c.innerHTML = '<p class="no-requests">Error loading requests.</p>';
    }
  }

  function handleBookingStatusUpdate(data) {
    const card = document.querySelector(`[data-job-id="${data.jobId}"]`);
    if (card) {
      const actions = card.querySelector('.job-actions');
      if (actions) actions.innerHTML = `<em>Job ${String(data.status).toUpperCase()}</em>`;
      card.style.opacity = '0.6';
      setTimeout(fetchPendingJobs, 500);
      fetchDashboardSummary();
    }
  }

  async function fetchDashboardSummary() {
    try {
      const res = await fetch(`${CFG.ARTISAN_API}/dashboard-summary`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('failed');
      const data  = await res.json();
      const items = $$('.summary-item strong');
      if (items[0]) items[0].textContent = data.activeJobsCount  || 0;
      if (items[1]) items[1].textContent = data.newRequestsCount || 0;
      if (items[2]) items[2].textContent = `₦${(data.totalEarnings || 0).toLocaleString()}`;
    } catch (e) { console.warn('[FixaChat] fetchDashboardSummary', e); }
  }

  async function loadArtisanProfile() {
    try {
      const res = await fetch(`${CFG.ARTISAN_API}/me`, { headers: authHeaders(true) });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      $$('.usernameDisplay').forEach(el => el.textContent = data.name || CFG.user.username || 'Artisan');
      const e = document.getElementById('emailDisplay'); if (e) e.textContent = data.email || '';
      const p = document.getElementById('phoneDisplay'); if (p) p.textContent = data.phone || '';
      const img = $('.profile-img'); if (img) img.src = data.profilePic || data.avatar || 'https://via.placeholder.com/80';
      const badge = document.getElementById('verificationBadge');
      const bText = document.getElementById('badgeText');
      const bIcon = document.getElementById('badgeIcon');
      if (badge && bText && bIcon) {
        bText.textContent = data.verification ? 'Verified' : 'Not Verified';
        bIcon.textContent = data.verification ? '✓' : '✕';
        badge.className   = `verification-badge ${data.verification ? 'verified' : 'not-verified'}`;
      }
    } catch (e) { console.warn('[FixaChat] loadArtisanProfile', e); }
  }

})(window);