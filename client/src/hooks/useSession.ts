import { useState, useCallback } from 'react';

function generateId(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const storageKey = 'honkai-chat-session';

export function useSession() {
  const [sessionId] = useState<string>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const id = generateId();
    localStorage.setItem(storageKey, id);
    return id;
  });

  const clearSession = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, []);

  return { sessionId, clearSession };
}
