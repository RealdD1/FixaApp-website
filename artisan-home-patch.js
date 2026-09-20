/**
 * INTEGRATION PATCH — artisan-home.js
 *
 * Apply these 4 changes to your existing artisan-home.js.
 * Do NOT copy the whole file — just find each section and replace.
 */

// ─── CHANGE 1: Add data-feature attributes to your toolbar buttons in HTML ──
// In your HTML file, update the buttons:
//
//   <button id="voiceBtn"  data-feature="voice"    ...>🎤</button>
//   <button id="attachBtn" data-feature="media"     ...>📎</button>
//   <button id="locationBtn" data-feature="location" ...>📍</button>  (if you have one)
//
// This lets ChatGuard lock/unlock them automatically.


// ─── CHANGE 2: Replace sendTextMessage ─────────────────────────────────────
async function sendTextMessage(text) {
  if (!text || !activeChatId) return;

  // ✅ Guard — block if banned/suspended
  if (window.ChatGuard && !window.ChatGuard.isAllowed()) {
    showStatusMessage('You are currently restricted from sending messages.', 'error');
    return;
  }

  // ✅ Guard — filter text
  if (window.ChatGuard) {
    const { blocked, reason } = await window.ChatGuard.checkText(text);
    if (blocked) {
      showStatusMessage(reason || 'Message blocked by chat guard.', 'error');
      return;
    }
  }

  const localId   = `temp-text-${Date.now()}`;
  const optimistic = {
    _id: localId, text,
    sender: artisanDatabaseId,
    createdAt: new Date().toISOString(),
    isLocal: true
  };
  appendMessage(optimistic);

  try {
    const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/messages`, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data    = await res.json();
    const realMsg = data.message || data;
    replaceOptimisticMessage(localId, realMsg);
    chatLastMsgId.set(String(activeChatId), realMsg._id || realMsg.id || '');
    if (socket && socket.connected) {
      socket.emit('newMessage', { chatId: activeChatId, message: realMsg });
    }
  } catch (err) {
    console.error('sendTextMessage error', err);
    showStatusMessage('Failed to send message', 'error');
    document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
  }
}


// ─── CHANGE 3: Replace sendMedia ───────────────────────────────────────────
async function sendMedia(file, isVoice = false) {
  window.__sendingMedia = true;
  if (!file || !activeChatId) return;

  // ✅ Guard — check if feature is locked (requires payment)
  const feature = isVoice ? 'voice' : 'media';
  if (window.ChatGuard && !window.ChatGuard.isFeatureUnlocked(feature)) {
    showStatusMessage('Complete payment to unlock this feature.', 'error');
    window.__sendingMedia = false;
    return;
  }

  // ✅ Guard — OCR check on images
  if (!isVoice && window.ChatGuard) {
    const { blocked, reason } = await window.ChatGuard.checkImage(file);
    if (blocked) {
      showStatusMessage(reason || 'Image blocked: restricted content detected.', 'error');
      window.__sendingMedia = false;
      return;
    }
  }

  const blobUrl  = URL.createObjectURL(file);
  const localId  = `temp-media-${Date.now()}`;
  const optimistic = {
    _id: localId,
    voiceNote: isVoice ? blobUrl : null,
    image: !isVoice ? blobUrl : null,
    sender: artisanDatabaseId,
    createdAt: new Date().toISOString(),
    isLocal: true
  };
  appendMessage(optimistic);

  const fd = new FormData();
  fd.append('file', file);
  if (isVoice) fd.append('type', 'voice');

  try {
    const res = await fetch(`${MESSAGE_API_URL}/${encodeURIComponent(activeChatId)}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const realMsg = await res.json();
    URL.revokeObjectURL(blobUrl);
    replaceOptimisticMessage(localId, realMsg);
    chatLastMsgId.set(String(activeChatId), realMsg._id || realMsg.id || '');
    if (socket && socket.connected) {
      socket.emit('newMessage', { chatId: activeChatId, message: realMsg });
    }
  } catch (err) {
    console.error('sendMedia error', err);
    showStatusMessage('Failed to send media', 'error');
    document.querySelector(`[data-msg-id="${localId}"]`)?.remove();
    URL.revokeObjectURL(blobUrl);
  } finally {
    window.__sendingMedia = false;
  }
}


// ─── CHANGE 4: Update the DOMContentLoaded boot block ──────────────────────
// Inside the existing DOMContentLoaded handler, add these 2 lines AFTER initSocket():

  // ✅ Init ChatGuard
  if (window.ChatGuard) {
    await window.ChatGuard.init(artisanDatabaseId, token);
  }

// AND update your openChat function to call onChatOpen:
// Inside openChat(), after `activeChatId = chatId;`, add:

  if (window.ChatGuard) {
    await window.ChatGuard.onChatOpen(chatId);
    window.ChatGuard.renderEscrowBanner();
    window.ChatGuard.renderLockedOverlay();
  }


// ─── CHANGE 5: Fix image refresh (root cause) ──────────────────────────────
// In your HTML, make sure the file input is NOT inside a <form> tag, OR
// ensure the form has onsubmit="return false".
// The safest fix: wrap the file input in a plain <div>, not a <form>.
//
// Also ensure this line exists in attachUI():
//   document.getElementById('media')?.addEventListener('change', function (e) {
//     e.preventDefault();
//     e.stopPropagation();       // ← this was present
//     const file = this.files[0];
//     if (!file) return;
//     sendMedia(file, false);
//     this.value = '';           // ← reset to allow same-file re-selection
//   });
//
// The root cause of the page refresh is usually a parent <form> with no
// action="" and no onsubmit="return false". Fix the HTML, not just the JS.
