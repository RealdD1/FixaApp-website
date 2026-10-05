export default class ChatRenderer {
  constructor(messagesContainer, currentUserId) {
    this.container = messagesContainer;
    this.currentUserId = currentUserId;
  }

  clear() {
    this.container.innerHTML = "";
  }

  append(message) {
    const isMe =
      message.sender?._id === this.currentUserId ||
      message.sender === this.currentUserId;

    const wrapper = document.createElement("div");
    wrapper.className = `flex ${isMe ? "justify-end" : "justify-start"} my-2`;

    const bubble = document.createElement("div");
    bubble.className = `
      max-w-[70%] px-4 py-2 rounded-xl text-sm
      ${isMe ? "bg-yellow-400 text-black" : "bg-gray-700 text-white"}
    `;

    if (message.image || message.voiceNote) {
      const media = document.createElement(
        message.voiceNote ? "audio" : "img"
      );

      if (message.voiceNote) media.controls = true;

      media.src = message.image || message.voiceNote;
      media.className = "max-w-[220px] rounded-lg mb-2";

      bubble.appendChild(media);
    }

    if (message.text) {
      const text = document.createElement("div");
      text.textContent = message.text;
      bubble.appendChild(text);
    }

    wrapper.appendChild(bubble);
    this.container.appendChild(wrapper);
    this.container.scrollTop = this.container.scrollHeight;
  }
}