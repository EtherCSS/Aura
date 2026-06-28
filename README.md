# AURA — Real AI Assistant

A polished, responsive, voice-enabled assistant powered by OpenAI GPT-4.1
through the GitHub Models API.

## Start AURA

The easiest option on Windows:

1. Use the included `.env` file, or copy `.env.example` to a new file named `.env`.
   A visible fallback file named `server.env` is also supported for Windows users.
2. Put your fresh `GITHUB_TOKEN` value in `.env` or `server.env`. The token must
   have **Models: read** permission.
3. Double-click `start-aura.bat`.
4. Open `http://127.0.0.1:4173` if it does not open automatically.
5. If the page was already open, press `Ctrl + F5` to hard-refresh it.

Or run it from a terminal:

```powershell
npm start
```

No package installation is needed. Node.js 20 or newer is required.

## Security

- There is no login or credential screen in the website.
- The browser never receives or stores the token.
- The local Node server reads the token from `.env` or the `GITHUB_TOKEN`
  environment variable.
- `.env` is excluded by `.gitignore` and is not included in source control.
- Never reuse a token that has been posted in chat, committed, or otherwise
  exposed. Revoke it and create a fresh one.

## Real AI features

- Streamed GPT-4.1 responses from GitHub Models
- Multi-turn conversation context
- Secure same-origin local API proxy
- Token, payload-size, and message-history safeguards
- Clear handling for expired tokens, rate limits, timeouts, and offline states
- Reactive fluid orb with idle, listening, thinking, and speaking states
- Browser speech recognition and optional spoken responses
- Conversation history, prompt suggestions, and responsive mobile design
- Keyboard shortcut: `Ctrl/Cmd + K`
- Reduced-motion accessibility support

## Configuration

Server configuration is handled by `.env` in the project folder. As a fallback,
`server.js` also reads `server.env` and `config.env`. Real environment variables
still take priority over local files:

```text
GITHUB_TOKEN=your_github_models_token
AURA_MODEL=openai/gpt-4.1
PORT=4173
```

The defaults are:

```text
Model: openai/gpt-4.1
Port:  4173
Host:  127.0.0.1
```

You can also override the model and port with environment variables:

```powershell
$env:AURA_MODEL="openai/gpt-4.1"
$env:PORT="4173"
npm start
```

See `.env.example` for the supported values. The included server intentionally
binds to localhost so the token is only used by the local Node server and is
not exposed to the browser.

To confirm that the token is detected, start AURA and open:

```text
http://127.0.0.1:4173/api/status
```

It should show `"connected": true`. It will never display the token.

## Voice controls

AURA now includes browser voice features:

- Click the microphone button or the center orb to start **continuous voice conversation**.
- After you speak, AURA sends the prompt, answers, then automatically opens the microphone again for your next message.
- Click the microphone/orb again, or press Esc, to stop continuous voice conversation.
- Conversation history stays hidden during active listening, thinking, and speaking so the live voice interface stays clean.
- Click the new Voice button in the top bar to turn spoken replies on or off.
- Spoken replies now use a deep male voice profile: lowest practical pitch, slower delivery, and the best available male English voice installed in the browser.
- Press Ctrl+M to start or stop continuous voice conversation quickly.
- Press Esc to stop listening, stop the current spoken reply, and exit continuous voice conversation.

Voice input and voice playback use the browser Web Speech APIs. Use Chrome or Microsoft Edge on `http://127.0.0.1:4173` for best results. The exact male voice depends on what your Windows/browser has installed; AURA automatically prefers voices such as Microsoft Guy, David, Mark, George, or other English male voices when available. Microphone access will not work correctly when opening `index.html` directly from the file system or from an unsupported browser.

If voice input says it cannot access the microphone:

1. Open AURA from `http://127.0.0.1:4173`, not by double-clicking `index.html`.
2. Use Chrome or Microsoft Edge. Firefox and some mobile browsers do not expose the same speech recognition API.
3. Click the lock/site icon beside the address bar.
4. Set **Microphone** to **Allow**.
5. Refresh AURA with `Ctrl+F5`, then click the microphone button again.
6. Make sure no other app is using the microphone.
