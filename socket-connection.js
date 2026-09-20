// socket-connection.js
// ✅ Shared Socket.IO connection used across all Fixa pages

if (!window.globalSocket) {
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user"));

  // Create only one global socket connection
  window.globalSocket = io("http://localhost:5000", {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    transports: ["websocket"],
  });

  window.globalSocket.on("connect", () => {
    console.log("✅ Connected to Fixa socket:", window.globalSocket.id);

    // 🧠 Register user immediately after connecting
    if (user && user._id) {
      window.globalSocket.emit("register", user._id);
      console.log("👤 Registered user room:", user._id);
    } else {
      console.warn("⚠️ No user found in localStorage during socket registration.");
    }
  });

  window.globalSocket.on("disconnect", (reason) => {
    console.warn("⚠️ Socket disconnected:", reason);
  });

  window.globalSocket.on("connect_error", (err) => {
    console.error("❌ Socket connection error:", err.message);
  });
}
