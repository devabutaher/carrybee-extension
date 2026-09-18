/**
 * Utility functions.
 */

/** Promise-based sleep. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Poll a predicate function until it returns truthy or timeout.
 * Supports AbortController for cancellation.
 */
export function waitFor<T>(
  predicate: () => T | null | false | 0,
  {
    interval = 150,
    timeout = 3000,
    signal,
  }: { interval?: number; timeout?: number; signal?: AbortSignal } = {}
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const start = Date.now();
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timerId) clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    function tick() {
      if (signal?.aborted) {
        signal.removeEventListener('abort', onAbort);
        return reject(new DOMException('Aborted', 'AbortError'));
      }

      let val: T | null | false | 0;
      try {
        val = predicate();
      } catch {
        val = null;
      }
      if (val) {
        if (timerId) clearTimeout(timerId);
        signal?.removeEventListener('abort', onAbort);
        return resolve(val);
      }
      if (Date.now() - start >= timeout) {
        if (timerId) clearTimeout(timerId);
        signal?.removeEventListener('abort', onAbort);
        return resolve(null);
      }
      timerId = setTimeout(tick, interval);
    }

    tick();
  });
}

/**
 * Escape HTML entities to prevent XSS.
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
