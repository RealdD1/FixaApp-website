/**
 * FIXA — Notification + Dispute + Rating System
 * Shared module for artisan-home.js and customer (index.html)
 * Drop-in: <script src="fixa-notification-system.js"></script>
 * Call FixaSystem.init(socket, user, token, BASE_URL, role) after socket is ready
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────
  // INTERNAL STATE
  // ─────────────────────────────────────────────
  let _socket = null;
  let _user   = null;
  let _token  = null;
  let _base   = '';
  let _role   = 'customer'; // 'artisan' | 'customer'
  let _notifications = [];
  let _unreadCount   = 0;
  let _disputeBookingId = null;

  // ─────────────────────────────────────────────
// SOUND PLAYER (resilient — won't crash if blocked or missing)
// ─────────────────────────────────────────────
const _soundCache = {};
function playSound(name) {
  try {
    if (!_soundCache[name]) {
      _soundCache[name] = new Audio(`/sounds/${name}.mp3`);
      _soundCache[name].volume = 0.5;
    }
    // Clone to allow overlapping plays
    const a = _soundCache[name].cloneNode();
    a.volume = 0.5;
    a.play().catch(() => {}); // ignore autoplay blocks
  } catch {}
}
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
      if (dt.toDateString() === now.toDateString())
        return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return dt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }
  function authH(json = false) {
    const h = { Authorization: `Bearer ${_token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  async function apiFetch(path, opts = {}) {
    const r = await fetch(`${_base}${path}`, { ...opts, headers: { ...authH(true), ...(opts.headers || {}) } });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || `HTTP ${r.status}`); }
    return r.json();
  }

  // ─────────────────────────────────────────────
  // INJECT STYLES
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('fixa-sys-styles')) return;
    const style = document.createElement('style');
    style.id = 'fixa-sys-styles';
    style.textContent = `
      /* ── NOTIFICATION BELL CONTAINER ── */
      #fixaNotifContainer {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9000;
        font-family: 'Plus Jakarta Sans', 'Segoe UI', sans-serif;
      }
      #fixaNotifBell {
        width: 44px; height: 44px;
        background: rgba(255,215,0,0.12);
        border: 1px solid rgba(255,215,0,0.3);
        border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
        color: #ffd700;
        font-size: 20px;
        user-select: none;
      }
      #fixaNotifBell:hover { background: rgba(255,215,0,0.22); }
      #fixaNotifBadge {
        position: absolute;
        top: -5px; right: -5px;
        background: #ef4444;
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        min-width: 18px;
        height: 18px;
        border-radius: 999px;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        border: 2px solid #00172b;
      }
      /* ── NOTIFICATION PANEL ── */
      #fixaNotifPanel {
        position: absolute;
        top: 54px;
        right: 0;
        width: 340px;
        max-height: 480px;
        background: #051e30;
        border: 1px solid rgba(255,215,0,0.2);
        border-radius: 18px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.55);
        display: none;
        flex-direction: column;
        overflow: hidden;
        animation: fixaSlideDown 0.22s cubic-bezier(0.34,1.56,0.64,1);
      }
      #fixaNotifPanel.open { display: flex; }
      @keyframes fixaSlideDown {
        from { opacity: 0; transform: translateY(-10px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .fixa-notif-header {
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .fixa-notif-header h4 { font-size: 14px; font-weight: 700; color: #fff; }
      .fixa-notif-clear {
        background: none; border: none;
        color: rgba(255,255,255,0.4);
        font-size: 11px; cursor: pointer;
        transition: color 0.2s;
        padding: 0;
      }
      .fixa-notif-clear:hover { color: #ffd700; }
      .fixa-notif-list { overflow-y: auto; flex: 1; }
      .fixa-notif-item {
        padding: 13px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.04);
        cursor: pointer;
        transition: background 0.15s;
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .fixa-notif-item:hover { background: rgba(255,215,0,0.05); }
      .fixa-notif-item.unread { border-left: 3px solid #ffd700; }
      .fixa-notif-item.unread .fixa-ni-title { color: #fff; }
      .fixa-ni-icon {
        font-size: 20px;
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        background: rgba(255,255,255,0.05);
        border-radius: 10px;
      }
      .fixa-ni-content { flex: 1; }
      .fixa-ni-title { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); margin-bottom: 3px; }
      .fixa-ni-body  { font-size: 11.5px; color: rgba(255,255,255,0.45); line-height: 1.45; }
      .fixa-ni-time  { font-size: 10px; color: rgba(255,255,255,0.25); margin-top: 5px; }
      .fixa-notif-empty {
        text-align: center;
        padding: 36px 20px;
        color: rgba(255,255,255,0.25);
        font-size: 13px;
      }

      /* ── TOAST ── */
      #fixaToastZone {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
        pointer-events: none;
        width: 90%;
        max-width: 360px;
      }
      .fixa-toast {
        background: #051e30;
        border: 1px solid rgba(255,215,0,0.25);
        border-radius: 14px;
        padding: 12px 18px;
        display: flex;
        align-items: center;
        gap: 10px;
        pointer-events: auto;
        animation: fixaToastIn 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards;
        width: 100%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }
      .fixa-toast.leaving { animation: fixaToastOut 0.25s ease forwards; }
      @keyframes fixaToastIn  { from { opacity:0; transform: translateY(20px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }
      @keyframes fixaToastOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(10px); } }
      .fixa-toast-icon { font-size: 18px; }
      .fixa-toast-content { flex: 1; }
      .fixa-toast-title { font-size: 13px; font-weight: 700; color: #fff; }
      .fixa-toast-body  { font-size: 11.5px; color: rgba(255,255,255,0.55); margin-top: 2px; }

      /* ── ADMIN ALERT OVERLAY ── */
      #fixaAdminAlert {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.75);
        z-index: 10000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        backdrop-filter: blur(4px);
      }
      #fixaAdminAlert.open { display: flex; }
      .fixa-admin-alert-box {
        background: linear-gradient(145deg, #051e30, #0a2a40);
        border: 1px solid rgba(255,215,0,0.35);
        border-radius: 24px;
        padding: 32px 28px;
        width: 100%;
        max-width: 380px;
        text-align: center;
        animation: fixaPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes fixaPopIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }
      .fixa-aa-icon { font-size: 48px; margin-bottom: 14px; display: block; }
      .fixa-aa-title { font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 8px; }
      .fixa-aa-body  { font-size: 13.5px; color: rgba(255,255,255,0.6); line-height: 1.6; margin-bottom: 24px; }
      .fixa-aa-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 12px 32px;
        border-radius: 12px;
        font-weight: 700;
        font-size: 14px;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }
      .fixa-aa-btn-gold    { background: #ffd700; color: #000; }
      .fixa-aa-btn-danger  { background: #ef4444; color: #fff; }
      .fixa-aa-btn:hover   { filter: brightness(1.1); }
      .fixa-aa-btn-ghost {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.2);
        color: rgba(255,255,255,0.6);
        margin-left: 10px;
        font-size: 13px;
        padding: 10px 20px;
      }

      /* ── DISPUTE MODAL ── */
      #fixaDisputeModal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        z-index: 9500;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        backdrop-filter: blur(3px);
      }
      #fixaDisputeModal.open { display: flex; }
      .fixa-dispute-box {
        background: #041b2b;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 22px;
        width: 100%;
        max-width: 420px;
        overflow: hidden;
        animation: fixaPopIn 0.28s cubic-bezier(0.34,1.56,0.64,1);
      }
      .fixa-dispute-header {
        padding: 20px 22px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .fixa-dispute-header h3 { font-size: 17px; font-weight: 800; color: #fff; }
      .fixa-dispute-close {
        background: rgba(255,255,255,0.07);
        border: none; color: rgba(255,255,255,0.5);
        width: 30px; height: 30px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 18px;
        display: flex; align-items: center; justify-content: center;
      }
      .fixa-dispute-body { padding: 20px 22px; }
      .fixa-field-label {
        font-size: 11px;
        font-weight: 700;
        color: rgba(255,255,255,0.35);
        text-transform: uppercase;
        letter-spacing: 0.6px;
        margin-bottom: 6px;
        display: block;
      }
      .fixa-field-input, .fixa-field-select, .fixa-field-textarea {
        width: 100%;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        padding: 10px 14px;
        color: #fff;
        font-size: 13.5px;
        outline: none;
        transition: border 0.2s;
        margin-bottom: 14px;
        font-family: inherit;
        box-sizing: border-box;
      }
      .fixa-field-input:focus,
      .fixa-field-select:focus,
      .fixa-field-textarea:focus { border-color: rgba(255,215,0,0.5); }
      .fixa-field-select option { background: #051e30; }
      .fixa-field-textarea { resize: vertical; min-height: 90px; }
      .fixa-dispute-footer {
        padding: 14px 22px 20px;
        display: flex;
        gap: 10px;
      }
      .fixa-btn-full {
        flex: 1; padding: 12px;
        border-radius: 11px;
        font-weight: 700;
        font-size: 13.5px;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }
      .fixa-btn-gold   { background: #ffd700; color: #000; }
      .fixa-btn-ghost  { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.1); }
      .fixa-btn-danger { background: #ef4444; color: #fff; }
      .fixa-btn-full:hover { filter: brightness(1.1); }
      .fixa-btn-full:disabled { opacity: 0.5; cursor: not-allowed; }

      /* ── RATING MODAL ── */
      #fixaRatingModal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        z-index: 9500;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        backdrop-filter: blur(3px);
      }
      #fixaRatingModal.open { display: flex; }
      .fixa-rating-box {
        background: linear-gradient(160deg,#041b2b,#062035);
        border: 1px solid rgba(255,215,0,0.18);
        border-radius: 24px;
        width: 100%;
        max-width: 380px;
        padding: 28px 24px;
        text-align: center;
        animation: fixaPopIn 0.28s cubic-bezier(0.34,1.56,0.64,1);
      }
      .fixa-rating-avatar {
        width: 64px; height: 64px;
        border-radius: 18px;
        background: linear-gradient(135deg,#ffd700,#e6c200);
        color: #000;
        font-weight: 800;
        font-size: 26px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 12px;
      }
      .fixa-rating-name { font-size: 17px; font-weight: 800; color: #fff; margin-bottom: 4px; }
      .fixa-rating-sub  { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 22px; }
      .fixa-stars {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-bottom: 18px;
      }
      .fixa-star {
        font-size: 36px;
        cursor: pointer;
        color: rgba(255,255,255,0.15);
        transition: color 0.15s, transform 0.15s;
        user-select: none;
      }
      .fixa-star.active   { color: #ffd700; }
      .fixa-star:hover    { transform: scale(1.2); }
      .fixa-star-label {
        font-size: 13px;
        color: rgba(255,255,255,0.5);
        margin-bottom: 16px;
        min-height: 20px;
        font-weight: 500;
      }
      .fixa-rating-skip {
        display: block;
        margin-top: 14px;
        background: none;
        border: none;
        color: rgba(255,255,255,0.3);
        font-size: 12px;
        cursor: pointer;
        text-decoration: underline;
      }

      /* ── SUSPENDED SCREEN ── */
      #fixaSuspendedScreen {
        position: fixed;
        inset: 0;
        background: #00172b;
        z-index: 99999;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 32px;
        font-family: 'Plus Jakarta Sans', sans-serif;
      }
      #fixaSuspendedScreen.open { display: flex; }
      .fixa-suspended-icon { font-size: 72px; margin-bottom: 20px; opacity: 0.9; }
      .fixa-suspended-title { font-size: 26px; font-weight: 900; color: #ef4444; margin-bottom: 12px; }
      .fixa-suspended-body  {
        font-size: 14.5px; color: rgba(255,255,255,0.5);
        max-width: 320px; line-height: 1.7; margin-bottom: 28px;
      }
      .fixa-suspended-contact {
        font-size: 12px; color: rgba(255,255,255,0.25);
      }
      .fixa-suspended-contact a { color: #ffd700; text-decoration: none; }

      /* ── SCROLLBAR ── */
      .fixa-notif-list::-webkit-scrollbar { width: 3px; }
      .fixa-notif-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
    `;
    document.head.appendChild(style);
  }
  function _renderEvidencePreview() {
  const fileInput = document.getElementById('fixaDisputeFiles');
  const previewEl = document.getElementById('fixaEvidencePreview');
  const errorEl = document.getElementById('fixaEvidenceError');
  if (!fileInput || !previewEl) return;

  const files = Array.from(fileInput.files || []);
  errorEl.style.display = 'none';

  // Validate
  if (files.length > 5) {
    errorEl.textContent = 'Maximum 5 files allowed. Extras have been removed.';
    errorEl.style.display = 'block';
  }
  const valid = files.slice(0, 5).filter(f => {
    if (f.size > 10 * 1024 * 1024) {
      errorEl.textContent = `"${f.name}" is over 10MB and was skipped.`;
      errorEl.style.display = 'block';
      return false;
    }
    return true;
  });

  // Update the input's FileList to match what we kept
  const dt = new DataTransfer();
  valid.forEach(f => dt.items.add(f));
  fileInput.files = dt.files;

  // Render
  if (!valid.length) {
    previewEl.style.display = 'none';
    previewEl.innerHTML = '';
    return;
  }

  previewEl.style.display = 'grid';
  previewEl.innerHTML = '';
  valid.forEach((file, idx) => {
    const tile = document.createElement('div');
    tile.style.cssText = 'position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08)';

    const isImg = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (isImg) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      img.onload = () => URL.revokeObjectURL(img.src);
      tile.appendChild(img);
    } else if (isVideo) {
      const vid = document.createElement('video');
      vid.src = URL.createObjectURL(file);
      vid.muted = true;
      vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      tile.appendChild(vid);

      const playIcon = document.createElement('div');
      playIcon.textContent = '▶';
      playIcon.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:white;font-size:22px;text-shadow:0 2px 6px rgba(0,0,0,0.6);pointer-events:none';
      tile.appendChild(playIcon);
    } else {
      tile.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px">📄</div>';
    }

    // Filename label
    const label = document.createElement('div');
    label.textContent = file.name.length > 16 ? file.name.slice(0, 13) + '…' : file.name;
    label.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:4px 6px;background:linear-gradient(to top,rgba(0,0,0,0.85),transparent);color:white;font-size:9px;font-weight:600;text-align:center';
    tile.appendChild(label);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '×';
    removeBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(0,0,0,0.7);color:white;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding:0';
    removeBtn.onclick = () => {
      const newDt = new DataTransfer();
      Array.from(fileInput.files).forEach((f, i) => {
        if (i !== idx) newDt.items.add(f);
      });
      fileInput.files = newDt.files;
      _renderEvidencePreview();
    };
    tile.appendChild(removeBtn);

    previewEl.appendChild(tile);
  });
}
  function togglePanel() {
    document.getElementById('fixaNotifPanel').classList.toggle('open');
    // Mark all as read on open
    _notifications.forEach(n => n.unread = false);
    _unreadCount = 0;
    updateBadge();
    renderList();
  }function showToast(title, body, type = 'system') {
  const zone = document.getElementById('fixaToastZone');
  if (!zone) return;

  const icon = NOTIF_ICONS[type] || 'ℹ️';

  const el = document.createElement('div');
  el.className = 'fixa-toast';

  el.innerHTML = `
    <div class="fixa-toast-icon">${icon}</div>
    <div class="fixa-toast-content">
      <div class="fixa-toast-title">${esc(title)}</div>
      ${body ? `<div class="fixa-toast-body">${esc(body)}</div>` : ''}
    </div>
  `;

  zone.appendChild(el);

  // PLAY SOUND
  const soundMap = {
    message: 'new-message',
    job: 'new-job',
    payment: 'payment',
    dispute: 'alert',
    suspended: 'alert',
    warning: 'alert',
    success: 'success',
    system: 'notification'
  };

  playSound(soundMap[type] || 'notification');

  // Browser notification
  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    new Notification(title, {
      body: body || '',
      icon: '/images/logo.png' // optional
    });
  }

  // Auto remove
  setTimeout(() => {
    el.classList.add('leaving');

    setTimeout(() => {
      el.remove();
    }, 300);

  }, 4000);
}


// SOUND PLAYER
function playSound(name) {
  try {
    const audio = new Audio(`/sounds/${name}.mp3`);

    // restart if already playing
    audio.currentTime = 0;

    audio.play().catch(err => {
      console.log('Sound blocked:', err);
    });

  } catch (err) {
    console.log('Sound error:', err);
  }
}
  // ─────────────────────────────────────────────
  // BUILD DOM
  // ─────────────────────────────────────────────
  function buildDOM() {
   
    // Notification Bell + Panel
    if (!document.getElementById('fixaNotifContainer')) {
      const container = document.createElement('div');
      container.id = 'fixaNotifContainer';
      container.innerHTML = `
        <div id="fixaNotifBell" title="Notifications">
          🔔
          <span id="fixaNotifBadge"></span>
        </div>
        <div id="fixaNotifPanel">
          <div class="fixa-notif-header">
            <h4>🔔 Notifications</h4>
            <button class="fixa-notif-clear" onclick="FixaSystem.clearAll()">Clear all</button>
          </div>
          <div class="fixa-notif-list" id="fixaNotifList">
            <div class="fixa-notif-empty">No notifications yet</div>
          </div>
        </div>
      `;
      document.body.appendChild(container);
      document.getElementById('fixaNotifBell').addEventListener('click', e => {
        e.stopPropagation();
        togglePanel();
      });
      document.addEventListener('click', e => {
        const panel = document.getElementById('fixaNotifPanel');
        const bell  = document.getElementById('fixaNotifBell');
        if (panel && !panel.contains(e.target) && e.target !== bell) {
          panel.classList.remove('open');
        }
      });

    }

    // ─────────────────────────────────────────────
// EVIDENCE PREVIEW
// ─────────────────────────────────────────────

    // Toast zone
    if (!document.getElementById('fixaToastZone')) {
      const tz = document.createElement('div');
      tz.id = 'fixaToastZone';
      document.body.appendChild(tz);
    }

    // Admin Alert Overlay
    if (!document.getElementById('fixaAdminAlert')) {
      const aa = document.createElement('div');
      aa.id = 'fixaAdminAlert';
      aa.innerHTML = `
        <div class="fixa-admin-alert-box" id="fixaAdminAlertBox">
          <span class="fixa-aa-icon" id="fixaAaIcon">ℹ️</span>
          <div class="fixa-aa-title" id="fixaAaTitle">Notice</div>
          <div class="fixa-aa-body"  id="fixaAaBody"></div>
          <div id="fixaAaBtns"></div>
        </div>
      `;
      document.body.appendChild(aa);
    }

    // Dispute Modal
    if (!document.getElementById('fixaDisputeModal')) {
      const dm = document.createElement('div');
      dm.id = 'fixaDisputeModal';
     dm.innerHTML = `
  <div class="fixa-dispute-box">
    <div class="fixa-dispute-header">
      <h3>⚠️ Report a Dispute</h3>
      <button class="fixa-dispute-close" onclick="FixaSystem.closeDispute()">×</button>
    </div>
    <div class="fixa-dispute-body">
      <label class="fixa-field-label">Booking ID</label>
      <input class="fixa-field-input" id="fixaDisputeBookingId" placeholder="Booking ID…" readonly/>

      <label class="fixa-field-label">Reason</label>
      <select class="fixa-field-select" id="fixaDisputeReason">
        <option value="">Select a reason</option>
        <option value="no_show">Artisan no-show</option>
        <option value="poor_quality">Poor quality of work</option>
        <option value="overcharged">Overcharged / price dispute</option>
        <option value="unsafe">Unsafe behaviour</option>
        <option value="fraud">Fraud / scam attempt</option>
        <option value="incomplete">Job incomplete</option>
        <option value="damage">Damage to property</option>
        <option value="other">Other</option>
      </select>

      <label class="fixa-field-label">Describe what happened</label>
      <textarea class="fixa-field-textarea" id="fixaDisputeDesc"
        placeholder="Give as much detail as possible — when it happened, what went wrong, what you've tried…"></textarea>

      <label class="fixa-field-label">Priority</label>
      <select class="fixa-field-select" id="fixaDisputePriority">
        <option value="low">Low</option>
        <option value="medium" selected>Medium</option>
        <option value="high">High — I need urgent help</option>
      </select>

      <!-- ── EVIDENCE UPLOAD ── -->
      <label class="fixa-field-label" style="margin-top:6px">Evidence (optional)</label>
      <div id="fixaEvidenceDrop" style="border:2px dashed rgba(255,255,255,0.15);border-radius:12px;padding:18px 14px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(255,255,255,0.02);margin-bottom:8px">
        <div style="font-size:24px;margin-bottom:6px">📎</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,0.7);font-weight:600">Click to add photos or videos</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:3px">Up to 5 files · max 10MB each</div>
      </div>
      <input type="file" id="fixaDisputeFiles" multiple accept="image/*,video/*" style="display:none"/>

      <!-- Live preview grid -->
      <div id="fixaEvidencePreview" style="display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px"></div>

      <div id="fixaEvidenceError" style="display:none;color:#ef4444;font-size:11px;margin-bottom:10px"></div>
    </div>
    <div class="fixa-dispute-footer">
      <button class="fixa-btn-full fixa-btn-ghost" onclick="FixaSystem.closeDispute()">Cancel</button>
      <button class="fixa-btn-full fixa-btn-danger" id="fixaDisputeSubmit"
        onclick="FixaSystem._submitDispute()">Submit Report</button>
    </div>
  </div>
`;
document.body.appendChild(dm);

// ── Wire up evidence upload + preview ──
const dropEl = document.getElementById('fixaEvidenceDrop');
const fileInput = document.getElementById('fixaDisputeFiles');

dropEl.addEventListener('click', () => fileInput.click());

dropEl.addEventListener('dragover', e => {
  e.preventDefault();
  dropEl.style.borderColor = '#ffd700';
  dropEl.style.background = 'rgba(255,215,0,0.06)';
});
dropEl.addEventListener('dragleave', () => {
  dropEl.style.borderColor = 'rgba(255,255,255,0.15)';
  dropEl.style.background = 'rgba(255,255,255,0.02)';
});
dropEl.addEventListener('drop', e => {
  e.preventDefault();
  dropEl.style.borderColor = 'rgba(255,255,255,0.15)';
  dropEl.style.background = 'rgba(255,255,255,0.02)';
  if (e.dataTransfer?.files?.length) {
    fileInput.files = e.dataTransfer.files;
    _renderEvidencePreview();
  }
});

fileInput.addEventListener('change', _renderEvidencePreview);
    }

    // Rating Modal
    if (!document.getElementById('fixaRatingModal')) {
      const rm = document.createElement('div');
      rm.id = 'fixaRatingModal';
      rm.innerHTML = `
        <div class="fixa-rating-box">
          <div class="fixa-rating-avatar" id="fixaRatingAvatar">?</div>
          <div class="fixa-rating-name" id="fixaRatingName">Artisan Name</div>
          <div class="fixa-rating-sub"  id="fixaRatingSub">How was your experience?</div>
          <div class="fixa-stars" id="fixaStars">
            ${[1,2,3,4,5].map(n=>`<span class="fixa-star" data-val="${n}" onclick="FixaSystem._selectStar(${n})">★</span>`).join('')}
          </div>
          <div class="fixa-star-label" id="fixaStarLabel">Tap a star to rate</div>
          <textarea class="fixa-field-textarea" id="fixaRatingComment" placeholder="Leave a comment (optional)…" style="text-align:left"></textarea>
          <input type="hidden" id="fixaRatingBookingId"/>
          <input type="hidden" id="fixaRatingArtisanId"/>
          <input type="hidden" id="fixaRatingVal" value="0"/>
          <button class="fixa-btn-full fixa-btn-gold" onclick="FixaSystem._submitRating()">Submit Review</button>
          <button class="fixa-rating-skip" onclick="FixaSystem.closeRating()">Skip for now</button>
        </div>
      `;
      document.body.appendChild(rm);
    }

    // Suspended Screen
    if (!document.getElementById('fixaSuspendedScreen')) {
      const ss = document.createElement('div');
      ss.id = 'fixaSuspendedScreen';
      ss.innerHTML = `
        <div class="fixa-suspended-icon">🚫</div>
        <div class="fixa-suspended-title">Account Suspended</div>
        <div class="fixa-suspended-body" id="fixaSuspendedBody">
          Your Fixa account has been suspended by an administrator. You cannot access this platform at this time.
        </div>
        <div class="fixa-suspended-contact">
          Questions? Contact <a href="mailto:support@fixa.ng">support@fixa.ng</a>
        </div>
      `;
      document.body.appendChild(ss);
    }
  }

  // ─────────────────────────────────────────────
  // NOTIFICATION PANEL
  // ─────────────────────────────────────────────


  function updateBadge() {
    const badge = document.getElementById('fixaNotifBadge');
    if (!badge) return;
    if (_unreadCount > 0) {
      badge.style.display = 'flex';
      badge.textContent = _unreadCount > 99 ? '99+' : _unreadCount;
    } else {
      badge.style.display = 'none';
    }
    // Sync with any existing nav bell count
    const existing = document.getElementById('notifCount');
    if (existing) { existing.textContent = _unreadCount; existing.style.display = _unreadCount ? 'flex' : 'none'; }
  }

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
    // Browser notification
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(`Fixa — ${title}`, { body, icon: '/icon.png' }); } catch {}
    }
    return n;
  }

  function renderList() {
    const list = document.getElementById('fixaNotifList');
    if (!list) return;
    if (!_notifications.length) {
      list.innerHTML = '<div class="fixa-notif-empty">🔔 All caught up!</div>';
      return;
    }
    list.innerHTML = _notifications.map(n => `
      <div class="fixa-notif-item ${n.unread ? 'unread' : ''}" onclick="FixaSystem._notifClick('${n.id}')">
        <div class="fixa-ni-icon">${NOTIF_ICONS[n.type] || 'ℹ️'}</div>
        <div class="fixa-ni-content">
          <div class="fixa-ni-title">${esc(n.title)}</div>
          <div class="fixa-ni-body">${esc(n.body)}</div>
          <div class="fixa-ni-time">${fmtTime(n.time)}</div>
        </div>
      </div>
    `).join('');
  }

  // ─────────────────────────────────────────────
  // TOAST
  // ─────────────────────────────────────────────

  // ─────────────────────────────────────────────
  // ADMIN ALERT OVERLAY (for bans, verif, etc.)
  // ─────────────────────────────────────────────
  function showAdminAlert({ icon, title, body, primaryBtn, primaryAction, secondaryBtn, secondaryAction }) {
    document.getElementById('fixaAaIcon').textContent = icon || 'ℹ️';
    document.getElementById('fixaAaTitle').textContent = title || 'Notice';
    document.getElementById('fixaAaBody').textContent = body || '';
    const btns = document.getElementById('fixaAaBtns');
    btns.innerHTML = '';
    if (primaryBtn) {
      const b = document.createElement('button');
      b.className = `fixa-aa-btn ${primaryAction === 'logout' ? 'fixa-aa-btn-danger' : 'fixa-aa-btn-gold'}`;
      b.textContent = primaryBtn;
      b.onclick = () => {
        document.getElementById('fixaAdminAlert').classList.remove('open');
        if (primaryAction === 'logout') {
          localStorage.clear(); window.location.href = 'SignIn.html';
        } else if (typeof primaryAction === 'function') primaryAction();
      };
      btns.appendChild(b);
    }
    if (secondaryBtn) {
      const b = document.createElement('button');
      b.className = 'fixa-aa-btn fixa-aa-btn-ghost';
      b.textContent = secondaryBtn;
      b.onclick = () => {
        document.getElementById('fixaAdminAlert').classList.remove('open');
        if (typeof secondaryAction === 'function') secondaryAction();
      };
      btns.appendChild(b);
    }
    document.getElementById('fixaAdminAlert').classList.add('open');
  }

  // ─────────────────────────────────────────────
  // SOCKET EVENT HANDLERS (Admin → User actions)
  // ─────────────────────────────────────────────
  function bindSocketEvents(socket) {
    if (!socket) return;

    // ── Generic notification from admin ──
    socket.on('notification', (data) => {
      const { title, body, type, chatId } = data || {};
      addNotification(title || 'Fixa Notice', body || '', type || 'system', chatId);
    });

    // ── Account suspended ──
    socket.on('accountSuspended', (data) => {
      const reason = (data && data.reason) || 'Your account has been suspended by an administrator.';
      addNotification('Account Suspended 🚫', reason, 'suspended');
      // Show full-screen suspension
      const ss = document.getElementById('fixaSuspendedScreen');
      if (ss) {
        const bod = document.getElementById('fixaSuspendedBody');
        if (bod) bod.textContent = reason;
        ss.classList.add('open');
      }
      // Show overlay alert too
      showAdminAlert({
        icon: '🚫',
        title: 'Account Suspended',
        body: reason,
        primaryBtn: 'Understood — Sign Out',
        primaryAction: 'logout'
      });
    });

    // ── Account activated ──
    socket.on('accountActivated', (data) => {
      const msg = (data && data.message) || 'Your Fixa account has been reactivated. Welcome back!';
      addNotification('Account Reactivated ✅', msg, 'activated');
      const ss = document.getElementById('fixaSuspendedScreen');
      if (ss) ss.classList.remove('open');
      showAdminAlert({
        icon: '✅',
        title: 'Account Reactivated!',
        body: msg,
        primaryBtn: 'Continue',
        primaryAction: () => {}
      });
    });

    // ── Verification approved ──
    socket.on('verificationApproved', (data) => {
      const msg = (data && data.message) || 'Congratulations! Your Fixa account is now verified. You will receive more job requests.';
      addNotification('Verification Approved ✅', msg, 'verification');
      showAdminAlert({
        icon: '🎉',
        title: 'You\'re Verified!',
        body: msg,
        primaryBtn: 'Great, thanks!',
        primaryAction: () => {}
      });
      // Update badge if present
      const badge = document.getElementById('verificationBadge');
      const text  = document.getElementById('badgeText');
      const icon  = document.getElementById('badgeIcon');
      if (badge && text && icon) {
        badge.className = 'verification-badge verified';
        text.textContent = 'Verified';
        icon.textContent = '✓';
      }
    });

    // ── Verification rejected ──
    socket.on('verificationRejected', (data) => {
      const reason = (data && data.reason) || 'Your verification was not approved. Please re-submit with clearer documents.';
      addNotification('Verification Update ⚠️', reason, 'warning');
      showAdminAlert({
        icon: '⚠️',
        title: 'Verification Not Approved',
        body: reason,
        primaryBtn: 'Re-submit Documents',
        primaryAction: () => { window.location.href = 'verification.html'; },
        secondaryBtn: 'OK',
        secondaryAction: () => {}
      });
    });

    // ── Admin direct message / announcement ──
    socket.on('adminAnnouncement', (data) => {
      const { title, message, type } = data || {};
      addNotification(title || '📢 Announcement', message || '', type || 'system');
    });

    // ── Job accepted → open timed chat (customer) ──
    socket.on('jobAccepted', (data) => {
      const { chatId, artisanName, timerDuration } = data || {};
      const name = artisanName || 'Your artisan';
      const mins = Math.floor((timerDuration || 1800) / 60);
      addNotification('Job Accepted! 🎉', `${name} accepted your job. Chat is open for ${mins} minutes.`, 'job', chatId);
    });

    // ── Booking status changes ──
    socket.on('bookingStatusUpdated', (data) => {
      const { status, artisanName, bookingId } = data || {};
      const msgs = {
        accepted:   `Your booking was accepted by ${artisanName || 'your artisan'}.`,
        rejected:   'Your booking was declined.',
        completed:  'Your job has been marked complete. Please confirm and rate your artisan.',
        verifying:  'Job completion is being verified.',
        cancelled:  'Booking was cancelled.'
      };
      const msg = msgs[status] || `Booking status updated: ${status}`;
      addNotification('Booking Update', msg, status === 'completed' ? 'success' : 'job');
      // Prompt rating on completion (customer side)
      if (status === 'completed' && _role === 'customer' && data.artisanId) {
        setTimeout(() => {
          FixaSystem.openRating({
            bookingId: bookingId || data.bookingId,
            artisanId: data.artisanId,
            artisanName: artisanName || 'Artisan'
          });
        }, 1500);
      }
    });

    // ── Dispute received acknowledgement ──
    socket.on('disputeAcknowledged', (data) => {
      addNotification('Dispute Received 🚨', 'Your dispute report has been received. Our team will review it within 24 hours.', 'dispute');
    });

    // ── Chat sealed ──
    socket.on('chatSealed', (data) => {
      const { reason } = data || {};
      addNotification('Chat Session Ended 🔒', reason || 'Your timed chat session has ended.', 'chat');
    });

    // ── New message (background tab notification) ──
    socket.on('newMessage', (payload) => {
      const { chatId, message } = payload || {};
      // Only notify if chat is NOT currently active
      const activeChatId = window.activeChatId || null;
      if (chatId && message && String(activeChatId) !== String(chatId)) {
        const senderName = message.senderName || (_role === 'customer' ? 'Artisan' : 'Customer');
        addNotification(`New message from ${senderName}`, message.text || 'Sent a media file', 'message', chatId);
      }
    });

    // ── New job request (artisan) ──
    socket.on('newJobRequest', (job) => {
      if (_role === 'artisan') {
        const customer = job?.customer?.name || job?.customer?.username || 'A customer';
        addNotification('New Job Request 🔨', `${customer} needs your service. Check it out!`, 'job');
      }
    });
  }

  // ─────────────────────────────────────────────
  // DISPUTE SYSTEM
  // ─────────────────────────────────────────────
  // Show dispute button only when there's a booking

function openDispute(bookingId) {
  _disputeBookingId = bookingId || '';

  document.getElementById('fixaDisputeBookingId').value = bookingId || '';
  document.getElementById('fixaDisputeReason').value = '';
  document.getElementById('fixaDisputeDesc').value = '';
  document.getElementById('fixaDisputePriority').value = 'medium';

  // Reset evidence
  const fileInput = document.getElementById('fixaDisputeFiles');
  if (fileInput) fileInput.value = '';
  const preview = document.getElementById('fixaEvidencePreview');
  if (preview) {
    preview.innerHTML = '';
    preview.style.display = 'none';
  }
  const err = document.getElementById('fixaEvidenceError');
  if (err) err.style.display = 'none';

  document.getElementById('fixaDisputeModal').classList.add('open');
}
async function _submitDispute() {
  const reason = document.getElementById('fixaDisputeReason').value;
  const desc = document.getElementById('fixaDisputeDesc').value.trim();
  const priority = document.getElementById('fixaDisputePriority').value;
  const bookingId = document.getElementById('fixaDisputeBookingId').value.trim();
  const fileInput = document.getElementById('fixaDisputeFiles');

  if (!reason) { showToast('Missing field', 'Please select a reason.', 'warning'); return; }
  if (!desc) { showToast('Missing field', 'Please describe what happened.', 'warning'); return; }
  if (desc.length < 20) { showToast('Tell us more', 'Please add at least 20 characters of detail.', 'warning'); return; }

  const btn = document.getElementById('fixaDisputeSubmit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const fd = new FormData();
    fd.append('bookingId', bookingId);
    fd.append('reason', reason);
    fd.append('description', desc);
    fd.append('priority', priority);

    if (fileInput?.files?.length) {
      for (const f of fileInput.files) fd.append('evidence', f);
    }

    const res = await fetch(`${_base}/api/disputes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${_token}` }, // do NOT set Content-Type — browser sets multipart boundary
      body: fd
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || `HTTP ${res.status}`);
    }

    document.getElementById('fixaDisputeModal').classList.remove('open');
    addNotification(
      'Dispute Submitted 🚨',
      'Your report has been sent to Fixa support. Funds are held until resolution.',
      'dispute'
    );

    if (_socket) _socket.emit('disputeSubmitted', { bookingId, reason });
  } catch (e) {
    showToast('Failed', e.message || 'Could not submit dispute. Try again.', 'warning');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Report';
  }
}
  function closeDispute() {
    document.getElementById('fixaDisputeModal').classList.remove('open');
  }

  // ─────────────────────────────────────────────
  // RATING SYSTEM
  // ─────────────────────────────────────────────
  let _currentStar = 0;
  const STAR_LABELS = ['', 'Poor 😞', 'Fair 😐', 'Good 🙂', 'Great 😊', 'Excellent 🌟'];

  function openRating({ bookingId, artisanId, artisanName }) {
    _currentStar = 0;
    document.getElementById('fixaRatingBookingId').value = bookingId || '';
    document.getElementById('fixaRatingArtisanId').value = artisanId || '';
    document.getElementById('fixaRatingVal').value = '0';
    document.getElementById('fixaRatingName').textContent = artisanName || 'Artisan';
    document.getElementById('fixaRatingAvatar').textContent = (artisanName || 'A')[0].toUpperCase();
    document.getElementById('fixaRatingSub').textContent = 'How was your experience?';
    document.getElementById('fixaStarLabel').textContent = 'Tap a star to rate';
    document.getElementById('fixaRatingComment').value = '';
    _renderStars(0);
    document.getElementById('fixaRatingModal').classList.add('open');
  }

  function _selectStar(val) {
    _currentStar = val;
    document.getElementById('fixaRatingVal').value = val;
    document.getElementById('fixaStarLabel').textContent = STAR_LABELS[val] || '';
    _renderStars(val);
  }

  function _renderStars(active) {
    document.querySelectorAll('.fixa-star').forEach((s, i) => {
      s.classList.toggle('active', i < active);
    });
  }

  async function _submitRating() {
    const rating    = parseInt(document.getElementById('fixaRatingVal').value);
    const comment   = document.getElementById('fixaRatingComment').value.trim();
    const bookingId = document.getElementById('fixaRatingBookingId').value;
    const artisanId = document.getElementById('fixaRatingArtisanId').value;

    if (!rating) { showToast('Rating required', 'Please tap a star to rate.', 'warning'); return; }

    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ artisanId, bookingId, rating, comment })
      });
      document.getElementById('fixaRatingModal').classList.remove('open');
      addNotification('Review Submitted ⭐', 'Thank you for your feedback!', 'rating');
    } catch (e) {
      showToast('Failed', e.message || 'Could not submit review.', 'warning');
    }
  }

  function closeRating() {
    document.getElementById('fixaRatingModal').classList.remove('open');
  }

  // ─────────────────────────────────────────────
  // FETCH + PERSIST NOTIFICATIONS FROM SERVER
  // ─────────────────────────────────────────────
  async function loadNotificationsFromServer() {
    try {
      const data = await apiFetch('/api/notifications');
      const list = Array.isArray(data) ? data : (data.notifications || []);
      // Prepend server notifications (don't duplicate)
      list.forEach(n => {
        if (!_notifications.find(x => x.serverId === n._id)) {
          _notifications.push({
            id: n._id || Date.now(),
            serverId: n._id,
            title: n.title,
            body: n.message || n.body || '',
            type: n.type || 'system',
            chatId: n.chatId || null,
            time: new Date(n.createdAt || Date.now()),
            unread: !n.read
          });
        }
      });
      _notifications.sort((a, b) => b.time - a.time);
      _unreadCount = _notifications.filter(n => n.unread).length;
      updateBadge();
      renderList();
    } catch (e) {
      // silently fail — notifications are non-critical
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  function _notifClick(id) {
    const n = _notifications.find(x => String(x.id) === String(id));
    if (!n) return;
    n.unread = false;
    togglePanel(); // close panel
    if (n.chatId) {
      // Navigate to that chat
      if (typeof window.openChat === 'function') window.openChat(n.chatId, '');
      if (typeof window.switchPage === 'function') window.switchPage('messages');
    }
  }

  const FixaSystem = {
    init(socket, user, token, baseUrl, role) {
      _socket = socket;
      _user   = user;
      _token  = token;
      _base   = baseUrl || '';
      _role   = role || 'customer';
      injectStyles();
      buildDOM();
      bindSocketEvents(socket);
      loadNotificationsFromServer();
      // Request browser notification permission
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      return this;
    },

    // Notification
    addNotification,
    showToast,
    clearAll() {
      _notifications = [];
      _unreadCount = 0;
      updateBadge();
      renderList();
    },

    // Dispute
    openDispute,
    closeDispute,
    _submitDispute,

    // Rating
    openRating,
    closeRating,
    _selectStar,
    _submitRating,

    // Admin alerts
    showAdminAlert,

    // Internal
    _notifClick,
  };

  global.FixaSystem = FixaSystem;

})(window);