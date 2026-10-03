/**
 * Firebase Cloud Messaging HTTP v1 sender.
 * Server-only: reads the service account from FIREBASE_SERVICE_ACCOUNT_JSON and
 * mints an OAuth access token with Web Crypto (Workers-compatible, no node SDK).
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface FcmErrorDetail {
  "@type"?: string;
  errorCode?: string;
  fieldViolations?: Array<{ field?: string; description?: string }>;
}

function isStaleFcmTokenError(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      error?: { status?: string; message?: string; details?: FcmErrorDetail[] };
    };
    const error = parsed.error;
    if (!error) return false;
    if (error.status === "UNREGISTERED") return true;

    const details = error.details ?? [];
    const fcmError = details.find((detail) => detail["@type"]?.endsWith("FcmError"));
    if (fcmError?.errorCode === "UNREGISTERED") return true;
    if (fcmError?.errorCode !== "INVALID_ARGUMENT") return false;

    const tokenViolation = details
      .flatMap((detail) => detail.fieldViolations ?? [])
      .some((violation) =>
        /token/i.test(`${violation.field ?? ""} ${violation.description ?? ""}`),
      );
    return tokenViolation || /registration token/i.test(error.message ?? "");
  } catch {
    return false;
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  url?: string;
  kind?: string;
  ttlSeconds?: number;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function readServiceAccount(): ServiceAccount {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  const parsed = JSON.parse(raw) as ServiceAccount;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields");
  }
  return parsed;
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(account.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Firebase auth failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/**
 * Sends one FCM message per token. Returns the tokens FCM rejected as
 * unregistered/invalid so the caller can prune them.
 */
export async function sendFcmToTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<{ sent: number; staleTokens: string[] }> {
  if (tokens.length === 0) return { sent: 0, staleTokens: [] };
  const ttlSeconds =
    payload.ttlSeconds === undefined
      ? undefined
      : Number.isFinite(payload.ttlSeconds)
        ? Math.min(2_419_200, Math.floor(payload.ttlSeconds))
        : 0;
  if (ttlSeconds !== undefined && ttlSeconds <= 0) return { sent: 0, staleTokens: [] };
  const account = readServiceAccount();
  const accessToken = await getAccessToken(account);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const url = payload.url ?? "/notifications";
  const appOrigin = process.env["PUBLIC_APP_URL"] ?? "https://mku-pulse.vercel.app";
  const appBase = new URL(appOrigin);
  const requestedLink = new URL(url, appBase);
  const clickPath =
    requestedLink.origin === appBase.origin
      ? `${requestedLink.pathname}${requestedLink.search}${requestedLink.hash}`
      : "/notifications";
  const clickLink = new URL(clickPath, appBase.origin).toString();
  const eventId = requestedLink.searchParams.get("notification_event");
  const notificationTag = `mku-pulse-${eventId ?? `${payload.kind ?? "general"}-${Date.now()}`}`;

  const staleTokens: string[] = [];
  let sent = 0;

  await Promise.all(
    tokens.map(async (token) => {
      const message = {
        message: {
          token,
          // `notification` makes Android render it while the APK is backgrounded.
          notification: { title: payload.title, body: payload.body },
          data: { title: payload.title, body: payload.body, url, kind: payload.kind ?? "general" },
          android: {
            ...(ttlSeconds !== undefined ? { ttl: `${ttlSeconds}s` } : {}),
            priority: "HIGH",
            notification: {
              channel_id: "campus_connect",
              tag: notificationTag,
              default_sound: true,
              default_vibrate_timings: true,
            },
          },
          webpush: {
            ...(ttlSeconds !== undefined ? { headers: { TTL: String(ttlSeconds) } } : {}),
            notification: {
              title: payload.title,
              body: payload.body,
              icon: "/icons/icon-192.png",
              badge: "/icons/icon-192.png",
              tag: notificationTag,
              renotify: false,
              vibrate: [180, 80, 180],
            },
            fcm_options: { link: clickLink },
          },
        },
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (res.ok) {
        sent += 1;
        return;
      }
      const text = await res.text();
      if (isStaleFcmTokenError(text)) staleTokens.push(token);
      console.error("FCM send failed", res.status, text.slice(0, 300));
    }),
  );

  return { sent, staleTokens };
}
