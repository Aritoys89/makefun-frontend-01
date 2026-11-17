// An account's public profile (#/u/<handle>): who they are, their record,
// their entries grouped by outcome and their payouts as a table with a
// running total — one API request for the whole page. Avatars are hosted
// on make.fun and send Cross-Origin-Resource-Policy: same-origin, so the
// <img> carries crossorigin="anonymous".

import { getProfile, absUrl } from './api.js';
import { esc, fmtUSD, fmtNum, fmtDate, microRate, shortAddr } from './format.js';

function scoreText(score) {
  if (!score) return '';
  if ((score.column?.source || '').includes('micro')) return microRate(score.value);
  return score.display ?? String(score.value ?? '');
}

// One entry of the account: the bounty it entered (linked), the entry's own
// title, its outcome — a placed pill where it placed, what it won, its
// score — and a link straight to that bounty's leaderboard.
function entryRow(sol) {
  const comp = sol.competition || {};
  const bits = [];
  if (sol.prize_usd) bits.push(`won ${fmtUSD(sol.prize_usd)}`);
  const score = scoreText(sol.score);
  if (score) bits.push(`${sol.score.column?.title || 'Score'} ${score}`);
  bits.push(`entered ${fmtDate(sol.entered_at)}`);
  return `<li class="entry-row">
    <div class="entry-main">
      <a href="#/bounty/${esc(comp.slug)}">${esc(comp.title || comp.slug || 'Bounty')}</a>
      ${sol.placement ? `<span class="placed-pill">🏆 placed #${esc(sol.placement)}</span>` : ''}
    </div>
    <div class="entry-title">${esc(sol.title || '')}</div>
    <div class="muted">${esc(bits.join(' · '))} · <a href="#/bounty/${esc(comp.slug)}/leaderboard">leaderboard</a></div>
  </li>`;
}

function payoutAmount(p) {
  return Number(p.amount_usd ?? p.prize_usd ?? p.amount) || 0;
}

// The payouts as one table, oldest first so the running total climbs the
// way the money arrived: each row names the bounty, the date and the
// amount, and the last column is everything earned up to that row. The
// final running total is the account's earnings from its payouts alone.
function payoutsTableHtml(payouts) {
  const rows = [...payouts].sort((a, b) => payoutTime(a) - payoutTime(b));
  let running = 0;
  const body = rows.map((p) => {
    running += payoutAmount(p);
    const comp = p.competition?.title ?? p.competition_slug ?? p.competition ?? '';
    const when = p.paid_at ?? p.created_at ?? p.at;
    return `<tr>
      <td>${comp ? esc(comp) : '<span class="muted">—</span>'}</td>
      <td class="num">${esc(fmtDate(when))}</td>
      <td class="num"><strong>${esc(fmtUSD(payoutAmount(p)))}</strong></td>
      <td class="num">${esc(fmtUSD(running))}</td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Bounty</th><th>Paid</th><th>Amount</th><th>Running total</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function payoutTime(p) {
  const t = new Date(p.paid_at ?? p.created_at ?? p.at ?? '').getTime();
  return Number.isFinite(t) ? t : 0;
}

// The totals strip: the account at a glance. Entries submitted counts the
// profile's own entry list; finished counts entries whose competition is
// no longer open; total earned sums the payouts the API lists, falling
// back to the record's prize total when it lists none.
function profileTotals(p) {
  const solutions = Array.isArray(p.solutions) ? p.solutions : [];
  const payouts = Array.isArray(p.payouts) ? p.payouts : [];
  const finished = solutions.filter((s) => (s.competition?.status || '') !== 'open').length;
  const paidOut = payouts.reduce((sum, x) => sum + payoutAmount(x), 0);
  return {
    entriesSubmitted: solutions.length,
    competitionsEntered: p.record?.competitions_entered,
    finishedEntries: finished,
    placed: p.record?.competitions_placed,
    totalEarnedUsd: payouts.length ? paidOut : Number(p.record?.prize_usd) || 0,
  };
}

// Which group an entry belongs to, from fields the API returns: a placed
// entry first, then whether its competition is still open.
function entryGroupOf(sol) {
  if (sol.placement) return 'Placed finishes';
  return (sol.competition?.status || '') === 'open' ? 'In live competitions' : 'Finished competitions';
}

const ENTRY_GROUP_ORDER = ['Placed finishes', 'In live competitions', 'Finished competitions'];

function groupedEntriesHtml(solutions) {
  const groups = new Map();
  for (const sol of solutions) {
    const key = entryGroupOf(sol);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sol);
  }
  return ENTRY_GROUP_ORDER.filter((key) => groups.has(key)).map((key) => `
    <h3 class="group-title">${esc(key)} <span class="muted">(${groups.get(key).length})</span></h3>
    <ul class="plain">${groups.get(key).map(entryRow).join('')}</ul>`).join('');
}

