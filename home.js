// customer-home.js — Full implementation for Customer Dashboard UI + Chat
(function () {
    'use strict';

    // -------------------------
    // CUSTOMER INFO & AUTH
    // -------------------------
    const user = JSON.parse(localStorage.getItem("user"));
    const token = localStorage.getItem("token");
        
    if (!user || !token) {
        window.location.href = "SignIn.html";
        return;
    } else if (user.role !== "customer") {
        window.location.href = "SignIn.html";
        return;
    } else {
        user._id = user._id || user.id;
       const usernameEl = document.getElementById("usernameDisplay");
if (usernameEl) usernameEl.textContent = user.username || '';

const emailEl = document.getElementById("emailDisplay");
if (emailEl) emailEl.textContent = user.email || '';
    }

    // -------------------------
    // GLOBALS / STATE
    // -------------------------
    const BASE_URL = 'http://localhost:5000';
    const MESSAGE_API_URL = `${BASE_URL}/api/messages`;
    let currentOpenChatId = null;
    let miniChatPollInterval = null;
    let lastMessageTimestamp = null; // for merge-only-new on poll
    const POLL_INTERVAL_MS = 3000; // 3s - silent polling while mini chat is open

    // -------------------------
    // NAV + LOGOUT (unchanged)
    // -------------------------
    const pages = {
        home: document.getElementById("homePage"),
        messages: document.getElementById("messagesPage"),
        account: document.getElementById("accountPage"),
    };

    const buttons = {
        home: document.getElementById("homeBtn"),
        messages: document.getElementById("messagesBtn"),
        account: document.getElementById("accountBtn"),
    };

    const underline = document.querySelector(".nav-underline");

    function showPage(pageName) {
        Object.values(pages).forEach(page => page?.classList?.remove("active"));
        Object.values(buttons).forEach(btn => btn?.classList?.remove("active"));
        pages[pageName]?.classList?.add("active");
        buttons[pageName]?.classList?.add("active");
        if (underline) {
            const index = Object.keys(pages).indexOf(pageName);
            underline.style.transform = `translateX(${index * 100}%)`;
        }
        if (pageName === "messages") {
            const chatDataString = localStorage.getItem("openChatWith");
            if (chatDataString) {
                try {
                    const artisanToOpen = JSON.parse(chatDataString);
                    loadMessages(artisanToOpen);
                    return;
                } catch (e) {
                    console.error("Error parsing openChatWith data:", e);
                }
            }
            loadMessages();
        }
    }

    if (buttons.home) buttons.home.addEventListener("click", () => showPage("home"));
    if (buttons.messages) buttons.messages.addEventListener("click", () => showPage("messages"));
    if (buttons.account) buttons.account.addEventListener("click", () => showPage("account"));

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
        localStorage.clear();
        alert('Logout Successfully');
        window.location.href = "SignIn.html";
    });

  // customer-home.js — Full page chat like artisan version
