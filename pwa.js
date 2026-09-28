// Fixa PWA Bootstrap
//
// - Registers the service worker
// - Checks for updates
// - Shows an Update button when a new worker is installed
// - Never reloads automatically
// - Shows Install App when supported

(function () {
  'use strict';

  // Prevent duplicate execution.
  if (window.__fixaPwaLoaded) {
    return;
  }

  window.__fixaPwaLoaded = true;


  // ─────────────────────────────────────────────
  // BODY READY
  // ─────────────────────────────────────────────

  function onBodyReady(callback) {
    if (document.body) {
      callback();
    } else {
      document.addEventListener(
        'DOMContentLoaded',
        callback,
        { once: true }
      );
    }
  }


  // ─────────────────────────────────────────────
  // UPDATE BANNER
  // ─────────────────────────────────────────────

  function showUpdateBanner() {
    onBodyReady(function () {

      if (document.getElementById('fixaUpdateBanner')) {
        return;
      }

      const bar = document.createElement('div');

      bar.id = 'fixaUpdateBanner';

      bar.setAttribute('role', 'status');

      bar.style.cssText =
        'position:fixed;' +
        'left:12px;' +
        'right:12px;' +
        'bottom:calc(96px + env(safe-area-inset-bottom,0px));' +
        'z-index:6000;' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:space-between;' +
        'gap:12px;' +
        'background:#0a1f33;' +
        'color:#fff;' +
        'border:1px solid rgba(255,215,0,.45);' +
        'border-radius:14px;' +
        'padding:12px 14px;' +
        'font:600 13px/1.3 system-ui,Arial,sans-serif;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.45);';


      const message = document.createElement('span');

      message.textContent =
        'A new version of Fixa is ready.';


      const button = document.createElement('button');

      button.type = 'button';

      button.textContent = 'Update';

      button.style.cssText =
        'background:#ffd700;' +
        'color:#001;' +
        'border:none;' +
        'border-radius:999px;' +
        'padding:8px 16px;' +
        'font-weight:800;' +
        'font-size:13px;' +
        'cursor:pointer;' +
        'flex-shrink:0;';


      button.addEventListener('click', function () {

        // Reload only after the user explicitly chooses Update.
        window.location.reload();

      });


      bar.appendChild(message);

      bar.appendChild(button);

      document.body.appendChild(bar);
    });
  }


  // ─────────────────────────────────────────────
  // SERVICE WORKER
  // ─────────────────────────────────────────────

  if ('serviceWorker' in navigator) {

    window.addEventListener('load', function () {

      const hadController =
        !!navigator.serviceWorker.controller;


      navigator.serviceWorker
        .register('/sw.js', {
          updateViaCache: 'none'
        })

        .then(function (registration) {

          console.log(
            '[Fixa PWA] Service worker registered:',
            registration.scope
          );


          // Detect a newly installed worker.
          registration.addEventListener(
            'updatefound',
            function () {

              const newWorker =
                registration.installing;

              if (!newWorker) {
                return;
              }


              newWorker.addEventListener(
                'statechange',
                function () {

                  if (
                    newWorker.state === 'installed' &&
                    navigator.serviceWorker.controller
                  ) {

                    // A real update has arrived.
                    showUpdateBanner();
                  }
                }
              );
            }
          );


          // Check immediately.
          registration.update().catch(function () {});


          // Check whenever the user returns to the tab.
          document.addEventListener(
            'visibilitychange',
            function () {

              if (
                document.visibilityState === 'visible'
              ) {
                registration
                  .update()
                  .catch(function () {});
              }
            }
          );


          // Check every 30 minutes.
          setInterval(
            function () {
              registration
                .update()
                .catch(function () {});
            },
            30 * 60 * 1000
          );

        })

        .catch(function (error) {

          console.warn(
            '[Fixa PWA] Service worker registration failed:',
            error
          );

        });
    });
  }


  // ─────────────────────────────────────────────
  // INSTALL APP
  // ─────────────────────────────────────────────

  let deferredPrompt = null;


  const installBtn =
    document.createElement('button');


  installBtn.id = 'fixaInstallBtn';

  installBtn.type = 'button';

  installBtn.textContent = '⬇ Install App';

  installBtn.style.cssText =
    'position:fixed;' +
    'left:50%;' +
    'transform:translateX(-50%);' +
    'bottom:calc(90px + env(safe-area-inset-bottom,0px));' +
    'background:#ffd700;' +
    'color:#001;' +
    'border:none;' +
    'padding:10px 18px;' +
    'border-radius:999px;' +
    'font-weight:800;' +
    'font-size:13px;' +
    'cursor:pointer;' +
    'box-shadow:0 8px 24px rgba(0,0,0,.35);' +
    'z-index:5000;' +
    'display:none;';


  onBodyReady(function () {
    document.body.appendChild(installBtn);
  });


  window.addEventListener(
    'beforeinstallprompt',
    function (event) {

      event.preventDefault();

      deferredPrompt = event;

      installBtn.style.display = 'block';
    }
  );


  installBtn.addEventListener(
    'click',
    async function () {

      if (!deferredPrompt) {
        return;
      }

      installBtn.style.display = 'none';

      deferredPrompt.prompt();

      try {
        await deferredPrompt.userChoice;
      } catch (error) {
        // User cancelled or browser rejected the prompt.
      }

      deferredPrompt = null;
    }
  );


  window.addEventListener(
    'appinstalled',
    function () {

      installBtn.style.display = 'none';

      deferredPrompt = null;
    }
  );

})();
