const body = document.body;
const canvas = document.getElementById("particleCanvas");
const context = canvas.getContext("2d");
const orbWrap = document.getElementById("orbWrap");
const orb = document.getElementById("orb");
const promptForm = document.getElementById("promptForm");
const promptInput = document.getElementById("promptInput");
const micButton = document.getElementById("micButton");
const soundButton = document.getElementById("soundButton");
const voiceButton = document.getElementById("voiceButton");
const historyButton = document.getElementById("historyButton");
const closeHistoryButton = document.getElementById("closeHistoryButton");
const historyPanel = document.getElementById("historyPanel");
const panelBackdrop = document.getElementById("panelBackdrop");
const messageList = document.getElementById("messageList");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const assistantTitle = document.getElementById("assistantTitle");
const assistantSubtitle = document.getElementById("assistantSubtitle");
const stateEyebrow = document.getElementById("stateEyebrow");
const modeLabel = document.getElementById("modeLabel");
const toast = document.getElementById("toast");
const aiStatusIndicator = document.getElementById("aiStatusIndicator");
const aiStatusText = document.getElementById("aiStatusText");

let currentState = "idle";
let soundEnabled = false;
let voiceRepliesEnabled = true;
let availableVoices = [];
let preferredVoice = null;
let aiConnected = false;
let audioContext = null;
let recognition = null;
let toastTimer = null;
let stateTimer = null;
let particles = [];
let animationFrame = null;
let deviceScale = Math.min(window.devicePixelRatio || 1, 2);
let conversation = [];
let recognitionActive = false;
let continuousVoiceMode = false;
let restartListeningAfterResponse = false;
let pendingVoicePrompt = false;
let microphonePermissionGranted = false;
let voiceRestartTimer = null;

const stateCopy = {
  idle: {
    eyebrow: "AURA IS READY",
    title: "How can I help?",
    subtitle: "Ask anything, or tap the orb to start voice conversation.",
    mode: "Ambient intelligence",
  },
  listening: {
    eyebrow: "VOICE CHANNEL OPEN",
    title: "Voice conversation on",
    subtitle: "Speak naturally. AURA will keep listening after every reply.",
    mode: "Continuous listening",
  },
  thinking: {
    eyebrow: "MAKING CONNECTIONS",
    title: "Let me think",
    subtitle: "Following the shape of your idea...",
    mode: "Neural synthesis",
  },
  speaking: {
    eyebrow: "AURA RESPONDS",
    title: "Here’s a thought",
    subtitle: "Your answer is ready.",
    mode: "Voice response",
  },
};

const VOICE_SETTINGS_KEY = "aura_voice_replies_enabled";
const VOICE_INPUT_HELP = "Use Chrome or Microsoft Edge and open AURA from http://127.0.0.1:4173.";

function loadVoiceSettings() {
  try {
    const saved = window.localStorage.getItem(VOICE_SETTINGS_KEY);
    if (saved !== null) voiceRepliesEnabled = saved === "true";
  } catch {
    voiceRepliesEnabled = true;
  }
}

function saveVoiceSettings() {
  try {
    window.localStorage.setItem(VOICE_SETTINGS_KEY, String(voiceRepliesEnabled));
  } catch {
    // Local storage may be unavailable in private or restricted browser modes.
  }
}

const DEEP_MALE_VOICE = {
  rate: 0.88,
  pitch: 0.58,
  volume: 0.96,
};

function scoreVoiceForDeepMaleProfile(voice) {
  const name = String(voice.name || "").toLowerCase();
  const lang = String(voice.lang || "").toLowerCase();
  let score = 0;

  if (/^en/.test(lang)) score += 50;
  if (/en[-_]us|en[-_]gb|en[-_]ph|en[-_]au|en[-_]ca/.test(lang)) score += 12;
  if (/male|guy|man|masculine|david|mark|george|james|john|daniel|richard|ryan|alex|fred|ralph|thomas|google uk english male/.test(name)) score += 60;
  if (/natural|neural|online|premium/.test(name)) score += 14;
  if (/deep|baritone|bass/.test(name)) score += 25;
  if (/female|woman|zira|aria|jenny|samantha|susan|hazel|helen|linda|karen|victoria|moira|tessa|fiona/.test(name)) score -= 70;
  if (!/^en/.test(lang)) score -= 35;

  return score;
}

