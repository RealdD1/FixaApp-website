(function (w) {
  const root = document.documentElement;
  const vv = w.visualViewport;
  const mq = w.matchMedia('(max-width:768px)');
  let msgs, footer, input, fab, unread = 0, active = false;

  const atBottom = () => msgs && msgs.scrollHeight - msgs.clientHeight - msgs.scrollTop < 80;
  const toBottom = (smooth) => msgs && msgs.scrollTo({ top: msgs.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

 let baseH = 0;

function fit() {
  if (!active) return;
  const wasBottom = atBottom();
  const h = vv ? vv.height : w.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  baseH = Math.max(baseH, h);
  const kb = baseH - h > 150;                     // keyboard is open

  root.style.setProperty('--app-h', h + 'px');
  root.style.setProperty('--app-top', top + 'px');
  document.body.classList.toggle('kb-open', kb);

  if (mq.matches) {                               // inline !important so no stylesheet can override it
    const page = document.querySelector('#jobsPage.active, #messagesPage.active');
    if (page) {
      const set = (p, v) => page.style.setProperty(p, v, 'important');
      set('position', 'fixed'); set('left', '0'); set('right', '0');
      set('top', top + 'px'); set('height', h + 'px'); set('max-height', h + 'px');
      page.querySelector('.messages-shell')?.style.setProperty('height', '100%', 'important');
    }
  }
  if (wasBottom || kb) toBottom(false);
}


  function updateFab() {
    if (!fab) return;
    if (atBottom()) unread = 0;
    fab.style.display = atBottom() ? 'none' : 'flex';
    fab.style.bottom = footer.offsetHeight + 12 + 'px';
    const b = fab.querySelector('b');
    b.textContent = unread > 99 ? '99+' : unread;
    b.style.display = unread ? 'inline-block' : 'none';
  }

  function grow() {
    if (!input || input.tagName !== 'TEXTAREA') return;
    const wasBottom = atBottom();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    if (wasBottom) toBottom(false);
  }

  function init(o) {
    msgs = document.getElementById(o.messages);
    footer = document.getElementById(o.footer);
    input = document.getElementById(o.input);
    if (!msgs || !footer) return;

    msgs.addEventListener('scroll', updateFab, { passive: true });
    if (input) {
      input.addEventListener('input', grow);
     input.addEventListener('focus', () => [100, 350, 700].forEach(t => setTimeout(() => { fit(); toBottom(false); }, t)));
    }

    const parent = footer.parentElement;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    fab = document.createElement('button');
    fab.type = 'button';
    fab.style.cssText = 'display:none;position:absolute;right:14px;z-index:5;width:42px;height:42px;border-radius:50%;' +
      'border:1px solid rgba(255,255,255,.15);background:#0f2a44;color:#ffd700;font-size:20px;align-items:center;' +
      'justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer';
    fab.innerHTML = '↓<b style="position:absolute;top:-6px;right:-4px;background:#ef4444;color:#fff;font-size:10px;' +
      'min-width:18px;height:18px;line-height:18px;border-radius:9px;text-align:center;display:none"></b>';
    fab.addEventListener('pointerdown', (e) => e.preventDefault());   // keep keyboard open
    fab.addEventListener('click', () => { unread = 0; toBottom(true); });
    parent.appendChild(fab);

    // Keep the Send button from stealing focus, so the keyboard stays up like WhatsApp
    const send = footer.querySelector('.send-btn, #sendBtn');
    send && send.addEventListener('pointerdown', (e) => e.preventDefault());

    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
w.addEventListener('orientationchange', () => { baseH = 0; setTimeout(fit, 300); });
w.addEventListener('resize', fit);
    // Rigid page: block rubber-banding everywhere except real scroll areas
    document.addEventListener('touchmove', (e) => {
      if (!active || !mq.matches) return;
      if (e.target.closest('#' + msgs.id + ',textarea,#executionPanel,#proofPhotoGallery,.chat-scrollable')) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
  }

function release() {                              // undo everything when the chat closes
  document.body.classList.remove('kb-open');
  document.querySelectorAll('#jobsPage, #messagesPage').forEach(page => {
    ['position', 'left', 'right', 'top', 'height', 'max-height'].forEach(p => page.style.removeProperty(p));
    page.querySelector('.messages-shell')?.style.removeProperty('height');
  });
}

function enter() {
  active = true; unread = 0;
  baseH = vv ? vv.height : w.innerHeight;
  root.classList.add('chat-open'); document.body.classList.add('chat-open');
  fit(); w.scrollTo(0, 0);
  setTimeout(() => { fit(); toBottom(false); updateFab(); }, 60);
}
function exit() {
  active = false;
  root.classList.remove('chat-open'); document.body.classList.remove('chat-open');
  release();
  if (fab) fab.style.display = 'none';
}
  function noteIncoming() { if (!atBottom()) { unread++; updateFab(); } }
  function resetInput() { if (input) { input.value = ''; input.style.height = ''; } }

  w.FixaChatUI = { init, enter, exit, noteIncoming, resetInput, toBottom };
})(window);