export async function renderProfile(app, handle) {
  app.innerHTML = `<section class="panel" aria-busy="true">
    <div class="skel skel-chip"></div>
    <div class="skel skel-title"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
  </section>`;
  const p = await getProfile(handle);
  const avatarPath = p.avatar?.url || p.image;
  const initial = esc((p.handle || '?').charAt(0).toUpperCase());
  const avatar = avatarPath
    ? `<span class="avatar-pick avatar-pick-lg">${initial}<img crossorigin="anonymous" alt="" src="${esc(absUrl(avatarPath))}"></span>`
    : '';
  const record = p.record || {};
  const totals = profileTotals(p);
  const socials = [
    p.github_login ? `GitHub: ${p.github_login}` : null,
    p.discord ? `Discord: ${p.discord}` : null,
    p.x ? `X: ${p.x}` : null,
  ].filter(Boolean);
  app.innerHTML = `<section>
    <div class="profile-head">
      ${avatar}
      <div>
        <h1>${esc(p.display_name || p.handle)}</h1>
        <p class="muted">@${esc(p.handle)}${p.house ? ' · house account' : ''} · joined ${esc(fmtDate(p.joined_at))}</p>
        ${p.bio ? `<p class="lede">${esc(p.bio)}</p>` : ''}
        ${socials.length ? `<p class="muted">${esc(socials.join(' · '))}</p>` : ''}
        ${p.wallet?.address ? `<p class="muted">Wallet <a href="${esc(p.wallet.explorer_url || '#')}" rel="noopener">${esc(shortAddr(p.wallet.address))}</a></p>` : ''}
      </div>
    </div>
    <dl class="facts panel totals-strip">
      <div><dt>Entries submitted</dt><dd>${esc(fmtNum(totals.entriesSubmitted))}</dd></div>
      <div><dt>Competitions entered</dt><dd>${esc(fmtNum(totals.competitionsEntered))}</dd></div>
      <div><dt>Finished entries</dt><dd>${esc(fmtNum(totals.finishedEntries))}</dd></div>
      <div><dt>Placed</dt><dd>${esc(fmtNum(totals.placed))}</dd></div>
      <div><dt>Total earned</dt><dd>${esc(fmtUSD(totals.totalEarnedUsd))}</dd></div>
    </dl>
    <dl class="facts panel">
      <div><dt>Entered</dt><dd>${esc(fmtNum(record.competitions_entered))}</dd></div>
      <div><dt>Placed</dt><dd>${esc(fmtNum(record.competitions_placed))}</dd></div>
      <div><dt>Won</dt><dd>${esc(fmtNum(record.competitions_won))}</dd></div>
      <div><dt>Podiums</dt><dd>${esc(fmtNum(record.podium_finishes))}</dd></div>
      <div><dt>Best placement</dt><dd>${record.best_placement ? '#' + esc(record.best_placement) : '—'}</dd></div>
      <div><dt>Prizes won</dt><dd>${esc(fmtUSD(record.prize_usd))}</dd></div>
    </dl>
    <section class="panel">
      <h2>Entries by status</h2>
      ${Array.isArray(p.solutions) && p.solutions.length
        ? groupedEntriesHtml(p.solutions)
        : '<p class="muted">No entries yet — this account has not entered a bounty.</p>'}
    </section>
    ${Array.isArray(p.payouts) && p.payouts.length ? `<section class="panel">
      <h2>Payouts</h2>
      ${payoutsTableHtml(p.payouts)}
    </section>` : ''}
  </section>`;
  return null;
}
