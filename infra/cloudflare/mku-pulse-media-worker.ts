interface Env {
  MEDIA: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MEDIA_SIGNING_SECRET: string;
}

const ALLOWED_BUCKETS = new Set(["avatars", "media"]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const TOKEN_TTL_SECONDS = 60 * 60;

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (
    origin === "https://mku-pulse.vercel.app" ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin ?? "") ||
    origin === "http://localhost:5173"
  ) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function unauthorized(origin: string | null): Response {
  return json({ error: "Unauthorized" }, 401, origin);
}

async function authenticate(request: Request, env: Env): Promise<string | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authorization,
    },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: string };
  return user.id ?? null;
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function signingKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.MEDIA_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createToken(path: string, env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${path}:${expires}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(env),
    new TextEncoder().encode(payload),
  );
  return `${expires}.${toBase64Url(signature)}`;
}

async function validToken(path: string, token: string, env: Env): Promise<boolean> {
  const [expiresText, signatureText] = token.split(".");
  const expires = Number(expiresText);
  if (!expires || expires < Math.floor(Date.now() / 1000) || !signatureText) return false;
  return crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    fromBase64Url(signatureText),
    new TextEncoder().encode(`${path}:${expires}`),
  );
}

function decodeR2Path(value: string): string | null {
  if (!value.startsWith("r2:")) return null;
  const path = value.slice(3);
  const parts = path.split("/");
  if (parts.length !== 3 || !ALLOWED_BUCKETS.has(parts[0] ?? "")) return null;
  if (!parts[1] || !parts[2] || parts.some((part) => part.includes(".."))) return null;
  return path;
}

function extensionFor(file: File): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return extensions[file.type] ?? file.name.split(".").pop()?.toLowerCase() ?? "bin";
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (url.pathname === "/health" && request.method === "GET")
    return json({ ok: true, bucket: "mku-pulse-media" }, 200, origin);

  if (url.pathname === "/upload" && request.method === "POST") {
    const userId = await authenticate(request, env);
    if (!userId) return unauthorized(origin);
    const form = await request.formData();
    const bucket = form.get("bucket");
    const file = form.get("file");
    if (typeof bucket !== "string" || !ALLOWED_BUCKETS.has(bucket) || !(file instanceof File)) {
      return json({ error: "Invalid upload" }, 400, origin);
    }
    if (!file.size || file.size > MAX_UPLOAD_BYTES)
      return json({ error: "File is too large" }, 413, origin);
    const key = `${bucket}/${userId}/${crypto.randomUUID()}.${extensionFor(file)}`;
    await env.MEDIA.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "private, max-age=3600",
      },
      customMetadata: { ownerId: userId, bucket },
    });
    return json({ path: `r2:${key}` }, 201, origin);
  }

  if (url.pathname === "/sign" && request.method === "GET") {
    const userId = await authenticate(request, env);
    if (!userId) return unauthorized(origin);
    const markedPath = url.searchParams.get("path") ?? "";
    const path = decodeR2Path(markedPath);
    if (!path) return json({ error: "Invalid path" }, 400, origin);
    const object = await env.MEDIA.head(path);
    if (!object) return json({ error: "Not found" }, 404, origin);
    const token = await createToken(markedPath, env);
    const mediaUrl = new URL(request.url);
    mediaUrl.pathname = "/media";
    mediaUrl.search = "";
    mediaUrl.searchParams.set("path", markedPath);
    mediaUrl.searchParams.set("token", token);
    return json({ url: mediaUrl.toString(), expiresIn: TOKEN_TTL_SECONDS }, 200, origin);
  }

  if (url.pathname === "/media" && request.method === "GET") {
    const markedPath = url.searchParams.get("path") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const path = decodeR2Path(markedPath);
    if (!path || !(await validToken(markedPath, token, env)))
      return json({ error: "Invalid media URL" }, 401, origin);
    const object = await env.MEDIA.get(path);
    if (!object) return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
    const headers = new Headers(corsHeaders(origin));
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "private, max-age=3600");
    return new Response(object.body, { headers });
  }

  if (url.pathname === "/media" && request.method === "DELETE") {
    const userId = await authenticate(request, env);
    if (!userId) return unauthorized(origin);
    const markedPath = url.searchParams.get("path") ?? "";
    const path = decodeR2Path(markedPath);
    if (!path || !path.split("/")[1]?.startsWith(userId))
      return json({ error: "Invalid path" }, 400, origin);
    await env.MEDIA.delete(path);
    return json({ ok: true }, 200, origin);
  }

  return json({ error: "Not found" }, 404, origin);
}

export default { fetch: handle };
