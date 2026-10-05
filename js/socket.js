import { io } from "https://cdn.socket.io/4.7.2/socket.io.esm.min.js";

export function createSocket(BASE_URL, token, userId) {
  const socket = io(BASE_URL, { auth: { token } });

  socket.on("connect", () => {
    socket.emit("register", userId);
  });

  return socket;
}