(function () {
    'use strict';
  
    // ----- CONFIG -----
    const BASE_URL = 'http://localhost:5000';
    const MESSAGE_API_URL = `${BASE_URL}/api/messages`;
  
    // ----- AUTH -----
    const user = JSON.parse(localStorage.getItem('user'));
    const token = localStorage.getItem('token');
  
    if (!user || !token || user.role !== 'customer') {
      window.location = "SignIn.html";
    }
  
    user._id = user._id || user.id;
  
    // ----- DOM SHORTCUTS -----
    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));
  
    // ----- STATE -----
    let socket = null;
    let activeChatId = null;
    let isTyping = false;
    let typingTimer = null;
    const TYPING_TIMEOUT = 2500;
  
    // ----- SOCKET -----
    function initSocket() {
      socket = io(BASE_URL, { auth: { token } });
  
      socket.on('connect', () => {
        console.log('[SOCKET] Customer connected');
        if (user._id) socket.emit('register', user._id);
      });
  
      socket.on('newMessage', (payload) => {
        handleIncomingMessage(payload);
      });
  
      socket.on('typing', ({ chatId }) => {
        if (String(chatId) === String(activeChatId)) {
          $('#typingIndicator')?.style.setProperty('display', 'block');
        }
      });
  
      socket.on('stopTyping', ({ chatId }) => {
        if (String(chatId) === String(activeChatId)) {
          $('#typingIndicator')?.style.setProperty('display', 'none');
        }
      });
    }
  
    // ----- HELPERS -----
    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  
    function formatTimeShort(ts) {
      try {
        const d = new Date(ts);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } catch {
        return '';
      }
    }
  
    function isNearBottom(el, threshold = 80) {
      if (!el) return true;
      return (el.scrollHeight - el.clientHeight - el.scrollTop) <= threshold;
    }
  
    // ----- CHAT LIST -----
    async function loadCustomerChats() {
      const container = $('.chat-list');
      if (!container) return;
  
      container.innerHTML = '<p style="text-align:center;color:#9aa6b2">Loading conversations...</p>';
  
      try {
        const res = await fetch(`${MESSAGE_API_URL}/my-chats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
  
        if (!res.ok) throw new Error('Failed to load chats');
  
        const chats = await res.json();
  
        container.innerHTML = '';
        if (!chats?.length) {
          container.innerHTML = '<p style="text-align:center;color:#9aa6b2">No conversations yet.</p>';
          return;
        }
  
        chats.forEach(chat => renderChatItem(chat, container));
      } catch (err) {
        console.error(err);
        container.innerHTML = '<p style="color:red;text-align:center">Failed to load chats</p>';
      }
    }
  
    function renderChatItem(chat, container) {
      const other = chat.participants?.find(p => (p._id || p.id) !== user._id) || {};
      const name = other.username || other.name || 'Artisan';
      const lastMsg = chat.latestMessage || (chat.messages?.[chat.messages.length-1]) || {};
      const lastText = lastMsg.text || lastMsg.content || 'Say hi...';
      const time = formatTimeShort(lastMsg.createdAt);
      const unread = chat.unreadCount || 0;
  
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.dataset.chatId = chat._id;
      item.style.cssText = `
        display:flex; align-items:center; gap:12px; padding:12px; cursor:pointer; border-bottom:1px solid #1e3d59;
      `;
  
      // Avatar
      const avatar = document.createElement('div');
      avatar.style.cssText = `
        width:48px; height:48px; border-radius:50%; background:#4b5563; 
        color:white; font-weight:600; display:flex; align-items:center; justify-content:center;
      `;
      avatar.textContent = name[0]?.toUpperCase() || '?';
  
      // Info
      const info = document.createElement('div');
      info.style.flex = '1';
      info.innerHTML = `
        <div style="display:flex;justify-content:space-between">
          <strong style="color:#e2e8f0">${escapeHtml(name)}</strong>
          <small style="color:#94a3b8">${time}</small>
        </div>
        <div style="margin-top:4px;display:flex;justify-content:space-between;align-items:center">
          <span style="color:#cbd5e1;font-size:13px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${escapeHtml(lastText)}
          </span>
          ${unread ? `<span style="background:#f59e0b;color:#0f172a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">${unread}</span>` : ''}
        </div>
      `;
  
      item.appendChild(avatar);
      item.appendChild(info);
  
      item.addEventListener('click', () => openChat(chat._id, name));
  
      container.appendChild(item);
    }
  
    // ----- OPEN CHAT -----
    async function openChat(chatId, otherName) {
      activeChatId = chatId;
  
      const chatView = $('#individualChatView');
      if (chatView) chatView.style.display = 'block';
  
      const header = $('#chatHeader');
      if (header) header.textContent = otherName || 'Chat';
  
      const messagesEl = $('#messages');
      if (!messagesEl) return;
  
      messagesEl.innerHTML = '<p style="text-align:center;color:#9aa6b8">Loading messages...</p>';
  
      try {
        const res = await fetch(`${MESSAGE_API_URL}/${chatId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
  
        if (!res.ok) throw new Error('Failed to load messages');
  
        const messages = await res.json();
        renderMessages(messages, messagesEl);
  
        messagesEl.scrollTop = messagesEl.scrollHeight;
  
        // Join room
        socket?.emit('joinChat', chatId);
      } catch (err) {
        console.error(err);
        messagesEl.innerHTML = '<p style="color:red;text-align:center">Could not load messages</p>';
      }
    }
  
    // ----- RENDER MESSAGES (same style as artisan) -----
    function renderMessages(messages, container) {
      container.innerHTML = '';
  
      if (!messages?.length) {
        container.innerHTML = '<div style="text-align:center;color:#9aa6b8;padding:20px">No messages yet. Start the conversation!</div>';
        return;
      }
  
      messages.forEach(m => {
        const isMe = String(m.sender?._id || m.sender) === String(user._id);
  
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; margin:8px 6px;
        `;
  
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.style.cssText = `
          max-width:78%; padding:10px 14px; border-radius:12px; position:relative; word-break:break-word;
          background:${isMe ? 'linear-gradient(90deg, #f6d365 0%, #fda085 100%)' : 'rgba(255,255,255,0.08)'};
          color:${isMe ? '#0f172a' : '#ffffff'};
          border-bottom-${isMe ? 'right' : 'left'}-radius:4px;
        `;
  
        // Media
        if (m.image || m.voiceNote || m.mediaUrl) {
          const src = m.image || m.voiceNote || m.mediaUrl || '';
          const fullSrc = src.startsWith('http') ? src : `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
  
          if (src.toLowerCase().match(/\.(webm|mp3|wav|ogg)$/i)) {
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = fullSrc;
            audio.style.cssText = 'max-width:240px; display:block; margin:8px auto;';
            bubble.appendChild(audio);
          } else {
            const img = document.createElement('img');
            img.src = fullSrc;
            img.style.cssText = 'max-width:240px; border-radius:8px; display:block; margin:8px auto;';
            img.loading = 'lazy';
            bubble.appendChild(img);
          }
        }
  
        // Text
        if (m.text || m.content) {
          const textDiv = document.createElement('div');
          textDiv.textContent = m.text || m.content;
          bubble.appendChild(textDiv);
        }
  
        // Meta
        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px; opacity:0.8; margin-top:6px; text-align:right;';
        meta.textContent = formatTimeShort(m.createdAt);
  
        if (isMe) {
          const status = document.createElement('span');
          status.style.marginLeft = '8px';
          status.innerHTML = m.seen ? '✓✓' : (m.delivered ? '✓' : '');
          meta.appendChild(status);
        }
  
        bubble.appendChild(meta);
        wrapper.appendChild(bubble);
        container.appendChild(wrapper);
      });
    }
  
    // ----- SEND MESSAGE -----
    async function sendMessage() {
      const input = $('#messageInput');
      if (!input || !activeChatId) return;
  
      const text = input.value.trim();
      if (!text) return;
  
      const tempMsg = {
        text,
        sender: { _id: user._id },
        createdAt: new Date().toISOString(),
        isMe: true
      };
  
      // Optimistic UI
      renderMessages([tempMsg], $('#messages')); // append only
  
      input.value = '';
  
      try {
        const res = await fetch(`${MESSAGE_API_URL}/${activeChatId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ text })
        });
  
        if (!res.ok) throw new Error('Send failed');
  
        const realMsg = await res.json();
        // You can replace optimistic message here if needed
      } catch (err) {
        console.error('Send error:', err);
        alert('Failed to send message');
      }
    }
  
    // ----- INCOMING MESSAGE -----
    function handleIncomingMessage({ chatId, message }) {
      if (String(chatId) === String(activeChatId)) {
        const container = $('#messages');
        if (isNearBottom(container)) {
          renderMessages([message], container); // append
        }
      } else {
        // Update chat list badge / preview (optional)
        loadCustomerChats(); // simple refresh
      }
    }
  
    // ----- TYPING -----
    $('#messageInput')?.addEventListener('input', () => {
      if (!activeChatId || isTyping) return;
      isTyping = true;
      socket?.emit('typing', { chatId: activeChatId });
  
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isTyping = false;
        socket?.emit('stopTyping', { chatId: activeChatId });
      }, TYPING_TIMEOUT);
    });
  
    // ----- UI EVENTS -----
    $('#sendBtn')?.addEventListener('click', sendMessage);
    $('#messageInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  
    $('#chatBackBtn')?.addEventListener('click', () => {
      $('#individualChatView').style.display = 'none';
      activeChatId = null;
      socket?.emit('leaveChat', activeChatId);
    });
  
    // ----- INIT -----
    document.addEventListener('DOMContentLoaded', () => {
      initSocket();
      loadCustomerChats();
  
      // Optional: open specific chat from url or localStorage
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chat');
      if (chatId) openChat(chatId, 'Chat');
    });
  
  })();

    function stopMiniChatPolling() {
        if (miniChatPollInterval) {
            clearInterval(miniChatPollInterval);
            miniChatPollInterval = null;
        }
    }

    // -------------------------
    // INIT
    // -------------------------
    document.addEventListener("DOMContentLoaded", () => {
        const urlParams = new URLSearchParams(window.location.search);
        const shouldOpenMessages = urlParams.get('openMessages') === 'true';
        const chatDataString = localStorage.getItem("openChatWith");
        let artisanToOpen = null;

        if (shouldOpenMessages && chatDataString) {
            try { artisanToOpen = JSON.parse(chatDataString); } catch (e) { console.error(e); }
        }

        if (artisanToOpen) {
            showPage("messages");
        } else {
            showPage("home");
        }
    });

    // Stop polling when window unloads
    window.addEventListener('beforeunload', () => stopMiniChatPolling());

})();


function renderChatList(chats) {
  const container = document.querySelector('.chat-list');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(chats) || chats.length === 0) { container.innerHTML = '<p class="no-chats p-4 text-center text-gray-400">No conversations yet.</p>'; return; }
  chats.forEach(chat => {
    const other = (chat.participants || []).find(p => (p._id || p.id) !== (user._id || user.id)) || {};
    const name = other?.username || other?.name || 'Customer';
    const lastMessage = (chat.messages && chat.messages.length) ? chat.messages[chat.messages.length -1] : (chat.latestMessage || null);
    const lastText = lastMessage ? (lastMessage.text || lastMessage.content || '') : 'Say hi';
    const lastTime = lastMessage ? formatTimeShort(lastMessage.createdAt || lastMessage.createdAt) : '';
    const unreadCount = chat.unreadCount || 0;
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.style.display='flex'; el.style.alignItems='center'; el.style.gap='12px'; el.style.padding='12px'; el.style.cursor='pointer';
    el.dataset.chatId = chat._id || chat.id || chat.chatId;
    const avatarWrapper = document.createElement('div'); avatarWrapper.style.flex='0 0 auto'; avatarWrapper.appendChild(createAvatar(name,46));
    const details = document.createElement('div'); details.style.flex='1';
    details.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${escapeHtml(name)}</div><div style="font-size:12px;color:#9aa6b2">${escapeHtml(lastTime)}</div></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><div style="font-size:13px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px" data-preview-text>${escapeHtml(lastText)}</div><div>${unreadCount ? `<span style="background:#ffc107;color:#00172b;font-weight:700;border-radius:999px;padding:4px 8px;font-size:12px">${escapeHtml(String(unreadCount))}</span>` : ''}</div></div>`;
    el.appendChild(avatarWrapper); el.appendChild(details);
    el.addEventListener('click', ()=> { const badge = el.querySelector('span'); if (badge) badge.remove(); openChat(el.dataset.chatId); });
    container.appendChild(el);
    // set dataset to help diffing later
    el.dataset.lastMessageId = (lastMessage && (lastMessage._id || lastMessage.id)) || '';
    el.dataset.unread = String(unreadCount || 0);
  });
}

function updateReactionDisplay(bubbleInner, reactions) {
  if (!bubbleInner) return;
  let rd = bubbleInner.querySelector('.reaction-display');

  if (reactions && Object.keys(reactions).length > 0) {
      if (!rd) {
          rd = document.createElement('div');
          rd.className = 'reaction-display';
          rd.style.position = 'absolute';
          rd.style.bottom = '-8px';
          rd.style.right = '0';
          rd.style.display = 'flex';
          rd.style.gap = '4px';
          rd.style.padding = '2px 4px';
          rd.style.borderRadius = '999px';
          rd.style.background = '#1e3d59';
          rd.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';
          rd.style.color = 'white';
          bubbleInner.style.position = 'relative';
          bubbleInner.appendChild(rd);
      }
      rd.innerHTML = '';

      Object.entries(reactions).forEach(([emoji, userIds]) => {
          if (userIds.length > 0) {
              const count = userIds.length;
              const reactionBadge = document.createElement('span');
              reactionBadge.className = 'reaction-badge';
              reactionBadge.textContent = `${emoji} ${count}`;
              reactionBadge.style.fontSize = '10px';
              reactionBadge.style.lineHeight = '1';
              reactionBadge.style.display = 'flex';
              reactionBadge.style.alignItems = 'center';
              reactionBadge.style.cursor = 'pointer';

              const reactedBy = userIds.map(id => id === user._id || id === user.id ? 'You' : String(id).substring(0, 4)).join(', ');
              reactionBadge.title = `Reacted by: ${reactedBy}`;

              rd.appendChild(reactionBadge);
          }
      });
  } else {
      if (rd) rd.remove();
  }
}

async function openChat(chatId) {
  if (!chatId) return;
  activeChatId = chatId;
  const view = document.getElementById('individualChatView'); if (view) view.style.display = 'block';
  const msgsEl = document.getElementById('messages'); if (!msgsEl) return;
  msgsEl.innerHTML = '<p style="text-align:center;color:#9aa6b2">Loading messages...</p>';
  try {
      const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(chatId)}`, { headers: authHeaders(true) });
      if (!res.ok) { console.warn('openChat fetch failed', res.status); msgsEl.innerHTML = '<p style="color:red;text-align:center">Could not load messages.</p>'; return; }
      const msgs = await res.json();
      renderMessages(msgs || []);
      // hide typing indicator
      const tEl = document.getElementById('typingIndicator'); if (tEl) tEl.style.display = 'none';
      // record last message id for append-only fetches
      markLastMessageAfterOpen(chatId);
  } catch (e) { console.error('openChat error', e); msgsEl.innerHTML = '<p style="color:red;text-align:center">Error loading messages.</p>'; }
}
/***********************
* Helpers (required)
***********************/
function normalizeId(v) {
if (v === undefined || v === null || v === '') return '';
try {
  if (typeof v === 'object') {
    if (v._id) return String(v._id);
    if (v.id) return String(v.id);
    if (v.toString && typeof v.toString === 'function') {
      const s = v.toString();
      if (s && s !== '[object Object]') return String(s);
    }
    // Buffer-based ObjectId structures
    if (v.id && typeof v.id === 'object' && v.id.toString) return String(v.id.toString());
    return JSON.stringify(v);
  }
  return String(v);
} catch (e) { return String(v); }
}

function escapeHtml(str) {
if (str === undefined || str === null) return '';
return String(str)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');
}

function formatTimeShort(ts) {
try {
  const d = new Date(ts || Date.now());
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
} catch (e) { return ''; }
}

async function safeJson(res) {
try { return await res.json(); }
catch (e) { return { status: res.status, text: await res.text().catch(()=>'') }; }
}

function authHeaders(withJson = false) {
const h = {};
const tk = (typeof localStorage !== 'undefined') ? localStorage.getItem('token') : null;
if (tk) h['Authorization'] = `Bearer ${tk}`;
if (withJson) h['Content-Type'] = 'application/json';
return h;
}

/** computeIsMe - consistent heuristic to determine if the message came from current user */
function computeIsMe(m) {
// Normalize user id
if (typeof user === 'object' && user !== null && !user._id) {
  user._id = user.id || user.userId || user.uid || user._id || '';
}
const currentArtisanId = normalizeId(user && (user._id || user.id || user.userId || user.uid) || '');

// check explicit flags first
if (m.outgoing === true || m.isMine === true || m.fromCurrentUser === true || m.fromClient === true) return true;
if (m.incoming === true || m.isIncoming === true) return false;

// role fields
const role = (m.role || m.fromRole || m.senderRole || '').toString().toLowerCase();
if (role.includes('artisan') || role.includes('provider')) {
  if (currentArtisanId) {
    // if there's an id, compare; otherwise assume artisan (if current user role is artisan)
    const candidate = normalizeId(m.senderId || m.sender || m.from || m.userId || '');
    if (candidate) return candidate === currentArtisanId;
    return (user && user.role && user.role.toLowerCase().includes('artisan')) || false;
  }
  return false;
}

// id-based comparison
const senderCandidates = [m.senderId, m.sender, m.from, m.userId, m.authorId, m.creatorId];
const senderRaw = senderCandidates.find(v => v !== undefined && v !== null) || '';
const msgSenderId = normalizeId(senderRaw);

if (msgSenderId && currentArtisanId) return msgSenderId === currentArtisanId;

// socket id fallback
if (typeof window !== 'undefined' && window.socket && (m.socketId || m.fromSocketId)) {
  try {
    if (String(m.socketId || m.fromSocketId) === String(window.socket.id)) return true;
  } catch (e) { /* ignore */ }
}

// conservative default: treat as not me (received)
return false;
}

/***********************
* renderMessages
* Replaces your earlier function; handles date separators, media, and left/right
***********************/
function renderMessages(messages) {
const msgsEl = document.getElementById('messages');
if (!msgsEl) return;
msgsEl.innerHTML = '';

if (!Array.isArray(messages) || messages.length === 0) {
  msgsEl.innerHTML = '<div style="text-align:center;color:#9aa6b2;padding-top:12px">No messages yet. Say hi!</div>';
  return;
}

// ensure normalized user id
if (typeof user === 'object' && user !== null && !user._id) {
  user._id = normalizeId(user.id || user.userId || user.uid || user._id || '');
} else if (user && user._id) user._id = normalizeId(user._id);

let lastDate = null;

messages.forEach(m => {
  try {
    const isMe = computeIsMe(m);

    const msgDate = new Date(m.createdAt || m.ts || m.time || Date.now());
    const msgDateStr = msgDate.toDateString();

    // Date separator
    if (msgDateStr !== lastDate) {
      const sep = document.createElement('div');
      sep.style.margin = '12px auto';
      sep.style.padding = '6px';
      sep.style.background = '#022b3a';
      sep.style.color = '#cbd5e1';
      sep.style.display = 'inline-block';
      sep.style.borderRadius = '999px';
      sep.textContent = (msgDateStr === new Date().toDateString()) ? 'Today' : msgDate.toLocaleDateString();
      sep.className = 'date-sep';
      msgsEl.appendChild(sep);
      lastDate = msgDateStr;
    }

    // wrapper
    const wrapper = document.createElement('div');
    wrapper.className = `message-container ${isMe ? 'sent' : 'received'}`;
    wrapper.style.display = 'flex';
    wrapper.style.justifyContent = isMe ? 'flex-end' : 'flex-start';
    wrapper.style.margin = '8px 6px';

    // bubble
    const bubbleInner = document.createElement('div');
    bubbleInner.className = 'message-bubble msg-enter';
    bubbleInner.dataset.msgId = m._id || m.id || '';
    bubbleInner.style.maxWidth = '72%';
    bubbleInner.style.padding = '10px';
    bubbleInner.style.borderRadius = '12px';
    bubbleInner.style.wordBreak = 'break-word';
    bubbleInner.style.boxShadow = '0 6px 14px rgba(0,0,0,0.18)';

    // styling by side
    if (isMe) {
      // artisan (right) - gold-ish
      bubbleInner.style.background = 'linear-gradient(90deg,#f6d365 0%,#fda085 100%)';
      bubbleInner.style.color = '#0b0b0b';
      bubbleInner.style.borderBottomRightRadius = '4px';
    } else {
      // customer (left) - light blue
      bubbleInner.style.background = 'rgba(173,216,230,0.08)';
      bubbleInner.style.color = '#fff';
      bubbleInner.style.borderBottomLeftRadius = '4px';
      bubbleInner.style.border = '1px solid rgba(135,206,250,0.04)';
    }

    // Media handling
  // Replace the media handling block in BOTH renderMessages and appendMessageLocally with this:

// Media handling - FIXED to support voiceNote & image from backend
// Media handling - FINAL VERSION
const mediaSrc = m.voiceNote || m.image || m.mediaUrl || m.media?.url || m.fileUrl || m.url;
if (mediaSrc) {
// Make it a full absolute URL (this fixes everything)
let src = mediaSrc;
if (!src.startsWith('http') && !src.startsWith('data:')) {
  src = src.replace(/^.*public[\/\\]?/, '/'); // clean any junk
  src = src.replace(/\\/g, '/');               // fix backslashes
  src = `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
}

console.log('[MEDIA DEBUG] Rendering src:', src); // ← keep for 1-2 tests

const lower = src.toLowerCase();
const isAudio = 
  lower.endsWith('.webm') || 
  lower.endsWith('.mp3') || 
  lower.endsWith('.wav') || 
  lower.endsWith('.ogg') || 
  lower.includes('audio/');

let mediaEl;
if (isAudio) {
  mediaEl = document.createElement('audio');
  mediaEl.controls = true;
  mediaEl.preload = 'metadata'; // shows duration faster
  mediaEl.src = src;
  mediaEl.style.maxWidth = '100%';
  mediaEl.style.width = '240px';
  mediaEl.style.display = 'block';
  mediaEl.style.margin = '8px auto';
} else {
  mediaEl = document.createElement('img');
  mediaEl.src = src;
  mediaEl.alt = m.text || 'Image';
  mediaEl.loading = 'lazy';
  mediaEl.style.maxWidth = '100%';
  mediaEl.style.width = '240px';
  mediaEl.style.borderRadius = '8px';
  mediaEl.style.display = 'block';
  mediaEl.style.margin = '8px auto';
}

bubbleInner.appendChild(mediaEl);
}
    // Text content (safe)
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = escapeHtml(m.text || m.content || m.body || '');
    bubbleInner.appendChild(textDiv);

    // Meta row (time + status)
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.style.display = 'flex';
    meta.style.justifyContent = 'flex-end';
    meta.style.gap = '8px';
    meta.style.marginTop = '6px';
    meta.style.alignItems = 'center';

    const timeSpan = document.createElement('span');
    timeSpan.style.fontSize = '11px';
    timeSpan.style.opacity = '0.85';
    timeSpan.style.color = isMe ? 'inherit' : '#cbd5e1';
    timeSpan.textContent = formatTimeShort(m.createdAt || Date.now());
    meta.appendChild(timeSpan);

    if (isMe) {
      const statusIcon = document.createElement('span');
      statusIcon.style.fontSize = '12px';
      statusIcon.style.marginLeft = '6px';
      statusIcon.innerHTML = m.seen ? '✅' : (m.delivered ? '✓' : '');
      meta.appendChild(statusIcon);
    }

    bubbleInner.appendChild(meta);

    // Reactions display if present
    if (m.reactions && Array.isArray(m.reactions) && m.reactions.length) {
      const rwrap = document.createElement('div');
      rwrap.style.marginTop = '6px';
      rwrap.className = 'reaction-row';
      m.reactions.forEach(r => {
        const pill = document.createElement('span');
        pill.textContent = r;
        pill.style.marginRight = '6px';
        pill.style.fontSize = '13px';
        rwrap.appendChild(pill);
      });
      bubbleInner.appendChild(rwrap);
    }

    // interactions for reaction picker (guarded)
    bubbleInner.addEventListener('contextmenu', ev => { ev.preventDefault(); if (typeof openReactionPicker === 'function') openReactionPicker(ev, bubbleInner.dataset.msgId); });
    bubbleInner.addEventListener('click', ev => { if (ev.ctrlKey && typeof openReactionPicker === 'function') openReactionPicker(ev, bubbleInner.dataset.msgId); });

    wrapper.appendChild(bubbleInner);
    msgsEl.appendChild(wrapper);

    // animation trigger (optional)
    void bubbleInner.offsetHeight;
    bubbleInner.classList.add('msg-enter-active');
    setTimeout(() => bubbleInner.classList.add('msg-pop'), 220);
    setTimeout(() => bubbleInner.classList.remove('msg-pop'), 420);
  } catch (err) {
    console.error('renderMessages: per-message error', err, m);
  }
});

