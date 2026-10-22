// Due dates are stored as local calendar days, 'YYYY-MM-DD', so they don't shift with time zones.

const pad = (n) => String(n).padStart(2, '0');

export function toDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today() {
  return toDay(new Date());
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return toDay(new Date(y, m - 1, d + n));
}

function parse(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysFromToday(day) {
  return Math.round((parse(day) - parse(today())) / 86400000);
}

export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// 'overdue' | 'today' | 'soon' (next 6 days) | 'later'
export function dueState(day) {
  const n = daysFromToday(day);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 6) return 'soon';
  return 'later';
}

// "Today", "Tomorrow", "Yesterday", "Friday", "3 days ago", "Mon, Nov 3", "Mon, Nov 3, 2027"
export function dueLabel(day) {
  const n = daysFromToday(day);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < -1 && n >= -6) return `${-n} days ago`;
  const date = parse(day);
  if (n > 1 && n <= 6) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

// Quick choices offered next to date pickers.
export function quickDates() {
  const t = today();
  const d = new Date();
  const toMonday = ((8 - d.getDay()) % 7) || 7; // next Monday, never today
  return [
    { label: 'Today', value: t },
    { label: 'Tomorrow', value: addDays(t, 1) },
    { label: 'Next week', value: addDays(t, toMonday) },
  ];
}
