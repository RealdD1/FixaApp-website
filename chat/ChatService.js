export default class ChatService {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  headers(json = false) {
    const h = { Authorization: `Bearer ${this.token}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async getChats() {
    const res = await fetch(`${this.baseUrl}/my-chats`, {
      headers: this.headers()
    });
    return res.json();
  }

  async getMessages(chatId) {
    const res = await fetch(`${this.baseUrl}/${chatId}`, {
      headers: this.headers()
    });
    return res.json();
  }

  async sendText(chatId, text) {
    const res = await fetch(`${this.baseUrl}/${chatId}/messages`, {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({ text })
    });
    return res.json();
  }

  async sendMedia(chatId, file) {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch(`${this.baseUrl}/${chatId}/media`, {
      method: "POST",
      headers: this.headers(),
      body: fd
    });

    return res.json();
  }
}