import ChatService from "./ChatService.js";
import ChatRenderer from "./ChatRenderer.js";

export default class ChatController {
  constructor({ baseUrl, token, user, socket }) {
    this.service = new ChatService(baseUrl, token);
    this.renderer = new ChatRenderer(
      document.getElementById("messages"),
      user._id
    );

    this.socket = socket;
    this.activeChatId = null;

    this._bindSocket();
  }

  _bindSocket() {
    this.socket?.on("newMessage", ({ chatId, message }) => {
      if (chatId === this.activeChatId) {
        this.renderer.append(message);
      }
    });
  }

  async openChat(chatId) {
    this.activeChatId = chatId;
    this.renderer.clear();

    const messages = await this.service.getMessages(chatId);
    messages.forEach(m => this.renderer.append(m));
  }

  async sendText(text) {
    if (!this.activeChatId) return;

    const message = await this.service.sendText(
      this.activeChatId,
      text
    );

    this.renderer.append(message);
  }
}