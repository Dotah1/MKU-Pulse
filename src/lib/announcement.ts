const ANNOUNCEMENT_EXPIRY_PARAM = "pulse_expires";
const ANNOUNCEMENT_IMAGE_PARAM = "pulse_image";
const URL_BASE = "https://mku-pulse.invalid";

export interface AnnouncementMetadata {
  expiresAt: number | null;
  imagePath: string | null;
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
      !rawImage.startsWith("/") &&
      !rawImage.includes("..") &&
      !rawImage.includes(":")
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
