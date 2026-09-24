/**
 * CarryBee Order Processing Auto-Flow — Content Script
 *
 * Injects into hive.carrybee.com/order-processing/* pages.
 * Provides 4 automated processing modes.
 */

import type {
  AutomationState,
  Mode,
  PrintThenSortResult,
  Settings,
} from "~/types";
import { DEFAULT_SETTINGS } from "~/types";
import { sleep, waitFor } from "~/utils/helpers";
import {
  SEL,
  clearInputCache,
  findActionButton,
  findWeightIcon,
  findWeightNumberInput,
  getBusinessName,
  getConsignmentIdFromRow,
  getRows,
} from "~/utils/selectors";

function getSettingsFromBackground(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CB_GET_SETTINGS" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve(DEFAULT_SETTINGS);
      } else {
        resolve(response);
      }
    });
  });
}

const pendingBatchConsignments: { id: string; name: string }[] = [];

function addConsignmentToBackground(
  business: string,
  consignmentId: string,
): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "CB_ADD_CONSIGNMENT",
        business,
        consignmentId,
        timestamp: Date.now(),
      },
      () => {
        chrome.runtime
          .sendMessage({
            type: "CB_CONSIGNMENT_ADDED",
            businessName: business,
            consignmentId,
          })
          .catch(() => {});
        resolve();
      },
    );
  });
}

function checkDailyResetFromBackground(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "CB_CHECK_DAILY_RESET" }, (response) => {
      resolve(response?.reset ?? false);
    });
  });
}

