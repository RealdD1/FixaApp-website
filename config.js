// config.js — the ONLY place environment settings live.
// Load this BEFORE any other script on every page:
//   <script src="config.js"></script>

(function () {
  const host = window.location.hostname;

  // localhost, 127.0.0.1, or a page opened straight from disk (file://)
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  window.FIXA_CONFIG = {
    API_URL: isLocal
      ? 'http://localhost:5000'
      : 'https://api.fixaapp.net',

  VAPID_PUBLIC_KEY:
    'BO5upnmzIIUyRHjIT5FKOkvLxS-b99GLrv4gm0pXy08hlLz5D53b1XYPudhX6rvCDINZGWUOD7QoULpyR9kaT4U',

    // Google Maps (browser key — MUST be restricted to your domains in Google Cloud)
    GOOGLE_MAPS_API_KEY: 'AIzaSyDZjCz9CqvNO4Ifk-zomviJx_v6fD-9YsQ',

  };
})();