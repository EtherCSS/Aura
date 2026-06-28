"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;

function parseEnvContent(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      values[key] = value;
  }
  return values;
}

function loadLocalEnv() {
  const configFiles = [".env", "server.env", "config.env"];
  const combined = {};
  const loadedFiles = [];

  for (const fileName of configFiles) {
    try {
      const content = fs.readFileSync(path.join(ROOT, fileName), "utf8");
      Object.assign(combined, parseEnvContent(content));
      loadedFiles.push(fileName);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`AURA could not read ${fileName}.`);
      }
    }
  }

  return { values: combined, loadedFiles };
}

const localEnvConfig = loadLocalEnv();
const localEnv = localEnvConfig.values;
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || localEnv.PORT) || 4173;
const MODEL = process.env.AURA_MODEL || localEnv.AURA_MODEL || "openai/gpt-4.1";
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || localEnv.GITHUB_TOKEN || "").trim();
const GITHUB_TOKEN_SOURCE = process.env.GITHUB_TOKEN
  ? "environment variable"
  : localEnv.GITHUB_TOKEN
    ? localEnvConfig.loadedFiles.join(", ")
    : "missing";
const API_URL = "https://models.github.ai/inference/chat/completions";
const API_VERSION = "2026-03-10";
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function readJson(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(new Error("REQUEST_TOO_LARGE"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-14)
    .filter(
      (message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 6000),
    }))
    .filter((message) => message.content);
}

function mapApiError(status, payload) {
  if (status === 401 || status === 403) {
    return {
      status: 401,
      code: "INVALID_TOKEN",
      message:
        "GitHub rejected this token. Create a new fine-grained PAT with Models: read permission.",
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: "RATE_LIMITED",
      message: "GitHub Models is rate-limiting requests. Please wait a moment and try again.",
    };
  }

  const detail =
    payload?.error?.message || payload?.message || "The model service could not complete this request.";
  return {
    status: status >= 400 && status < 600 ? status : 502,
    code: "MODEL_ERROR",
    message: String(detail).slice(0, 500),
  };
}

async function handleChat(request, response) {
  if (!GITHUB_TOKEN) {
    sendJson(response, 503, {
      code: "AI_NOT_CONFIGURED",
      message: "The server-side GitHub Models token is not configured.",
    });
    return;
  }

  let data;
  try {
    data = await readJson(request);
  } catch (error) {
    sendJson(response, error.message === "REQUEST_TOO_LARGE" ? 413 : 400, {
      code: error.message,
      message: "The chat request was not valid.",
    });
    return;
  }

  const messages = normalizeMessages(data.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    sendJson(response, 400, {
      code: "INVALID_MESSAGES",
      message: "A user message is required.",
    });
    return;
  }

  const systemMessage = {
    role: "system",
    content:
      "You are AURA, a calm, perceptive, modern AI assistant. Be genuinely useful, clear, and concise. " +
      "Answer in plain language, use short structure only when it helps, and never claim to have performed actions you did not perform. " +
      "Your tone is intelligent, warm, composed, and quietly futuristic.",
  };

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [systemMessage, ...messages],
        temperature: 0.7,
        max_tokens: 900,
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    sendJson(response, 502, {
      code: timedOut ? "MODEL_TIMEOUT" : "MODEL_UNAVAILABLE",
      message: timedOut
        ? "The model took too long to respond."
        : "Could not reach GitHub Models. Check your internet connection.",
    });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    let payload = {};
    try {
      payload = await upstream.json();
    } catch {
      payload = { message: await upstream.text().catch(() => "") };
    }
    const mapped = mapApiError(upstream.status, payload);
    sendJson(response, mapped.status, mapped);
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
  } catch {
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify({ error: { message: "The response stream ended early." } })}\n\n`);
    }
  } finally {
    response.end();
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (url.pathname === "/api/status" && request.method === "GET") {
    sendJson(response, 200, {
      connected: Boolean(GITHUB_TOKEN),
      configured: Boolean(GITHUB_TOKEN),
      provider: "GitHub Models",
      model: MODEL,
      tokenSource: GITHUB_TOKEN_SOURCE,
      configFilesLoaded: localEnvConfig.loadedFiles,
    });
    return;
  }

  if (url.pathname === "/api/chat" && request.method === "POST") {
    await handleChat(request, response);
    return;
  }

  if (request.method === "GET" && PUBLIC_FILES.has(url.pathname)) {
    const [fileName, contentType] = PUBLIC_FILES.get(url.pathname);
    const filePath = path.join(ROOT, fileName);
    fs.readFile(filePath, (error, content) => {
      if (error) {
        sendJson(response, 500, {
          code: "FILE_ERROR",
          message: "AURA could not load this asset.",
        });
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
      });
      response.end(content);
    });
    return;
  }

  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "That AURA route does not exist.",
  });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, {
        code: "SERVER_ERROR",
        message: "AURA encountered an unexpected server error.",
      });
    } else if (!response.writableEnded) {
      response.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`AURA is ready at http://${HOST}:${PORT}`);
  console.log(
    GITHUB_TOKEN
      ? `GitHub Models connected (${MODEL}); token source: ${GITHUB_TOKEN_SOURCE}`
      : "Add a fresh GITHUB_TOKEN to .env or server.env, then restart AURA to enable real AI.",
  );
});
