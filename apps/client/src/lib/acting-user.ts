/**
 * TEMPORARY — the client half of task 2.1's acting-user seam. Removed at 3.13,
 * when the session cookie supplies the identity instead.
 *
 * `apiFetch` is a plain function rather than a hook, so the selected agent
 * lives in module state that the switcher writes and the fetcher reads. That is
 * deliberately the *only* coupling: when the seam goes away, this file is
 * deleted and `apiFetch` loses three lines.
 */

const STORAGE_KEY = 'support.actingUserId';
export const ACTING_USER_HEADER = 'x-acting-user';

/** Survives a reload so the queue does not silently change who you are acting as. */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing and similar. Falling back to the server's default agent
    // is fine; failing to render the queue over it is not.
    return null;
  }
}

let actingUserId: string | null = readStored();

const listeners = new Set<() => void>();

export function getActingUserId(): string | null {
  return actingUserId;
}

export function setActingUserId(id: string | null): void {
  actingUserId = id;
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal; the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` contract, so the switcher re-renders on change. */
export function subscribeToActingUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
