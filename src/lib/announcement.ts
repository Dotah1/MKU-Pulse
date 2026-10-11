const ANNOUNCEMENT_EXPIRY_PARAM = "pulse_expires";
const ANNOUNCEMENT_IMAGE_PARAM = "pulse_image";
const URL_BASE = "https://mku-pulse.invalid";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IMAGE_NAME = "[a-z0-9][a-z0-9._-]*";
const LEGACY_IMAGE_PATH = new RegExp(`^${UUID}/${IMAGE_NAME}$`, "i");
const R2_IMAGE_PATH = new RegExp(`^r2:media/${UUID}/${IMAGE_NAME}$`, "i");

export interface AnnouncementMetadata {
  expiresAt: number | null;
  imagePath: string | null;
}

export function isOwnedAnnouncementImagePath(path: string, userId: string): boolean {
  if (path.length > 512 || path.includes("..") || path.includes("\\")) return false;
  if (LEGACY_IMAGE_PATH.test(path)) return path.startsWith(`${userId}/`);
  return R2_IMAGE_PATH.test(path) && path.startsWith(`r2:media/${userId}/`);
}

export function createAnnouncementUrl(imagePath: string | null, expiresAt: number): string {
  const url = new URL("/feed", URL_BASE);
  url.searchParams.set(ANNOUNCEMENT_EXPIRY_PARAM, String(expiresAt));
  if (imagePath) url.searchParams.set(ANNOUNCEMENT_IMAGE_PARAM, imagePath);
  return `${url.pathname}${url.search}`;
}

export function getAnnouncementMetadata(url: string | null): AnnouncementMetadata {
  if (!url) return { expiresAt: null, imagePath: null };

  try {
    const parsed = new URL(url, URL_BASE);
    const rawExpiry = parsed.searchParams.get(ANNOUNCEMENT_EXPIRY_PARAM);
    const parsedExpiry = rawExpiry ? Number(rawExpiry) : Number.NaN;
    const rawImage = parsed.searchParams.get(ANNOUNCEMENT_IMAGE_PARAM);
    const imagePath =
      rawImage &&
      rawImage.length <= 512 &&
      !rawImage.includes("..") &&
      (LEGACY_IMAGE_PATH.test(rawImage) || R2_IMAGE_PATH.test(rawImage))
        ? rawImage
        : null;

    return {
      expiresAt: Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? parsedExpiry : null,
      imagePath,
    };
  } catch {
    return { expiresAt: null, imagePath: null };
  }
}

export function isAnnouncementExpired(url: string | null, now = Date.now()): boolean {
  const { expiresAt } = getAnnouncementMetadata(url);
  return expiresAt !== null && expiresAt <= now;
}
