// Picks which date tabs ("Nov 16, 2026") belong to a period such as "last week". All dates are local days.

const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function tabDate(name) {
  const d = new Date(name);
  return Number.isNaN(d.getTime()) ? null : dayOnly(d);
}

function isoDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** First and last day of a named period, or null when it is not a date range (or custom dates are missing). */
function periodOf(range, from, to, now = new Date()) {
  const today = dayOnly(now);
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (range) {
    case 'today': return [today, today];
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)];
    case 'thisWeek': return [monday, today];
    case 'lastWeek': return [addDays(monday, -7), addDays(monday, -1)];
    case 'last7': return [addDays(today, -6), today];
    case 'last14': return [addDays(today, -13), today];
    case 'last30': return [addDays(today, -29), today];
    case 'thisMonth': return [new Date(today.getFullYear(), today.getMonth(), 1), today];
    case 'custom': {
      const a = isoDate(from);
      const b = isoDate(to);
      if (!a || !b) return null;
      return a <= b ? [a, b] : [b, a];
    }
    default: return null;
  }
}

/** Date tabs newest first. Tabs whose name is not a date go last. */
function sortTabs(tabs) {
  return tabs.map((t) => ({ t, d: tabDate(t) })).sort((a, b) => (b.d || 0) - (a.d || 0)).map((x) => x.t);
}

/**
 * opts.range: latest | today | yesterday | thisWeek | lastWeek | last7 | last14 | last30 | thisMonth | all | day | custom
 * Returns { tabs (newest first), wanted (newest first) } or { error }.
 */
function pickTabs(allTabs, opts = {}, now = new Date()) {
  const tabs = sortTabs(allTabs || []);
  const range = opts.range || 'latest';
  if (range === 'list') return { tabs, wanted: [] };
  if (range === 'day') return { tabs, wanted: tabs.includes(opts.day) ? [opts.day] : [] };
  if (range === 'latest') return { tabs, wanted: tabs.filter((t) => tabDate(t)).slice(0, 1) };
  if (range === 'all') return { tabs, wanted: tabs };
  const p = periodOf(range, opts.from, opts.to, now);
  if (!p) return { tabs, error: 'Pick both a From and a To date.' };
  return { tabs, wanted: tabs.filter((t) => { const d = tabDate(t); return d && d >= p[0] && d <= p[1]; }) };
}

module.exports = { pickTabs, periodOf, tabDate, sortTabs };