function choosePreferredVoice(voices) {
  if (!voices.length) return null;

  const ranked = [...voices].sort((a, b) => scoreVoiceForDeepMaleProfile(b) - scoreVoiceForDeepMaleProfile(a));
  const bestEnglishVoice = ranked.find((voice) => /^en/i.test(voice.lang));
  return bestEnglishVoice || ranked[0];
}

function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  availableVoices = window.speechSynthesis.getVoices();
  preferredVoice = choosePreferredVoice(availableVoices);
}

function updateVoiceButton() {
  if (!voiceButton) return;
  const supported = "speechSynthesis" in window;
  voiceButton.disabled = !supported;
  voiceButton.setAttribute("aria-pressed", String(voiceRepliesEnabled && supported));
  voiceButton.setAttribute(
    "aria-label",
    supported
      ? voiceRepliesEnabled
        ? "Disable voice replies"
        : "Enable voice replies"
      : "Voice replies are not supported in this browser",
  );
  voiceButton.dataset.tooltip = supported
    ? voiceRepliesEnabled
      ? "Voice on"
      : "Voice off"
    : "Voice unavailable";
}

function syncVoiceConversationUi() {
  const supported = typeof getRecognitionConstructor === "function" && Boolean(getRecognitionConstructor());
  const secure = typeof isVoiceInputSecureOrigin === "function" && isVoiceInputSecureOrigin();
  const available = supported && secure;

  body.dataset.voiceConversation = continuousVoiceMode ? "on" : "off";
  micButton.setAttribute("aria-pressed", String(continuousVoiceMode));

  if (available) {
    micButton.setAttribute(
      "aria-label",
      continuousVoiceMode ? "Stop continuous voice conversation" : "Start continuous voice conversation",
    );
    micButton.dataset.tooltip = continuousVoiceMode ? "Voice chat on" : "Speak";
    orb.setAttribute(
      "aria-label",
      continuousVoiceMode ? "Stop continuous voice conversation" : "Activate voice assistant",
    );
  }
}

function setState(state, copy = {}) {
  currentState = state;
  body.dataset.state = state;
  const defaults = stateCopy[state];
  stateEyebrow.textContent = copy.eyebrow || defaults.eyebrow;
  assistantTitle.textContent = copy.title || defaults.title;
  assistantSubtitle.textContent = copy.subtitle || defaults.subtitle;
  modeLabel.textContent = copy.mode || defaults.mode;
  syncVoiceConversationUi();
}

function openHistory() {
  if (continuousVoiceMode || ["listening", "thinking", "speaking"].includes(currentState)) {
    closeHistory();
    showToast("Conversation history stays hidden during live conversation.");
    return;
  }

  historyPanel.classList.add("open");
  panelBackdrop.classList.add("open");
  historyPanel.removeAttribute("inert");
  historyPanel.setAttribute("aria-hidden", "false");
  historyButton.setAttribute("aria-expanded", "true");
  window.setTimeout(() => closeHistoryButton.focus(), 200);
}

function closeHistory() {
  historyPanel.classList.remove("open");
  panelBackdrop.classList.remove("open");
  historyPanel.setAttribute("inert", "");
  historyPanel.setAttribute("aria-hidden", "true");
  historyButton.setAttribute("aria-expanded", "false");
}

function updateConnectionStatus(connected, label) {
  aiConnected = connected;
  aiStatusIndicator.classList.toggle("connected", connected);
  aiStatusText.textContent = label || (connected ? "AI online" : "AI offline");
}

