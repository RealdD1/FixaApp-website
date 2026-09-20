/**
 * fixa-chat.js — Fixa Chat System v2
 * ──────────────────────────────────────────────────────────────────
 * A self-contained, role-aware chat module.
 *
 * Usage:
 *   FixaChat.mount(document.getElementById('chatContainer'), {
 *     user:    { _id, username, role },
 *     token:   'jwt...',
 *     baseUrl: 'http://localhost:5000',
 *     socket:  socketInstance,
 *     onBack:  () => switchPage('home')
 *   });
 *
 *   FixaChat.openChat(chatId, { username, avatar });
 *
 * Features:
 *   ✓ Text messages with optimistic send
 *   ✓ Image uploads (NO page refresh)
 *   ✓ Voice notes (NO page refresh)
 *   ✓ Typing indicator
 *   ✓ Read receipts (✓ / ✓✓ / ✓✓ blue)
 *   ✓ Reply to message (long-press or right-click)
 *   ✓ Message reactions (emoji picker)
 *   ✓ ChatGuard integration (optional)
 *
 * Architecture promises:
 *   ✓ NEVER uses <form> tags
 *   ✓ All async handlers wrapped in try/catch
 *   ✓ Blob URLs kept alive until real image loads
 *   ✓ Self-contained — owns its own DOM
 *   ✓ Works for both artisan and customer via config.user.role
 */

