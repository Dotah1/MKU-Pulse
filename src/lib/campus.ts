export const ADMIN_EMAIL = "odhiambochrishani@gmail.com";

export type Tier = "free" | "mid" | "full";

export type Gender = "male" | "female";

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/** Profile pictures must stay under 5MB. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** Feed uploads must stay under 25MB. */
export const POST_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
/** Feed videos play for at most 60 seconds. */
export const POST_VIDEO_MAX_SECONDS = 60;
export const YEAR_OPTIONS = ["1", "2", "3", "4", "5", "6"];

export interface Profile {
  id: string;
  full_name: string;
  year_of_study: number;
  major: string;
  avatar_url: string | null;
  bio: string;
  interests: string[];
  gender: Gender | null;
  tier: Tier;
  tier_expires_at: string | null;
  pending_tier: Tier | null;
  is_banned: boolean;
  post_block_until: string | null;
  notifications_enabled: boolean;
  is_private: boolean;
  created_at: string;
}

export interface TierLimits {
  label: string;
  symbol: string;
  postsPerDay: number;
  canPostImage: boolean;
  canPostVideo: boolean;
  videosPerDay: number;
  swipesPerDay: number;
  superLikesPerDay: number;
  canChatMatches: boolean;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    label: "Campus Citizen",
    symbol: "●",
    postsPerDay: 2,
    canPostImage: true,
    canPostVideo: false,
    videosPerDay: 0,
    swipesPerDay: 25,
    superLikesPerDay: 0,
    canChatMatches: true,
  },
  mid: {
    label: "Campus Socialite",
    symbol: "⚡",
    postsPerDay: 5,
    canPostImage: true,
    canPostVideo: true,
    videosPerDay: 1,
    swipesPerDay: 100,
    superLikesPerDay: 1,
    canChatMatches: true,
  },
  full: {
    label: "Campus VIP",
    symbol: "♛",
    postsPerDay: 10,
    canPostImage: true,
    canPostVideo: true,
    videosPerDay: 5,
    swipesPerDay: 250,
    superLikesPerDay: 5,
    canChatMatches: true,
  },
};

export const GMAIL_RE = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;
export const PHONE_RE = /^\+254\d{9}$/;
export const PASSWORD_RE =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-[\]\\/'`~+=;])[\S]{8,}$/;

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "At least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Add one uppercase letter";
  if (!/\d/.test(pw)) return "Add one number";
  if (!/[!@#$%^&*(),.?":{}|<>_\-[\]\\/'`~+=;]/.test(pw)) return "Add one special character";
  return null;
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

export function effectiveTier(
  profile: Pick<Profile, "tier" | "tier_expires_at"> | null,
  freeAccessMode: boolean,
): Tier {
  // Free Access Mode lifts free members to the Mid plan; anyone who paid keeps
  // the plan they bought.
  const paid =
    profile && profile.tier !== "free" && !isExpired(profile.tier_expires_at) ? profile.tier : null;
  if (paid) return paid;
  if (freeAccessMode) return "mid";
  return "free";
}

export function daysLeft(expiresAt: string | null): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function sanitizeText(input: string, max: number): string {
  return input
    .replace(/<[^>]*>/g, "")
    .slice(0, max)
    .trimEnd();
}

export function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export const INTEREST_OPTIONS = [
  "Music",
  "Football",
  "Coding",
  "Art",
  "Business",
  "Gaming",
  "Reading",
  "Fitness",
  "Travel",
  "Photography",
  "Debate",
  "Faith",
  "Dance",
  "Movies",
  "Volunteering",
];
