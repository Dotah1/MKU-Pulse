import { supabase } from "@/integrations/supabase/client";
import type { MiniProfile } from "@/lib/campus-data";

export const CONNECT_DECK_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ConnectDeckSnapshot {
  cachedAt: number;
  deck: MiniProfile[];
  cursor: string | null;
  hasMore: boolean;
  seenProfileIds: string[];
  queuedProfileIds: string[];
  pendingSwipeIds: string[];
  swipesToday: number;
  superToday: number;
  quotaDay: string;
  quotaFetchedAt: number;
}

const connectDeckCache = new Map<string, ConnectDeckSnapshot>();
let activeCacheUserId: string | null = null;
let hasObservedAuthState = false;

function setActiveCacheUser(userId: string | null) {
  hasObservedAuthState = true;
  if (activeCacheUserId === userId) return;
  activeCacheUserId = userId;
  connectDeckCache.clear();
}

function canUseCacheForUser(userId: string) {
  if (!hasObservedAuthState && activeCacheUserId === null) activeCacheUserId = userId;
  return activeCacheUserId === userId;
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    setActiveCacheUser(session?.user.id ?? null);
  });
}

function copySnapshot(snapshot: ConnectDeckSnapshot): ConnectDeckSnapshot {
  return {
    ...snapshot,
    deck: [...snapshot.deck],
    seenProfileIds: [...snapshot.seenProfileIds],
    queuedProfileIds: [...snapshot.queuedProfileIds],
    pendingSwipeIds: [...snapshot.pendingSwipeIds],
  };
}

export function getConnectDeckSnapshot(userId: string): ConnectDeckSnapshot | null {
  if (!canUseCacheForUser(userId)) return null;
  const snapshot = connectDeckCache.get(userId);
  if (!snapshot) return null;
  if (Date.now() - snapshot.cachedAt >= CONNECT_DECK_CACHE_TTL_MS) {
    connectDeckCache.delete(userId);
    return null;
  }
  return copySnapshot(snapshot);
}

export function saveConnectDeckSnapshot(userId: string, snapshot: ConnectDeckSnapshot) {
  if (!canUseCacheForUser(userId)) return;
  connectDeckCache.set(userId, copySnapshot(snapshot));
}

export function updateConnectDeckSnapshot(
  userId: string,
  update: (snapshot: ConnectDeckSnapshot) => ConnectDeckSnapshot,
): boolean {
  const snapshot = getConnectDeckSnapshot(userId);
  if (!snapshot) return false;
  saveConnectDeckSnapshot(userId, update(snapshot));
  return true;
}
