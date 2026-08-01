/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { bulkSubmitLabel, computePopoverPosition, swipeDirection } from '@/app/lib/ui';

describe('computePopoverPosition', () => {
  const viewport = { width: 1000, height: 800 };

  it('positions below and left-aligned with the anchor when there is room', () => {
    const anchor = { top: 100, bottom: 120, left: 50, right: 150 };
    const panel = { width: 200, height: 100 };
    const { top, left } = computePopoverPosition({ panel, anchor, viewport });
    expect(top).toBe(126); // anchor.bottom + 6
    expect(left).toBe(50); // anchor.left
  });

  it('flips above the anchor when appearing below would overflow the bottom', () => {
    const anchor = { top: 750, bottom: 770, left: 50, right: 150 };
    const panel = { width: 200, height: 100 };
    const { top } = computePopoverPosition({ panel, anchor, viewport });
    expect(top).toBe(644); // anchor.top - panel.height - 6
  });

  it('clamps top to at least `pad` even if flipping above would go negative', () => {
    const anchor = { top: 10, bottom: 780, left: 50, right: 150 };
    const panel = { width: 200, height: 700 };
    const { top } = computePopoverPosition({ panel, anchor, viewport, pad: 8 });
    expect(top).toBe(8);
  });

  it('right-aligns with the anchor when left-aligning would overflow the right edge', () => {
    const anchor = { top: 100, bottom: 120, left: 900, right: 950 };
    const panel = { width: 200, height: 100 };
    const { left } = computePopoverPosition({ panel, anchor, viewport });
    expect(left).toBe(750); // anchor.right - panel.width
  });

  it('hard-clamps left within the viewport when even right-alignment would overflow', () => {
    const anchor = { top: 100, bottom: 120, left: 0, right: 10 };
    const panel = { width: 1200, height: 100 }; // wider than the viewport
    const { left } = computePopoverPosition({ panel, anchor, viewport, pad: 8 });
    expect(left).toBe(8);
  });

  it('uses a default pad of 8 when not specified', () => {
    const anchor = { top: 750, bottom: 770, left: 50, right: 150 };
    const panel = { width: 200, height: 780 };
    const { top } = computePopoverPosition({ panel, anchor, viewport });
    expect(top).toBe(8);
  });
});

describe('swipeDirection', () => {
  it('returns null for a small movement at or under the threshold', () => {
    expect(swipeDirection(10)).toBeNull();
    expect(swipeDirection(50)).toBeNull();
    expect(swipeDirection(-50)).toBeNull();
  });

  it('returns "next" for a leftward swipe past the threshold (negative delta)', () => {
    expect(swipeDirection(-51)).toBe('next');
  });

  it('returns "prev" for a rightward swipe past the threshold (positive delta)', () => {
    expect(swipeDirection(51)).toBe('prev');
  });

  it('respects a custom threshold', () => {
    expect(swipeDirection(30, 20)).toBe('prev');
    expect(swipeDirection(15, 20)).toBeNull();
  });
});

describe('bulkSubmitLabel', () => {
  it('shows a generic label when nothing has been parsed yet', () => {
    expect(bulkSubmitLabel(0, 0)).toBe('Add teams');
  });

  it('pluralizes for exactly one valid row', () => {
    expect(bulkSubmitLabel(1, 1)).toBe('Add 1 team');
  });

  it('pluralizes for multiple valid rows, all valid', () => {
    expect(bulkSubmitLabel(3, 3)).toBe('Add 3 teams');
  });

  it('shows "N of M" when only some rows are valid', () => {
    expect(bulkSubmitLabel(5, 2)).toBe('Add 2 of 5 teams');
  });
});
