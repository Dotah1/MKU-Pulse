import { supabase } from "@/integrations/supabase/client";

type CacheEntry = { url: string; expires: number };
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string | null>>();
const SIGNED_URL_STORAGE_PREFIX = "mku-pulse:signed-media:v1:";
const MAX_PERSISTED_SIGNED_URLS = 100;
const MAX_IMAGE_EDGE = 1200;
const IMAGE_QUALITY = 0.8;
const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
const R2_MEDIA_WORKER_URL = (
  import.meta.env.VITE_R2_MEDIA_WORKER_URL as string | undefined
)?.replace(/\/$/, "");
let authGeneration = 0;

function isR2Path(path: string) {
  return path.startsWith("r2:");
}

async function getAuthorizationHeader() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  return accessToken ? `Bearer ${accessToken}` : null;
}

function storageKey(key: string) {
  return `${SIGNED_URL_STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

function readPersistedUrl(key: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  const itemKey = storageKey(key);
  try {
    const raw = window.localStorage.getItem(itemKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CacheEntry>;
    if (typeof value.url !== "string" || typeof value.expires !== "number") {
      window.localStorage.removeItem(itemKey);
      return null;
    }
    if (value.expires <= Date.now()) {
      window.localStorage.removeItem(itemKey);
      return null;
    }
    return { url: value.url, expires: value.expires };
  } catch {
    return null;
  }
}

function persistUrl(key: string, entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    const itemKey = storageKey(key);
    const entries: { key: string; expires: number }[] = [];
    const existingKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const existingKey of existingKeys) {
      if (!existingKey?.startsWith(SIGNED_URL_STORAGE_PREFIX)) continue;
      try {
        const value = JSON.parse(storage.getItem(existingKey) ?? "null") as Partial<CacheEntry>;
        if (typeof value.expires !== "number" || value.expires <= Date.now()) {
          storage.removeItem(existingKey);
        } else {
          entries.push({ key: existingKey, expires: value.expires });
        }
      } catch {
        storage.removeItem(existingKey);
      }
    }
    if (!storage.getItem(itemKey) && entries.length >= MAX_PERSISTED_SIGNED_URLS) {
      entries.sort((left, right) => left.expires - right.expires);
      while (entries.length >= MAX_PERSISTED_SIGNED_URLS) {
        const oldest = entries.shift();
        if (oldest) storage.removeItem(oldest.key);
      }
    }
    storage.setItem(itemKey, JSON.stringify(entry));
  } catch {
    // Storage may be disabled or full; the in-memory cache remains available.
  }
}

function clearSignedUrlCache() {
  authGeneration += 1;
  cache.clear();
  pending.clear();
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SIGNED_URL_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Ignore unavailable browser storage.
  }
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") clearSignedUrlCache();
  });
}

/** Resolve a private-bucket object path into a temporary signed URL. */
export async function getSignedUrl(
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  if (hit) cache.delete(key);

  const persisted = readPersistedUrl(key);
  if (persisted) {
    cache.set(key, persisted);
    return persisted.url;
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const generation = authGeneration;
  const request = (async () => {
    try {
      if (isR2Path(path) && R2_MEDIA_WORKER_URL) {
        const authorization = await getAuthorizationHeader();
        if (!authorization) return null;
        const response = await fetch(
          `${R2_MEDIA_WORKER_URL}/sign?path=${encodeURIComponent(path)}`,
          { headers: { Authorization: authorization } },
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { url?: string; expiresIn?: number };
        if (!payload.url || generation !== authGeneration) return null;
        const lifetime = Math.max(60, Math.min(payload.expiresIn ?? 3600, 3600));
        const entry = { url: payload.url, expires: Date.now() + (lifetime - 60) * 1000 };
        cache.set(key, entry);
        persistUrl(key, entry);
        return entry.url;
      }

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 6);
      if (error || !data?.signedUrl || generation !== authGeneration) return null;
      const entry = { url: data.signedUrl, expires: Date.now() + 60 * 60 * 5 * 1000 };
      cache.set(key, entry);
      persistUrl(key, entry);
      return entry.url;
    } catch {
      return null;
    }
  })();
  pending.set(key, request);
  void request.finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  return request;
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resize a browser image to at most 1200x1200 and encode it as WebP (or JPEG
 * when WebP encoding is unavailable) at quality 0.8.
 */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Images must be 50MB or smaller before compression");
  }

  let source: CanvasImageSource;
  let width: number;
  let height: number;
  let cleanup = () => {};

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      cleanup = () => bitmap.close();
    } catch {
      // Fall through to the image-element decoder for browsers that cannot
      // create a bitmap for a format their <img> element can still display.
      const image = await decodeImageElement(file);
      source = image.source;
      width = image.width;
      height = image.height;
      cleanup = image.cleanup;
    }
  } else {
    const image = await decodeImageElement(file);
    source = image.source;
    width = image.width;
    height = image.height;
    cleanup = image.cleanup;
  }

  try {
    if (!width || !height) throw new Error("Could not read image dimensions");
    const scale = Math.min(1, MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process images");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const webp = await canvasBlob(canvas, "image/webp", IMAGE_QUALITY);
    let blob = webp?.type === "image/webp" ? webp : null;
    if (!blob) {
      // JPEG has no alpha channel; place transparent pixels on white rather
      // than letting browsers turn them black during encoding.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = "source-over";
      const jpeg = await canvasBlob(canvas, "image/jpeg", IMAGE_QUALITY);
      if (jpeg?.type !== "image/jpeg") throw new Error("Could not compress this image");
      blob = jpeg;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], `${baseName}.${extension}`, {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } finally {
    cleanup();
  }
}

function decodeImageElement(
  file: File,
): Promise<{ source: HTMLImageElement; width: number; height: number; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image"));
    };
    image.src = url;
  });
}

export async function uploadFile(
  bucket: string,
  userId: string,
  file: File,
  options: { alreadyCompressed?: boolean } = {},
): Promise<string> {
  const upload =
    file.type.startsWith("image/") && !options.alreadyCompressed
      ? await compressImageFile(file)
      : file;
  const contentTypeExtension: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const ext =
    contentTypeExtension[upload.type] ?? upload.name.split(".").pop()?.toLowerCase() ?? "bin";
  if (R2_MEDIA_WORKER_URL) {
    try {
      const authorization = await getAuthorizationHeader();
      if (authorization) {
        const form = new FormData();
        form.set("bucket", bucket);
        form.set("file", new File([upload], `upload.${ext}`, { type: upload.type }));
        const response = await fetch(`${R2_MEDIA_WORKER_URL}/upload`, {
          method: "POST",
          headers: { Authorization: authorization },
          body: form,
        });
        if (response.ok) {
          const payload = (await response.json()) as { path?: string };
          if (payload.path?.startsWith("r2:")) return payload.path;
        }
      }
    } catch {
      // R2 is an optional acceleration path during rollout; retain Supabase fallback.
    }
  }

  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, upload, {
    cacheControl: "3600",
    upsert: false,
    ...(upload.type ? { contentType: upload.type } : {}),
  });
  if (error) throw error;
  return path;
}

export function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      el.load();
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const duration = el.duration;
      cleanup();
      resolve(duration);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error("Could not read video"));
    };
    el.src = url;
  });
}

const VIDEO_MAX_EDGE = 720;
const VIDEO_BITRATE = 1_200_000;

/**
 * Re-encode a short video on-device to at most 720p at ~1.2 Mbps using the
 * browser's MediaRecorder. Falls back to the original file when the browser
 * cannot record or when the result would not be smaller.
 */
export async function compressVideoFile(file: File, maxSeconds: number): Promise<File> {
  if (typeof MediaRecorder === "undefined" || typeof document === "undefined") return file;
  const mime = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) return file;

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.preload = "auto";
  let audioContext: AudioContext | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Could not read video"));
    });
    const scale = Math.min(
      1,
      VIDEO_MAX_EDGE / video.videoWidth,
      VIDEO_MAX_EDGE / video.videoHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
    canvas.height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof canvas.captureStream !== "function") return file;
    const stream = canvas.captureStream(30);

    try {
      audioContext = new AudioContext();
      const source = audioContext.createMediaElementSource(video);
      const dest = audioContext.createMediaStreamDestination();
      source.connect(dest);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
      await audioContext.resume();
    } catch {
      video.muted = true;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    let raf = 0;
    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (video.currentTime >= maxSeconds && recorder.state === "recording") recorder.stop();
      if (recorder.state === "recording") raf = requestAnimationFrame(draw);
    };
    video.onended = () => {
      if (recorder.state === "recording") recorder.stop();
    };
    try {
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }
    recorder.start(1000);
    draw();
    await stopped;
    cancelAnimationFrame(raf);
    video.pause();
    stream.getTracks().forEach((track) => track.stop());

    const type = mime.split(";")[0] ?? "video/webm";
    const blob = new Blob(chunks, { type });
    if (!blob.size || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
    return new File([blob], `${baseName}.${type === "video/mp4" ? "mp4" : "webm"}`, {
      type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    void audioContext?.close().catch(() => {});
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
