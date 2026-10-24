const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range, If-Range, Accept",
  "access-control-expose-headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  "cache-control": "private, no-store",
};

function base64Bytes(value, url = false) {
  let input = String(value || "");
  if (url) input = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(input);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64Bytes(value, true)));
}

function error(status, code, message) {
  return Response.json({ code, error: message }, { status, headers: CORS });
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

function mediaHeaders(upstream) {
  const headers = new Headers(CORS);
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!["GET", "HEAD"].includes(request.method)) return error(405, "METHOD_NOT_ALLOWED", "Método não permitido.");
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "evotv-web-media-relay" }, { headers: CORS });
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 4 || parts[0] !== "stream") return error(404, "NOT_FOUND", "Rota não encontrada.");
    const [, ticket, packed, file] = parts;
    try {
      const source = await decryptSource(packed, env.WEB_RELAY_PRIVATE_KEY);
      if (source?.expiresAt <= Date.now() || !["http:", "https:"].includes(new URL(source.target).protocol)
        || `${source.id}.${source.extension}` !== file) {
        return error(401, "STREAM_TICKET_INVALID", "A autorização do vídeo expirou. Abra a mídia novamente.");
      }
      const relayHash = await digest(packed);
      const validationUrl = `${String(env.AUTH_BACKEND_URL).replace(/\/$/, "")}/api/web-stream/${encodeURIComponent(ticket)}/validate?relay=${encodeURIComponent(relayHash)}`;
      const validation = await fetch(validationUrl, { headers: { accept: "application/json" } });
      if (validation.status !== 204) {
        const body = await validation.text();
        const headers = new Headers(CORS); headers.set("content-type", validation.headers.get("content-type") || "application/json; charset=utf-8");
        return new Response(body, { status: validation.status, headers });
      }
      const headers = new Headers({ "user-agent": "VLC/3.0.23 LibVLC/3.0.23", "accept-encoding": "identity" });
      for (const name of ["range", "if-range", "accept"]) {
        const value = request.headers.get(name); if (value) headers.set(name, value);
      }
      const upstream = await fetch(source.target, { method: request.method, headers, redirect: "follow" });
      if (!upstream.ok && upstream.status !== 206) {
        await upstream.body?.cancel();
        return error(502, "IPTV_UPSTREAM_FAILED", `O provedor recusou a mídia (HTTP ${upstream.status}).`);
      }
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: mediaHeaders(upstream) });
    } catch {
      return error(502, "IPTV_UPSTREAM_UNREACHABLE", "O relay não conseguiu abrir a conexão com o servidor IPTV.");
    }
  },
};
