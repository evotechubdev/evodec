const ALLOWED_ORIGIN = "https://evotechubdev.github.io";
const SESSION_HEADERS = [
  "x-evo-session",
  "x-evo-profile",
  "x-evo-platform",
  "x-evo-version",
  "x-evo-version-code",
];

function corsHeaders(origin) {
  const headers = new Headers({
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, If-Range, Accept, X-Evo-Session, X-Evo-Profile, X-Evo-Platform, X-Evo-Version, X-Evo-Version-Code",
    "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
    "cache-control": "private, no-store",
    vary: "Origin",
  });
  if (origin === ALLOWED_ORIGIN) headers.set("access-control-allow-origin", origin);
  return headers;
}

function base64Bytes(value, url = false) {
  let input = String(value || "");
  if (url) input = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(input);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64Bytes(value, true)));
}

function error(status, code, message, origin) {
  return Response.json({ code, error: message }, { status, headers: corsHeaders(origin) });
}

async function decryptSource(packed, privateKey) {
  const envelope = decodeJson(packed);
  if (envelope?.version !== 1) throw new Error("invalid envelope");
  const rsa = await crypto.subtle.importKey(
    "pkcs8",
    base64Bytes(privateKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, rsa, base64Bytes(envelope.key, true));
  const aes = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const ciphertext = base64Bytes(envelope.data, true);
  const tag = base64Bytes(envelope.tag, true);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Bytes(envelope.iv, true), tagLength: 128 },
    aes,
    combined,
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mediaHeaders(upstream, origin) {
  const headers = corsHeaders(origin);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function openProvider(target, request, headers, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  };
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || response.status === 416 || request.method === "HEAD") {
      cleanup();
      return { response, body: null, firstBytes: 0 };
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("missing media body");
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) {
      await reader.cancel().catch(() => {});
      throw new Error("empty media body");
    }
    clearTimeout(timer);
    const body = new ReadableStream({
      start(stream) { stream.enqueue(first.value); },
      async pull(stream) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanup();
            stream.close();
          } else stream.enqueue(chunk.value);
        } catch (reason) {
          cleanup();
          stream.error(reason);
        }
      },
      async cancel(reason) {
        cleanup();
        await reader.cancel(reason).catch(() => {});
      },
    });
    return { response, body, firstBytes: first.value.byteLength };
  } catch (reason) {
    cleanup();
    throw reason;
  }
}

function providerAccountUrl(target) {
  try {
    const url = new URL(target);
    const match = /\/(?:live|movie|series)\/([^/]+)\/([^/]+)\/[^/]+$/.exec(url.pathname);
    if (!match) return null;
    const basePath = url.pathname.slice(0, match.index).replace(/\/$/, "");
    const account = new URL(`${basePath}/player_api.php`, url.origin);
    account.searchParams.set("username", decodeURIComponent(match[1]));
    account.searchParams.set("password", decodeURIComponent(match[2]));
    return account.href;
  } catch {
    return null;
  }
}

