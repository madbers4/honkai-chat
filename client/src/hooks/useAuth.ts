import { useMemo } from 'react';
import type { Role } from '../types';

export interface AuthResult {
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** The auth param to append to WS URL (e.g. "token=abc" or "key=xyz") */
  authParam: string | null;
}

const authStorageKey = 'honkai-chat-auth';

/**
 * Reads auth credentials from URL search params.
 *
 * - `/guest?token=<guestToken>` → regular guest. `token` is stripped from URL immediately.
 * - `/guest?key=<testGuestKey>` → test guest. `key` stays in URL.
 * - `/actor?key=<actorKey>` → actor. `key` stays in URL.
 *
 * The credential is persisted in sessionStorage so it survives
 * React StrictMode remounts (where the URL param is already stripped).
 */
export function useAuth(role: Role): AuthResult {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const key = params.get('key');

    if (role === 'actor') {
      if (key) {
        return { authenticated: true, authParam: `key=${encodeURIComponent(key)}` };
      }
      return { authenticated: false, authParam: null };
    }

    // role === 'guest'
    if (key) {
      // Test guest — key stays in URL
      return { authenticated: true, authParam: `key=${encodeURIComponent(key)}` };
    }

    if (token) {
      // Regular guest — strip token from URL, persist in sessionStorage
      sessionStorage.setItem(authStorageKey, token);

      params.delete('token');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState(null, '', newUrl);

      return { authenticated: true, authParam: `token=${encodeURIComponent(token)}` };
    }

    // No URL params — check sessionStorage (survives StrictMode remount + page refreshes within session)
    const stored = sessionStorage.getItem(authStorageKey);
    if (stored) {
      return { authenticated: true, authParam: `token=${encodeURIComponent(stored)}` };
    }

    return { authenticated: false, authParam: null };
  }, []); // Run once on mount — URL params are read-once
}
