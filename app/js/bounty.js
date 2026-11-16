// A bounty's page (#/bounty/<slug>): summary, the live pot and rewards
// table, dates and status, the full description, and the requirements
// (deliverables, deadlines, entry fee) from the requirements endpoint.
// The detail and the requirements are fetched in parallel: two requests.

import { getCompetition, getRequirements } from './api.js';
import { esc, fmtUSD, fmtNum, fmtDate, timeLeft } from './format.js';

// A small, safe Markdown-to-HTML renderer for bounty descriptions: the text
// is escaped first, then block structure (headings, lists, code fences) and
// inline marks (code, bold, italic, links) are applied on the escaped text.
function inlineMd(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

export function mdLite(markdown) {
  const lines = esc(markdown || '').split('\n');
  const out = [];
  let list = null;
  let code = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (line.trim().startsWith('```')) { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (line.trim().startsWith('```')) { closeList(); code = []; continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inlineMd((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) out.push(`<p>${inlineMd(line)}</p>`);
  }
  closeList();
  if (code !== null) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  return out.join('\n');
}

function rewardsTable(detail) {
  if (Array.isArray(detail.rewardsNow) && detail.rewardsNow.length) {
    const rows = detail.rewardsNow.map((r) => `<tr>
      <td>${esc(r.place)}</td><td>${esc(fmtUSD(r.baseUsd))}</td>
      <td>${esc(fmtUSD(r.feeShareUsd))}</td><td><strong>${esc(fmtUSD(r.amountUsd))}</strong></td>
    </tr>`).join('');
    return `<table class="data"><thead><tr><th>Place</th><th>Base prize</th><th>Fee share</th><th>Total now</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (detail.rewards && typeof detail.rewards === 'object') {
    const rows = Object.entries(detail.rewards)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([place, usd]) => `<tr><td>${esc(place)}</td><td><strong>${esc(fmtUSD(usd))}</strong></td></tr>`).join('');
    return `<table class="data"><thead><tr><th>Place</th><th>Prize</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return '<p class="muted">No rewards table published.</p>';
}

function requirementsHtml(req) {
  if (!req) return '';
  const parts = [];
  if (Array.isArray(req.deliverables) && req.deliverables.length) {
    const items = req.deliverables.map((d) =>
      `<li><strong>${esc(d.name || d.kind || 'Deliverable')}</strong>${d.description ? ` — ${esc(d.description)}` : ''}</li>`).join('');
    parts.push(`<h2>Deliverables</h2><ul class="plain">${items}</ul>`);
  }
  if (req.deadlines && typeof req.deadlines === 'object') {
    const rows = Object.entries(req.deadlines)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(fmtDate(v))}</dd></div>`).join('');
    if (rows) parts.push(`<h2>Key dates</h2><dl class="facts">${rows}</dl>`);
  }
  if (req.prerequisites?.summary) {
    parts.push(`<h2>Before you start</h2><p>${esc(req.prerequisites.summary)}</p>`);
  }
  return parts.length ? `<section class="panel">${parts.join('')}</section>` : '';
}

export async function renderBounty(app, slug) {
  app.innerHTML = '<section class="panel"><p class="muted">Loading bounty…</p></section>';
  const [detail, req] = await Promise.all([
    getCompetition(slug),
    getRequirements(slug).catch(() => null),
  ]);
  const left = timeLeft(detail.deadline);
  const fee = Number(detail.entryFeeUsd);
  const pot = detail.potUsd ?? detail.rewardAmount;
  app.innerHTML = `<section>
    <p class="crumbs"><a href="#/">&larr; All bounties</a></p>
    <div class="page-head">
      <span class="chip">${esc(detail.category || 'Bounty')}</span>
      <span class="chip ${left.open ? 'chip-open' : 'chip-closed'}">${esc(left.text)}</span>
      <h1>${esc(detail.title)}</h1>
      <p class="lede">${esc(detail.summary || '')}</p>
    </div>
    <dl class="facts panel">
      <div><dt>Live pot</dt><dd>${esc(fmtUSD(pot))}</dd></div>
      <div><dt>Base prizes</dt><dd>${esc(fmtUSD(detail.rewardAmount))}</dd></div>
      <div><dt>Entry fee</dt><dd>${fee > 0 ? esc(fmtUSD(fee)) : 'Free'}</dd></div>
      <div><dt>Entries</dt><dd>${esc(fmtNum(detail.submissionCount))}</dd></div>
      <div><dt>Deadline</dt><dd>${esc(fmtDate(detail.deadline))}</dd></div>
      <div><dt>Published</dt><dd>${esc(fmtDate(detail.publishedAt))}</dd></div>
      <div><dt>Status</dt><dd>${esc(detail.status)}${left.open ? ' · taking entries' : ' · closed'}</dd></div>
      <div><dt>Sponsor</dt><dd>${esc(detail.sponsor?.name || '—')}</dd></div>
    </dl>
    <section class="panel">
      <h2>Rewards <span class="muted">— live pot ${esc(fmtUSD(pot))}</span></h2>
      ${rewardsTable(detail)}
      <p><a class="button" href="#/bounty/${esc(detail.slug)}/leaderboard">View the leaderboard</a></p>
    </section>
    <section class="panel prose">
      <h2>About this bounty</h2>
      ${mdLite(detail.description)}
    </section>
    ${requirementsHtml(req)}
  </section>`;
  return null;
}
