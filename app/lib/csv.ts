/**
 * Minimal CSV helpers for client-side CSV generation and browser file download.
 */

/**
 * Escapes a single CSV field value. Always wraps in double quotes and doubles
 * any internal double quotes, so the result is safe regardless of whether the
 * value contains commas, quotes, or newlines.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  // Double any embedded quotes, then wrap in quotes.
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Triggers a browser download of a CSV string as a `.csv` file.
 * Only safe to call in a browser context (`'use client'` components).
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Builds a local-timezone timestamp string suitable for use in filenames.
 * Format: YYYY-MM-DD_HH-MM-SS (colons replaced with dashes for file-system safety).
 */
export function localTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}