async function authorizeProvider(target, request, userAgent) {
  const accountUrl = providerAccountUrl(target);
  if (!accountUrl) return 0;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 6_500);
  try {
    const response = await fetch(accountUrl, {
      headers: { "user-agent": userAgent, "accept-encoding": "identity", accept: "application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => {});
    return response.status;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      let backendStatus = 0;
      try {
        const backend = await fetch(`${String(env.AUTH_BACKEND_URL).replace(/\/$/, "")}/health`, {
          headers: { accept: "application/json" },
          redirect: "follow",
        });
        backendStatus = backend.status;
        await backend.body?.cancel();
      } catch {
        // The public health response exposes only reachability, never URLs or credentials.
      }
      return Response.json(
        { ok: true, service: "evotv-web-media-relay", backendReachable: backendStatus >= 200 && backendStatus < 500, backendStatus },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const origin = request.headers.get("origin");
    if (origin !== ALLOWED_ORIGIN) return error(403, "ORIGIN_FORBIDDEN", "Origem não autorizada.", null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (!["GET", "HEAD"].includes(request.method)) return error(405, "METHOD_NOT_ALLOWED", "Método não permitido.", origin);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "stream") return error(404, "NOT_FOUND", "Rota não encontrada.", origin);
    const [, ticket, packed, file] = parts;
    const validationHeaders = new Headers({ accept: "application/json" });
    for (const name of SESSION_HEADERS) {
      const value = request.headers.get(name);
      if (!value) return error(401, "SESSION_REQUIRED", "Abra a mídia pelo perfil ativo no EVOTV.", origin);
      validationHeaders.set(name, value);
    }
    let source;
    try {
      source = await decryptSource(packed, env.WEB_RELAY_PRIVATE_KEY);
    } catch (reason) {
      console.error("relay_stage=decrypt", reason instanceof Error ? reason.name : "UnknownError");
      return error(502, "RELAY_DECRYPT_FAILED", "O relay não conseguiu validar a autorização criptografada da mídia.", origin);
    }
    const sourceTargets = [...new Set(
      (Array.isArray(source?.targets) ? source.targets : [source?.target])
        .filter((target) => typeof target === "string")
        .slice(0, 4),
    )];
    let validTargets = sourceTargets.length > 0;
    try {
      validTargets = validTargets && sourceTargets.every((target) => ["http:", "https:"].includes(new URL(target).protocol));
    } catch { validTargets = false; }
    if (source?.expiresAt <= Date.now() || !validTargets || `${source.id}.${source.extension}` !== file) {
      return error(401, "STREAM_TICKET_INVALID", "A autorização do vídeo expirou. Abra a mídia novamente.", origin);
    }
    const relayHash = await digest(packed);
    const validationUrl = `${String(env.AUTH_BACKEND_URL).replace(/\/$/, "")}/api/web-stream/${encodeURIComponent(ticket)}/validate?relay=${encodeURIComponent(relayHash)}`;
    let validation;
    try {
      validation = await fetch(validationUrl, { headers: validationHeaders, redirect: "follow" });
    } catch (reason) {
      console.error("relay_stage=backend", reason instanceof Error ? reason.name : "UnknownError");
      return error(502, "AUTH_BACKEND_UNREACHABLE", "O relay não conseguiu validar a sessão no backend.", origin);
    }
    if (validation.status !== 204) {
      const body = await validation.text();
      const headers = corsHeaders(origin);
      headers.set("content-type", validation.headers.get("content-type") || "application/json; charset=utf-8");
      return new Response(body, { status: validation.status, headers });
    }
    const vlc21 = "VLC/3.0.21 LibVLC/3.0.21";
    const vlc23 = "VLC/3.0.23 LibVLC/3.0.23";
    const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
    let upstream;
    let upstreamBody;
    let providerError;
    let attemptCount = 0;
    try {
      const providerAuthStatus = await authorizeProvider(source.target, request, vlc21);
      console.log("relay_stage=provider_auth", `status=${providerAuthStatus || 0}`);
    } catch (reason) {
      console.warn("relay_stage=provider_auth_failed", reason instanceof Error ? reason.name : "UnknownError");
    }
    const incomingRange = request.headers.get("range");
    const attempts = source.kind === "live"
      ? [
        { userAgent: vlc21, range: incomingRange || "bytes=0-" },
        { userAgent: vlc21, range: incomingRange },
        { userAgent: vlc23, range: incomingRange || "bytes=0-" },
        { userAgent: browser, range: incomingRange },
      ]
      : [
        { userAgent: vlc23, range: incomingRange },
        { userAgent: vlc21, range: incomingRange },
        { userAgent: browser, range: incomingRange },
      ];
    const deadline = Date.now() + 22_000;
    playback: for (const attempt of attempts) {
      for (let targetIndex = 0; targetIndex < sourceTargets.length; targetIndex++) {
        const remaining = deadline - Date.now();
        if (remaining < 750) break playback;
        attemptCount++;
        const headers = new Headers({ "user-agent": attempt.userAgent, "accept-encoding": "identity", accept: "*/*" });
        if (attempt.range) headers.set("range", attempt.range);
        const ifRange = request.headers.get("if-range");
        if (ifRange) headers.set("if-range", ifRange);
        if (source.kind === "live") headers.set("icy-metadata", "1");
        try {
          const opened = await openProvider(sourceTargets[targetIndex], request, headers, Math.min(6_500, remaining));
          const response = opened.response;
          if (response.ok && response.status !== 416 && (request.method === "HEAD" || opened.firstBytes > 0)) {
            upstream = response;
            upstreamBody = opened.body;
            console.log("relay_stage=provider_open", `target=${targetIndex + 1}/${sourceTargets.length} attempt=${attemptCount} status=${response.status} bytes=${opened.firstBytes} type=${response.headers.get("content-type") || "unknown"}`);
            break playback;
          }
          providerError = response.status;
          await response.body?.cancel();
        } catch (reason) {
          console.warn("relay_stage=provider_timeout", `target=${targetIndex + 1}/${sourceTargets.length} attempt=${attemptCount} error=${reason instanceof Error ? reason.name : "UnknownError"}`);
        }
      }
    }
    if (!upstream) {
      console.warn("relay_stage=provider_denied", `status=${providerError || 0} targets=${sourceTargets.length} attempts=${attemptCount}`);
      if (providerError) return error(502, "IPTV_UPSTREAM_FAILED", `O provedor recusou a mídia (HTTP ${providerError}).`, origin);
      return error(502, "IPTV_UPSTREAM_UNREACHABLE", "O relay não conseguiu abrir a conexão com o servidor IPTV.", origin);
    }
    return new Response(request.method === "HEAD" ? null : upstreamBody, {
      status: upstream.status,
      headers: mediaHeaders(upstream, origin),
    });
  },
};
