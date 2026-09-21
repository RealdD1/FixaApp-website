// config.js — the ONLY place the API address lives.
// Load this BEFORE any other script on every page:
//   <script src="config.js"></script>

(function () {
  const host = window.location.hostname;

  // localhost, 127.0.0.1, or a page opened straight from disk (file://)
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  window.FIXA_CONFIG = {
    API_URL: isLocal
      ? 'http://localhost:5000'
      : 'https://fixa-backend.onrender.com',
  };
})();
