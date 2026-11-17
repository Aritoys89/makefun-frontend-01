// A bounty's leaderboard (#/bounty/<slug>/leaderboard): ranked entries with
// the rates the API gives them. The columns come from the API's own column
// definitions; micro rates are shown as percents and sizes as bytes. Long
// boards render 100 rows at a time behind a "show more" button, so a board
// with thousands of entries never builds thousands of DOM rows at once.

import { getLeaderboard, getCompetition, absUrl } from './api.js';
import { esc, fmtBytes, microRate } from './format.js';

const PAGE = 100;
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

// The ranks the live rewards table pays, from the competition detail: the
// places of its rewardsNow, or the keys of its rewards table. The
// leaderboard's own prize_rank is not this — every valid entry carries
// one — so without the detail there is no honest paid set and no row is
// highlighted.
function paidRanksOf(detail) {
  if (Array.isArray(detail?.rewardsNow) && detail.rewardsNow.length) {
    return new Set(detail.rewardsNow.map((r) => Number(r.place)));
  }
  if (detail?.rewards && typeof detail.rewards === 'object') {
    return new Set(Object.keys(detail.rewards).map(Number).filter((n) => n > 0));
  }
  return new Set();
}

function medalForRank(rank) {
  return MEDALS[rank] || '';
}

function rowClassForRank(rank, paidRanks) {
  const classes = [];
  if (rank >= 1 && rank <= 3) classes.push(`podium podium-${rank}`);
  if (paidRanks.has(rank)) classes.push('paid-row');
  return classes.join(' ');
}

function cellValue(entry, col) {
  const values = entry.values || {};
  const raw = values[col.key];
  if (raw === null || raw === undefined) return '—';
  if (col.key === 'bytes') return fmtBytes(raw);
  if (col.key === 'valid') return raw ? '✓' : '—';
  if ((col.source || '').includes('micro') || col.key.startsWith('judge')) return microRate(raw);
  return String(entry.display?.[col.key] ?? raw);
}

export async function renderLeaderboard(app, slug) {
  app.innerHTML = `<section class="panel" aria-busy="true">
    <div class="skel skel-title"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
    <div class="skel skel-stats"></div>
  </section>`;
  const [data, detail] = await Promise.all([
    getLeaderboard(slug),
    getCompetition(slug).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return getCompetition(slug).catch(() => null);
    }),
  ]);
  const entries = data.entries || [];
  const cols = (data.columns || []).filter((c) => !c.hidden);
  const phase = data.phase || {};
  const paidRanks = paidRanksOf(detail);
  let shown = PAGE;

  function rowsHtml() {
    return entries.slice(0, shown).map((entry) => {
      const rank = Number(entry.rank);
      const initial = esc((entry.handle || '?').charAt(0).toUpperCase());
      const avatar = `<span class="avatar-pick">${initial}${entry.image
        ? `<img crossorigin="anonymous" loading="lazy" alt="" src="${esc(absUrl(entry.image))}">`
        : ''}</span>`;
      const cells = cols.map((col) => `<td class="num">${esc(cellValue(entry, col))}</td>`).join('');
      const medal = medalForRank(rank);
      return `<tr class="${rowClassForRank(rank, paidRanks)}">
        <td class="rank">${medal ? `<span class="medal" aria-label="rank ${rank}">${medal}</span> ` : ''}${esc(entry.rank ?? '—')}</td>
        <td><div class="entrant">${avatar}<span>
          <a href="#/u/${esc(entry.handle)}">@${esc(entry.handle)}</a>${paidRanks.has(rank) ? ' <span class="paid-badge">paid place</span>' : ''}
          <span class="entry-title">${esc(entry.title || '')}</span>
        </span></div></td>
        ${cells}
      </tr>`;
    }).join('');
  }

  app.innerHTML = `<section>
    <p class="crumbs"><a href="#/bounty/${esc(slug)}">&larr; ${esc(data.competition?.title || slug)}</a></p>
    <div class="page-head">
      <h1>Leaderboard</h1>
      <p class="muted">${esc(data.competition?.title || '')} · ${esc(phase.title || '')} phase
        ${phase.scores_visible ? '· scores live' : ''}${phase.placements_held ? ' · placements held until the final' : ''}
        ${data.metrics_withheld ? ' · some metrics withheld' : ''}${paidRanks.size ? ` · ${paidRanks.size} paid places, highlighted below` : ''}</p>
    </div>
    ${entries.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th>Entrant</th>${cols.map((c) => `<th>${esc(c.title)}</th>`).join('')}</tr></thead>
      <tbody id="rows">${rowsHtml()}</tbody>
    </table></div>
    <p class="muted" id="count">${Math.min(shown, entries.length)} of ${entries.length} entries</p>
    ${entries.length > shown ? '<p><button class="button" id="more" type="button">Show more entries</button></p>' : ''}`
    : `<div class="empty-state">
        <p><strong>No entries yet.</strong></p>
        <p class="muted">This leaderboard fills in as entries arrive and are graded. Be the first to enter.</p>
        <p><a class="button" href="#/bounty/${esc(slug)}">About this bounty</a></p>
      </div>`}
  </section>`;

  const moreBtn = app.querySelector('#more');
  if (moreBtn) {
    moreBtn.addEventListener('click', () => {
      shown += PAGE;
      app.querySelector('#rows').innerHTML = rowsHtml();
      app.querySelector('#count').textContent = `${Math.min(shown, entries.length)} of ${entries.length} entries`;
      if (shown >= entries.length) moreBtn.remove();
    });
  }
  return null;
}
