interface Env {
  MEDIA: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MEDIA_SIGNING_SECRET: string;
  R2_MEDIA_CLEANUP_SECRET: string;
}

const ALLOWED_BUCKETS = new Set(["avatars", "media"]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/webp"]);
const MAX_CLEANUP_PATHS = 200;
const TOKEN_TTL_SECONDS = 60 * 60;
const MAX_MEDIA_EDGE_CACHE_TTL_SECONDS = 5 * 60;

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface MediaObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

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

function constantTimeEqual(received: string, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
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

async function validTokenExpiry(path: string, token: string, env: Env): Promise<number | null> {
  const [expiresText, signatureText] = token.split(".");
  const expires = Number(expiresText);
  if (!expires || expires <= Math.floor(Date.now() / 1000) || !signatureText) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    fromBase64Url(signatureText),
    new TextEncoder().encode(`${path}:${expires}`),
  );
  return valid ? expires : null;
}

function decodeR2Path(value: string): string | null {
  if (!value.startsWith("r2:")) return null;
  const path = value.slice(3);
  const parts = path.split("/");
  if (parts.length !== 3 || !ALLOWED_BUCKETS.has(parts[0] ?? "")) return null;
  if (!parts[1] || !parts[2] || parts.some((part) => part.includes(".."))) return null;
  return path;
}

function mediaCacheKey(request: Request, markedPath: string): Request {
  const url = new URL(request.url);
  url.pathname = "/media";
  url.search = "";
  url.searchParams.set("path", markedPath);
  return new Request(url.toString(), { method: "GET" });
}

function responseFromObject(object: MediaObjectBody, ttlSeconds: number): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Content-Length")) headers.set("Content-Length", String(object.size));
  headers.set(
    "Cache-Control",
    ttlSeconds > 0 ? `public, max-age=${ttlSeconds}` : "private, no-store",
  );
  headers.delete("Set-Cookie");
  headers.delete("Vary");
  headers.delete("Access-Control-Allow-Origin");
  return new Response(object.body, { headers });
}

function clientMediaResponse(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(origin);
  for (const name of [
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Origin",
    "Vary",
  ]) {
    const value = cors.get(name);
    if (value) headers.set(name, value);
    else headers.delete(name);
  }
  // The Worker cache stores a separate public response; browsers must not retain private media.
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function deleteExpiredMedia(request: Request, env: Env): Promise<Response> {
  const expectedSecret = env.R2_MEDIA_CLEANUP_SECRET;
  if (!expectedSecret) return json({ error: "Cleanup is not configured" }, 503);
  const authorization = request.headers.get("Authorization") ?? "";
  const suppliedSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!constantTimeEqual(suppliedSecret, expectedSecret)) return unauthorized(null);

  let body: { paths?: unknown };
  try {
    body = (await request.json()) as { paths?: unknown };
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (
    !Array.isArray(body.paths) ||
    body.paths.length === 0 ||
    body.paths.length > MAX_CLEANUP_PATHS
  ) {
    return json({ error: "Invalid media path list" }, 400);
  }

  if (body.paths.some((value) => typeof value !== "string")) {
    return json({ error: "Invalid media path list" }, 400);
  }
  const paths = [...new Set(body.paths as string[])];
  const objectKeys = paths.map((value) => decodeR2Path(value));
  if (objectKeys.some((path) => !path?.startsWith("media/"))) {
    return json({ error: "Invalid media path list" }, 400);
  }

  await env.MEDIA.delete(objectKeys as string[]);
  // Cache API deletion is local to this data center; the five-minute TTL is the global fallback.
  await Promise.all(
    paths.map(async (markedPath) => {
      try {
        await caches.default.delete(mediaCacheKey(request, markedPath));
      } catch {
        // Deletion from the current edge is best-effort; entries expire within five minutes.
      }
    }),
  );
  return json({ deleted: objectKeys.length });
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

async function handle(
  request: Request,
  env: Env,
  context: WorkerExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (url.pathname === "/health" && request.method === "GET")
    return json({ ok: true, bucket: "mku-pulse-media" }, 200, origin);
  if (url.pathname === "/internal/delete-media" && request.method === "POST") {
    return deleteExpiredMedia(request, env);
  }

  if (url.pathname === "/upload" && request.method === "POST") {
    const userId = await authenticate(request, env);
    if (!userId) return unauthorized(origin);
    const form = await request.formData();
    const bucket = form.get("bucket");
    const file = form.get("file");
    if (
      typeof bucket !== "string" ||
      !ALLOWED_BUCKETS.has(bucket) ||
      !file ||
      typeof file !== "object" ||
      typeof (file as File).arrayBuffer !== "function"
    ) {
      return json({ error: "Invalid upload" }, 400, origin);
    }
    const uploadFile = file as File;
    if (!uploadFile.size || uploadFile.size > MAX_UPLOAD_BYTES)
      return json({ error: "File is too large" }, 413, origin);
    if (
      bucket === "avatars" &&
      (uploadFile.size > MAX_AVATAR_BYTES || !ALLOWED_AVATAR_TYPES.has(uploadFile.type))
    ) {
      return json({ error: "Avatars must be JPEG or WebP and no larger than 512 KB" }, 413, origin);
    }
    const key = `${bucket}/${userId}/${crypto.randomUUID()}.${extensionFor(uploadFile)}`;
    await env.MEDIA.put(key, await uploadFile.arrayBuffer(), {
      httpMetadata: {
        contentType: uploadFile.type || "application/octet-stream",
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
    const tokenExpiry = path ? await validTokenExpiry(markedPath, token, env) : null;
    if (!path || !tokenExpiry) return json({ error: "Invalid media URL" }, 401, origin);

    const hasRange = request.headers.has("Range");
    const key = mediaCacheKey(request, markedPath);
    if (!hasRange) {
      try {
        const cached = await caches.default.match(key);
        if (cached) return clientMediaResponse(cached, origin);
      } catch {
        // R2 remains the source of truth if an edge-cache lookup fails.
      }
    }

    const object = await env.MEDIA.get(path);
    if (!object) return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
    const remainingTokenSeconds = tokenExpiry - Math.floor(Date.now() / 1000);
    const ttlSeconds = hasRange
      ? 0
      : Math.max(0, Math.min(MAX_MEDIA_EDGE_CACHE_TTL_SECONDS, remainingTokenSeconds));
    const storedResponse = responseFromObject(object, ttlSeconds);
    if (ttlSeconds > 0 && object.size <= MAX_UPLOAD_BYTES) {
      context.waitUntil(
        caches.default.put(key, storedResponse.clone()).catch(() => {
          // Cache writes are best-effort and must not interrupt media delivery.
        }),
      );
    }
    return clientMediaResponse(storedResponse, origin);
  }

  if (url.pathname === "/media" && request.method === "DELETE") {
    const userId = await authenticate(request, env);
    if (!userId) return unauthorized(origin);
    const markedPath = url.searchParams.get("path") ?? "";
    const path = decodeR2Path(markedPath);
    if (!path || path.split("/")[1] !== userId) return json({ error: "Invalid path" }, 400, origin);
    await env.MEDIA.delete(path);
    // Cache API deletion is local to this data center; the five-minute TTL is the global fallback.
    try {
      await caches.default.delete(mediaCacheKey(request, markedPath));
    } catch {
      // Deletion from the current edge is best-effort; entries expire within five minutes.
    }
    return json({ ok: true }, 200, origin);
  }

  return json({ error: "Not found" }, 404, origin);
}

export default {
  fetch(request: Request, env: Env, context: WorkerExecutionContext) {
    return handle(request, env, context);
  },
};
