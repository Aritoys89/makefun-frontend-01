// A bounty's leaderboard (#/bounty/<slug>/leaderboard): ranked entries with
// the rates the API gives them. The columns come from the API's own column
// definitions; micro rates are shown as percents and sizes as bytes. Long
// boards render 100 rows at a time behind a "show more" button, so a board
// with thousands of entries never builds thousands of DOM rows at once. A
// filter box narrows the loaded entries by entrant or entry title at no
// request cost, a strip at the top sums the prizes, and a band in the
// table marks where the paid places end.

import { getLeaderboard, getCompetition, absUrl } from './api.js';
import { esc, fmtBytes, fmtUSD, microRate } from './format.js';

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

// The prize summary for the strip: how many places pay, what they pay in
// all, and the top prize — from the same detail the paid ranks come from,
// so the strip and the highlighting can never disagree.
function prizeSummaryOf(detail) {
  const amounts = [];
  if (Array.isArray(detail?.rewardsNow) && detail.rewardsNow.length) {
    for (const r of detail.rewardsNow) amounts.push(Number(r.amountUsd));
  } else if (detail?.rewards && typeof detail.rewards === 'object') {
    for (const usd of Object.values(detail.rewards)) amounts.push(Number(usd));
  }
  const clean = amounts.filter((n) => Number.isFinite(n) && n > 0);
  if (!clean.length) return null;
  return {
    places: clean.length,
    total: clean.reduce((sum, n) => sum + n, 0),
    top: Math.max(...clean),
  };
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

function matchesQuery(entry, query) {
  if (!query) return true;
  const hay = `${entry.handle || ''} ${entry.title || ''}`.toLowerCase();
  return hay.includes(query);
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
  const lastPaid = paidRanks.size ? Math.max(...paidRanks) : 0;
  const summary = prizeSummaryOf(detail);
  const colSpan = cols.length + 2;
  let shown = PAGE;
  let query = '';

  const visibleEntries = () => entries.filter((entry) => matchesQuery(entry, query));

  function entryRowHtml(entry) {
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
  }

  // The rows on show, with one band row where the paid places end: the
  // first visible row past the last paid rank carries the marker, so the
  // cut is visible wherever the visitor has paged or filtered to.
  function rowsHtml(list) {
    let bandShown = false;
    return list.slice(0, shown).map((entry) => {
      const rank = Number(entry.rank);
      let band = '';
      if (lastPaid > 0 && !bandShown && rank > lastPaid) {
        bandShown = true;
        band = `<tr class="band-row"><td colspan="${colSpan}">Below the paid places — places past ${lastPaid} take no prize</td></tr>`;
      }
      return band + entryRowHtml(entry);
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
    ${summary ? `<dl class="facts panel prize-strip">
      <div><dt>Paid places</dt><dd>${esc(summary.places)}</dd></div>
      <div><dt>Prizes in all</dt><dd>${esc(fmtUSD(summary.total))}</dd></div>
      <div><dt>Top prize</dt><dd>${esc(fmtUSD(summary.top))}</dd></div>
      <div><dt>Entries ranked</dt><dd>${esc(entries.length.toLocaleString('en-US'))}</dd></div>
    </dl>` : ''}
    ${entries.length ? `<div class="controls">
        <input id="lb-filter" type="search" placeholder="Filter by entrant or entry title…" aria-label="Filter leaderboard entries">
      </div>
      <div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th>Entrant</th>${cols.map((c) => `<th>${esc(c.title)}</th>`).join('')}</tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <p class="muted" id="count"></p>
    <p id="more-wrap" hidden><button class="button" id="more" type="button">Show more entries</button></p>`
    : `<div class="empty-state">
        <p><strong>No entries yet.</strong></p>
        <p class="muted">This leaderboard fills in as entries arrive and are graded. Be the first to enter.</p>
        <p><a class="button" href="#/bounty/${esc(slug)}">About this bounty</a></p>
      </div>`}
  </section>`;

  if (!entries.length) return null;

  const rowsEl = app.querySelector('#rows');
  const countEl = app.querySelector('#count');
  const moreWrap = app.querySelector('#more-wrap');
  const filterEl = app.querySelector('#lb-filter');

  function draw() {
    const list = visibleEntries();
    rowsEl.innerHTML = list.length
      ? rowsHtml(list)
      : `<tr><td colspan="${colSpan}" class="no-match">No entrant or entry title matches “${esc(query)}”. Clear the filter to see the whole board.</td></tr>`;
    countEl.textContent = query
      ? `${Math.min(shown, list.length)} of ${list.length} matching entries (${entries.length} in all)`
      : `${Math.min(shown, list.length)} of ${entries.length} entries`;
    moreWrap.hidden = shown >= list.length;
  }

  filterEl.addEventListener('input', () => {
    query = filterEl.value.trim().toLowerCase();
    shown = PAGE;
    draw();
  });
  app.querySelector('#more').addEventListener('click', () => {
    shown += PAGE;
    draw();
  });
  draw();
  return null;
}
