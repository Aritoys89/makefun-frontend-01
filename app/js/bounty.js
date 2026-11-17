// A bounty's page (#/bounty/<slug>): summary, the live pot and rewards
// table, dates and status, the full description, and the requirements
// (deliverables, deadlines, entry fee) from the requirements endpoint.
// The detail and the requirements are fetched in parallel: two requests.

import { getCompetition, getRequirements } from './api.js';
import { esc, fmtUSD, fmtNum, fmtDate, timeLeft, countdownText, shortAddr } from './format.js';

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

function escrowSummaryText(req, detail) {
  const escrow = req?.escrow || detail?.escrowLock;
  if (!escrow) return '';
  const state = detail?.escrowLifecycle?.state;
  const bits = [`Solana ${escrow.cluster || 'mainnet'} escrow`];
  if (state) bits.push(state);
  if (detail?.escrowLifecycle?.settled) bits.push('settled');
  return bits.join(' · ');
}

// The facts block: the numbers a visitor decides by, broken out on their
// own — live pot, base prizes, entry fee (and what it has raised), the
// rewards summary and where the money sits while the bounty runs.
function factsBlockHtml(detail, req) {
  const fee = Number(detail.entryFeeUsd);
  const pot = detail.potUsd ?? detail.rewardAmount;
  const paidPlaces = Array.isArray(detail.rewardsNow) ? detail.rewardsNow.length : 0;
  const escrow = escrowSummaryText(req, detail);
  const rows = [
    ['Live pot', fmtUSD(pot)],
    ['Base prizes', fmtUSD(detail.rewardAmount)],
    ['Entry fee', fee > 0 ? fmtUSD(fee) : 'Free'],
  ];
  if (fee > 0 && Number(detail.entryFeesUsd) > 0) {
    rows.push(['Fees in the pot', `${fmtUSD(detail.entryFeesUsd)} from ${fmtNum(detail.entryFeePayers)} entrants`]);
  }
  if (paidPlaces) rows.push(['Paid places', `${paidPlaces} places pay out`]);
  rows.push(['Entries', fmtNum(detail.submissionCount)]);
  rows.push(['Deadline', fmtDate(detail.deadline)]);
  if (detail.opensAt) rows.push(['Entries opened', fmtDate(detail.opensAt)]);
  rows.push(['Published', fmtDate(detail.publishedAt)]);
  if (escrow) rows.push(['Prize money', escrow]);
  return `<dl class="facts panel">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

// Copy text with the async clipboard API, falling back to a temporary
// textarea and execCommand where the clipboard is unavailable.
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

// The kit's own submit command, from the requirements' how_to_submit.cli,
// with a copy button; the placeholders (<url>, <sha>, …) are the entrant's
// to fill in.
function kitCommandHtml(req, slug) {
  const command = req?.how_to_submit?.cli;
  if (!command) return '';
  return `<div class="kit-command">
    <h3>Enter from the kit</h3>
    <p class="muted">The kit's submit command for this bounty, from its requirements — fill in the placeholders with your repo, commit and bundle:</p>
    <div class="command-row">
      <code class="command-text">${esc(command)}</code>
      <button class="button copy-button" type="button" data-command="${esc(command)}">Copy command</button>
    </div>
    <p class="muted">No kit yet? It is one download: <code>curl -sSL "https://make.fun/c/${esc(slug)}/kit" | tar xz</code></p>
  </div>`;
}

// The requirements as a readable checklist: what must be handed in (with
// the required ones marked), the entry fee, the key dates and the entry
// quota — all from GET /competitions/<slug>/requirements.
function requirementsChecklistHtml(req, slug) {
  if (!req) return '';
  const parts = [];
  if (Array.isArray(req.deliverables) && req.deliverables.length) {
    const items = req.deliverables.map((d) => `<li class="check-item">
      <span class="check-mark ${d.required ? 'check-required' : 'check-optional'}">${d.required ? '✓ required' : 'optional'}</span>
      <span><strong>${esc(d.name || d.kind || 'Deliverable')}</strong>${d.description ? ` — ${esc(d.description)}` : ''}</span>
    </li>`).join('');
    parts.push(`<h2>Requirements checklist</h2><ul class="checklist">${items}</ul>`);
  }
  const facts = [];
  const fee = req.entry_fee;
  if (fee && Number(fee.amount_usd) > 0) {
    facts.push(['Entry fee', `${fmtUSD(fee.amount_usd)} USDC, paid once per account`]);
  } else if (fee) {
    facts.push(['Entry fee', 'Free']);
  }
  if (req.quota?.max_per_day) facts.push(['Entry quota', `up to ${esc(req.quota.max_per_day)} entries per day`]);
  if (req.escrow?.vault) facts.push(['Escrow vault', shortAddr(req.escrow.vault)]);
  if (facts.length) {
    parts.push(`<dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);
  }
  if (req.deadlines && typeof req.deadlines === 'object') {
    const rows = Object.entries(req.deadlines)
      .filter(([, v]) => typeof v === 'string' && v)
      .map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(fmtDate(v))}</dd></div>`).join('');
    if (rows) parts.push(`<h3>Key dates</h3><dl class="facts">${rows}</dl>`);
  }
  if (req.prerequisites?.summary) {
    parts.push(`<h3>Before you start</h3><p>${esc(req.prerequisites.summary)}</p>`);
  }
  parts.push(kitCommandHtml(req, slug));
  return parts.length ? `<section class="panel">${parts.join('')}</section>` : '';
}

export async function renderBounty(app, slug) {
  app.innerHTML = `<section class="panel" aria-busy="true">
    <div class="skel skel-chip"></div>
    <div class="skel skel-title wide"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-stats"></div>
  </section>`;
  const [detail, req] = await Promise.all([
    getCompetition(slug),
    getRequirements(slug).catch(() => null),
  ]);
  const left = timeLeft(detail.deadline);
  const pot = detail.potUsd ?? detail.rewardAmount;
  app.innerHTML = `<section>
    <p class="crumbs"><a href="#/">&larr; All bounties</a></p>
    <div class="page-head">
      <span class="chip">${esc(detail.category || 'Bounty')}</span>
      <span class="chip ${left.open ? 'chip-open' : 'chip-closed'} countdown" data-deadline="${esc(detail.deadline || '')}">${esc(countdownText(detail.deadline))}</span>
      <span class="chip">${esc(detail.status)}${left.open ? ' · taking entries' : ' · closed'}</span>
      <h1>${esc(detail.title)}</h1>
      <p class="lede">${esc(detail.summary || '')}</p>
      <p class="muted">Sponsored by ${esc(detail.sponsor?.name || 'make.fun')}</p>
    </div>
    ${factsBlockHtml(detail, req)}
    <section class="panel">
      <h2>Rewards <span class="muted">— live pot ${esc(fmtUSD(pot))}</span></h2>
      ${rewardsTable(detail)}
      <p><a class="button" href="#/bounty/${esc(detail.slug)}/leaderboard">View the leaderboard</a></p>
    </section>
    <section class="panel prose">
      <h2>About this bounty</h2>
      ${mdLite(detail.description)}
    </section>
    ${requirementsChecklistHtml(req, detail.slug)}
  </section>`;
  const copyBtn = app.querySelector('.copy-button');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(copyBtn.dataset.command || '');
      copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed — select the text';
      setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 2500);
    });
  }
  const clockEl = app.querySelector('.countdown');
  if (!clockEl) return null;
  const clockTimer = setInterval(() => {
    clockEl.textContent = countdownText(detail.deadline);
  }, 1000);
  return () => clearInterval(clockTimer);
}
