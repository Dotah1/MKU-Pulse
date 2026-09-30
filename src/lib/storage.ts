import { supabase } from "@/integrations/supabase/client";

type CacheEntry = { url: string; expires: number };
const cache = new Map<string, CacheEntry>();
const MAX_IMAGE_EDGE = 1200;
const IMAGE_QUALITY = 0.8;
const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;

/** Resolve a private-bucket object path into a temporary signed URL. */
export async function getSignedUrl(
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 6);
  if (error || !data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, expires: Date.now() + 60 * 60 * 5 * 1000 });
  return data.signedUrl;
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