(function (global) {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════
  const state = {
    mounted: false,
    config: null,
    container: null,
    els: {},                    // cached DOM refs
    activeChatId: null,
    activeChatPeer: null,       // { _id, username, avatar }
    messagesByChat: new Map(),  // chatId -> messages[]
    replyingTo: null,
    isTyping: false,
    typingTimer: null,
    peerIsTyping: false,
    mediaRecorder: null,
    audioChunks: [],
    recordStart: 0,
    recordInterval: null,
    pendingBlobUrls: new Set(), // blob URLs to revoke later
    socketListenersAttached: false,
  };

  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  // ════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function normalizeId(v) {
    if (v == null) return '';
    if (typeof v === 'object') return String(v._id || v.id || '');
    return String(v);
  }

  function fmtTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function fmtDate(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return 'Today';
      const y = new Date(now); y.setDate(y.getDate() - 1);
      if (d.toDateString() === y.toDateString()) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return ''; }
  }

  function authHeaders(json = false) {
    const h = { Authorization: `Bearer ${state.config.token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function apiUrl(path) {
    return `${state.config.baseUrl}${path}`;
  }

  function mediaUrl(url) {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('http')) return url;
    return `${state.config.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  function tempId() {
    return 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function safeEmit(event, data) {
    const s = state.config.socket;
    if (s && s.connected) { s.emit(event, data); return true; }
    return false;
  }

  function isMe(msg) {
    if (msg.outgoing || msg.isLocal || msg.isMine) return true;
    const senderId = normalizeId(msg.sender?._id || msg.sender?.id || msg.senderId || msg.sender);
    return senderId === String(state.config.user._id);
  }

  // ════════════════════════════════════════════════════════════════
  // STYLES (injected once)
  // ════════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('fixa-chat-styles')) return;
    const css = `
      .fxc-root { display: flex; flex-direction: column; height: 100%; min-height: 400px; background: #011d2d; color: #fff; font-family: inherit; overflow: hidden; }
      .fxc-root *, .fxc-root *::before, .fxc-root *::after { box-sizing: border-box; }

      /* Header */
      .fxc-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(0,0,0,0.25); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
      .fxc-back { background: none; border: none; color: #ffd700; cursor: pointer; font-size: 22px; padding: 4px 8px; border-radius: 8px; }
      .fxc-back:hover { background: rgba(255,215,0,0.1); }
      .fxc-avatar { width: 40px; height: 40px; border-radius: 50%; background: #2a4a6b; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; overflow: hidden; flex-shrink: 0; }
      .fxc-avatar img { width: 100%; height: 100%; object-fit: cover; }
      .fxc-header-info { flex: 1; min-width: 0; }
      .fxc-header-name { font-weight: 700; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fxc-header-status { font-size: 11px; color: #ffd700; height: 14px; }

      /* Messages area */
      .fxc-messages { flex: 1; overflow-y: auto; padding: 10px 8px 14px; display: flex; flex-direction: column; gap: 4px; background: #011d2d; }
      .fxc-date-sep { text-align: center; margin: 14px 0 6px; font-size: 11px; color: #9aa6b2; }
      .fxc-date-sep span { background: rgba(255,255,255,0.06); padding: 3px 12px; border-radius: 999px; }

      .fxc-row { display: flex; margin: 2px 0; padding: 0 8px; max-width: 100%; }
      .fxc-row.sent { justify-content: flex-end; }
      .fxc-row.recv { justify-content: flex-start; }
      .fxc-row.grouped { margin-top: -2px; }

      .fxc-bubble { max-width: 78%; padding: 7px 11px 5px; border-radius: 16px; position: relative; word-break: break-word; animation: fxcPop 0.15s ease-out; }
      .fxc-row.sent .fxc-bubble { background: linear-gradient(135deg, #ffd54d, #ffc107); color: #000; border-bottom-right-radius: 4px; }
      .fxc-row.recv .fxc-bubble { background: #27425a; color: #fff; border-bottom-left-radius: 4px; }
      @keyframes fxcPop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

      /* Reply preview inside bubble */
      .fxc-reply-quote { border-left: 3px solid rgba(0,0,0,0.25); padding: 5px 8px; margin-bottom: 5px; font-size: 12px; background: rgba(0,0,0,0.12); border-radius: 6px; cursor: pointer; }
      .fxc-row.recv .fxc-reply-quote { border-left-color: rgba(255,215,0,0.55); background: rgba(255,255,255,0.05); }
      .fxc-reply-quote-name { font-weight: 700; color: #ffd700; font-size: 11px; }
      .fxc-reply-quote-text { opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .fxc-bubble-text { font-size: 14px; line-height: 1.4; white-space: pre-wrap; }
      .fxc-bubble img { display: block; max-width: 240px; border-radius: 10px; cursor: pointer; margin: 2px 0; }
      .fxc-bubble audio { display: block; width: 220px; height: 34px; margin: 4px 0; }

      .fxc-meta { display: flex; align-items: center; gap: 4px; justify-content: flex-end; font-size: 10px; opacity: 0.7; margin-top: 3px; }
      .fxc-row.recv .fxc-meta { justify-content: flex-start; }
      .fxc-tick { font-size: 11px; font-weight: 700; }
      .fxc-tick.read { color: #1e88e5; }

      /* Reactions */
      .fxc-reactions { position: absolute; bottom: -10px; right: 8px; display: flex; gap: 2px; background: #0a2a40; border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; padding: 2px 6px; font-size: 11px; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
      .fxc-row.recv .fxc-reactions { left: 8px; right: auto; }

      /* Reaction picker popover */
      .fxc-react-picker { position: fixed; display: flex; gap: 4px; background: #0a2a40; border: 1px solid rgba(255,215,0,0.3); border-radius: 999px; padding: 6px 10px; z-index: 10000; box-shadow: 0 4px 16px rgba(0,0,0,0.5); animation: fxcPop 0.15s ease-out; }
      .fxc-react-picker span { font-size: 22px; cursor: pointer; padding: 2px 4px; transition: transform 0.15s; user-select: none; }
      .fxc-react-picker span:hover { transform: scale(1.3); }

      /* Context menu */
      .fxc-ctx-menu { position: fixed; background: #0a2a40; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 4px; z-index: 10000; box-shadow: 0 4px 16px rgba(0,0,0,0.5); min-width: 140px; }
      .fxc-ctx-menu button { display: block; width: 100%; text-align: left; background: none; border: none; color: #fff; padding: 8px 14px; font-size: 13px; cursor: pointer; border-radius: 6px; }
      .fxc-ctx-menu button:hover { background: rgba(255,215,0,0.1); }

      /* Failed / status */
      .fxc-failed { font-size: 10px; color: #ef4444; margin-top: 2px; cursor: pointer; text-decoration: underline; }

      /* Reply UI above input */
      .fxc-reply-ui { background: rgba(255,215,0,0.08); border-left: 3px solid #ffd700; padding: 8px 12px; display: none; align-items: center; gap: 10px; flex-shrink: 0; }
      .fxc-reply-ui.active { display: flex; }
      .fxc-reply-ui-text { flex: 1; font-size: 12px; overflow: hidden; }
      .fxc-reply-ui-name { font-weight: 700; color: #ffd700; font-size: 11px; }
      .fxc-reply-ui-preview { opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fxc-reply-ui-close { background: none; border: none; color: #ffd700; font-size: 18px; cursor: pointer; padding: 0 4px; }

      /* Input footer */
      .fxc-footer { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: rgba(0,0,0,0.35); border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }
      .fxc-icon-btn { background: none; border: none; color: #cbd5e1; cursor: pointer; padding: 8px; border-radius: 50%; font-size: 20px; display: flex; align-items: center; justify-content: center; transition: background 0.15s; }
      .fxc-icon-btn:hover { background: rgba(255,215,0,0.1); color: #ffd700; }
      .fxc-input { flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 22px; padding: 9px 16px; font-size: 14px; outline: none; font-family: inherit; resize: none; min-height: 40px; max-height: 120px; line-height: 1.4; }
      .fxc-input:focus { border-color: rgba(255,215,0,0.45); }
      .fxc-send-btn { background: #ffd700; border: none; color: #000; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; transition: transform 0.15s; }
      .fxc-send-btn:hover:not(:disabled) { transform: scale(1.08); }
      .fxc-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

      /* Voice recording overlay */
      .fxc-voice-ui { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%); background: #0a2a40; border: 1px solid #ffd700; border-radius: 16px; padding: 12px 20px; display: none; align-items: center; gap: 12px; z-index: 9000; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
      .fxc-voice-ui.active { display: flex; animation: fxcPop 0.2s ease-out; }
      .fxc-voice-pulse { font-size: 18px; animation: fxcPulse 1s infinite; }
      @keyframes fxcPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .fxc-voice-timer { font-family: monospace; font-size: 18px; font-weight: 700; color: #ffd700; }
      .fxc-voice-btn { padding: 6px 14px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px; border: 1px solid; }
      .fxc-voice-cancel { background: rgba(239,68,68,0.15); color: #ef4444; border-color: #ef4444; }
      .fxc-voice-send { background: rgba(34,197,94,0.15); color: #22c55e; border-color: #22c55e; }

      /* Image lightbox */
      .fxc-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 10001; display: flex; align-items: center; justify-content: center; cursor: zoom-out; }
      .fxc-lightbox img { max-width: 95vw; max-height: 95vh; border-radius: 8px; }

      /* Empty state */
      .fxc-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #9aa6b2; font-size: 14px; padding: 40px 20px; text-align: center; }
      .fxc-empty-icon { font-size: 48px; opacity: 0.3; margin-bottom: 10px; }

      /* Scrollbar */
      .fxc-messages::-webkit-scrollbar { width: 4px; }
      .fxc-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    `;
    const style = document.createElement('style');
    style.id = 'fixa-chat-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════════════════════
  // DOM BUILD
  // ════════════════════════════════════════════════════════════════
  function buildDOM() {
    state.container.innerHTML = `
      <div class="fxc-root">
        <div class="fxc-header">
          <button type="button" class="fxc-back" data-role="back" title="Back">‹</button>
          <div class="fxc-avatar" data-role="peer-avatar"></div>
          <div class="fxc-header-info">
            <div class="fxc-header-name" data-role="peer-name">Chat</div>
            <div class="fxc-header-status" data-role="peer-status"></div>
          </div>
        </div>
        <div class="fxc-messages" data-role="messages"></div>
        <div class="fxc-reply-ui" data-role="reply-ui">
          <div class="fxc-reply-ui-text">
            <div class="fxc-reply-ui-name" data-role="reply-name"></div>
            <div class="fxc-reply-ui-preview" data-role="reply-preview"></div>
          </div>
          <button type="button" class="fxc-reply-ui-close" data-role="reply-close">×</button>
        </div>
        <div class="fxc-footer">
          <button type="button" class="fxc-icon-btn" data-role="attach" title="Attach image">📎</button>
          <button type="button" class="fxc-icon-btn" data-role="voice" title="Record voice note">🎙️</button>
          <textarea class="fxc-input" data-role="input" placeholder="Type a message..." rows="1"></textarea>
          <button type="button" class="fxc-send-btn" data-role="send" title="Send" disabled>➤</button>
        </div>
      </div>
      <div class="fxc-voice-ui" data-role="voice-ui">
        <span class="fxc-voice-pulse">🔴</span>
        <span class="fxc-voice-timer" data-role="voice-timer">00:00</span>
        <button type="button" class="fxc-voice-btn fxc-voice-cancel" data-role="voice-cancel">Cancel</button>
        <button type="button" class="fxc-voice-btn fxc-voice-send" data-role="voice-send">Send ✓</button>
      </div>
    `;

    // Cache elements
    const q = (r) => state.container.querySelector(`[data-role="${r}"]`);
    state.els = {
      back:         q('back'),
      peerAvatar:   q('peer-avatar'),
      peerName:     q('peer-name'),
      peerStatus:   q('peer-status'),
      messages:     q('messages'),
      replyUi:      q('reply-ui'),
      replyName:    q('reply-name'),
      replyPreview: q('reply-preview'),
      replyClose:   q('reply-close'),
      attach:       q('attach'),
      voice:        q('voice'),
      input:        q('input'),
      send:         q('send'),
      voiceUi:      q('voice-ui'),
      voiceTimer:   q('voice-timer'),
      voiceCancel:  q('voice-cancel'),
      voiceSend:    q('voice-send'),
    };

    // Hidden file input — appended OUTSIDE any possible form
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.setAttribute('data-role', 'file-input');
    state.container.appendChild(fileInput);
    state.els.fileInput = fileInput;
  }

  // ════════════════════════════════════════════════════════════════
  // EVENT WIRING
  // ════════════════════════════════════════════════════════════════
  function wireEvents() {
    const e = state.els;

    // Back button
    e.back.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (state.activeChatId) safeEmit('leaveChat', state.activeChatId);
      if (typeof state.config.onBack === 'function') state.config.onBack();
    });

    // Send button
    e.send.addEventListener('click', (ev) => {
      ev.preventDefault();
      sendText();
    });

    // Textarea — Enter to send, Shift+Enter for newline
    e.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendText();
      }
    });
    e.input.addEventListener('input', () => {
      e.send.disabled = e.input.value.trim().length === 0;
      // Auto-expand
      e.input.style.height = 'auto';
      e.input.style.height = Math.min(120, e.input.scrollHeight) + 'px';
      notifyTyping();
    });
    e.input.addEventListener('blur', () => {
      if (state.isTyping) {
        state.isTyping = false;
        safeEmit('stopTyping', { chatId: state.activeChatId });
      }
    });

    // Attach button → open file picker
    e.attach.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!state.activeChatId) return;
      e.fileInput.click();
    });

    // File input change → send image
    // CRITICAL: preventDefault + stopImmediatePropagation + self-contained handling
    e.fileInput.addEventListener('change', function onFileChange(ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const file = this.files && this.files[0];
      this.value = ''; // reset immediately so same file can be picked again
      if (!file) return;
      // Run in microtask so native handler fully unwinds first
      Promise.resolve().then(() => sendMedia(file, 'image'));
      return false;
    });

    // Reply close
    e.replyClose.addEventListener('click', (ev) => {
      ev.preventDefault();
      cancelReply();
    });

    // Voice buttons
    e.voice.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (state.mediaRecorder?.state === 'recording') stopRecording();
      else startRecording();
    });
    e.voiceSend.addEventListener('click', (ev) => {
      ev.preventDefault();
      stopRecording();
    });
    e.voiceCancel.addEventListener('click', (ev) => {
      ev.preventDefault();
      cancelRecording();
    });

    // Message context menu (right-click / long-press)
    e.messages.addEventListener('contextmenu', (ev) => {
      const row = ev.target.closest('.fxc-row');
      if (!row) return;
      ev.preventDefault();
      showContextMenu(ev.clientX, ev.clientY, row.dataset.msgId);
    });

    // Long-press support for touch devices
    let longPressTimer = null;
    e.messages.addEventListener('touchstart', (ev) => {
      const row = ev.target.closest('.fxc-row');
      if (!row) return;
      longPressTimer = setTimeout(() => {
        const touch = ev.touches[0];
        showContextMenu(touch.clientX, touch.clientY, row.dataset.msgId);
      }, 450);
    });
    e.messages.addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    e.messages.addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    // Click on image → lightbox
    e.messages.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'IMG' && ev.target.closest('.fxc-bubble')) {
        openLightbox(ev.target.src);
      }
    });

    // Read receipt — mark messages as read when scrolled to bottom
    e.messages.addEventListener('scroll', () => {
      if (e.messages.scrollTop + e.messages.clientHeight >= e.messages.scrollHeight - 20) {
        markUnreadAsRead();
      }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // SOCKET LISTENERS
  // ════════════════════════════════════════════════════════════════
  function attachSocketListeners() {
    const s = state.config.socket;
    if (!s || state.socketListenersAttached) return;
    state.socketListenersAttached = true;

    s.on('newMessage', (payload) => {
      try {
        const { chatId, message } = payload || {};
        if (!chatId || !message) return;
        if (String(chatId) !== String(state.activeChatId)) return;
        // Skip if this is our own message being echoed back (matched by clientTempId)
        if (message.clientTempId) {
          const existing = state.els.messages.querySelector(`[data-msg-id="${message.clientTempId}"]`);
          if (existing) {
            replaceMessage(message.clientTempId, message);
            return;
          }
        }
        appendMessage(message);
        markUnreadAsRead();
      } catch (e) { console.warn('[FixaChat] newMessage handler error', e); }
    });

    s.on('typing', ({ chatId }) => {
      if (String(chatId) !== String(state.activeChatId)) return;
      state.peerIsTyping = true;
      state.els.peerStatus.textContent = 'typing…';
    });

    s.on('stopTyping', ({ chatId }) => {
      if (String(chatId) !== String(state.activeChatId)) return;
      state.peerIsTyping = false;
      state.els.peerStatus.textContent = '';
    });

    s.on('messageRead', ({ chatId, messageId, userId }) => {
      if (String(chatId) !== String(state.activeChatId)) return;
      // Update tick for that message
      const row = state.els.messages.querySelector(`[data-msg-id="${messageId}"]`);
      if (row) {
        const tick = row.querySelector('.fxc-tick');
        if (tick) tick.classList.add('read');
      }
    });

    s.on('messageReaction', ({ chatId, messageId, reactions }) => {
      if (String(chatId) !== String(state.activeChatId)) return;
      const row = state.els.messages.querySelector(`[data-msg-id="${messageId}"]`);
      if (row) renderReactions(row, reactions);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // OPEN / CLOSE CHAT
  // ════════════════════════════════════════════════════════════════
  async function openChat(chatId, peer) {
    console.log("Opening chat:", chatId);
    if (!state.mounted) {
      console.warn('[FixaChat] not mounted yet');
      return;
    }
    state.activeChatId = chatId;
    state.activeChatPeer = peer || {};
    window.activeChatId = chatId; // keep global in sync for FixaSystem

    // Update header
    state.els.peerName.textContent = peer?.username || peer?.name || 'Chat';
    const avatar = state.els.peerAvatar;
    if (peer?.avatar) {
      avatar.innerHTML = `<img src="${escHtml(mediaUrl(peer.avatar))}" alt=""/>`;
    } else {
      avatar.textContent = (peer?.username || '?')[0].toUpperCase();
    }
    state.els.peerStatus.textContent = '';

    // Join chat room
    safeEmit('joinChat', String(chatId));

    // ChatGuard hook
    if (state.config.features?.chatGuard && window.ChatGuard?.onChatOpen) {
      try { await window.ChatGuard.onChatOpen(chatId); } catch {}
    }

    // Show loading
    state.els.messages.innerHTML = '<div class="fxc-empty"><div>Loading messages…</div></div>';

    // Load messages
    try {
      const res = await fetch(apiUrl(`/api/messages/${encodeURIComponent(chatId)}`), {
        headers: authHeaders()
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const messages = await res.json();
      const list = Array.isArray(messages) ? messages : (messages.messages || []);
      state.messagesByChat.set(String(chatId), list);
      renderMessageList(list);
      setTimeout(markUnreadAsRead, 100);
    } catch (err) {
      console.error('[FixaChat] load messages failed', err);
      state.els.messages.innerHTML =
        `<div class="fxc-empty"><div class="fxc-empty-icon">⚠️</div><div>Could not load messages</div></div>`;
    }
  }

  function closeChat() {
    if (state.activeChatId) safeEmit('leaveChat', state.activeChatId);
    state.activeChatId = null;
    state.activeChatPeer = null;
    window.activeChatId = null;
    cancelReply();
    cancelRecording();
  }

  // ════════════════════════════════════════════════════════════════
  // RENDER MESSAGES
  // ════════════════════════════════════════════════════════════════
  function renderMessageList(messages) {
    state.els.messages.innerHTML = '';
    if (!messages.length) {
      state.els.messages.innerHTML = `
        <div class="fxc-empty">
          <div class="fxc-empty-icon">💬</div>
          <div>Say hi 👋</div>
        </div>`;
      return;
    }
    let lastDate = '';
    let lastSender = '';
    messages.forEach((m) => {
      const d = fmtDate(m.createdAt || Date.now());
      if (d !== lastDate) {
        appendDateSeparator(d);
        lastDate = d;
        lastSender = '';
      }
      const senderId = normalizeId(m.sender?._id || m.sender?.id || m.senderId || m.sender);
      const grouped = senderId && senderId === lastSender;
      appendMessage(m, { grouped, silent: true });
      lastSender = senderId;
    });
    scrollToBottom();
  }

  function appendDateSeparator(text) {
    const sep = document.createElement('div');
    sep.className = 'fxc-date-sep';
    sep.innerHTML = `<span>${escHtml(text)}</span>`;
    state.els.messages.appendChild(sep);
  }

  function appendMessage(m, opts = {}) {
    const mine = isMe(m);
    const msgId = m._id || m.id || m.clientTempId || tempId();

    // Dedupe — if already rendered, skip
    if (state.els.messages.querySelector(`[data-msg-id="${msgId}"]`)) return;

    const row = document.createElement('div');
    row.className = `fxc-row ${mine ? 'sent' : 'recv'}${opts.grouped ? ' grouped' : ''}`;
    row.dataset.msgId = msgId;

    const bubble = document.createElement('div');
    bubble.className = 'fxc-bubble';

    // Reply quote
    if (m.replyTo) {
      const rq = document.createElement('div');
      rq.className = 'fxc-reply-quote';
      rq.dataset.jumpTo = m.replyTo._id || m.replyTo.id || '';
      const replyName = m.replyTo.sender?.username || (isMe(m.replyTo) ? 'You' : 'Them');
      const replyText = m.replyTo.text || (m.replyTo.mediaType === 'image' ? '📷 Image' : (m.replyTo.mediaType === 'voice' ? '🎙️ Voice note' : '…'));
      rq.innerHTML = `
        <div class="fxc-reply-quote-name">${escHtml(replyName)}</div>
        <div class="fxc-reply-quote-text">${escHtml(replyText)}</div>`;
      rq.addEventListener('click', () => {
        const target = state.els.messages.querySelector(`[data-msg-id="${rq.dataset.jumpTo}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      bubble.appendChild(rq);
    }

    // Media
    const mediaSrc = m.voiceNote || m.image || m.mediaUrl;
    const mediaType = m.mediaType || (m.voiceNote ? 'voice' : (m.image || m.mediaUrl ? 'image' : null));
    if (mediaSrc && mediaType === 'voice') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = mediaUrl(mediaSrc);
      bubble.appendChild(audio);
    } else if (mediaSrc && mediaType === 'image') {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = mediaUrl(mediaSrc);
      // CRITICAL: for blob URLs, don't revoke until onload fires
      if (mediaSrc.startsWith('blob:')) {
        state.pendingBlobUrls.add(mediaSrc);
        img.addEventListener('load', () => { /* kept alive for reload cases */ }, { once: true });
      }
      bubble.appendChild(img);
    }

    // Text
    const text = m.text || m.content;
    if (text && text !== 'Voice note' && text !== 'Image') {
      const t = document.createElement('div');
      t.className = 'fxc-bubble-text';
      t.textContent = text;
      bubble.appendChild(t);
    }

    // Meta (time + ticks)
    const meta = document.createElement('div');
    meta.className = 'fxc-meta';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = fmtTime(m.createdAt || Date.now());
    meta.appendChild(timeSpan);
    if (mine) {
      const tick = document.createElement('span');
      tick.className = 'fxc-tick';
      const status = m.status || 'sent';
      const peerRead = m.readBy?.some(u => String(u) !== String(state.config.user._id));
      if (status === 'sending') tick.textContent = '⏱';
      else if (status === 'failed') tick.textContent = '!';
      else if (peerRead) { tick.textContent = '✓✓'; tick.classList.add('read'); }
      else if (m.delivered) tick.textContent = '✓✓';
      else tick.textContent = '✓';
      meta.appendChild(tick);
    }
    bubble.appendChild(meta);

    // Reactions
    if (m.reactions && Object.keys(m.reactions).length) {
      renderReactions(row, m.reactions, bubble);
    }

    // Failed retry
    if (m.status === 'failed') {
      const retry = document.createElement('div');
      retry.className = 'fxc-failed';
      retry.textContent = 'Failed — tap to retry';
      retry.addEventListener('click', () => retrySend(msgId));
      bubble.appendChild(retry);
    }

    row.appendChild(bubble);
    state.els.messages.appendChild(row);

    if (!opts.silent) {
      const near = (state.els.messages.scrollHeight - state.els.messages.clientHeight - state.els.messages.scrollTop) < 140;
      if (near || mine) scrollToBottom();
    }
  }

  /**
   * Replace an optimistic message with the real one from the server.
   * Since the optimistic msg was just appended at the bottom, and the real
   * one arrives right after, we simply update the row's data-msg-id and
   * update the tick, keeping scroll position and media blob intact.
   */
  function replaceMessage(oldId, newMsg) {
    const row = state.els.messages.querySelector(`[data-msg-id="${oldId}"]`);
    if (!row) { appendMessage({ ...newMsg, status: 'sent' }); return; }
    // Update the row id to real id so future events (reactions, reads) target it
    row.dataset.msgId = newMsg._id || newMsg.id || oldId;
    // Update tick to 'sent'
    const tick = row.querySelector('.fxc-tick');
    if (tick) {
      tick.textContent = '✓';
      tick.classList.remove('read');
    }
    // Merge reactions if server added any
    if (newMsg.reactions) renderReactions(row, newMsg.reactions);
  }

  function renderReactions(row, reactions, bubbleOpt) {
    const bubble = bubbleOpt || row.querySelector('.fxc-bubble');
    if (!bubble) return;
    let el = bubble.querySelector('.fxc-reactions');
    const entries = Object.entries(reactions).filter(([, users]) => users && users.length);
    if (!entries.length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'fxc-reactions';
      bubble.appendChild(el);
    }
    el.innerHTML = entries.map(([emoji, users]) =>
      `<span>${emoji} ${users.length > 1 ? users.length : ''}</span>`).join('');
  }

  function scrollToBottom() {
    const m = state.els.messages;
    m.scrollTop = m.scrollHeight;
  }

  // ════════════════════════════════════════════════════════════════
  // SEND TEXT
  // ════════════════════════════════════════════════════════════════
  async function sendText() {
    try {
      const text = state.els.input.value.trim();
      if (!text || !state.activeChatId) return;

      // ChatGuard
      if (state.config.features?.chatGuard && window.ChatGuard?.checkText) {
        try {
          const r = await window.ChatGuard.checkText(text);
          if (r?.blocked) return;
        } catch {}
      }

      // Clear input immediately
      state.els.input.value = '';
      state.els.input.style.height = 'auto';
      state.els.send.disabled = true;

      // Capture reply then clear UI
      const replyTo = state.replyingTo;
      cancelReply();

      const clientTempId = tempId();
      const optimistic = {
        _id: clientTempId,
        clientTempId,
        text,
        sender: { _id: state.config.user._id, username: state.config.user.username },
        createdAt: new Date().toISOString(),
        isLocal: true,
        outgoing: true,
        status: 'sending',
        replyTo: replyTo || undefined,
      };
      appendMessage(optimistic);

      // POST to server
      const body = { text, clientTempId };
      if (replyTo) body.replyTo = replyTo._id || replyTo.id;

      const res = await fetch(
        apiUrl(`/api/messages/${encodeURIComponent(state.activeChatId)}/messages`),
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const real = data.message || data;
      if (!real.clientTempId) real.clientTempId = clientTempId;
      replaceMessage(clientTempId, real);
      safeEmit('newMessage', { chatId: state.activeChatId, message: real });
    } catch (err) {
      console.error('[FixaChat] sendText error', err);
      // Mark optimistic as failed
      const rows = state.els.messages.querySelectorAll('.fxc-row');
      const last = rows[rows.length - 1];
      if (last) last.dataset.failed = '1';
    }
  }

  // ════════════════════════════════════════════════════════════════
  // SEND MEDIA (image or voice)  — THE KEY NO-REFRESH PATH
  // ════════════════════════════════════════════════════════════════
  async function sendMedia(file, kind /* 'image' | 'voice' */) {
    try {
      if (!file || !state.activeChatId) return;

      // ChatGuard OCR for images
      if (kind === 'image' && state.config.features?.chatGuard && window.ChatGuard?.checkImage) {
        try {
          const r = await window.ChatGuard.checkImage(file);
          if (r?.blocked) return;
        } catch {}
      }

      const blobUrl = URL.createObjectURL(file);
      state.pendingBlobUrls.add(blobUrl);
      const clientTempId = tempId();

      const optimistic = {
        _id: clientTempId,
        clientTempId,
        sender: { _id: state.config.user._id, username: state.config.user.username },
        createdAt: new Date().toISOString(),
        isLocal: true,
        outgoing: true,
        status: 'sending',
        mediaType: kind,
      };
      if (kind === 'image') optimistic.image = blobUrl;
      else optimistic.voiceNote = blobUrl;
      appendMessage(optimistic);

      // Capture reply
      const replyTo = state.replyingTo;
      cancelReply();

      // Upload
      const fd = new FormData();
      fd.append('file', file);
      fd.append('clientTempId', clientTempId);
      if (kind === 'voice') fd.append('type', 'voice');
      if (replyTo) fd.append('replyTo', replyTo._id || replyTo.id);

      // IMPORTANT: do NOT set Content-Type; browser sets multipart boundary
      const res = await fetch(
        apiUrl(`/api/messages/${encodeURIComponent(state.activeChatId)}/media`),
        { method: 'POST', headers: { Authorization: `Bearer ${state.config.token}` }, body: fd }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const real = await res.json();
      if (!real.clientTempId) real.clientTempId = clientTempId;

      // Wait for the real image/audio to load before revoking blob
      await swapMediaSource(clientTempId, real, blobUrl);
      safeEmit('newMessage', { chatId: state.activeChatId, message: real });
    } catch (err) {
      console.error('[FixaChat] sendMedia error', err);
      // Leave optimistic in place, mark as failed
      const row = state.els.messages.querySelector('.fxc-row:last-child');
      if (row) row.classList.add('fxc-failed-row');
    }
    return false; // extra safety — signal no navigation
  }

  /**
   * Swap blob URL to server URL AFTER the new media has loaded.
   * This is what prevents the "broken image during swap" issue
   * that can trigger browser reload on some mobile environments.
   */
  function swapMediaSource(tempIdVal, realMsg, blobUrl) {
    return new Promise((resolve) => {
      const row = state.els.messages.querySelector(`[data-msg-id="${tempIdVal}"]`);
      if (!row) { URL.revokeObjectURL(blobUrl); state.pendingBlobUrls.delete(blobUrl); resolve(); return; }

      const newSrc = mediaUrl(realMsg.voiceNote || realMsg.image || realMsg.mediaUrl);
      const mediaEl = row.querySelector('img, audio');

      const finalize = () => {
        // Update msg id on row
        row.dataset.msgId = realMsg._id || realMsg.id || tempIdVal;
        // Update ticks
        const tick = row.querySelector('.fxc-tick');
        if (tick) tick.textContent = '✓';
        URL.revokeObjectURL(blobUrl);
        state.pendingBlobUrls.delete(blobUrl);
        resolve();
      };

      if (!mediaEl || !newSrc) { finalize(); return; }

      // Preload real source in a hidden element; swap only when loaded
      const preloader = mediaEl.tagName === 'IMG' ? new Image() : document.createElement('audio');
      preloader.onload = () => { mediaEl.src = newSrc; finalize(); };
      preloader.onerror = () => { finalize(); }; // fall back to blob
      preloader.oncanplaythrough = () => { mediaEl.src = newSrc; finalize(); };
      preloader.src = newSrc;
      // Safety timeout — don't wait forever
      setTimeout(finalize, 5000);
    });
  }

  // ════════════════════════════════════════════════════════════════
  // VOICE RECORDING
  // ════════════════════════════════════════════════════════════════
  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      if (!state.activeChatId) return;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      state.mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      state.audioChunks = [];

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
      };

      state.mediaRecorder.onstop = async () => {
        try {
          clearInterval(state.recordInterval);
          state.recordInterval = null;
          state.els.voiceTimer.textContent = '00:00';
          state.els.voiceUi.classList.remove('active');
          stream.getTracks().forEach(t => t.stop());

          const blob = new Blob(state.audioChunks, { type: mime });
          state.audioChunks = [];
          if (blob.size < 500) return; // too short

          const ext = mime.includes('webm') ? 'webm' : 'ogg';
          const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
          await sendMedia(file, 'voice');
        } catch (err) {
          console.error('[FixaChat] voice onstop error', err);
        }
      };

      state.mediaRecorder.start();
      state.recordStart = Date.now();
      state.els.voiceUi.classList.add('active');

      state.recordInterval = setInterval(() => {
        const s = Math.floor((Date.now() - state.recordStart) / 1000);
        state.els.voiceTimer.textContent =
          `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        if (Date.now() - state.recordStart > 120000) stopRecording();
      }, 250);
    } catch (err) {
      console.error('[FixaChat] startRecording error', err);
    }
  }

  function stopRecording() {
    try {
      if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
    } catch (e) { console.warn(e); }
  }

  function cancelRecording() {
    try {
      if (state.mediaRecorder) {
        state.mediaRecorder.ondataavailable = null;
        state.mediaRecorder.onstop = null;
        if (state.mediaRecorder.state === 'recording') state.mediaRecorder.stop();
      }
      state.audioChunks = [];
      clearInterval(state.recordInterval);
      state.recordInterval = null;
      state.els.voiceUi?.classList.remove('active');
      if (state.els.voiceTimer) state.els.voiceTimer.textContent = '00:00';
    } catch (e) { console.warn(e); }
  }

  // ════════════════════════════════════════════════════════════════
  // TYPING
  // ════════════════════════════════════════════════════════════════
  function notifyTyping() {
    if (!state.activeChatId) return;
    if (!state.isTyping) {
      state.isTyping = true;
      safeEmit('typing', { chatId: state.activeChatId });
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      state.isTyping = false;
      safeEmit('stopTyping', { chatId: state.activeChatId });
    }, 2200);
  }

  // ════════════════════════════════════════════════════════════════
  // REPLY
  // ════════════════════════════════════════════════════════════════
  function startReply(msgId) {
    const cachedList = state.messagesByChat.get(String(state.activeChatId)) || [];
    const msg = cachedList.find(m => String(m._id || m.id) === String(msgId)) ||
                findMsgInDOM(msgId);
    if (!msg) return;
    state.replyingTo = msg;
    const senderName = msg.sender?.username || (isMe(msg) ? 'You' : state.activeChatPeer?.username || 'Them');
    const preview = msg.text || (msg.mediaType === 'image' || msg.image ? '📷 Image' : (msg.mediaType === 'voice' || msg.voiceNote ? '🎙️ Voice note' : '…'));
    state.els.replyName.textContent = senderName;
    state.els.replyPreview.textContent = preview;
    state.els.replyUi.classList.add('active');
    state.els.input.focus();
  }

  function cancelReply() {
    state.replyingTo = null;
    state.els.replyUi.classList.remove('active');
    state.els.replyName.textContent = '';
    state.els.replyPreview.textContent = '';
  }

  function findMsgInDOM(msgId) {
    const row = state.els.messages.querySelector(`[data-msg-id="${msgId}"]`);
    if (!row) return null;
    const text = row.querySelector('.fxc-bubble-text')?.textContent || '';
    const hasImg = !!row.querySelector('img');
    const hasAudio = !!row.querySelector('audio');
    return {
      _id: msgId,
      text,
      mediaType: hasImg ? 'image' : (hasAudio ? 'voice' : null),
      sender: {},
    };
  }

  // ════════════════════════════════════════════════════════════════
  // CONTEXT MENU (reply / react)
  // ════════════════════════════════════════════════════════════════
  function showContextMenu(x, y, msgId) {
    document.querySelector('.fxc-ctx-menu')?.remove();
    document.querySelector('.fxc-react-picker')?.remove();
    const menu = document.createElement('div');
    menu.className = 'fxc-ctx-menu';
    menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 140)}px`;
    menu.innerHTML = `
      <button type="button" data-act="reply">↩ Reply</button>
      <button type="button" data-act="react">😊 React</button>
      <button type="button" data-act="copy">📋 Copy</button>`;
    menu.addEventListener('click', (ev) => {
      const act = ev.target.dataset.act;
      menu.remove();
      if (act === 'reply') startReply(msgId);
      else if (act === 'react') showReactionPicker(x, y, msgId);
      else if (act === 'copy') {
        const row = state.els.messages.querySelector(`[data-msg-id="${msgId}"]`);
        const text = row?.querySelector('.fxc-bubble-text')?.textContent;
        if (text) navigator.clipboard.writeText(text).catch(() => {});
      }
    });
    document.body.appendChild(menu);
    setTimeout(() => {
      const close = (ev) => {
        if (!menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  function showReactionPicker(x, y, msgId) {
    document.querySelector('.fxc-react-picker')?.remove();
    const picker = document.createElement('div');
    picker.className = 'fxc-react-picker';
    picker.style.left = `${Math.min(x - 80, window.innerWidth - 240)}px`;
    picker.style.top = `${Math.max(8, y - 50)}px`;
    picker.innerHTML = REACTIONS.map(e => `<span data-emoji="${e}">${e}</span>`).join('');
    picker.addEventListener('click', async (ev) => {
      const emoji = ev.target.dataset.emoji;
      if (!emoji) return;
      picker.remove();
      await sendReaction(msgId, emoji);
    });
    document.body.appendChild(picker);
    setTimeout(() => {
      const close = (ev) => {
        if (!picker.contains(ev.target)) {
          picker.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  async function sendReaction(msgId, emoji) {
    try {
      safeEmit('messageReaction', { chatId: state.activeChatId, messageId: msgId, reaction: emoji });
      const res = await fetch(
        apiUrl(`/api/messages/${encodeURIComponent(state.activeChatId)}/messages/${encodeURIComponent(msgId)}/react`),
        { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ reaction: emoji }) }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.reactions) {
          const row = state.els.messages.querySelector(`[data-msg-id="${msgId}"]`);
          if (row) renderReactions(row, data.reactions);
        }
      }
    } catch (err) { console.warn('[FixaChat] reaction failed', err); }
  }

  // ════════════════════════════════════════════════════════════════
  // READ RECEIPTS
  // ════════════════════════════════════════════════════════════════
  function markUnreadAsRead() {
    if (!state.activeChatId) return;
    const rows = state.els.messages.querySelectorAll('.fxc-row.recv');
    rows.forEach(row => {
      const id = row.dataset.msgId;
      if (!id || row.dataset.read === '1') return;
      row.dataset.read = '1';
      safeEmit('messageRead', { chatId: state.activeChatId, messageId: id });
    });
  }

  // ════════════════════════════════════════════════════════════════
  // IMAGE LIGHTBOX
  // ════════════════════════════════════════════════════════════════
  function openLightbox(src) {
    const box = document.createElement('div');
    box.className = 'fxc-lightbox';
    box.innerHTML = `<img src="${escHtml(src)}" alt="">`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }

  // ════════════════════════════════════════════════════════════════
  // RETRY
  // ════════════════════════════════════════════════════════════════
  function retrySend(msgId) {
    // v2 feature — not implemented in v1
    console.log('retry', msgId);
  }

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════
  const FixaChat = {
    mount(containerEl, config) {
      if (!containerEl) throw new Error('FixaChat.mount: container required');
      if (!config?.user || !config?.token || !config?.baseUrl) {
        throw new Error('FixaChat.mount: user, token, baseUrl required');
      }
      state.container = containerEl;
      state.config = {
        features: { replies: true, reactions: true, readReceipts: true, chatGuard: true, voice: true, images: true },
        ...config,
        features: { replies: true, reactions: true, readReceipts: true, chatGuard: true, voice: true, images: true, ...(config.features || {}) },
      };
      state.config.user._id = state.config.user._id || state.config.user.id || '';
      injectStyles();
      buildDOM();
      wireEvents();
      attachSocketListeners();
      state.mounted = true;
      return this;
    },

    openChat,
    closeChat,

    appendIncomingMessage(chatId, message) {
      if (String(chatId) !== String(state.activeChatId)) return;
      appendMessage(message);
    },

    destroy() {
      closeChat();
      state.pendingBlobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      state.pendingBlobUrls.clear();
      if (state.container) state.container.innerHTML = '';
      state.mounted = false;
    },

    _state: state, // for debugging
  };

  global.FixaChat = FixaChat;
})(window);