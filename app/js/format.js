// Formatting helpers shared by every view: HTML escaping, money, dates,
// time left, byte sizes, micro rates and wallet addresses.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtUSD(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function fmtNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}

// Whether a bounty still takes entries is decided by its deadline alone:
// a bounty past it may still read status "open" until its results publish.
export function timeLeft(iso, now = Date.now()) {
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return { open: false, text: 'No deadline' };
  const ms = end - now;
  if (ms <= 0) return { open: false, text: 'Entries closed' };
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;
  if (days > 0) return { open: true, text: `${days}d ${hours}h left` };
  if (hours > 0) return { open: true, text: `${hours}h ${minutes}m left` };
  return { open: true, text: `${Math.max(minutes, 1)}m left` };
}

// A ticking countdown with seconds, for the board's live clocks: the text a
// one-second timer writes into each card's clock without any refetch.
export function countdownText(iso, now = Date.now()) {
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return 'No deadline';
  const ms = end - now;
  if (ms <= 0) return 'Entries closed';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock} left` : `${clock} left`;
}

// The board's status tabs, decided by deadline alone (see timeLeft):
// open now, closing soon (inside 72 hours) or closed.
export function bountyStatusTab(item, now = Date.now()) {
  const end = new Date(item.deadline).getTime();
  if (!Number.isFinite(end) || end <= now) return 'closed';
  return end - now <= 72 * 3600 * 1000 ? 'soon' : 'open';
}

export function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Leaderboard rates arrive as micro values: 937226 means a 0.937226 win rate.
export function microRate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n / 10000).toFixed(1)}%` : '—';
}

export function shortAddr(address) {
  const a = String(address ?? '');
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

// A stable hue for a category name, so every card and chip of one category
// wears the same accent colour on every visit: a plain string hash folded
// into 0–359. Purely presentational — the same name always gives the same
// hue, with no state kept anywhere.
export function hueFor(text) {
  let hash = 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return ((hash % 360) + 360) % 360;
}

// A share of a whole as a one-decimal percent, for the rewards bar legend:
// 0.4 of the pot reads "40.0%".
export function fmtShare(fraction) {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}
