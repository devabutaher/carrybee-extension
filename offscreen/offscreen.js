// Read the clipboard on behalf of the background service worker.
//
// navigator.clipboard.readText() requires the calling document to be
// OS-focused — the offscreen document is never OS-focused, so that throws.
// Primary approach (same as Chrome's official offscreen-clipboard sample):
// focus a hidden textarea and run document.execCommand('paste'), which
// works in extension documents with the clipboardRead permission.
// navigator.clipboard.readText() stays as a fallback.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'CE_REQUEST_CLIPBOARD') {
    (async () => {
      let text = '';
      let ok = false;
      let error = '';
      let method = '';

      // ── Primary: textarea + execCommand('paste') ──
      try {
        const ta = document.getElementById('pasteArea');
        ta.value = '';
        ta.focus();
        if (document.execCommand('paste')) {
          text = ta.value;
          ok = true;
          method = 'execCommand';
        } else {
          error = 'execCommand("paste") returned false';
        }
      } catch (e) {
        error = String((e && e.message) || e);
      }

      // ── Fallback: Clipboard API (works only if Chrome treats this doc
      // as focused — rare, but keep it as a backup) ──
      if (!ok || !text) {
        try {
          const clip = await navigator.clipboard.readText();
          text = clip || '';
          ok = true;
          method = 'clipboard API';
          error = '';
        } catch (e) {
          error = error || String((e && e.message) || e);
        }
      }

      console.debug(
        '[CE offscreen] read:', { ok, method, error, length: text.length }
      );
      sendResponse({ ok, text, error });
    })();
    return true; // async response
  }
});
