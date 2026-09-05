/**
 * Signing up requires email confirmation, so there is no session yet when the
 * user picks their profile picture. We keep the chosen file in the browser and
 * upload it automatically the first time they have a session, so nobody is
 * asked for the photo twice.
 */
const DB_NAME = "campus-connect";
const STORE = "pending-avatar";
const KEY = "avatar";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePendingAvatar(file: File): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await tx("readwrite", (s) =>
      s.put({ blob: file, name: file.name, type: file.type }, KEY) as IDBRequest<IDBValidKey>,
    );
  } catch {
    /* storing the photo locally is best-effort */
  }
}

export async function takePendingAvatar(): Promise<File | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const row = await tx<{ blob: Blob; name: string; type: string } | undefined>("readonly", (s) =>
      s.get(KEY),
    );
    if (!row?.blob) return null;
    return new File([row.blob], row.name || "avatar.jpg", {
      type: row.type || row.blob.type || "image/jpeg",
    });
  } catch {
    return null;
  }
}

export async function clearPendingAvatar(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await tx("readwrite", (s) => s.delete(KEY) as IDBRequest<undefined>);
  } catch {
    /* ignore */
  }
}