async function checkAiStatus() {
  if (window.location.protocol === "file:") {
    updateConnectionStatus(false, "Start local server");
    return false;
  }

  try {
    const response = await fetch(`/api/status?t=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("STATUS_UNAVAILABLE");
    const data = await response.json();
    const connected = Boolean(data.connected);
    updateConnectionStatus(
      connected,
      connected ? "AI online" : "Add server token",
    );
    return connected;
  } catch {
    updateConnectionStatus(false, "Server offline");
    return false;
  }
}

function showToast(message, duration = 3200) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), duration);
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playTone(frequency = 430, duration = 0.12, volume = 0.028) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, ctx.currentTime + duration);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration);
}

function addMessage(role, text, typing = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}`;

  const avatar = document.createElement("div");
  if (role === "user") {
    avatar.className = "user-avatar";
    avatar.textContent = "YOU";
  } else {
    avatar.className = "message-orb";
    avatar.setAttribute("aria-hidden", "true");
  }

  const content = document.createElement("div");
  const meta = document.createElement("p");
  meta.className = "message-meta";
  meta.textContent = `${role === "user" ? "YOU" : "AURA"} · NOW`;
  content.appendChild(meta);

  if (typing) {
    const dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.innerHTML = "<i></i><i></i><i></i>";
    content.appendChild(dots);
    article.dataset.typing = "true";
  } else {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    content.appendChild(paragraph);
  }

  article.append(avatar, content);
  messageList.appendChild(article);
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  return article;
}

function turnTypingIntoMessage(article) {
  const content = article.querySelector("div:last-child");
  const dots = content.querySelector(".typing-dots");
  dots?.remove();
  let paragraph = content.querySelector("p:not(.message-meta)");
  if (!paragraph) {
    paragraph = document.createElement("p");
    paragraph.className = "streaming-text";
    content.appendChild(paragraph);
  }
  article.removeAttribute("data-typing");
  return paragraph;
}

function extractStreamText(payload) {
  const content = payload?.choices?.[0]?.delta?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

async function streamAiReply(messages, onText) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: "AURA could not read the model response." };
    }
    const error = new Error(errorData.message || "The AI request failed.");
    error.code = errorData.code || "AI_ERROR";
    throw error;
  }

  if (!response.body) throw new Error("The AI response stream was empty.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.replace(/\r\n/g, "\n").split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (payload.error) throw new Error(payload.error.message || "The response stream ended early.");
        const text = extractStreamText(payload);
        if (text) onText(text);
      }
    }

    if (done) break;
  }
}

