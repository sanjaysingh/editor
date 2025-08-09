export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.viewers = new Set();
    this.hostWebSocket = null;
    this.room = {
      content: "",
      selection: { start: 0, end: 0 },
      version: 0,
      hostToken: null,
      hostConnected: false,
      active: false,
      createdByIp: null,
      expiresAt: 0
    };
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("room");
      if (stored) {
        this.room = stored;
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname.endsWith("/init") && method === "POST") {
      return this.handleInit(request);
    }
    if (url.pathname.endsWith("/snapshot")) {
      return this.handleSnapshot(request);
    }
    if (url.pathname.endsWith("/stop") && method === "POST") {
      return this.handleStop(request);
    }
    if (url.pathname.endsWith("/ws")) {
      return this.handleWebSocket(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async handleInit(request) {
    const { key, hostToken, ip } = await safeJson(request);
    if (!validateKeyFormat(key) || !hostToken) {
      return json({ error: "bad init" }, 400, corsHeaders(this.env, request));
    }
    if (this.room.active) {
      return json({ error: "already active" }, 409, corsHeaders(this.env, request));
    }
    const ttl = Number(this.env.ROOM_TTL_SECONDS || 3600);
    this.room.active = true;
    this.room.hostToken = hostToken;
    this.room.hostConnected = false;
    this.room.createdByIp = ip || null;
    this.room.expiresAt = Date.now() + ttl * 1000;
    await this.state.storage.put("room", this.room);
    await this.state.storage.setAlarm(this.room.expiresAt);
    return json({ ok: true }, 200, corsHeaders(this.env, request));
  }

  async handleSnapshot(request) {
    const body = {
      active: this.room.active,
      content: this.room.content,
      selection: this.room.selection,
      version: this.room.version
    };
    return json(body, 200, corsHeaders(this.env, request));
  }

  async handleStop(request) {
    const { hostToken } = await safeJson(request);
    if (!hostToken || hostToken !== this.room.hostToken) {
      return json({ error: "unauthorized" }, 401, corsHeaders(this.env, request));
    }
    this.room.active = false;
    this.room.expiresAt = Date.now();
    await this.state.storage.put("room", this.room);
    // notify viewers
    for (const ws of this.viewers) {
      try { ws.send(JSON.stringify({ type: "ended" })); } catch {}
      try { ws.close(1000, "ended"); } catch {}
    }
    this.viewers.clear();
    if (this.hostWebSocket) {
      try { this.hostWebSocket.close(1000, "ended"); } catch {}
      this.hostWebSocket = null;
    }
    return json({ ok: true }, 200, corsHeaders(this.env, request));
  }

  async handleWebSocket(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token");

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const origin = request.headers.get("Origin") || request.headers.get("Sec-WebSocket-Origin");
    if (!isAllowedOrigin(this.env, origin)) {
      return new Response("forbidden origin", { status: 403 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    if (role === "host") {
      if (!token || token !== this.room.hostToken) {
        server.accept();
        server.send(JSON.stringify({ type: "error", reason: "unauthorized" }));
        server.close(1008, "unauthorized");
        return new Response(null, { status: 101, webSocket: server });
      }
      if (!this.room.active) {
        server.accept();
        server.send(JSON.stringify({ type: "error", reason: "inactive" }));
        server.close(1008, "inactive");
        return new Response(null, { status: 101, webSocket: server });
      }
      if (this.hostWebSocket) {
        try { this.hostWebSocket.close(1000, "replaced"); } catch {}
      }
      this.hostWebSocket = server;
      server.accept();
      this.room.hostConnected = true;
      await this.state.storage.put("room", this.room);
      server.addEventListener("message", async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "state") {
            if (!this.room.active) return;
            this.room.content = String(msg.content ?? "");
            this.room.selection = msg.selection || { start: 0, end: 0 };
            this.room.version = Number(msg.version || (this.room.version + 1));
            await this.state.storage.put("room", this.room);
            const payload = JSON.stringify({ type: "state", content: this.room.content, selection: this.room.selection, version: this.room.version });
            for (const ws of this.viewers) {
              try { ws.send(payload); } catch {}
            }
          }
        } catch {}
      });
      server.addEventListener("close", async () => {
        this.room.hostConnected = false;
        await this.state.storage.put("room", this.room);
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    // viewer
    if (!this.room.active) {
      server.accept();
      server.send(JSON.stringify({ type: "ended" }));
      server.close(1000, "inactive");
      return new Response(null, { status: 101, webSocket: server });
    }

    const maxViewers = Number(this.env.MAX_VIEWERS || 50);
    if (this.viewers.size >= maxViewers) {
      server.accept();
      server.send(JSON.stringify({ type: "error", reason: "room_full" }));
      server.close(1008, "room full");
      return new Response(null, { status: 101, webSocket: server });
    }

    server.accept();
    // send initial state
    try {
      server.send(JSON.stringify({ type: "state", content: this.room.content, selection: this.room.selection, version: this.room.version }));
    } catch {}
    this.viewers.add(server);
    server.addEventListener("close", () => {
      this.viewers.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    // TTL expiration
    if (this.room.active && Date.now() >= (this.room.expiresAt || 0)) {
      this.room.active = false;
      await this.state.storage.put("room", this.room);
      for (const ws of this.viewers) {
        try { ws.send(JSON.stringify({ type: "ended" })); } catch {}
        try { ws.close(1000, "expired"); } catch {}
      }
      this.viewers.clear();
      if (this.hostWebSocket) {
        try { this.hostWebSocket.close(1000, "expired"); } catch {}
        this.hostWebSocket = null;
      }
    } else if (this.room.active) {
      // re-arm to exact expiry if needed
      await this.state.storage.setAlarm(this.room.expiresAt);
    }
  }
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Requested-With,CF-Access-Jwt-Assertion",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = isAllowedOrigin(env, origin) ? origin : "null";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

function isAllowedOrigin(env, origin) {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(origin);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function validateKeyFormat(key) {
  return /^[A-HJ-NP-Z]{3}-[2-9]{3}$/.test(key);
}

function generateReadableKey() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude I O
  const digits = "23456789"; // exclude 0 1
  const pick = (chars, n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${pick(letters,3)}-${pick(digits,3)}`;
}

function generateHostToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    // Only allow requests from allowed origins
    const origin = request.headers.get("Origin");
    if (origin && !isAllowedOrigin(env, origin)) {
      return new Response("forbidden origin", { status: 403 });
    }

    // Simple routing
    if (url.pathname === "/api/share/start" && request.method === "POST") {
      return createSession(request, env, ctx);
    }
    if (url.pathname === "/api/share/stop" && request.method === "POST") {
      return stopSession(request, env, ctx);
    }
    if (url.pathname.startsWith("/api/share/snapshot/")) {
      const key = url.pathname.split("/").pop();
      if (!validateKeyFormat(key)) return json({ error: "invalid key" }, 400, corsHeaders(env, request));
      const id = env.ROOMS.idFromName(key);
      const stub = env.ROOMS.get(id);
      return stub.fetch(new Request(new URL(`/snapshot`, request.url), { headers: request.headers }));
    }
    if (url.pathname.startsWith("/ws/")) {
      const key = url.pathname.split("/")[2];
      if (!validateKeyFormat(key)) return new Response("invalid key", { status: 400 });
      const id = env.ROOMS.idFromName(key);
      const stub = env.ROOMS.get(id);
      const wsUrl = new URL(`/ws${url.search}`, request.url);
      return stub.fetch(new Request(wsUrl, request));
    }

    return new Response("Not found", { status: 404 });
  }
};

async function createSession(request, env, ctx) {
  // Basic abuse protections: require JSON, custom header, and allowed origin
  if (request.headers.get("content-type")?.includes("application/json") !== true) {
    return json({ error: "invalid content-type" }, 415, corsHeaders(env, request));
  }
  if (request.headers.get("X-Requested-With") !== "editor") {
    return json({ error: "forbidden" }, 403, corsHeaders(env, request));
  }

  // Optional: Turnstile verification
  const secret = env.TURNSTILE_SECRET_KEY || "";
  if (secret) {
    const { turnstileToken } = await safeJson(request);
    if (!turnstileToken) return json({ error: "turnstile required" }, 400, corsHeaders(env, request));
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", turnstileToken);
    const tsRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const tsJson = await tsRes.json().catch(() => ({}));
    if (!tsJson.success) {
      return json({ error: "turnstile failed" }, 403, corsHeaders(env, request));
    }
  }

  // Rate limiting per IP (ephemeral; simple token bucket per hour)
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucketKey = `create:${ip}:${new Date().getUTCHours()}`;
  const limit = Number(env.CREATE_LIMIT_PER_HOUR || 20);
  const current = (await env.ROOMS_STORAGE?.get?.(bucketKey)) || 0; // placeholder if binding existed; we'll fallback to DO local

  // Generate key and create/activate room in DO
  const key = generateReadableKey();
  const hostToken = generateHostToken();
  const id = env.ROOMS.idFromName(key);
  const stub = env.ROOMS.get(id);
  const initReq = new Request(new URL("/init", request.url), {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ key, hostToken, ip })
  });
  const initRes = await stub.fetch(initReq);
  if (!initRes.ok) {
    return json({ error: "failed to init" }, 500, corsHeaders(env, request));
  }

  const reqOrigin = request.headers.get("Origin") || new URL(request.url).origin;
  const viewerUrl = `${reqOrigin}/?share=${key}`;
  const ttlSeconds = Number(env.ROOM_TTL_SECONDS || 3600);
  return json({ key, hostToken, viewerUrl, ttlSeconds }, 200, corsHeaders(env, request));
}

async function stopSession(request, env, ctx) {
  const { key, hostToken } = await safeJson(request);
  if (!validateKeyFormat(key)) return json({ error: "invalid key" }, 400, corsHeaders(env, request));
  const id = env.ROOMS.idFromName(key);
  const stub = env.ROOMS.get(id);
  return stub.fetch(new Request(new URL("/stop", request.url), { method: "POST", headers: request.headers, body: JSON.stringify({ hostToken }) }));
} 