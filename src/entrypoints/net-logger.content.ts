/**
 * COD v3 Phase 0 — network evidence LOGGER (observation only).
 *
 * Runs in the page's MAIN world so it sees the real `fetch` and
 * `XMLHttpRequest` calls made by the CarryBee React app. It does NOT change
 * any behavior: every completed request is (a) printed to the DevTools
 * console and (b) appended to `window.__CB_NET` so the endpoint list can be
 * copied in one line.
 *
 * Usage for the capture:
 *   1. Load the extension, refresh the CarryBee tab, open DevTools console
 *   2. Click PRINT on one parcel manually
 *   3. Click SORT on that parcel manually
 *   4. Send the "[Carrybee/Net]" console lines (or `copy(window.__CB_NET)`)
 */

export default defineContentScript({
  matches: [
    "*://hive.carrybee.com/order-processing/*",
    "*://hive.carrybee.com/sub-sort/*",
  ],
  // document_start is REQUIRED: the hook must be in place before the app's
  // first requests (initial data load) fire.
  runAt: "document_start",
  world: "MAIN",
  main() {
    const LOG = "[Carrybee/Net]";
    const buffer: Array<{ at: number; method: string; url: string; status: number }> =
      (window as unknown as { __CB_NET?: typeof buffer }).__CB_NET ?? [];
    (window as unknown as { __CB_NET: typeof buffer }).__CB_NET = buffer;

    // Keep only the last 300 requests so the array stays copyable.
    function log(method: string, url: string, status: number): void {
      buffer.push({ at: Date.now(), method, url, status });
      if (buffer.length > 300) buffer.shift();
      console.log(LOG, method, url, "→", status);
    }

    // ---- fetch hook ----
    const origFetch = window.fetch.bind(window);
    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      let method = "GET";
      let url = "";
      try {
        if (typeof input === "string") {
          url = input;
          method = (init?.method ?? "GET").toUpperCase();
        } else if (input instanceof URL) {
          url = input.href;
          method = (init?.method ?? "GET").toUpperCase();
        } else {
          url = input.url;
          method = (init?.method ?? input.method ?? "GET").toUpperCase();
        }
      } catch {
        /* never break the app over logging */
      }
      try {
        const res = await origFetch(input, init);
        log(method, url, res.status);
        return res;
      } catch (err) {
        log(method, url, 0);
        throw err;
      }
    };

    // ---- XHR hook ----
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __cbInfo?: { method: string; url: string } },
      method: string,
      url: string,
      ...rest: unknown[]
    ) {
      this.__cbInfo = { method: String(method).toUpperCase(), url: String(url) };
      // Element type differs per TS DOM lib version — cast through unknown.
      return (origOpen as unknown as (...args: unknown[]) => void).apply(
        this,
        [method, url, ...rest] as unknown as unknown[],
      ) as void;
    };

    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __cbInfo?: { method: string; url: string } },
      ...args: unknown[]
    ) {
      this.addEventListener("loadend", () => {
        const info = this.__cbInfo;
        if (info) log(info.method, info.url, this.status);
      });
      return (origSend as unknown as (...args: unknown[]) => void).apply(
        this,
        args as unknown as unknown[],
      ) as void;
    };

    console.log(
      LOG,
      "logger attached — print + sort one parcel manually, then copy the lines above (or run copy(window.__CB_NET))",
    );
  },
});
