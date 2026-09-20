(function (global) {
  'use strict';

  const FixaPush = {
    isSupported() {
      return 'serviceWorker' in navigator &&
             'PushManager' in window &&
             'Notification' in window;
    },

    async getRegistration() {
      try {
        return await navigator.serviceWorker.ready;
      } catch (e) {
        console.warn('[Push] SW not ready', e);
        return null;
      }
    },

    urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

      const raw = atob(base64);
      const arr = new Uint8Array(raw.length);

      for (let i = 0; i < raw.length; i++) {
        arr[i] = raw.charCodeAt(i);
      }

      return arr;
    },

    async getVapidKey(baseUrl, token) {
      const res = await fetch(`${baseUrl}/api/push/vapid-public-key`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to get VAPID key');

      const data = await res.json();
      return data.publicKey;
    },

    async subscribe(baseUrl, user, token) {
      if (!this.isSupported()) return null;

      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') return null;

      const reg = await this.getRegistration();
      if (!reg) return null;

      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const vapidKey = await this.getVapidKey(baseUrl, token);

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(vapidKey)
        });
      }

      await fetch(`${baseUrl}/api/push/subscribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          userId: user._id || user.id
        })
      });

      console.log('[Push] Subscribed');
      return sub;
    },

    async unsubscribe(baseUrl, token) {
      const reg = await this.getRegistration();
      if (!reg) return false;

      const sub = await reg.pushManager.getSubscription();
      if (!sub) return false;

      await fetch(`${baseUrl}/api/push/unsubscribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ endpoint: sub.endpoint })
      });

      await sub.unsubscribe();
      return true;
    },

    listenForClicks() {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'OPEN_CHAT' && e.data.chatId) {
          if (typeof window.switchPage === 'function') {
            window.switchPage('messages');
          }

          if (typeof window.openChat === 'function') {
            setTimeout(() => {
              window.openChat(e.data.chatId, '');
            }, 400);
          }
        }
      });
    }
  };

  global.FixaPush = FixaPush;

  // Auto-init
  function autoInit() {
    if (!window.FixaSystem) return;

    const originalInit = window.FixaSystem.init;

    window.FixaSystem.init = function (socket, user, token, baseUrl, role) {
      const result = originalInit.call(this, socket, user, token, baseUrl, role);

      if (FixaPush.isSupported()) {
        FixaPush.subscribe(baseUrl, user, token)
          .catch(err => console.warn('[Push] auto-subscribe failed', err));

        FixaPush.listenForClicks();
      }

      return result;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

})(window);