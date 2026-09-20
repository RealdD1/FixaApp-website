(function (global) {
  'use strict';

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const BASE_URL = 'http://localhost:5000';
  const MOD_API  = `${BASE_URL}/api/moderation`;
  const PAY_API  = `${BASE_URL}/api/payments`;
  const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';

  // ─── BLOCKED PATTERNS ─────────────────────────────────────────────────────
  const BLOCKED_PATTERNS = [
    /\bwhatsapp\b/i, /\bwhat'?s\s*app\b/i, /\bw\.?a\.?p?\b/i,
    /\bdm\s*(me|on|at)?\b/i, /\bdirect\s*message\b/i,
    /\bcall\s*me\b/i, /\bcontact\s*me\s*(off|outside|directly)\b/i,
    /\boff[\s-]?platform\b/i, /\boutside\s*(fixa|the\s*app)\b/i,
    /\btelegram\b/i, /\bsignal\b/i, /\bmy\s*number\s*is\b/i,
    /\breach\s*me\s*(on|at|via)\b/i,
    /\bbank\s*transfer\b/i, /\bpay\s*(me\s*)?(directly|outside|cash|in\s*hand)\b/i,
    /\baccount\s*(number|details)\b/i,
    /(\+?234|0)\s*[- .]?\s*[789]\s*[0-9]\s*[0-9]\s*[- .]?\s*[0-9]{3}\s*[- .]?\s*[0-9]{4}/,
    /\b\d[\s.\-]{0,2}\d[\s.\-]{0,2}\d[\s.\-]{0,2}\d[\s.\-]{0,2}\d{3,5}\b/,
    /\b(zero|one|two|three|four|five|six|seven|eight|nine)[\s,]+(zero|one|two|three|four|five|six|seven|eight|nine)[\s,]+(zero|one|two|three|four|five|six|seven|eight|nine)/i,
  ];

  const PENALTY_INFO = {
    1: { label: 'Warning' },
    2: { label: 'Final warning' },
    3: { label: '24-hour chat ban' },
    4: { label: 'Extended ban' },
    5: { label: 'Account suspended' },
  };

  // ─── STATE ────────────────────────────────────────────────────────────────
  let _chatId = null, _userId = null, _token = null;
  let _strikes = 0, _isBanned = false, _isSuspended = false;
  let _paymentMade = false, _tesseractLoaded = false, _initialized = false;

  global.ChatGuard = {
    init, onChatOpen, checkText, checkImage,
    isAllowed, isFeatureUnlocked, showBlockedToast,
    getStrikes: () => _strikes,
    isBanned: () => _isBanned,
  };

  async function init(userId, token) {
    if (_initialized) return;
    _initialized = true;
    _userId = userId;
    _token = token || localStorage.getItem('token');
    loadTesseract();
    await refreshStatus();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectPenaltyBar);
    } else {
      injectPenaltyBar();
    }
  }

  async function onChatOpen(chatId) {
    _chatId = chatId;
    await Promise.all([refreshStatus(), checkPayment(chatId)]);
    renderEscrowBanner();
    updateLockedFeatures();
    if (!_paymentMade) renderLockedNotice();
  }

  // ─── STATUS FETCH ─────────────────────────────────────────────────────────
  async function refreshStatus() {
    if (!_userId || !_token) return;
    try {
      const res = await fetch(`${BASE_URL}/api/users/me/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      _strikes     = data.strikes || 0;
      _isBanned    = !!(data.banned || data.chatBanned);
      _isSuspended = !!(data.suspended || data.isSuspended);
      updatePenaltyDots();

      if (_isBanned || _isSuspended) {
        _triggerBanOverlay({
          chatBanned: _isBanned,
          isSuspended: _isSuspended,
          banExpiresAt: data.banExpiresAt,
          reason: data.reason,
          banType: _isSuspended ? 'full' : 'chat'
        });
      }
    } catch (e) { /* silent */ }
  }

  function _triggerBanOverlay(data) {
    window.dispatchEvent(new CustomEvent('chatGuardBanned', { detail: data }));
    if (typeof window.showBanOverlay === 'function') {
      window.showBanOverlay(data);
    }
  }

  async function checkPayment(chatId) {
    if (!chatId || !_token) { _paymentMade = false; return; }
    try {
      const res = await fetch(`${PAY_API}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}` },
        body: JSON.stringify({ chatId }),
      });
      if (!res.ok) { _paymentMade = false; return; }
      const data = await res.json();
      _paymentMade = !!data.paid;
    } catch { _paymentMade = false; }
  }

  function isAllowed() { return !_isBanned && !_isSuspended; }
  function isFeatureUnlocked(feature) {
    const gated = ['location', 'phone', 'voice'];
    return gated.includes(feature) ? _paymentMade : true;
  }

  // ─── TEXT CHECK ───────────────────────────────────────────────────────────
  async function checkText(text) {
    if (!text || !text.trim()) return { blocked: false };
    if (!isAllowed()) return { blocked: true, reason: _isSuspended ? 'Account suspended' : 'Chat banned' };

    for (const pat of BLOCKED_PATTERNS) {
      if (pat.test(text)) {
        await recordViolation('regex', text);
        return { blocked: true, reason: 'Restricted content detected. Contact and payments must stay on Fixa.' };
      }
    }

    try {
      const res = await fetch(`${MOD_API}/ai-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}` },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.flagged) {
          await recordViolation('ai', text);
          return { blocked: true, reason: data.reason || 'Message flagged by automated review.' };
        }
      }
    } catch { /* fail open */ }

    return { blocked: false };
  }

  async function checkImage(file) {
    if (!file) return { blocked: false };
    if (!_tesseractLoaded || !window.Tesseract) {
      console.warn('[ChatGuard] OCR unavailable');
      return { blocked: false };
    }
    try {
      const url = URL.createObjectURL(file);
      const result = await window.Tesseract.recognize(url, 'eng', { logger: () => {} });
      URL.revokeObjectURL(url);
      const text = result?.data?.text || '';
      if (!text.trim()) return { blocked: false };
      return await checkText(text);
    } catch (e) {
      console.warn('[ChatGuard] OCR failed', e);
      return { blocked: false };
    }
  }

  // ─── VIOLATION RECORDING — FIXED ───────────────────────────────────────────
  async function recordViolation(type, context, chatId = _chatId) {
    if (!_token) {
      console.warn('[ChatGuard] No token — cannot report violation');
      return;
    }

    try {
      // ✅ Properly send POST with body
      const res = await fetch(`${BASE_URL}/api/users/me/report-violation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${_token}`,
        },
        body: JSON.stringify({
          type: type || 'regex',
          context: String(context || '').slice(0, 200),
          chatId: chatId || null,
        }),
      });

      if (!res.ok) {
        console.warn('[ChatGuard] Violation report failed:', res.status);
        // Even on failure, do optimistic increment so UX doesn't feel broken
        _strikes = Math.min((_strikes || 0) + 1, 5);
        showPenaltyBanner(_strikes, type);
        updatePenaltyDots();
        return;
      }

      const data = await res.json();
      console.log('[ChatGuard] Violation recorded:', data);

      // ✅ Trust backend as the source of truth
      _strikes = data.strikes ?? _strikes;
      _isBanned = !!data.chatBanned;
      _isSuspended = data.action === 'suspended';

      // Show the strike banner with the AUTHORITATIVE strike number from backend
      showPenaltyBanner(_strikes, type);
      updatePenaltyDots();

      // If banned or suspended, show the overlay
      if (data.chatBanned || data.action === 'suspended') {
        _triggerBanOverlay({
          chatBanned: !!data.chatBanned,
          isSuspended: data.action === 'suspended',
          banExpiresAt: data.banExpiresAt,
          reason: data.reason,
          banType: data.action === 'suspended' ? 'full' : 'chat'
        });
      }

      return data;
    } catch (e) {
      console.warn('[ChatGuard] Could not report violation:', e);
    }
  }

  // ─── UI HELPERS ───────────────────────────────────────────────────────────
  function getMessagesContainer() {
    return document.getElementById('messages') || document.getElementById('messagesContainer');
  }
  function getChatFooter() {
    return document.getElementById('chatFooter') || document.querySelector('.chat-footer');
  }
  function getChatConv() {
    return document.getElementById('chatConvView') || document.querySelector('.chat-conv-view');
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showPenaltyBanner(strike, violationReason) {
    const msgs = getMessagesContainer();
    if (!msgs) return;
    const info = PENALTY_INFO[Math.min(strike, 5)] || PENALTY_INFO[5];
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      background:rgba(255,59,92,0.08);border:1px solid rgba(255,59,92,0.3);border-radius:10px;
      padding:10px 14px;margin:8px 0;display:flex;align-items:flex-start;gap:8px;
      animation:cgFadeIn .3s;`;
    wrap.innerHTML = `
      <span style="font-size:16px;flex-shrink:0">⚠️</span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;color:#ff3b5c">
          Strike ${strike}/5 — ${escapeHtml(info.label)}
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;line-height:1.45">
          Your message was blocked.
          ${strike < 3 ? `${3 - strike} more strike(s) before a 24-hour chat ban.` : ''}
          ${strike === 3 ? 'Your chat is now banned for 24 hours.' : ''}
          ${strike >= 5 ? 'Your account has been suspended pending review.' : ''}
        </div>
      </div>`;
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function injectPenaltyBar() {
    if (document.getElementById('cg-penalty-bar')) return;
    const footer = getChatFooter();
    if (!footer) return;
    const bar = document.createElement('div');
    bar.id = 'cg-penalty-bar';
    bar.style.cssText = `
      display:flex;align-items:center;gap:6px;padding:5px 14px;font-size:11px;
      color:rgba(255,255,255,0.45);border-top:1px solid rgba(255,255,255,0.06);
      flex-shrink:0;background:rgba(0,0,0,0.15);`;
    bar.innerHTML = `
      <span style="opacity:.7">Violations:</span>
      ${[1,2,3,4,5].map(() => `<div class="cg-dot" style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.12);transition:background .25s"></div>`).join('')}
      <span class="cg-label" style="margin-left:4px">0/5</span>`;
    footer.parentNode.insertBefore(bar, footer);
    updatePenaltyDots();
  }

  function updatePenaltyDots() {
    const bar = document.getElementById('cg-penalty-bar');
    if (!bar) return;
    bar.querySelectorAll('.cg-dot').forEach((d, i) => {
      const filled = i < _strikes;
      const isHigh = i >= 2;
      d.style.background = filled ? (isHigh ? '#ff3b5c' : '#ffc107') : 'rgba(255,255,255,0.12)';
    });
    const label = bar.querySelector('.cg-label');
    if (label) {
      const next = _strikes < 3 ? 'chat ban at 3' : _strikes < 5 ? 'suspension at 5' : 'suspended';
      label.textContent = `${_strikes}/5 — ${next}`;
    }
  }

  function renderEscrowBanner() {
    const conv = getChatConv();
    if (!conv) return;
    if (document.getElementById('cg-escrow-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'cg-escrow-banner';
    banner.style.cssText = `
      background:rgba(255,215,0,0.08);border-bottom:1px solid rgba(255,215,0,0.2);
      padding:9px 14px;display:flex;align-items:flex-start;gap:8px;flex-shrink:0;`;
    banner.innerHTML = `
      <span style="font-size:15px;flex-shrink:0;margin-top:1px">🔒</span>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600;color:#ffd700">Fixa secure escrow active</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px;line-height:1.45">
          Payments outside Fixa are <strong>not protected</strong>.
          Pay through Fixa to get a full refund if the job isn't completed.
        </div>
      </div>
      <button type="button" id="cg-escrow-close" style="background:none;border:none;color:rgba(255,215,0,0.6);cursor:pointer;font-size:16px;padding:0 4px;line-height:1">×</button>`;
    const header = conv.querySelector('.conv-header');
    if (header && header.nextSibling) conv.insertBefore(banner, header.nextSibling);
    else conv.insertBefore(banner, conv.firstChild);
    document.getElementById('cg-escrow-close').addEventListener('click', () => banner.remove());
  }

  function renderLockedNotice() {
    const msgs = getMessagesContainer();
    if (!msgs || _paymentMade) return;
    if (document.getElementById('cg-lock-notice')) return;
    const overlay = document.createElement('div');
    overlay.id = 'cg-lock-notice';
    overlay.style.cssText = `
      align-self:center;background:rgba(255,255,255,0.05);
      border:1px solid rgba(255,255,255,0.08);border-radius:10px;
      padding:12px 16px;text-align:center;max-width:280px;margin:14px auto;`;
    overlay.innerHTML = `
      <div style="font-size:20px;margin-bottom:6px">🔐</div>
      <div style="font-size:13px;font-weight:600;color:#fff">Some features locked</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;line-height:1.4">
        Voice notes, location & phone sharing unlock once escrow payment is confirmed.
      </div>`;
    msgs.appendChild(overlay);
  }

  function updateLockedFeatures() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
      const unlocked = isFeatureUnlocked('voice');
      voiceBtn.disabled = !unlocked;
      voiceBtn.style.opacity = unlocked ? '1' : '0.35';
      voiceBtn.style.cursor = unlocked ? '' : 'not-allowed';
      voiceBtn.title = unlocked ? '' : 'Voice notes unlock after payment';
    }
    document.querySelectorAll('[data-feature]').forEach(btn => {
      const f = btn.dataset.feature;
      const unlocked = isFeatureUnlocked(f);
      btn.disabled = !unlocked;
      btn.style.opacity = unlocked ? '1' : '0.35';
      btn.style.cursor = unlocked ? '' : 'not-allowed';
      btn.title = unlocked ? '' : `${f} unlocks after payment`;
    });
    if (_paymentMade) document.getElementById('cg-lock-notice')?.remove();
  }

  function showBlockedToast(reason) {
    if (window.FixaSystem?.showToast) {
      window.FixaSystem.showToast('Message blocked', reason || 'Restricted content', 'warning');
      return;
    }
    const t = document.createElement('div');
    t.style.cssText = `
      position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
      background:#791f1f;color:#fff;padding:10px 18px;border-radius:10px;
      font-size:13px;font-weight:600;z-index:9999;animation:cgFadeIn .3s;
      max-width:90%;text-align:center;`;
    t.textContent = `🚫 ${reason || 'Message blocked'}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function loadTesseract() {
    if (window.Tesseract) { _tesseractLoaded = true; return; }
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload = () => { _tesseractLoaded = true; console.log('[ChatGuard] Tesseract ready'); };
    s.onerror = () => console.warn('[ChatGuard] Tesseract failed to load');
    document.head.appendChild(s);
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes cgFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(style);

})(window);