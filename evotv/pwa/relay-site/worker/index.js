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
    if (source?.expiresAt <= Date.now() || !["http:", "https:"].includes(new URL(source.target).protocol)
      || `${source.id}.${source.extension}` !== file) {
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
    const headers = new Headers({ "user-agent": "VLC/3.0.23 LibVLC/3.0.23", "accept-encoding": "identity" });
    for (const name of ["range", "if-range", "accept"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    let upstream;
    try {
      upstream = await fetch(source.target, { method: request.method, headers, redirect: "follow" });
    } catch (reason) {
      console.error("relay_stage=provider", reason instanceof Error ? reason.name : "UnknownError");
      return error(502, "IPTV_UPSTREAM_UNREACHABLE", "O relay não conseguiu abrir a conexão com o servidor IPTV.", origin);
    }
    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel();
      return error(502, "IPTV_UPSTREAM_FAILED", `O provedor recusou a mídia (HTTP ${upstream.status}).`, origin);
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: mediaHeaders(upstream, origin),
    });
  },
};
