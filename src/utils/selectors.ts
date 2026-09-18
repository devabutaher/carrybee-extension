/**
 * DOM selector utilities for CarryBee page interaction.
 * Robust fallback chain for finding input elements.
 */

const inputCache = new Map<string, HTMLInputElement>();

export function clearInputCache(): void {
  inputCache.clear();
}

/**
 * Find an input element using a fallback chain:
 *   1. aria-label attribute
 *   2. placeholder attribute
 *   3. XPath by associated <label> text
 *   4. DOM proximity to label text
 */
export function findInputByLabel(
  labelText: string,
  placeholderText?: string
): HTMLInputElement | null {
  const cached = inputCache.get(labelText);
  if (cached && document.body.contains(cached)) return cached;

  const ariaInput = document.querySelector<HTMLInputElement>(
    `input[aria-label="${labelText}"]`
  );
  if (ariaInput) {
    inputCache.set(labelText, ariaInput);
    return ariaInput;
  }

  if (placeholderText) {
    const phInput = document.querySelector<HTMLInputElement>(
      `input[placeholder="${placeholderText}"]`
    );
    if (phInput) {
      inputCache.set(labelText, phInput);
      return phInput;
    }
  }

  try {
    const xpath = `//label[contains(text(), "${labelText}")]//input | //label[contains(text(), "${labelText}")]/following-sibling::input`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    if (result.singleNodeValue) {
      const input = result.singleNodeValue as HTMLInputElement;
      inputCache.set(labelText, input);
      return input;
    }
  } catch {
    /* XPath not supported or failed */
  }

  const allInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')
  );
  for (const input of allInputs) {
    const parent = input.closest('div, span, label');
    if (parent && parent.textContent?.includes(labelText)) {
      inputCache.set(labelText, input);
      return input;
    }
  }

  return null;
}

/** DOM selectors for CarryBee page elements. */
export const SEL = {
  merchantOrderInput: () => findInputByLabel('Merchant Order ID', 'Search Merchant Order ID'),
  phoneInput: () => findInputByLabel('Customer Phone', 'Search Customer Phone'),
  codInput: () => findInputByLabel('COD', 'Search COD'),
  consignmentInput: () => findInputByLabel('Consignment ID', 'Search Consignment ID'),
  row: 'div[data-order-id]',
  weightIcon: 'svg.lucide-square-pen',
  weightInput: 'input[type="number"]',
  printBtn: 'svg.lucide-printer',
  sortBtn: 'svg.lucide-arrow-down-wide-narrow',
  toast: '[data-sonner-toast]',
};

/** Find weight icon in a row. */
export function findWeightIcon(row: Element): SVGSVGElement | null {
  return row.querySelector(SEL.weightIcon);
}

/** Find weight number input in a row. */
export function findWeightNumberInput(row: Element): HTMLInputElement | null {
  return row.querySelector(SEL.weightInput);
}

/** Find action button (print/sort) in a row by icon class. */
export function findActionButton(row: Element, iconClass: string): HTMLButtonElement | null {
  const icon = row.querySelector(`svg.${iconClass}`);
  return icon?.closest('button') ?? null;
}

/** Get consignment ID from a row element. */
export function getConsignmentIdFromRow(row: Element): string | null {
  return row.getAttribute('data-order-id');
}

/** Get all order rows from the DOM. */
export function getRows(): Element[] {
  return Array.from(document.querySelectorAll(SEL.row));
}

/**
 * Extract the business name from the page UI.
 * Searches divs for "Business Name" label and returns adjacent value.
 */
export function getBusinessName(): string {
  const captions = Array.from(document.querySelectorAll('div')).slice(0, 500);
  for (const el of captions) {
    if (el.children.length > 0) continue;
    if (!/^Business Name$/i.test((el.textContent || '').trim())) continue;

    let value = el.nextElementSibling;
    if (value && (value.textContent || '').trim() === ':') {
      value = value.nextElementSibling;
    }
    if (value) {
      return value.textContent?.trim() || 'Unknown';
    }
  }

  const match = document.body.innerText.match(/Business Name\s*:\s*([^\n:]+)/);
  return match ? match[1].trim() : 'Unknown';
}