function speak(text, onComplete = () => {}) {
  const finish = () => {
    onComplete();
  };

  if (!voiceRepliesEnabled || !("speechSynthesis" in window)) {
    stateTimer = window.setTimeout(() => {
      setState("idle");
      finish();
    }, 700);
    return;
  }

  refreshVoices();
  window.speechSynthesis.cancel();
  const cleanText = String(text || "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[`*_#>~|\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    setState("idle");
    finish();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.lang = preferredVoice?.lang || "en-US";
  utterance.rate = DEEP_MALE_VOICE.rate;
  utterance.pitch = DEEP_MALE_VOICE.pitch;
  utterance.volume = DEEP_MALE_VOICE.volume;
  utterance.onstart = () => {
    setState("speaking", {
      title: cleanText.length > 115 ? "A clear next step" : "Here’s a thought",
      subtitle: preferredVoice ? `AURA is speaking with ${preferredVoice.name}.` : "AURA is speaking in a deep voice profile.",
    });
  };
  utterance.onend = () => {
    if (currentState === "speaking") setState("idle");
    finish();
  };
  utterance.onerror = () => {
    if (currentState === "speaking") setState("idle");
    showToast("Voice playback was interrupted by the browser.");
    finish();
  };
  window.speechSynthesis.speak(utterance);
}

async function submitPrompt(rawPrompt, options = {}) {
  const prompt = rawPrompt.trim();
  const fromVoice = Boolean(options.fromVoice);
  if (!prompt || currentState === "thinking") {
    if (fromVoice) pendingVoicePrompt = false;
    return;
  }

  if (window.location.protocol === "file:") {
    if (fromVoice) pendingVoicePrompt = false;
    showToast("The local AI server must be running.");
    return;
  }

  if (!aiConnected) {
    const connectedNow = await checkAiStatus();
    if (!connectedNow) {
      if (fromVoice) {
        pendingVoicePrompt = false;
        continuousVoiceMode = false;
        restartListeningAfterResponse = false;
        syncVoiceConversationUi();
      }
      showToast("Server token not detected. Restart AURA, then refresh this page.");
      return;
    }
  }

  window.clearTimeout(stateTimer);
  window.clearTimeout(voiceRestartTimer);
  if (fromVoice && continuousVoiceMode) restartListeningAfterResponse = true;
  if (recognition && recognitionActive) {
    try {
      recognition.stop();
    } catch {
      // The browser may already be stopping voice recognition.
    }
  }

  addMessage("user", prompt);
  conversation.push({ role: "user", content: prompt });
  conversation = conversation.slice(-14);
  promptInput.value = "";
  closeHistory();
  playTone(300, 0.1, 0.022);
  setState("thinking");
  const typingMessage = addMessage("assistant", "", true);
  let responseText = "";
  let responseParagraph = null;

  try {
    await streamAiReply(conversation, (chunk) => {
      if (!responseParagraph) responseParagraph = turnTypingIntoMessage(typingMessage);
      responseText += chunk;
      responseParagraph.textContent = responseText;
      messageList.scrollTop = messageList.scrollHeight;
    });

    responseText = responseText.trim();
    if (!responseText) throw new Error("The model returned an empty response.");
    conversation.push({ role: "assistant", content: responseText });
    conversation = conversation.slice(-14);

    setState("speaking", {
      title: responseText.length > 115 ? "A clear next step" : "Here’s a thought",
      subtitle: voiceRepliesEnabled ? "AURA is preparing the voice response." : "Live response from GitHub Models.",
    });
    playTone(520, 0.2, 0.035);
    speak(responseText, () => maybeRestartVoiceConversation());
  } catch (error) {
    if (!responseParagraph) typingMessage.remove();
    if (responseParagraph && !responseText) typingMessage.remove();

    const message =
      error.message || "AURA could not reach the model. Please try again.";
    addMessage("assistant", message);
    setState("idle", {
      eyebrow: "CONNECTION INTERRUPTED",
      title: "Let’s reconnect",
      subtitle: "Your message is still in the conversation stream.",
      mode: "Connection check",
    });

    if (["AI_NOT_CONFIGURED", "INVALID_TOKEN"].includes(error.code)) {
      updateConnectionStatus(false);
      continuousVoiceMode = false;
      restartListeningAfterResponse = false;
    }
    pendingVoicePrompt = false;
    syncVoiceConversationUi();
    showToast(message);
  }
}

function getRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function isVoiceInputSecureOrigin() {
  const host = window.location.hostname;
  return (
    window.isSecureContext ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

function getVoiceInputMessage(reason = "") {
  const normalized = String(reason || "").toLowerCase();

  if (!getRecognitionConstructor()) {
    return `Voice input needs Chrome or Microsoft Edge. ${VOICE_INPUT_HELP}`;
  }

  if (!isVoiceInputSecureOrigin()) {
    return "Voice input needs localhost or HTTPS. Start AURA with start-aura.bat and open http://127.0.0.1:4173.";
  }

  if (["notallowederror", "securityerror", "not-allowed", "permission denied"].includes(normalized)) {
    return "Microphone is blocked. Click the lock icon beside the address bar, allow Microphone, then refresh AURA.";
  }

  if (["notfounderror", "devicesnotfounderror", "audio-capture"].includes(normalized)) {
    return "No microphone was detected. Connect or enable a microphone, then try again.";
  }

  if (["notreadableerror", "trackstarterror"].includes(normalized)) {
    return "Your microphone is being used by another app. Close other recording apps, then try again.";
  }

  if (["service-not-allowed"].includes(normalized)) {
    return "The browser blocked speech recognition. Use Chrome or Microsoft Edge and allow microphone access.";
  }

  if (["network"].includes(normalized)) {
    return "Voice recognition could not reach the browser speech service. Check your internet connection and try again.";
  }

  if (["language-not-supported"].includes(normalized)) {
    return "This browser does not support the selected speech language. Try Chrome or Edge with English speech input.";
  }

  return `I could not access voice input. ${VOICE_INPUT_HELP}`;
}

function updateVoiceInputButton() {
  const supported = Boolean(getRecognitionConstructor());
  const secure = isVoiceInputSecureOrigin();
  const available = supported && secure;

  micButton.setAttribute("aria-disabled", String(!available));
  micButton.dataset.tooltip = available
    ? continuousVoiceMode
      ? "Voice chat on"
      : "Speak"
    : "Voice unavailable";

  orb.setAttribute("aria-disabled", String(!available));
  orb.setAttribute("aria-label", available ? "Activate voice assistant" : "Voice input unavailable");
  syncVoiceConversationUi();
}

async function requestMicrophoneAccess() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return { ok: true };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    stream.getTracks().forEach((track) => track.stop());
    microphonePermissionGranted = true;
    return { ok: true };
  } catch (error) {
    return { ok: false, message: getVoiceInputMessage(error?.name || error?.message) };
  }
}

function initializeVoiceRecognition() {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) return null;

  const instance = new Recognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = navigator.languages?.find((language) => /^en/i.test(language)) || navigator.language || "en-US";

  instance.onstart = () => {
    recognitionActive = true;
    syncVoiceConversationUi();
    setState("listening", {
      title: "Voice conversation on",
      subtitle: "Speak. AURA will answer, then listen again automatically.",
      mode: "Continuous voice",
    });
    playTone(620, 0.13, 0.025);
  };

  instance.onresult = (event) => {
    let interimTranscript = "";
    let finalTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) {
        finalTranscript += `${text} `;
      } else {
        interimTranscript += text;
      }
    }

    const displayText = (finalTranscript || interimTranscript).trim();
    if (displayText) {
      promptInput.value = displayText;
      assistantSubtitle.textContent = displayText;
    } else {
      assistantSubtitle.textContent = "Speak naturally. AURA will keep listening after every reply.";
    }

    const prompt = finalTranscript.trim();
    if (prompt && !pendingVoicePrompt && currentState === "listening") {
      pendingVoicePrompt = true;
      submitPrompt(prompt, { fromVoice: true });
    }
  };

  instance.onerror = (event) => {
    const quietErrors = ["aborted", "no-speech"];
    recognitionActive = false;

    if (!quietErrors.includes(event.error)) {
      const message = getVoiceInputMessage(event.error);
      showToast(message, 6500);
      assistantSubtitle.textContent = message;
      continuousVoiceMode = false;
      restartListeningAfterResponse = false;
      pendingVoicePrompt = false;
      setState("idle");
      syncVoiceConversationUi();
    }
  };

  instance.onend = () => {
    recognitionActive = false;
    syncVoiceConversationUi();

    if (continuousVoiceMode && !pendingVoicePrompt && currentState === "listening" && !document.hidden) {
      voiceRestartTimer = window.setTimeout(() => startVoiceRecognition({ silent: true }), 650);
      return;
    }

    if (currentState === "listening") setState("idle");
  };

  return instance;
}

