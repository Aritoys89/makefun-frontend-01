// The bounty board (#/): every live bounty with its live pot, its entry fee
// where one is set, its time left (by deadline, never by status alone) and
// its entry count. Sorting and a text filter work on the cached list, so
// they cost no further requests; a one-minute timer refreshes the clocks.

import { getCompetitions } from './api.js';
import { esc, fmtUSD, fmtNum, timeLeft } from './format.js';

function potOf(item) {
  const pot = Number(item.potUsd);
  return Number.isFinite(pot) ? pot : Number(item.rewardAmount) || 0;
}

function cardHtml(item, now) {
  const left = timeLeft(item.deadline, now);
  const fee = Number(item.entryFeeUsd);
  const summary = item.summary || String(item.description || '').split('\n')[0];
  return `<article class="card">
    <div class="card-top">
      <span class="chip">${esc(item.category || 'Bounty')}</span>
      <span class="chip ${left.open ? 'chip-open' : 'chip-closed'}">${esc(left.text)}</span>
    </div>
    <h3><a href="#/bounty/${esc(item.slug)}">${esc(item.title)}</a></h3>
    <p class="summary">${esc(summary)}</p>
    <dl class="card-stats">
      <div><dt>Live pot</dt><dd>${esc(fmtUSD(potOf(item)))}</dd></div>
      <div><dt>Entry fee</dt><dd>${fee > 0 ? esc(fmtUSD(fee)) : 'Free'}</dd></div>
      <div><dt>Entries</dt><dd>${esc(fmtNum(item.submissionCount))}</dd></div>
    </dl>
    <div class="card-foot">
      <span class="muted">${esc(item.sponsor?.name || '')}</span>
      <a href="#/bounty/${esc(item.slug)}/leaderboard">Leaderboard &rarr;</a>
    </div>
  </article>`;
}

const SORTERS = {
  ending: (a, b) => {
    const now = Date.now();
    const aOpen = new Date(a.deadline).getTime() > now;
    const bOpen = new Date(b.deadline).getTime() > now;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return aOpen
      ? new Date(a.deadline) - new Date(b.deadline)
      : new Date(b.deadline) - new Date(a.deadline);
  },
  pot: (a, b) => potOf(b) - potOf(a),
  entries: (a, b) => (b.submissionCount || 0) - (a.submissionCount || 0),
  newest: (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
};

export async function renderBoard(app) {
  app.innerHTML = `<section>
    <div class="page-head">
      <h1>Live bounties</h1>
      <p class="muted">Every bounty on make.fun, with its live pot, entry fee, time left and entries.</p>
    </div>
    <div class="controls">
      <input id="filter" type="search" placeholder="Filter by title, category or skill…" aria-label="Filter bounties">
      <select id="sort" aria-label="Sort bounties">
        <option value="ending">Ending soon</option>
        <option value="pot">Biggest pot</option>
        <option value="entries">Most entries</option>
        <option value="newest">Newest</option>
      </select>
      <label class="check"><input id="open-only" type="checkbox"> Open only</label>
    </div>
    <div class="grid" id="cards"><p class="muted">Loading live bounties…</p></div>
  </section>`;

  const items = await getCompetitions();
  const cardsEl = app.querySelector('#cards');
  const filterEl = app.querySelector('#filter');
  const sortEl = app.querySelector('#sort');
  const openEl = app.querySelector('#open-only');
  let timer = null;

  function draw() {
    const now = Date.now();
    const q = filterEl.value.trim().toLowerCase();
    let list = items.filter((item) => {
      if (openEl.checked && !(new Date(item.deadline).getTime() > now)) return false;
      if (!q) return true;
      const hay = [item.title, item.slug, item.category, ...(item.skills || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
    list = [...list].sort(SORTERS[sortEl.value] || SORTERS.ending);
    cardsEl.innerHTML = list.length
      ? list.map((item) => cardHtml(item, now)).join('')
      : '<p class="muted">No bounties match.</p>';
  }

  filterEl.addEventListener('input', draw);
  sortEl.addEventListener('change', draw);
  openEl.addEventListener('change', draw);
  draw();
  timer = setInterval(draw, 60000);
  return () => clearInterval(timer);
}
