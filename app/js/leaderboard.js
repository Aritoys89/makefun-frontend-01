// A bounty's leaderboard (#/bounty/<slug>/leaderboard): ranked entries with
// the rates the API gives them. The columns come from the API's own column
// definitions; micro rates are shown as percents and sizes as bytes. Long
// boards render 100 rows at a time behind a "show more" button, so a board
// with thousands of entries never builds thousands of DOM rows at once.

import { getLeaderboard, absUrl } from './api.js';
import { esc, fmtBytes, microRate } from './format.js';

const PAGE = 100;

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
  app.innerHTML = '<section class="panel"><p class="muted">Loading leaderboard…</p></section>';
  const data = await getLeaderboard(slug);
  const entries = data.entries || [];
  const cols = (data.columns || []).filter((c) => !c.hidden);
  const phase = data.phase || {};
  let shown = PAGE;

  function rowsHtml() {
    return entries.slice(0, shown).map((entry) => {
      const initial = esc((entry.handle || '?').charAt(0).toUpperCase());
      const avatar = `<span class="avatar-pick">${initial}${entry.image
        ? `<img crossorigin="anonymous" loading="lazy" alt="" src="${esc(absUrl(entry.image))}">`
        : ''}</span>`;
      const cells = cols.map((col) => `<td class="num">${esc(cellValue(entry, col))}</td>`).join('');
      return `<tr>
        <td class="rank">${esc(entry.rank ?? '—')}</td>
        <td><div class="entrant">${avatar}<span>
          <a href="#/u/${esc(entry.handle)}">@${esc(entry.handle)}</a>
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
        ${data.metrics_withheld ? ' · some metrics withheld' : ''}</p>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th>Entrant</th>${cols.map((c) => `<th>${esc(c.title)}</th>`).join('')}</tr></thead>
      <tbody id="rows">${rowsHtml()}</tbody>
    </table></div>
    <p class="muted" id="count">${Math.min(shown, entries.length)} of ${entries.length} entries</p>
    ${entries.length > shown ? '<p><button class="button" id="more" type="button">Show more entries</button></p>' : ''}
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
