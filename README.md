# 🎬 Discord Streamer Bot

A Discord bot that automatically fetches movies from PhimAPI and streams them directly (Go Live) into Voice Channels with high quality and extreme smoothness using optimized FFmpeg WebRTC configurations.

## 🌟 Features
- Search for movies directly from PhimAPI using Slash Commands (`/streamphim`).
- Interactive UI menus to select movies and episodes automatically.
- Automatically joins Voice Channels and streams movies flawlessly using an **Optimized H264 Configuration (Zero Latency & CBR)**.
- Automatically disconnects and cleans up memory when using `/stopphim`.

## ⚙️ Installation Guide

### System Requirements:
- **Node.js** (Version 18 or higher).
- Recommended to run on Windows or a machine with a decent CPU for video encoding.

### Installation:
1. Clone or download this repository.
2. Open Terminal / Command Prompt in the project folder and run:
   ```bash
   npm install
   ```
3. Open `stream_bot.js` and fill in your Tokens in the Configuration section:
   - `BOT_TOKEN`: Your Discord Bot Token (Get it from the Discord Developer Portal).
   - `USER_TOKEN`: Your secondary Discord account token that will act as the streamer. *(Note: DO NOT use your main account to avoid risks)*.

### How to get a User Token (Use with caution):
1. Log in to your secondary account on Discord Web (Browser).
2. Press `F12` -> Switch to the **Network** tab.
3. Press `Ctrl + R` to reload the page. Look for network requests containing `science` or `messages`, then look for the `Authorization` header to copy your Token.

### Run the Bot:
Open your Terminal and run:
```bash
node stream_bot.js
```

## 🎮 How to Use on Discord
1. Invite the Bot to your Server (grant `bot` and `applications.commands` permissions).
2. Invite your secondary account (Streamer) to the same Server.
3. Join a Voice Channel.
4. Type the command `/streamphim <Movie Name>`.
5. Enjoy your mini cinema!

## ⚠️ Warning
This project uses Selfbot capabilities to stream WebRTC Video to Voice Channels. Using Selfbots is a violation of Discord's Terms of Service (ToS). Use at your own risk and **NEVER use your primary account token**.

---
*Powered by @dintunkit*
