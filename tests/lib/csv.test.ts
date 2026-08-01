import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildScoresCsv,
  downloadCsv,
  escapeCsvField,
  localTimestamp,
  scoresCsvFilename,
} from '@/app/lib/csv';

describe('escapeCsvField', () => {
  it('always wraps the value in double quotes', () => {
    expect(escapeCsvField('hello')).toBe('"hello"');
  });

  it('doubles embedded double quotes', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('passes embedded commas and newlines through, unescaped but quoted', () => {
    expect(escapeCsvField('a,b\nc')).toBe('"a,b\nc"');
  });

  it('renders null as an empty quoted field', () => {
    expect(escapeCsvField(null)).toBe('""');
  });

  it('renders undefined as an empty quoted field', () => {
    expect(escapeCsvField(undefined)).toBe('""');
  });

  it('renders the number 0 as "0", not empty (falsy but not null/undefined)', () => {
    expect(escapeCsvField(0)).toBe('"0"');
  });

  it('renders NaN as the literal string "NaN"', () => {
    expect(escapeCsvField(NaN)).toBe('"NaN"');
  });
});

describe('localTimestamp', () => {
  it('formats as YYYY-MM-DD_HH-MM-SS using local date/time components', () => {
    const date = new Date(2026, 0, 5, 3, 4, 5); // Jan 5 2026, 03:04:05 local
    expect(localTimestamp(date)).toBe('2026-01-05_03-04-05');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const date = new Date(2026, 8, 9, 1, 2, 3); // Sep 9 2026, 01:02:03 local
    expect(localTimestamp(date)).toBe('2026-09-09_01-02-03');
  });

  it('does not zero-pad the year', () => {
    const date = new Date(999, 0, 1, 0, 0, 0);
    expect(localTimestamp(date)).toBe('999-01-01_00-00-00');
  });
});

describe('scoresCsvFilename', () => {
  it('embeds the local timestamp in a bible-bowl-scores-*.csv filename', () => {
    const date = new Date(2026, 5, 15, 12, 30, 0);
    expect(scoresCsvFilename(date)).toBe('bible-bowl-scores-2026-06-15_12-30-00.csv');
  });
});

describe('buildScoresCsv', () => {
  const teams = [
    { id: 't1', name: 'Team One' },
    { id: 't2', name: 'Team Two' },
  ];

  it('builds a header row of Team, Type, Q1..Qn, Total', () => {
    const csv = buildScoresCsv(teams, new Map(), 3, () => '');
    const [header] = csv.split('\n');
    expect(header).toBe('"Team","Type","Q1","Q2","Q3","Total"');
  });

  it('leaves unscored questions blank and sums only the scored ones into Total', () => {
    const scoreMap = new Map([['t1', new Map([[1, { points: 2 }]])]]);
    const csv = buildScoresCsv(teams, scoreMap, 3, () => 'Teen');
    const rows = csv.split('\n');
    expect(rows[1]).toBe('"Team One","Teen","2","","","2"');
    expect(rows[2]).toBe('"Team Two","Teen","","","","0"');
  });

  it('uses the provided groupLabel function per team', () => {
    const csv = buildScoresCsv(teams, new Map(), 1, (t) => (t.id === 't1' ? 'Teen' : 'Adult'));
    const rows = csv.split('\n');
    expect(rows[1]).toContain('"Teen"');
    expect(rows[2]).toContain('"Adult"');
  });

  it('produces just a header row (no question columns) when maxQuestion is 0', () => {
    const csv = buildScoresCsv(teams, new Map(), 0, () => '');
    expect(csv.split('\n')).toHaveLength(3); // header + 2 team rows, no Q columns
    expect(csv.split('\n')[0]).toBe('"Team","Type","Total"');
  });
});

describe('downloadCsv', () => {
  beforeEach(() => {
    // jsdom doesn't implement URL.createObjectURL/revokeObjectURL.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  it('creates a temporary link, clicks it, and cleans up the object URL', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCsv('scores.csv', 'a,b,c');

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    // The <a> element should not be left behind in the DOM.
    expect(document.querySelector('a[download="scores.csv"]')).toBeNull();
  });
});
