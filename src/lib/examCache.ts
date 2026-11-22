// Lightweight IndexedDB cache for student exam questions & offline answer queue
// Stores ONLY non-secret question text and student answers (never auth tokens or answer keys).

const DB_NAME = 'mkc_cbt_exam_cache';
const STORE_NAME = 'exam_state';
const DB_VERSION = 1;

export interface CachedExamLocalState {
  cacheKey: string; // `exam_${examId}_student_${studentId}`
  sessionId: number;
  examId: number;
  title: string;
  durationMinutes: number;
  maxViolations: number;
  questions: any[];
  answers: Record<number, unknown>;
  pendingAnswerIds: number[];
  pendingViolations: Array<{ type: string; detail: string; timestamp: string }>;
  updatedAt: number;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadExamLocalState(cacheKey: string): Promise<CachedExamLocalState | null> {
  try {
    const db = await openCacheDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve((req.result as CachedExamLocalState) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveExamLocalState(state: CachedExamLocalState): Promise<void> {
  try {
    const db = await openCacheDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(state);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback silent ignore if IndexedDB disabled
  }
}

export async function clearExamLocalState(cacheKey: string): Promise<void> {
  try {
    const db = await openCacheDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}
