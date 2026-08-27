/** How an event series repeats. */
export type EventRecurrenceFrequency = 'none' | 'weekly' | 'monthly' | 'monthly_nth';

export type EventRecurrence = {
  frequency: EventRecurrenceFrequency;
  /** Horizon for materializing occurrences (months ahead of start / today). */
  windowMonths?: number;
  /** Optional inclusive end date (YYYY-MM-DD). */
  until?: string;
};

export const DEFAULT_RECURRENCE_WINDOW_MONTHS = 6;

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseIsoDayLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Human date with weekday, e.g. "Sun 13 Sep 2026". */
export function formatEventDateLabel(iso: string): string {
  const dt = parseIsoDayLocal(iso);
  if (!dt) return String(iso || '').trim();
  return `${WEEKDAY_SHORT[dt.getDay()]} ${dt.getDate()} ${MONTH_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
}

/** Full weekday name from ISO day, e.g. "Sunday". */
export function weekdayNameFromIso(iso: string): string {
  const dt = parseIsoDayLocal(iso);
  if (!dt) return '';
  return WEEKDAY_LABELS[dt.getDay()];
}

/** Short weekday from ISO day, e.g. "Sun". */
export function weekdayShortFromIso(iso: string): string {
  const dt = parseIsoDayLocal(iso);
  if (!dt) return '';
  return WEEKDAY_SHORT[dt.getDay()];
}

export function toIsoDayLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addMonthsClamped(dt: Date, months: number): Date {
  const out = new Date(dt.getFullYear(), dt.getMonth() + months, dt.getDate());
  // Clamp overflow (e.g. Jan 31 + 1 month).
  if (out.getDate() !== dt.getDate()) {
    out.setDate(0);
  }
  return out;
}

/** Nth weekday in month: 1..4 or -1 for last. */
export function nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number): Date | null {
  if (nth === -1) {
    const last = new Date(year, monthIndex + 1, 0);
    const back = (last.getDay() - weekday + 7) % 7;
    return new Date(year, monthIndex, last.getDate() - back);
  }
  if (nth < 1 || nth > 4) return null;
  const first = new Date(year, monthIndex, 1);
  const forward = (weekday - first.getDay() + 7) % 7;
  const day = 1 + forward + (nth - 1) * 7;
  const dt = new Date(year, monthIndex, day);
  if (dt.getMonth() !== monthIndex) return null;
  return dt;
}

export function weekdayNthInMonth(dt: Date): number {
  const day = dt.getDate();
  const nth = Math.ceil(day / 7);
  const nextWeek = new Date(dt.getFullYear(), dt.getMonth(), day + 7);
  if (nextWeek.getMonth() !== dt.getMonth()) return -1;
  return nth;
}

export function recurrenceLabel(rec: EventRecurrence | undefined, startDate: string): string {
  const freq = rec?.frequency || 'none';
  if (freq === 'none') return '';
  const start = parseIsoDayLocal(startDate);
  if (!start) {
    if (freq === 'weekly') return 'Every week';
    if (freq === 'monthly') return 'Every month';
    return 'Every month (nth weekday)';
  }
  const wd = WEEKDAY_LABELS[start.getDay()];
  if (freq === 'weekly') return `Every ${wd}`;
  if (freq === 'monthly') return `Monthly on day ${start.getDate()}`;
  const nth = weekdayNthInMonth(start);
  if (nth === -1) return `Every last ${wd} of the month`;
  const ord = nth === 1 ? '1st' : nth === 2 ? '2nd' : nth === 3 ? '3rd' : `${nth}th`;
  return `Every ${ord} ${wd} of the month`;
}

/**
 * Expand a recurrence into ISO day strings within the window.
 * Always includes startDate when valid.
 */
export function expandRecurrenceDates(
  startDate: string,
  recurrence: EventRecurrence | undefined,
  opts?: { windowMonths?: number; todayIso?: string }
): string[] {
  const start = parseIsoDayLocal(startDate);
  if (!start) return [];
  const freq = recurrence?.frequency || 'none';
  if (freq === 'none') return [toIsoDayLocal(start)];

  const windowMonths = Math.max(
    1,
    Number(recurrence?.windowMonths || opts?.windowMonths || DEFAULT_RECURRENCE_WINDOW_MONTHS) || DEFAULT_RECURRENCE_WINDOW_MONTHS
  );
  const today = opts?.todayIso ? parseIsoDayLocal(opts.todayIso) : new Date();
  const todayStart = today
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
    : new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const anchor = start < todayStart ? todayStart : start;
  const untilFromWindow = addMonthsClamped(anchor, windowMonths);
  const untilOpt = recurrence?.until ? parseIsoDayLocal(recurrence.until) : null;
  const until = untilOpt && untilOpt < untilFromWindow ? untilOpt : untilFromWindow;

  const out: string[] = [];
  const push = (dt: Date) => {
    if (dt < start) return;
    if (dt > until) return;
    out.push(toIsoDayLocal(dt));
  };

  if (freq === 'weekly') {
    const weekday = start.getDay();
    let cur = new Date(start);
    // Align first occurrence on/after start that matches weekday (start already matches).
    while (cur <= until) {
      if (cur.getDay() === weekday) push(new Date(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else if (freq === 'monthly') {
    const day = start.getDate();
    let y = start.getFullYear();
    let m = start.getMonth();
    for (let i = 0; i < windowMonths + 2; i++) {
      const dt = new Date(y, m, day);
      if (dt.getDate() === day) push(dt);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  } else if (freq === 'monthly_nth') {
    const weekday = start.getDay();
    const nth = weekdayNthInMonth(start);
    let y = start.getFullYear();
    let m = start.getMonth();
    for (let i = 0; i < windowMonths + 2; i++) {
      const dt = nthWeekdayOfMonth(y, m, weekday, nth);
      if (dt) push(dt);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  }

  return [...new Set(out)].sort();
}

/** Merge explicit dates with recurrence expansion. */
export function mergeOccurrenceDates(
  explicitDates: string[],
  startDate: string,
  recurrence: EventRecurrence | undefined
): string[] {
  const fromRule = expandRecurrenceDates(startDate || explicitDates[0] || '', recurrence);
  const merged = [...new Set([...explicitDates.filter(Boolean), ...fromRule])].sort();
  return merged.length ? merged : startDate ? [startDate] : [];
}

/** Heuristic: detect weekly / monthly_nth from a sorted date list. */
export function inferRecurrenceFromDates(dates: string[]): EventRecurrenceFrequency {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (unique.length < 3) return 'none';
  const parsed = unique.map(parseIsoDayLocal).filter((d): d is Date => !!d);
  if (parsed.length < 3) return 'none';

  const weekdays = new Set(parsed.map((d) => d.getDay()));
  if (weekdays.size === 1) {
    let weekly = true;
    for (let i = 1; i < parsed.length; i++) {
      const delta = (parsed[i].getTime() - parsed[i - 1].getTime()) / 86400000;
      if (delta !== 7 && delta !== 14) {
        // allow gaps of one week skip
        if (delta % 7 !== 0 || delta > 21) {
          weekly = false;
          break;
        }
      }
    }
    if (weekly) {
      // Prefer monthly_nth when gaps look monthly (~28-35 days).
      const gaps = [];
      for (let i = 1; i < parsed.length; i++) {
        gaps.push((parsed[i].getTime() - parsed[i - 1].getTime()) / 86400000);
      }
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avg >= 26 && avg <= 35) return 'monthly_nth';
      return 'weekly';
    }
  }

  const days = new Set(parsed.map((d) => d.getDate()));
  if (days.size === 1) return 'monthly';
  return 'none';
}
