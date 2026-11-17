// The bounty board (#/): every live bounty with its live pot, its entry fee
// where one is set, its time left and its entry count. Status tabs, a text
// search and sorting all work on the pages already fetched, so they cost no
// further requests; a "load more" button follows the API's next_cursor for
// the next page. Whether a bounty still takes entries is decided by its
// deadline alone — a bounty past it may still read status "open" — and a
// one-second ticker rewrites each card's countdown in place, no refetch.

import { getCompetitionsPage } from './api.js';
import { esc, fmtUSD, fmtNum, countdownText, bountyStatusTab } from './format.js';

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open now' },
  { key: 'soon', label: 'Closing soon' },
  { key: 'closed', label: 'Closed' },
];

function potOf(item) {
  const pot = Number(item.potUsd);
  return Number.isFinite(pot) ? pot : Number(item.rewardAmount) || 0;
}

function boardCardHtml(item, now) {
  const tab = bountyStatusTab(item, now);
  const fee = Number(item.entryFeeUsd);
  const summary = item.summary || String(item.description || '').split('\n')[0];
  return `<article class="card">
    <div class="card-top">
      <span class="chip">${esc(item.category || 'Bounty')}</span>
      <span class="chip ${tab === 'closed' ? 'chip-closed' : 'chip-open'} countdown" data-deadline="${esc(item.deadline || '')}">${esc(countdownText(item.deadline, now))}</span>
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

function skeletonCardsHtml(count) {
  return Array.from({ length: count }, () => `<article class="card skeleton-card" aria-hidden="true">
    <div class="skel skel-chip"></div>
    <div class="skel skel-title"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line short"></div>
    <div class="skel skel-stats"></div>
  </article>`).join('');
}

function matchesSearch(item, query) {
  if (!query) return true;
  const hay = [item.title, item.slug, item.category, ...(item.skills || [])].join(' ').toLowerCase();
  return hay.includes(query);
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

// The live clocks: once a second, rewrite the text of every countdown chip
// from its deadline. Nothing is refetched and nothing else is redrawn.
function startCountdownTicker(root) {
  const tick = () => {
    const now = Date.now();
    root.querySelectorAll('.countdown').forEach((el) => {
      el.textContent = countdownText(el.dataset.deadline, now);
    });
  };
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

export async function renderBoard(app) {
  app.innerHTML = `<section>
    <div class="page-head">
      <h1>Live bounties</h1>
      <p class="muted">Every bounty on make.fun, with its live pot, entry fee, time left and entries. Clocks tick live; status is read from each deadline, never the status label alone.</p>
    </div>
    <div class="controls">
      <input id="filter" type="search" placeholder="Search title, slug, category or skill…" aria-label="Search bounties">
      <select id="sort" aria-label="Sort bounties">
        <option value="ending">Ending soon</option>
        <option value="pot">Biggest pot</option>
        <option value="entries">Most entries</option>
        <option value="newest">Newest</option>
      </select>
      <span class="kbd-hint"><kbd>/</kbd> to search</span>
    </div>
    <div class="tabs" role="tablist" aria-label="Bounty status">
      ${STATUS_TABS.map((t) => `<button type="button" class="tab${t.key === 'all' ? ' tab-active' : ''}" data-tab="${t.key}" role="tab">${t.label} <span class="tab-count" data-count="${t.key}"></span></button>`).join('')}
    </div>
    <div class="grid" id="cards">${skeletonCardsHtml(6)}</div>
    <p id="more-wrap" hidden><button class="button" id="more" type="button">Load more bounties</button></p>
  </section>`;

  const cardsEl = app.querySelector('#cards');
  const filterEl = app.querySelector('#filter');
  const sortEl = app.querySelector('#sort');
  const moreWrap = app.querySelector('#more-wrap');
  const moreBtn = app.querySelector('#more');
  const tabEls = [...app.querySelectorAll('.tab')];
  const items = [];
  let activeTab = 'all';
  let nextCursor = null;
  let loadingPage = false;

  function drawCounts() {
    const now = Date.now();
    const counts = { all: items.length, open: 0, soon: 0, closed: 0 };
    for (const item of items) counts[bountyStatusTab(item, now)] += 1;
    tabEls.forEach((el) => {
      el.querySelector('.tab-count').textContent = counts[el.dataset.tab];
    });
  }

  function draw() {
    const now = Date.now();
    const query = filterEl.value.trim().toLowerCase();
    const list = items
      .filter((item) => (activeTab === 'all' || bountyStatusTab(item, now) === activeTab) && matchesSearch(item, query))
      .sort(SORTERS[sortEl.value] || SORTERS.ending);
    cardsEl.innerHTML = list.length
      ? list.map((item) => boardCardHtml(item, now)).join('')
      : `<div class="empty-state">
          <p><strong>No bounties match.</strong></p>
          <p class="muted">Nothing on this tab fits that search. Try a shorter word, or clear the filters to see the whole board.</p>
          <p><button class="button" id="reset-filters" type="button">Clear search and filters</button></p>
        </div>`;
    const reset = cardsEl.querySelector('#reset-filters');
    if (reset) reset.addEventListener('click', () => {
      filterEl.value = '';
      activeTab = 'all';
      tabEls.forEach((el) => el.classList.toggle('tab-active', el.dataset.tab === 'all'));
      draw();
    });
    drawCounts();
  }

  async function appendNextPage() {
    if (loadingPage || nextCursor === null && items.length) return;
    loadingPage = true;
    moreBtn.disabled = true;
    try {
      const page = await getCompetitionsPage(nextCursor);
      items.push(...page.items);
      nextCursor = page.nextCursor;
      moreWrap.hidden = !nextCursor;
      draw();
    } finally {
      loadingPage = false;
      moreBtn.disabled = false;
    }
  }

  filterEl.addEventListener('input', draw);
  sortEl.addEventListener('change', draw);
  tabEls.forEach((el) => el.addEventListener('click', () => {
    activeTab = el.dataset.tab;
    tabEls.forEach((t) => t.classList.toggle('tab-active', t === el));
    draw();
  }));
  moreBtn.addEventListener('click', appendNextPage);

  const firstPage = await getCompetitionsPage(null);
  items.push(...firstPage.items);
  nextCursor = firstPage.nextCursor;
  moreWrap.hidden = !nextCursor;
  draw();
  return startCountdownTicker(app);
}