async function startVoiceRecognition({ silent = false } = {}) {
  if (!getRecognitionConstructor()) {
    showToast(getVoiceInputMessage("unsupported"), 6500);
    promptInput.focus();
    return false;
  }

  if (!isVoiceInputSecureOrigin()) {
    showToast(getVoiceInputMessage("insecure"), 6500);
    promptInput.focus();
    return false;
  }

  if (recognitionActive) return true;

  window.clearTimeout(voiceRestartTimer);
  window.speechSynthesis?.cancel();

  if (!microphonePermissionGranted) {
    const permission = await requestMicrophoneAccess();
    if (!permission.ok) {
      showToast(permission.message, 6500);
      assistantSubtitle.textContent = permission.message;
      setState("idle", {
        eyebrow: "MICROPHONE BLOCKED",
        title: "Allow microphone access",
        subtitle: permission.message,
        mode: "Voice input check",
      });
      promptInput.focus();
      return false;
    }
  }

  recognition = recognition || initializeVoiceRecognition();
  if (!recognition) {
    showToast(getVoiceInputMessage("unsupported"), 6500);
    promptInput.focus();
    return false;
  }

  recognition.continuous = true;
  recognition.interimResults = true;

  try {
    recognition.start();
    if (!silent) showToast("Continuous voice conversation on");
    return true;
  } catch (error) {
    const alreadyStarted = /start|started|recognition has already started/i.test(String(error?.message || ""));
    if (alreadyStarted) return true;
    showToast(getVoiceInputMessage(error?.name || error?.message), 6500);
    return false;
  }
}