// keep scroll to bottom
msgsEl.scrollTop = msgsEl.scrollHeight;
}

  /***********************
   * appendMessageLocally
   * Appends a single message to the DOM (safe to call for optimistic updates)
   ***********************/
 const ChatContext = {
  type: 'artisan', // or 'customer'
  activeChatId: null,
  messageApiUrl: null
};
  function handleIncomingSocketMessage(payload) {
      const { chatId, message, unreadCount } = payload || {};
      if (!chatId || !message) return;
      
      // 1. If chat is open, just append the new message
      if (String(activeChatId) === String(chatId)) {
          appendMessageLocally(message);
      } else {
          // 2. Chat is not open, find it in the list
          const item = document.querySelector(`[data-chat-id="${chatId}"]`);
          
          if (item) {
              const lastMsgEl = item.querySelector('.last-message-text'); // Assuming you have a class for the last message text
  
              // Update last message text
              if (lastMsgEl) lastMsgEl.textContent = message.text || message.content || 'Media message';
  
              // Update unread count badge
              let badge = item.querySelector('.unread-badge');
              if (!badge) {
                  // If no badge exists, create one
                  badge = document.createElement('span');
                  badge.className = 'unread-badge text-xs font-bold text-gray-900 bg-yellow-500 rounded-full px-2 py-0.5 ml-auto';
                  item.querySelector('div.flex-1')?.appendChild(badge); // Append to a suitable location
              }
  
              // Update the count or hide if 0
              if (typeof unreadCount !== 'undefined' && unreadCount > 0) {
                  badge.textContent = unreadCount;
                  badge.style.display = 'inline-block';
              } else if (typeof unreadCount !== 'undefined' && unreadCount === 0) {
                  badge.style.display = 'none';
              }
              
              // Move chat to top
              const listEl = document.querySelector('.chat-list');
              if (listEl && item) listEl.insertBefore(item, listEl.firstChild);
              
          } else {
              // If chat not present, fetch chats (silent)
              loadArtisanChats().then(ch => diffAndUpdateChatList(ch || []));
          }
      }
      // ensure chatLastMsgId for that chat is updated
      if (message && (message._id || message.id)) chatLastMsgId.set(String(chatId), message._id || message.id);
  }
  
    // --- Reaction handler for socket updates ---
    function handleIncomingReaction(payload) {
        const { chatId, messageId, reactions } = payload || {};
        // always update reaction display for that message
        if (!messageId) return;
        const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
        if (msgEl) updateReactionDisplay(msgEl, reactions);
    }
  
    // ----- Typing notifier -----
    function notifyTyping(chatId) {
        if (!socket || !chatId) return;
        if (!isTyping) { isTyping = true; socket.emit('typing', { chatId }); }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { isTyping = false; socket.emit('stopTyping', { chatId }); }, TYPING_TIMEOUT);
    }
  
    // ----- Reaction picker -----
    function openReactionPicker(ev, messageId) {
        ev.preventDefault();
        const existing = document.querySelector('.reaction-picker'); if (existing) existing.remove();
        const picker = document.createElement('div'); picker.className = 'reaction-picker';
        picker.style.left = `${ev.clientX - 30}px`; picker.style.top = `${ev.clientY - 60}px`;
        REACTIONS.forEach(r => {
            const e = document.createElement('span'); e.className = 'reaction-emoji'; e.textContent = r; e.style.cursor = 'pointer'; e.style.margin = '6px';
            e.addEventListener('click', async () => {
                if (!activeChatId) { showStatusMessage('Select a chat first', 'warning'); return; }
  
                if (socket && socket.connected) socket.emit('messageReaction', { chatId: activeChatId, messageId, reaction: r });
  
                try {
                    await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/messages/${encodeURIComponent(messageId)}/react`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ reaction: r }) });
                } catch (err) { console.warn('reaction POST failed', err); showStatusMessage('Failed to post reaction', 'error'); }
  
                picker.remove();
            });
            picker.appendChild(e);
        });
        document.body.appendChild(picker);
        setTimeout(() => window.addEventListener('click', removePickerOnce));
        function removePickerOnce(e) { if (!picker.contains(e.target)) picker.remove(); window.removeEventListener('click', removePickerOnce); }
    }// artisan-test.js
  
  // ===== pollForUpdates =====
  // Simple poller: call this from DOMContentLoaded or wherever you previously called pollForUpdates
  // It will fetch messages for activeChatId and call renderMessages(messagesArray).
  // Keeps a lastFetchedAt to avoid unnecessary re-renders.
  let _lastFetchedAt = 0;
  let _pollIntervalId = null;
  
  function pollForUpdates() {
    if (!activeChatId) return; // nothing to poll
  
    // one-shot immediate fetch (you can also setInterval separately)
    (async () => {
      try {
        const url = `${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/messages?limit=100`;
        const res = await fetch(url, { headers: authHeaders(false) });
        if (!res.ok) {
          // If server returns 404 or 500, log but don't blow up
          console.warn('pollForUpdates: fetch failed', res.status);
          return;
        }
        const payload = await safeJson(res);
        // normalize to array
        const messages = Array.isArray(payload) ? payload : (payload.messages || payload.data || []);
        // Optional: compute a simple last-modified timestamp to reduce DOM churn
        if (!Array.isArray(messages)) return;
        const newest = messages.length ? Math.max(...messages.map(m => new Date(m.createdAt || m.ts || Date.now()).getTime())) : 0;
        if (newest > _lastFetchedAt) {
          _lastFetchedAt = newest;
          // call your renderer - renderMessages defined in your code
          if (typeof renderMessages === 'function') renderMessages(messages);
        }
      } catch (err) {
        console.warn('pollForUpdates error', err);
      }
    })();
  }
  
  // Optional: start/stop automatic polling
  function startAutoPoll(intervalMs = 5000) {
    if (_pollIntervalId) clearInterval(_pollIntervalId);
    _pollIntervalId = setInterval(() => { pollForUpdates(); }, intervalMs);
    // run once immediately
    pollForUpdates();
  }
  function stopAutoPoll() { if (_pollIntervalId) { clearInterval(_pollIntervalId); _pollIntervalId = null; } }
  
  // You must ensure stopPollingFallback is called on logout as well.
  
    // ----- Voice notes (MediaRecorder) -----
    (function setupVoice() {
      let mediaRecorder = null;
      let audioChunks = [];
      let recordingStart = 0;
      let recordingInterval = null;
  
      const voiceBtn = document.getElementById('voiceBtn');
      const voiceUI = document.getElementById('voiceRecordingUI');
      const voiceTimer = document.getElementById('voiceTimer');
      const voiceCancel = document.getElementById('voiceCancel');
      const voiceStop = document.getElementById('voiceStop');
  
      function formatTimer(ms) {
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      }
  
      async function startRecording() {
        if (!navigator.mediaDevices?.getUserMedia) {
          showStatusMessage('Browser does not support audio recording', 'warning');
          return;
        }
        if (!activeChatId) {
          showStatusMessage('Select a chat first', 'warning');
          return;
        }
  
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
          audioChunks = [];
  
          mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
          };
  
          mediaRecorder.onstop = async () => {
            clearInterval(recordingInterval);
            if (voiceTimer) voiceTimer.textContent = '00:00';
            stream.getTracks().forEach(t => t.stop());
  
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            if (blob.size < 1000) {
              showStatusMessage('Voice note too short', 'warning');
              return;
            }
  
            const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
            await sendMedia(file, true);
          };
  
          mediaRecorder.start();
          recordingStart = Date.now();
          if (voiceUI) voiceUI.style.display = 'flex';
          recordingInterval = setInterval(() => {
            if (voiceTimer) voiceTimer.textContent = formatTimer(Date.now() - recordingStart);
            if (Date.now() - recordingStart > 120000) stopRecording(); // 2 min max
          }, 250);
        } catch (err) {
          console.error('startRecording error:', err);
          showStatusMessage('Could not access microphone', 'error');
        }
      }
  
      function stopRecording() {
        if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
        if (voiceUI) voiceUI.style.display = 'none';
      }
  
      function cancelRecording() {
        stopRecording();
        audioChunks = [];
        if (voiceUI) voiceUI.style.display = 'none';
      }
  
      voiceBtn?.addEventListener('click', () => {
        if (mediaRecorder?.state === 'recording') stopRecording();
        else startRecording();
      });
  
      voiceStop?.addEventListener('click', stopRecording);
      voiceCancel?.addEventListener('click', cancelRecording);
    })();
  
    // ----- Image Upload -----
    document.getElementById('attachBtn')?.addEventListener('click', () => {
      document.getElementById('media')?.click();
    });
  
    document.getElementById('media')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.type.startsWith('image/')) {
        sendMedia(file);
      }
      e.target.value = '';
    });
  
    async function sendMedia(file, isVoice = false) {
      if (!file || !activeChatId) return;
    
      // Optimistic: Show preview immediately
      const blobUrl = URL.createObjectURL(file);
      const optimisticMsg = {
        _id: `temp-media-${Date.now()}`,
        text: isVoice ? 'Voice note (sending...)' : 'Image (sending...)',
        voiceNote: isVoice ? blobUrl : null,
        image: !isVoice ? blobUrl : null,
        sender: user._id,
        createdAt: new Date().toISOString(),
        isLocal: true // optional flag for styling
      };
    
      appendMessageLocally(optimisticMsg); // ← instant show!
    
      const fd = new FormData();
      fd.append('file', file);
      fd.append('text', isVoice ? 'Voice note' : 'Image');
    
      try {
        const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
    
        if (!res.ok) {
          console.error('Media failed:', await safeJson(res));
          showStatusMessage('Failed to send media', 'error');
          // Optional: remove optimistic on failure
          document.querySelector(`[data-msg-id="${optimisticMsg._id}"]`)?.remove();
          return;
        }
    
        const realMsg = await res.json();
    
        // Replace optimistic with real message
        const tempEl = document.querySelector(`[data-msg-id="${optimisticMsg._id}"]`);
        if (tempEl) tempEl.remove();
    
        appendMessageLocally(realMsg);
        if (socket && socket.connected) {
          socket.emit('newMessage', realMsg);
        }
    
        // Revoke blob URL to free memory
        URL.revokeObjectURL(blobUrl);
    
      } catch (err) {
        console.error('Media send error:', err);
        showStatusMessage('Network error sending media', 'error');
      }
    }
    // ----- Typing events wired to input -----
    (function attachFieldTyping() {
      const txt = document.getElementById('text');
      if (!txt) return;
      txt.addEventListener('input', () => { if (!activeChatId) return; notifyTyping(activeChatId); });
      txt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
      txt.addEventListener('blur', () => { if (isTyping && socket && activeChatId) { isTyping = false; socket.emit('stopTyping', { chatId: activeChatId }); } });
    })();
  async function loadMessages(chatId) {
      if (!chatId) return;
      try {
          const res = await fetch(`${MESSAGE_API_URL}/${chatId}`, {
              headers: { Authorization: `Bearer ${token}` }
          });
          if (!res.ok) return;
          const messages = await res.json();
          renderMessages(messages);
      } catch (err) {
          console.error("Failed to load messages:", err);
      }
  }
  
  function startPollingFallback() {
      setInterval(() => {
          if (activeChatId) loadMessages(activeChatId);
      }, 5000); // every 5 seconds
  }
  
  
    // ---------- PAGE VISIBILITY ----------
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAutoPoll();
      } else {
        startPollingFallback();
        pollForUpdates();
      }
    });
  
    // ----- Typing & Reaction server-side rely on these socket handlers on server -----
  
    // ----- UI events & wiring -----
    function attachUI() {
      document.getElementById('chatBackBtn')?.addEventListener('click', ()=> { document.getElementById('individualChatView').style.display='none'; activeChatId=null; });
      document.getElementById('sendBtn')?.addEventListener('click', (e)=> { e.preventDefault(); sendMessage(); });
      document.getElementById('attachBtn')?.addEventListener('click', ()=> document.getElementById('media').click());
      document.getElementById('media')?.addEventListener('change', ()=> {
        // auto-send media when selected
        sendMessage();
      });
      document.getElementById('newChatBtn')?.addEventListener('click', ()=> showStatusMessage('New chat flow not implemented', 'info'));
      document.getElementById('logout-btn')?.addEventListener('click', ()=> { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location='signin.html'; });
    }
  