export default defineContentScript({
  matches: [
    "*://hive.carrybee.com/order-processing/*",
    "*://hive.carrybee.com/sub-sort/*",
  ],
  runAt: "document_idle",
  main() {
    // ============ CONFIGURATION ============

    const CFG = {
      debounceMs: 200,
      rowPollIntervalMs: 50,
      rowStableMs: 200,
      rowPollHardMaxMs: 1000,
      weightInputWaitMs: 2000,
      weightToastTimeoutMs: 3000,
      printToastTimeoutMs: 12000,
      sortPollMs: 500,
      sortGraceTimeoutMs: 3000,
      sortDeadlineMs: 20000,
      badgeDisplayMs: 3000,
      mismatchBadgeMs: 2000,
      phoneSettleMs: 400,
      phoneSettleMaxMs: 2000,
      phoneEnterRememberMs: 1500,
    };

    // ============ STATE ============

    let enabled = false;
    let mode: Mode | null = null;
    let state: AutomationState = "IDLE";
    let settings: Settings = DEFAULT_SETTINGS;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cycleToken = 0;
    let codQuantityCounter = 0;
    let codQuantityTarget = 0;
    let lastToastAt = 0;
    let lastToastEvents: Array<{ text: string; at: number }> = [];
    let currentBusinessName: string | null = null;
    let confirmResolve: (() => void) | null = null;
    let confirmKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
    let currentAbortController: AbortController | null = null;
    let pendingSortConsignmentId: string | null = null;
    let lastClickedRowId: string | null = null;
    let lastEnterAt = 0;

    // ============ BADGE ELEMENTS ============

    let badgeOuterEl: HTMLDivElement | null = null;
    let badgeEl: HTMLDivElement | null = null;
    let badgeContainerEl: HTMLDivElement | null = null;
    let codProgressBadgeOuterEl: HTMLDivElement | null = null;
    let codProgressBadgeEl: HTMLDivElement | null = null;
    let codQuantityInputEl: HTMLInputElement | null = null;
    let codStopButtonEl: HTMLButtonElement | null = null;

    // ============ PER-CYCLE CACHE ============

    let cachedRows: Element[] | null = null;
    let cachedBusinessName: string | null = null;

    function clearCycleCache(): void {
      cachedRows = null;
      cachedBusinessName = null;
    }

    function getRowsCached(): Element[] {
      if (cachedRows) return cachedRows;
      cachedRows = getRows();
      return cachedRows;
    }

    // ============ BADGE FUNCTIONS ============

    function badgeContainer(): HTMLDivElement {
      if (badgeContainerEl && document.body.contains(badgeContainerEl))
        return badgeContainerEl;
      badgeContainerEl = document.createElement("div");
      badgeContainerEl.id = "cb-badge-container";
      document.body.appendChild(badgeContainerEl);
      return badgeContainerEl;
    }

    function badge(): HTMLDivElement {
      if (badgeEl && document.body.contains(badgeEl)) return badgeEl;
      badgeOuterEl = document.createElement("div");
      badgeOuterEl.id = "cb-auto-badge-outer";
      badgeEl = document.createElement("div");
      badgeEl.id = "cb-auto-badge";
      badgeOuterEl.appendChild(badgeEl);
      badgeContainer().appendChild(badgeOuterEl);
      return badgeEl;
    }

    function codProgressBadge(): HTMLDivElement {
      if (codProgressBadgeEl && document.body.contains(codProgressBadgeEl))
        return codProgressBadgeEl;
      codProgressBadgeOuterEl = document.createElement("div");
      codProgressBadgeOuterEl.id = "cb-cod-progress-badge-outer";
      codProgressBadgeEl = document.createElement("div");
      codProgressBadgeEl.id = "cb-cod-progress-badge";
      codProgressBadgeOuterEl.appendChild(codProgressBadgeEl);
      document.body.appendChild(codProgressBadgeOuterEl);
      return codProgressBadgeEl;
    }

    function hideBadge(): void {
      if (badgeOuterEl) badgeOuterEl.style.display = "none";
    }

    function setStatus(text: string, modeClass?: string): void {
      if (!enabled) return;
      if (!settings.showMainBadge) return;
      const el = badge();
      if (badgeOuterEl) badgeOuterEl.style.display = "";
      el.textContent = text;
      el.setAttribute("data-mode", modeClass || "info");
    }

    function setCodProgress(text: string | null): void {
      if (!text || !enabled || !settings.showProgressBadge) {
        if (codProgressBadgeOuterEl)
          codProgressBadgeOuterEl.style.display = "none";
        return;
      }
      const el = codProgressBadge();
      const outer = codProgressBadgeOuterEl;
      if (!outer) return;
      outer.style.display = "block";
      el.textContent = text;
    }

    function showCodQuantityInput(): void {
      const input = createCodQuantityInput();
      if (!input) return;
      wireCodQuantityInput();
      const container = input.parentElement;
      if (container) container.style.display = "flex";
      if (codStopButtonEl) codStopButtonEl.style.display = "none";
      input.value = "";
      setStatus("Ready — COD Quantity", "info");
    }

    function hideCodQuantityInput(): void {
      if (codQuantityInputEl && codQuantityInputEl.parentElement) {
        codQuantityInputEl.parentElement.style.display = "none";
      }
      if (codStopButtonEl) {
        codStopButtonEl.style.display = "none";
      }
      if (codQuantityInputEl) {
        codQuantityInputEl.value = "";
      }
    }

    function showIdleStatus(): void {
      if (!enabled) {
        hideBadge();
        hideCodQuantityInput();
      } else if (mode === "merchant") {
        setStatus("Ready — Merchant Order ID", "info");
        hideCodQuantityInput();
      } else if (mode === "phone") {
        setStatus("Ready — Customer Phone", "info");
        hideCodQuantityInput();
      } else if (mode === "consignment") {
        setStatus("Ready — Consignment ID", "info");
        hideCodQuantityInput();
      } else if (mode === "cod") {
        showCodQuantityInput();
      }
    }

    // ============ TOAST WATCHER ============

    const toastTextByNode = new WeakMap<Element, string>();
    let toastDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    function recordToast(text: string): void {
      if (!text) return;
      lastToastEvents.push({ text, at: Date.now() });
      if (lastToastEvents.length > 50) lastToastEvents.shift();
      lastToastAt = Date.now();
    }

    const isPrintSentToast = (t: string): boolean =>
      t.includes("sending to printer") || t.includes("pdf generated");
    const isSortToast = (t: string): boolean =>
      t.includes("sorted") && !t.includes("unsorted");
    const isWeightToast = (t: string): boolean => t.includes("weight");

    function processToasts(): void {
      const toasts = Array.from(document.querySelectorAll(SEL.toast));
      for (const t of toasts) {
        const text = (t.textContent || "").trim();
        if (!text) continue;
        if (toastTextByNode.get(t) === text) continue;
        toastTextByNode.set(t, text);
        recordToast(text);

        if (isSortToast(text.toLowerCase())) {
          if (
            enabled &&
            mode &&
            state !== "PRINTING" &&
            state !== "SORTING"
          ) {
            handleManualSortCompletion();
          }
          if (lastClickedRowId && (state === "IDLE" || !enabled)) {
            const businessName = getBusinessName();
            if (businessName) addConsignmentId(lastClickedRowId, businessName);
            lastClickedRowId = null;
          }
        }
      }
    }

    async function handleManualSortCompletion(): Promise<void> {
      if (pendingSortConsignmentId && currentBusinessName) {
        await addConsignmentId(pendingSortConsignmentId, currentBusinessName);
      }
      pendingSortConsignmentId = null;
      state = "IDLE";

      // Resume auto-flow if input has a value
      const inputConfigs: Record<
        string,
        { getInput: () => HTMLInputElement | null; requireConfirm: boolean }
      > = {
        consignment: { getInput: SEL.consignmentInput, requireConfirm: false },
        phone: { getInput: SEL.phoneInput, requireConfirm: true },
        merchant: { getInput: SEL.merchantOrderInput, requireConfirm: false },
      };
      const cfg = inputConfigs[mode || ""];
      if (cfg) {
        const input = cfg.getInput();
        if (input && input.value.trim() && enabled) {
          onSearchInputChanged(mode!, cfg.getInput, cfg.requireConfirm);
          return;
        }
      }

      refocusCurrentInput();
      showIdleStatus();
    }

    function waitForToastSince(
      matchFn: (text: string) => boolean,
      sinceMark: number,
      timeout: number,
    ): Promise<string | null> {
      return waitFor(
        () => {
          const ev = lastToastEvents.find(
            (e) => e.at > sinceMark && matchFn(e.text.toLowerCase()),
          );
          return ev ? ev.text : null;
        },
        { interval: 100, timeout },
      );
    }

    // ============ MERGED DOM OBSERVER ============

    let inputRemountDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    function watchDom(): void {
      const observer = new MutationObserver((mutations) => {
        let hasToast = false;
        let hasInputCandidate = false;

        for (const m of mutations) {
          if (hasToast && hasInputCandidate) break;
          // Text updates inside existing toast nodes (characterData mutations)
          if (!hasToast && m.type === "characterData") hasToast = true;
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            if (
              !hasToast &&
              (el.matches?.(SEL.toast) || el.querySelector?.(SEL.toast))
            )
              hasToast = true;
            if (!hasInputCandidate && el.querySelector?.("input[placeholder]"))
              hasInputCandidate = true;
          }
        }

        if (hasToast) {
          if (toastDebounceTimer) clearTimeout(toastDebounceTimer);
          toastDebounceTimer = setTimeout(processToasts, 50);
        }
        if (hasInputCandidate) {
          clearInputCache();
          if (inputRemountDebounceTimer)
            clearTimeout(inputRemountDebounceTimer);
          inputRemountDebounceTimer = setTimeout(attachInputListeners, 100);
        }
      });
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    // ============ STORAGE: Daily Reset + Consignment Tracking ============

    async function addConsignmentId(
      consignmentId: string,
      businessName: string,
      batch = false,
    ): Promise<void> {
      if (batch) {
        pendingBatchConsignments.push({
          id: consignmentId,
          name: businessName,
        });
        return;
      }

      await addConsignmentToBackground(businessName, consignmentId);
    }

    async function flushBatchConsignments(): Promise<void> {
      if (!pendingBatchConsignments.length) return;
      const batch = pendingBatchConsignments.splice(0);

      for (const { id: consignmentId, name: businessName } of batch) {
        await addConsignmentToBackground(businessName, consignmentId);
      }

      chrome.runtime
        .sendMessage({ type: "CB_CONSIGNMENT_ADDED" })
        .catch(() => {});
    }

    // ============ COD QUANTITY INPUT ============

    function createCodQuantityInput(): HTMLInputElement | null {
      const codInput = SEL.codInput();
      if (!codInput || !codInput.parentElement) return null;

      if (codQuantityInputEl && document.body.contains(codQuantityInputEl)) {
        return codQuantityInputEl;
      }

      if (!enabled || mode !== "cod") return null;

      const container = document.createElement("div");
      container.id = "cb-cod-quantity-container";
      container.innerHTML = `
        <input
          type="number"
          id="cb-cod-quantity-input"
          placeholder="Qty"
          min="1"
          max="200"
          value=""
        />
        <button id="cb-cod-quantity-btn">
          <span>Process</span>
          <span class="btn-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </span>
        </button>
        <button id="cb-cod-stop-btn" style="display:none;">Stop</button>
      `;

      const parent = codInput.parentElement;
      codInput.after(container);

      parent.style.display = "flex";
      parent.style.alignItems = "center";
      parent.style.gap = "8px";
      codInput.style.flex = "1";
      codInput.style.minWidth = "0";

      codQuantityInputEl = container.querySelector(
        "#cb-cod-quantity-input",
      ) as HTMLInputElement;
      codStopButtonEl = container.querySelector(
        "#cb-cod-stop-btn",
      ) as HTMLButtonElement;

      wireCodQuantityInput();
      return codQuantityInputEl;
    }

    function wireCodQuantityInput(): void {
      const container = document.querySelector("#cb-cod-quantity-container");
      const input = container
        ? (container.querySelector(
            "#cb-cod-quantity-input",
          ) as HTMLInputElement)
        : null;
      if (!container || !input || (container as HTMLElement).dataset.cbWired)
        return;
      (container as HTMLElement).dataset.cbWired = "1";

      function processQty(): void {
        const qty = parseInt(input!.value, 10);
        if (isNaN(qty) || qty < 1) {
          setStatus("Min quantity is 1", "error");
          input!.value = "";
          input!.focus();
          return;
        }
        if (qty > 200) {
          setStatus("Max quantity is 200", "error");
          input!.value = "";
          input!.focus();
          return;
        }
        startCodBatch(qty);
      }

      container.addEventListener("click", (e) => {
        if (!e.target || !(e.target as Element).closest) return;
        if ((e.target as Element).closest("#cb-cod-quantity-btn")) {
          processQty();
        } else if ((e.target as Element).closest("#cb-cod-stop-btn")) {
          stopCodBatch();
        }
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") processQty();
      });
    }

    // ============ MODE MANAGEMENT ============

    function setMode(newMode: Mode): void {
      mode = newMode;
      showIdleStatus();
    }

    /** User-initiated off (popup toggle / shortcut toggle): stop flows and hide UI. */
    function userDisable(): void {
      enabled = false;
      cycleToken++;
      state = "IDLE";
      confirmResolve = null;
      confirmKeydownHandler = null;
      setCodProgress(null);
      hideCodQuantityInput();
      showIdleStatus();
    }

    // ============ ABORT CONTROLLER ============

    function createAbortController(): AbortSignal {
      currentAbortController?.abort();
      currentAbortController = new AbortController();
      return currentAbortController.signal;
    }

    // ============ ERROR HANDLING HELPER ============

    async function showErrorAndWait(
      msg: string,
      ms: number,
      myToken: number,
    ): Promise<void> {
      setStatus(msg, "error");
      await sleep(ms);
      if (myToken === cycleToken) {
        state = "IDLE";
        showIdleStatus();
      }
    }

    // ============ REFOCUS HELPER ============

    function refocusCurrentInput(): void {
      if (!mode) return;
      let input: HTMLInputElement | null = null;
      if (mode === "merchant") input = SEL.merchantOrderInput();
      else if (mode === "phone") input = SEL.phoneInput();
      else if (mode === "consignment") input = SEL.consignmentInput();
      else if (mode === "cod") input = SEL.codInput();

      if (input) {
        input.focus();
        input.select();
      }
    }

    // ============ RESET STATE ============

    function resetStateForNewInput(): void {
      currentAbortController?.abort();
      currentAbortController = null;
      pendingSortConsignmentId = null;
      lastClickedRowId = null;

      const weightInput = document.querySelector(SEL.weightInput);
      if (weightInput) {
        const closeBtn =
          weightInput.parentElement?.querySelector("svg.lucide-x");
        if (closeBtn) {
          closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      }

      if (confirmKeydownHandler) {
        const input = SEL.phoneInput();
        input?.removeEventListener("keydown", confirmKeydownHandler);
        confirmKeydownHandler = null;
      }
      if (confirmResolve) {
        const r = confirmResolve;
        confirmResolve = null;
        r();
      }
      if (state !== "IDLE") {
        cycleToken++;
        state = "IDLE";
      }
      showIdleStatus();
    }

    // ============ PRINT + SORT HELPER ============

    async function printThenSort(
      row: Element,
      myToken: number,
    ): Promise<PrintThenSortResult> {
      state = "PRINTING";

      const printSinceMark = lastToastAt;
      const printBtn = findActionButton(row, "lucide-printer");
      setStatus("Printing...", "working");
      printBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const printToast = await waitForToastSince(
        isPrintSentToast,
        printSinceMark,
        CFG.printToastTimeoutMs,
      );
      if (myToken !== cycleToken) return { ok: false, reason: "stopped" };

      if (!printToast) {
        setStatus("Print failed", "error");
        await sleep(1000);
        return { ok: false, reason: "print-timeout" };
      }

      state = "SORTING";

      const sortSinceMark = lastToastAt;
      const sortBtn = findActionButton(row, "lucide-arrow-down-wide-narrow");
      setStatus("Sorting...", "working");
      sortBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      // Poll for sort completion: toast OR row removed (deadline in CFG)
      const DEADLINE = Date.now() + CFG.sortDeadlineMs;
      let sortToast: string | null = null;
      let rowRemoved = false;
      while (!sortToast && Date.now() < DEADLINE) {
        if (myToken !== cycleToken) return { ok: false, reason: "stopped" };
        sortToast = await waitForToastSince(
          isSortToast,
          sortSinceMark,
          CFG.sortPollMs,
        );
        if (sortToast) break;
        // Row removed from DOM = sorted (even without toast)
        if (!document.body.contains(row)) {
          rowRemoved = true;
          break;
        }
        // Sort button replaced by spinner = still loading, keep waiting
        const stillLoading = !findActionButton(
          row,
          "lucide-arrow-down-wide-narrow",
        );
        if (!stillLoading) break;
      }

      if (rowRemoved) return { ok: true };

      // Row still present — grace wait for toast
      if (!sortToast) {
        sortToast = await waitForToastSince(
          isSortToast,
          sortSinceMark,
          CFG.sortGraceTimeoutMs,
        );
      }

      if (!sortToast) {
        // Stuck loading — show badge, but caller tracks consignment as sorted
        setStatus("Sort failed", "error");
        await sleep(1000);
        return { ok: true, unverified: true };
      }

      return { ok: true };
    }

    // ============ CORE CYCLE ============

    async function runFullCycle(
      row: Element,
      myToken: number,
      includeWeight: boolean,
    ): Promise<void> {
      const consignmentId = getConsignmentIdFromRow(row);

      if (includeWeight) {
        state = "WEIGHT_EDIT";

        let weightInput = findWeightNumberInput(row);
        if (!weightInput) {
          const pencil = findWeightIcon(row);
          if (!pencil) {
            await showErrorAndWait("✗ Failed", 2000, myToken);
            return;
          }

          pencil.dispatchEvent(new MouseEvent("click", { bubbles: true }));

          weightInput = await waitFor(() => findWeightNumberInput(row), {
            interval: 100,
            timeout: CFG.weightInputWaitMs,
          });
          if (myToken !== cycleToken) return;
        }

        if (!weightInput) {
          await showErrorAndWait("✗ Failed", 2000, myToken);
          return;
        }

        weightInput.focus();
        weightInput.select();
        const originalWeightValue = (weightInput.value || "").trim();
        pendingSortConsignmentId = consignmentId;
        state = "WEIGHT_ENTRY";
        setStatus("Enter weight", "wait-input");

        const weightSinceMark = lastToastAt;

        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            weightInput!.removeEventListener("keydown", onKeydown);
            reject(new DOMException("Aborted", "AbortError"));
          };
          currentAbortController?.signal?.addEventListener("abort", onAbort, {
            once: true,
          });

          function onKeydown(e: KeyboardEvent) {
            if (e.key === "Enter") {
              currentAbortController?.signal?.removeEventListener(
                "abort",
                onAbort,
              );
              weightInput!.removeEventListener("keydown", onKeydown);
              resolve();
            }
          }
          weightInput!.addEventListener("keydown", onKeydown);
        });
        if (myToken !== cycleToken) return;

        const finalWeightValue = (weightInput.value || "").trim();
        const weightWasChanged = finalWeightValue !== originalWeightValue;

        if (weightWasChanged) {
          const weightToast = await waitForToastSince(
            isWeightToast,
            weightSinceMark,
            CFG.weightToastTimeoutMs,
          );
          if (myToken !== cycleToken) return;
          if (!weightToast) {
            setStatus("Weight update failed", "error");
            await sleep(1500);
            if (myToken !== cycleToken) return;
            return;
          }
        }
      }

      const result = await printThenSort(row, myToken);
      if (myToken !== cycleToken) return;

      if (!result.ok) {
        await showErrorAndWait(`✗ ${result.reason}`, 2500, myToken);
        return;
      }

      if (consignmentId) {
        await addConsignmentId(consignmentId, currentBusinessName!, false);
      }
      if (myToken !== cycleToken) return;

      if (result.unverified) {
        // "Sort failed" badge already shown — tracked as sorted, keep badge visible
        state = "IDLE";
        refocusCurrentInput();
        return;
      }

      setStatus("✓ Done", "success");
      state = "IDLE";

      refocusCurrentInput();
      showIdleStatus();
    }

    // ============ SEARCH INPUT HANDLER ============

    async function onSearchInputChanged(
      modeName: Mode,
      getInput: () => HTMLInputElement | null,
      requireConfirm = false,
    ): Promise<void> {
      if (!enabled || mode !== modeName || state !== "IDLE") return;

      const input = getInput();
      if (!input || !input.value.trim()) return;

      const myToken = ++cycleToken;
      const signal = createAbortController();
      clearCycleCache();
      state = "WAITING_ROWS";

      try {
        // Wait for exactly 1 row — stable-count (React renders rows instantly)
        let result: Element[] | null = null;
        let stableCount = -1;
        let stableSince = 0;
        const start = Date.now();
        for (;;) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          const rowsNow = getRowsCached();
          if (rowsNow.length === 1) {
            result = rowsNow;
            break;
          }
          const now = Date.now();
          if (rowsNow.length !== stableCount) {
            stableCount = rowsNow.length;
            stableSince = now;
          }
          if (
            now - stableSince >= CFG.rowStableMs ||
            now - start >= CFG.rowPollHardMaxMs
          )
            break;
          await sleep(CFG.rowPollIntervalMs);
        }

        if (myToken !== cycleToken) return;

        if (!result) {
          const rows = getRowsCached();
          if (rows.length === 0) {
            setStatus("No parcel found", "error");
          } else {
            setStatus("Multiple parcels found", "error");
          }
          await sleep(500);
          if (myToken === cycleToken) {
            state = "IDLE";
          }
          return;
        }

        // Phone mode (typed only): settle typing, validate digits, confirm with Enter
        if (requireConfirm) {
          // Settle wait — judge only after typing pauses (no false mismatch mid-type).
          // Enter during wait (or within phoneEnterRememberMs) counts as confirm intent.
          let enterPressed = Date.now() - lastEnterAt < CFG.phoneEnterRememberMs;
          const settleKeydown = (e: KeyboardEvent) => {
            if (e.key === "Enter") enterPressed = true;
          };
          input.addEventListener("keydown", settleKeydown);
          try {
            let lastVal = input.value;
            let stableAt = Date.now();
            const settleStart = Date.now();
            while (!enterPressed) {
              if (signal.aborted)
                throw new DOMException("Aborted", "AbortError");
              if (myToken !== cycleToken) return;
              const v = input.value;
              if (v !== lastVal) {
                lastVal = v;
                stableAt = Date.now();
              }
              if (
                Date.now() - stableAt >= CFG.phoneSettleMs ||
                Date.now() - settleStart >= CFG.phoneSettleMaxMs
              )
                break;
              await sleep(100);
            }
          } finally {
            input.removeEventListener("keydown", settleKeydown);
          }

          if (myToken !== cycleToken) return;

          // Validate ending digits match parcel phone (typed value, after settle)
          const row = result[0];
          const phoneDiv = row.querySelectorAll(":scope > div")[2];
          const phoneText = (phoneDiv?.textContent || "").trim();
          const typedDigits = input.value.trim().replace(/\D/g, "");

          if (typedDigits && phoneText && !phoneText.endsWith(typedDigits)) {
            setStatus("Phone number mismatch", "error");
            await sleep(CFG.mismatchBadgeMs);
            if (myToken === cycleToken) {
              state = "IDLE";
              showIdleStatus();
            }
            return;
          }

          // Enter already given (during/just before settle) + match → skip confirm pause
          if (!enterPressed) {
            state = "PHONE_CONFIRM";
            setStatus("Parcel found — press Enter", "wait-input");

            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                input.removeEventListener("keydown", confirmEnterHandler);
                reject(new DOMException("Aborted", "AbortError"));
              };
              signal.addEventListener("abort", onAbort, { once: true });

              /** Enter key = confirm selected phone row. */
              function confirmEnterHandler(e: KeyboardEvent) {
                if (e.key === "Enter") {
                  signal.removeEventListener("abort", onAbort);
                  input!.removeEventListener("keydown", confirmEnterHandler);
                  confirmKeydownHandler = null;
                  confirmResolve = null;
                  resolve();
                }
              }
              confirmResolve = resolve;
              confirmKeydownHandler = confirmEnterHandler;
              input.addEventListener("keydown", confirmEnterHandler);
            });

            if (myToken !== cycleToken) return;
          }
        }

        currentBusinessName = getBusinessName();
        await runFullCycle(result[0], myToken, !settings.skipWeight);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[CarryBee]", e);
      }
    }

    // ============ COD BATCH MODE ============

    async function stopCodBatch(): Promise<void> {
      cycleToken++;
      await flushBatchConsignments();
      hideCodQuantityInput();
      setStatus(
        `Stopped — ${codQuantityCounter}/${codQuantityTarget} sorted`,
        "error",
      );
      setCodProgress(null);
      await sleep(2500);
      state = "IDLE";
      showCodQuantityInput();
      const codInput = SEL.codInput();
      if (codInput) codInput.focus();
    }

    async function startCodBatch(qty: number): Promise<void> {
      if (!enabled || mode !== "cod" || state !== "IDLE") return;

      const myToken = ++cycleToken;
      clearCycleCache();
      codQuantityCounter = 0;
      codQuantityTarget = qty;
      currentBusinessName = getBusinessName();

      const input = createCodQuantityInput();
      if (!input) return;
      if (codStopButtonEl) codStopButtonEl.style.display = "block";

      await runCodBatch(myToken);
    }

    async function runCodBatch(myToken: number): Promise<void> {
      while (codQuantityCounter < codQuantityTarget && myToken === cycleToken) {
        clearCycleCache();
        state = "PROCESSING";

        const row = await waitFor(
          () => {
            const rows = getRowsCached();
            const first = rows[0];
            if (!first) return null;
            if (!findActionButton(first, "lucide-printer")) return null;
            return first;
          },
          { interval: 200, timeout: 1000 },
        );

        if (myToken !== cycleToken) return;

        if (!row) {
          await flushBatchConsignments();
          setCodProgress(null);
          if (codQuantityCounter > 0) {
            setStatus(`✓ ${codQuantityCounter} parcels sorted`, "success");
            await sleep(CFG.badgeDisplayMs);
          } else {
            setStatus("No more rows", "error");
            await sleep(2000);
          }
          if (myToken === cycleToken) {
            state = "IDLE";
            showCodQuantityInput();
            const codInput = SEL.codInput();
            if (codInput) codInput.focus();
          }
          return;
        }

        setCodProgress(
          `Processing ${codQuantityCounter + 1}/${codQuantityTarget}`,
        );

        const consignmentId = getConsignmentIdFromRow(row);

        const result = await printThenSort(row, myToken);
        if (myToken !== cycleToken) return;

        if (!result.ok) {
          await flushBatchConsignments();
          setCodProgress(null);
          await sleep(2500);
          if (myToken === cycleToken) {
            state = "IDLE";
            showCodQuantityInput();
            const codInput = SEL.codInput();
            if (codInput) codInput.focus();
          }
          return;
        }

        // Wait for row to disappear (skip if stuck/unverified — row may stay)
        if (!result.unverified) {
          await waitFor(() => !document.body.contains(row), { timeout: 2000 });
          if (myToken !== cycleToken) return;
        }

        if (consignmentId) {
          await addConsignmentId(consignmentId, currentBusinessName!, true);
        }

        codQuantityCounter++;
      }

      await flushBatchConsignments();

      if (myToken === cycleToken) {
        setCodProgress(`✓ ${codQuantityCounter} sorted`);
        setStatus("✓ Done", "success");
        await sleep(CFG.badgeDisplayMs);
        setCodProgress(null);
        state = "IDLE";
        showCodQuantityInput();
        const codInput = SEL.codInput();
        if (codInput) codInput.focus();
      }
    }

    // ============ INPUT LISTENERS ============

    function attachInputListeners(): void {
      const inputConfigs = [
        {
          getInput: () => SEL.merchantOrderInput(),
          handler: () =>
            onSearchInputChanged("merchant", SEL.merchantOrderInput),
        },
        {
          getInput: () => SEL.phoneInput(),
          handler: () => onSearchInputChanged("phone", SEL.phoneInput, true),
        },
        {
          getInput: () => SEL.consignmentInput(),
          handler: () =>
            onSearchInputChanged("consignment", SEL.consignmentInput),
        },
      ];

      for (const { getInput, handler } of inputConfigs) {
        const input = getInput();
        if (input && !(input as HTMLElement).dataset.cbWired) {
          (input as HTMLElement).dataset.cbWired = "1";
          input.addEventListener("input", () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            resetStateForNewInput();
            debounceTimer = setTimeout(handler, CFG.debounceMs);
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              lastEnterAt = Date.now();
            }
          });

          const clearIcon = input.parentElement?.querySelector("svg.lucide-x");
          if (clearIcon && !(clearIcon as HTMLElement).dataset.cbWired) {
            (clearIcon as HTMLElement).dataset.cbWired = "1";
            clearIcon.addEventListener("click", () => {
              resetStateForNewInput();
            });
          }
        }
      }

      createCodQuantityInput();
    }

    // ============ KEYBOARD SHORTCUTS ============

    /** Manifest command name → mode. */
    const COMMAND_TO_MODE: Record<string, Mode> = {
      "set-consignment-mode": "consignment",
      "set-phone-mode": "phone",
      "set-merchant-mode": "merchant",
      "set-cod-mode": "cod",
    };

    /**
     * Handle commands from background (keyboard shortcuts).
     * Toggle semantics: pressing the ACTIVE mode's shortcut turns the extension OFF;
     * any other shortcut switches mode (or turns ON if off).
     */
    function handleCommand(command: string): void {
      if (!isProcessingPage()) return;
      const target = COMMAND_TO_MODE[command];
      if (!target) return;

      if (enabled && mode === target) {
        userDisable();
        return;
      }

      enabled = true;
      setMode(target);
      if (target === "cod") {
        showCodQuantityInput();
        const codInput = SEL.codInput();
        if (codInput) codInput.focus();
      } else {
        refocusCurrentInput();
      }
    }

    // ============ RUNTIME MESSAGES ============

    function wireRuntimeMessages(): void {
      if (!chrome?.runtime?.onMessage) return;
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "CB_GET_STATE") {
          sendResponse({ enabled, mode });
        } else if (msg.type === "CB_SET_STATE") {
          const next = !!msg.enabled;
          const newMode = msg.mode || null;

          if (next && !isProcessingPage()) {
            sendResponse({ enabled: false, mode: null });
            return;
          }

          if (!next) {
            userDisable();
          } else if (next && newMode) {
            enabled = true;
            setMode(newMode);
            if (newMode === "cod") {
              showCodQuantityInput();
              const codInput = SEL.codInput();
              if (codInput) codInput.focus();
            } else {
              refocusCurrentInput();
            }
          } else if (next && !newMode) {
            enabled = true;
            setStatus("Pick a mode", "info");
          }

          sendResponse({ enabled, mode });
        } else if (msg.type === "CB_POPUP_CLOSED") {
          if (enabled && state === "IDLE") {
            refocusCurrentInput();
          }
          sendResponse({});
        } else if (msg.type === "CB_COMMAND") {
          handleCommand(msg.command);
          sendResponse({ enabled, mode });
        }
      });
    }

    // ============ SETTINGS LISTENER ============

    function wireSettingsListener(): void {
      if (!chrome?.storage?.onChanged) return;
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "local") {
          getSettingsFromBackground().then((s) => {
            settings = s;
          });
        }
      });
    }

    // ============ URL-BASED AUTO-DISABLE (SPA NAVIGATION) ============

    /** True only on exact order-processing / sub-sort path segments (no query/hash false positives). */
    function isProcessingPage(): boolean {
      const p = location.pathname;
      return (
        p === "/order-processing" ||
        p.startsWith("/order-processing/") ||
        p === "/sub-sort" ||
        p.startsWith("/sub-sort/")
      );
    }

    function disableExtension(): void {
      enabled = false;
      mode = null;
      cycleToken++;
      state = "IDLE";
      currentAbortController?.abort();
      currentAbortController = null;
      pendingSortConsignmentId = null;
      confirmResolve = null;
      if (confirmKeydownHandler) {
        const input = SEL.phoneInput();
        input?.removeEventListener("keydown", confirmKeydownHandler);
        confirmKeydownHandler = null;
      }
      setCodProgress(null);
      hideCodQuantityInput();
      hideBadge();
    }

    function onUrlChange(): void {
      if (isProcessingPage()) {
        showIdleStatus();
      } else {
        disableExtension();
      }
    }

    /** Monkey-patch pushState/replaceState + hashchange + setInterval fallback. */
    function wireUrlWatcher(): void {
      const origPush = history.pushState;
      const origReplace = history.replaceState;

      history.pushState = function (...args) {
        origPush.apply(this, args);
        onUrlChange();
      };
      history.replaceState = function (...args) {
        origReplace.apply(this, args);
        onUrlChange();
      };

      window.addEventListener("popstate", onUrlChange);
      window.addEventListener("hashchange", onUrlChange);

      // Fallback: poll URL every 1s for React routing that bypasses pushState
      let lastCheckedUrl = location.href;
      setInterval(() => {
        if (location.href !== lastCheckedUrl) {
          lastCheckedUrl = location.href;
          onUrlChange();
        }
      }, 1000);
    }

    function wireSortButtonTracker(): void {
      document.body.addEventListener(
        "click",
        (e) => {
          const btn = (e.target as Element).closest("button");
          if (!btn) return;
          const icon = btn.querySelector("svg.lucide-arrow-down-wide-narrow");
          if (!icon) return;
          const row = btn.closest(SEL.row);
          if (!row) return;
          lastClickedRowId = row.getAttribute("data-order-id");
        },
        true,
      );
    }

    // ============ INIT ============

    async function init(): Promise<void> {
      try {
        settings = await getSettingsFromBackground();
        await checkDailyResetFromBackground();

        wireUrlWatcher();
        onUrlChange();

        watchDom();
        attachInputListeners();
        wireRuntimeMessages();
        wireSettingsListener();
        wireSortButtonTracker();

        chrome.runtime
          .sendMessage({ type: "CB_CONTENT_READY", url: location.href })
          .catch(() => {});
      } catch (e) {
        console.error("[CarryBee] Init failed:", e);
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  },
});