function stopVoiceConversation({ showStatus = true } = {}) {
  continuousVoiceMode = false;
  restartListeningAfterResponse = false;
  pendingVoicePrompt = false;
  window.clearTimeout(voiceRestartTimer);
  window.speechSynthesis?.cancel();

  if (recognition && recognitionActive) {
    try {
      recognition.stop();
    } catch {
      // The browser may already be stopping voice recognition.
    }
  }

  if (["listening", "speaking"].includes(currentState)) setState("idle");
  syncVoiceConversationUi();
  if (showStatus) showToast("Continuous voice conversation off");
}

function maybeRestartVoiceConversation(delay = 550) {
  pendingVoicePrompt = false;
  if (!continuousVoiceMode || !restartListeningAfterResponse) {
    restartListeningAfterResponse = false;
    syncVoiceConversationUi();
    return;
  }

  restartListeningAfterResponse = false;
  syncVoiceConversationUi();
  voiceRestartTimer = window.setTimeout(() => {
    if (continuousVoiceMode && currentState !== "thinking" && !document.hidden) {
      startVoiceRecognition({ silent: true });
    }
  }, delay);
}

async function toggleListening() {
  if (continuousVoiceMode || recognitionActive || currentState === "listening") {
    stopVoiceConversation();
    return;
  }

  continuousVoiceMode = true;
  restartListeningAfterResponse = false;
  pendingVoicePrompt = false;
  syncVoiceConversationUi();

  const started = await startVoiceRecognition();
  if (!started) {
    continuousVoiceMode = false;
    syncVoiceConversationUi();
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.setAttribute("aria-label", soundEnabled ? "Disable interface sounds" : "Enable interface sounds");
  showToast(soundEnabled ? "Interface sounds on" : "Interface sounds off");
  if (soundEnabled) playTone(480, 0.16, 0.03);
}

function toggleVoiceReplies() {
  if (!("speechSynthesis" in window)) {
    showToast("Voice replies are not supported in this browser.");
    return;
  }

  voiceRepliesEnabled = !voiceRepliesEnabled;
  saveVoiceSettings();
  updateVoiceButton();

  if (voiceRepliesEnabled) {
    refreshVoices();
    showToast(preferredVoice ? `Deep male voice on: ${preferredVoice.name}` : "Deep male voice replies on");
    playTone(540, 0.14, 0.025);
  } else {
    window.speechSynthesis.cancel();
    showToast("AURA voice replies off");
    if (currentState === "speaking") setState("idle");
  }
}

function sizeCanvas() {
  deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * deviceScale;
  canvas.height = window.innerHeight * deviceScale;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

  const particleCount = Math.min(80, Math.max(34, Math.floor(window.innerWidth / 22)));
  particles = Array.from({ length: particleCount }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    size: Math.random() * 1.15 + 0.2,
    speed: Math.random() * 0.12 + 0.025,
    drift: (Math.random() - 0.5) * 0.08,
    alpha: Math.random() * 0.48 + 0.08,
    phase: Math.random() * Math.PI * 2,
  }));
}

