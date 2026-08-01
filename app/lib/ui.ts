/**
 * Small, DOM-free UI geometry/formatting helpers extracted from components
 * so they're unit-testable without a real layout engine.
 */

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PopoverPositionInput {
  panel: Size;
  anchor: Rect;
  viewport: Viewport;
  pad?: number;
}

/**
 * Computes a fixed-position popover's top/left, anchored below (or above, if
 * it would overflow the bottom) and left-aligned with (or right-aligned, if
 * it would overflow the right) an anchor element, clamped to stay fully
 * within the viewport.
 */
export function computePopoverPosition({
  panel,
  anchor,
  viewport,
  pad = 8,
}: PopoverPositionInput): { top: number; left: number } {
  const { width: pw, height: ph } = panel;
  const vw = viewport.width;
  const vh = viewport.height;

  // Vertical: appear below; flip above if it would overflow the bottom.
  let top = anchor.bottom + 6;
  if (top + ph + pad > vh) {
    top = anchor.top - ph - 6;
  }
  top = Math.max(pad, top);

  // Horizontal: left-align with anchor; fall back to right-align; then hard clamp.
  let left = anchor.left;
  if (left + pw + pad > vw) {
    left = anchor.right - pw;
  }
  left = Math.max(pad, Math.min(left, vw - pw - pad));

  return { top, left };
}

/**
 * Classifies a horizontal touch-drag delta as a swipe once it exceeds the
 * threshold; returns `null` for anything shorter (a tap or a small jitter).
 * Negative delta (finger moved left) means "next"; positive means "prev".
 */
export function swipeDirection(deltaX: number, threshold = 50): 'next' | 'prev' | null {
  if (Math.abs(deltaX) <= threshold) return null;
  return deltaX < 0 ? 'next' : 'prev';
}

/** Submit-button label for the bulk-add-teams preview, based on row counts. */
export function bulkSubmitLabel(parsedCount: number, validCount: number): string {
  if (parsedCount === 0) return 'Add teams';
  if (validCount === parsedCount) return `Add ${validCount} team${validCount === 1 ? '' : 's'}`;
  return `Add ${validCount} of ${parsedCount} teams`;
}