function drawParticles(time = 0) {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const stateBoost = currentState === "thinking" ? 1.8 : currentState === "listening" ? 1.35 : 1;
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight * 0.36;

  for (const particle of particles) {
    particle.y -= particle.speed * stateBoost;
    particle.x += particle.drift + Math.sin(time * 0.0003 + particle.phase) * 0.035;
    if (particle.y < -4) {
      particle.y = window.innerHeight + 4;
      particle.x = Math.random() * window.innerWidth;
    }

    const distance = Math.hypot(particle.x - centerX, particle.y - centerY);
    const nearOrb = distance < Math.min(window.innerWidth, window.innerHeight) * 0.28;
    const pulse = 0.6 + Math.sin(time * 0.001 + particle.phase) * 0.4;
    context.beginPath();
    context.fillStyle = `rgba(102, 225, 255, ${particle.alpha * pulse * (nearOrb ? 1.35 : 0.55)})`;
    context.shadowColor = "#4adfff";
    context.shadowBlur = nearOrb ? 5 : 1;
    context.arc(particle.x, particle.y, particle.size * (nearOrb ? 1.2 : 0.7), 0, Math.PI * 2);
    context.fill();
  }

  context.shadowBlur = 0;
  animationFrame = window.requestAnimationFrame(drawParticles);
}

function handlePointerMove(event) {
  const x = (event.clientX / window.innerWidth - 0.5) * 2;
  const y = (event.clientY / window.innerHeight - 0.5) * 2;
  orbWrap.style.setProperty("--mx", `${x * 7}px`);
  orbWrap.style.setProperty("--my", `${y * 5}px`);
}

promptForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt(promptInput.value);
});

orb.addEventListener("click", toggleListening);
micButton.addEventListener("click", toggleListening);
soundButton.addEventListener("click", toggleSound);
voiceButton?.addEventListener("click", toggleVoiceReplies);
historyButton.addEventListener("click", openHistory);
closeHistoryButton.addEventListener("click", closeHistory);
panelBackdrop.addEventListener("click", closeHistory);

clearHistoryButton.addEventListener("click", () => {
  messageList.innerHTML = "";
  conversation = [];
  addMessage("assistant", "A fresh start. What’s on your mind?");
  showToast("Conversation cleared");
});

document.querySelector(".attachment-button").addEventListener("click", () => {
  showToast("Attachment flow is ready for your AI backend.");
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => submitPrompt(button.dataset.prompt));
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    promptInput.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "m") {
    event.preventDefault();
    toggleListening();
  }
  if (event.key === "Escape") {
    if (historyPanel.classList.contains("open")) closeHistory();
    if (continuousVoiceMode || currentState === "listening" || currentState === "speaking") {
      stopVoiceConversation({ showStatus: false });
    }
  }
});

window.addEventListener("pointermove", handlePointerMove, { passive: true });
window.addEventListener("resize", sizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.cancelAnimationFrame(animationFrame);
    window.clearTimeout(voiceRestartTimer);
  } else {
    animationFrame = window.requestAnimationFrame(drawParticles);
    if (continuousVoiceMode && !recognitionActive && currentState === "listening") {
      voiceRestartTimer = window.setTimeout(() => startVoiceRecognition({ silent: true }), 650);
    }
  }
});

loadVoiceSettings();
recognition = initializeVoiceRecognition();
refreshVoices();
updateVoiceButton();
updateVoiceInputButton();
syncVoiceConversationUi();
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    refreshVoices();
    updateVoiceButton();
  };
}
setState("idle");
sizeCanvas();
animationFrame = window.requestAnimationFrame(drawParticles);
checkAiStatus();
