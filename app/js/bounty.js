// A bounty's page (#/bounty/<slug>): summary, the live pot and rewards
// table with a bar showing how the pot splits across the paid places, a
// timeline of the bounty's phases, the full description, the requirements
// (deliverables, deadlines, entry fee) from the requirements endpoint, and
// a rail of related bounties. The detail, the requirements and the board
// list (for the rail) are fetched in parallel: three requests, and the
// board list is usually the board's own cached page.

import { getCompetition, getRequirements, getCompetitionsPage } from './api.js';
import { esc, fmtUSD, fmtNum, fmtDate, fmtShare, timeLeft, countdownText, shortAddr, hueFor } from './format.js';

// A small, safe Markdown-to-HTML renderer for bounty descriptions: the text
// is escaped first, then block structure (headings, lists, tables, quotes,
// code fences) and inline marks (code, bold, italic, links) are applied on
// the escaped text, so no markup in a description can reach the page raw.
function inlineMd(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

// One row of a Markdown table, split on its pipes with the empty ends the
// leading and trailing pipes leave behind dropped.
function tableCells(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.map((c) => c.trim());
}

function isTableDivider(line) {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

export function mdLite(markdown) {
  const lines = esc(markdown || '').split('\n');
  const out = [];
  let list = null;
  let code = null;
  let quote = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => {
    if (quote) { out.push(`<blockquote>${quote.map((q) => `<p>${inlineMd(q)}</p>`).join('')}</blockquote>`); quote = null; }
  };
  const closeBlocks = () => { closeList(); closeQuote(); };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (code !== null) {
      if (line.trim().startsWith('```')) { out.push(`<pre><code>${code.join('\n')}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (line.trim().startsWith('```')) { closeBlocks(); code = []; continue; }
    // A table: a pipe row followed by a divider row of dashes. Body rows
    // are the pipe rows that follow; the first row is the header.
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeBlocks();
      const head = tableCells(line);
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(tableCells(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push(`<div class="table-wrap"><table class="data"><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeBlocks();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeBlocks(); out.push('<hr>'); continue; }
    // Quotes arrive escaped, so a quoted line starts with "&gt;".
    const quoted = line.match(/^&gt;\s?(.*)$/);
    if (quoted) {
      closeList();
      if (!quote) quote = [];
      quote.push(quoted[1]);
      continue;
    }
    closeQuote();
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
  closeBlocks();
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

// The paid places as { place, amount } pairs, from the live rewardsNow
// when the API gives it and from the static rewards table otherwise. The
// rewards bar and its legend are drawn from this one list.
function paidPlacesOf(detail) {
  if (Array.isArray(detail.rewardsNow) && detail.rewardsNow.length) {
    return detail.rewardsNow
      .map((r) => ({ place: Number(r.place), amount: Number(r.amountUsd) }))
      .filter((p) => p.place > 0 && Number.isFinite(p.amount))
      .sort((a, b) => a.place - b.place);
  }
  if (detail.rewards && typeof detail.rewards === 'object') {
    return Object.entries(detail.rewards)
      .map(([place, usd]) => ({ place: Number(place), amount: Number(usd) }))
      .filter((p) => p.place > 0 && Number.isFinite(p.amount))
      .sort((a, b) => a.place - b.place);
  }
  return [];
}

// The rewards bar: one stacked strip, a segment per paid place, its width
// the place's share of everything paid. First place wears the accent at
// full strength and each later place a paler step of it, so the winner's
// slice reads first. The legend names the podium shares in words.
function rewardsBarHtml(detail) {
  const places = paidPlacesOf(detail);
  const total = places.reduce((sum, p) => sum + p.amount, 0);
  if (places.length < 2 || !(total > 0)) return '';
  const segments = places.map((p, i) => {
    const share = p.amount / total;
    const light = Math.min(38 + i * 9, 82);
    return `<span class="bar-seg" style="width:${(share * 100).toFixed(2)}%;background:hsl(322 72% ${light}%)" title="Place ${p.place}: ${esc(fmtUSD(p.amount))} (${esc(fmtShare(share))})"></span>`;
  }).join('');
  const podium = places.slice(0, 3)
    .map((p) => `place ${p.place} takes ${esc(fmtShare(p.amount / total))}`)
    .join(' · ');
  const rest = places.length > 3 ? ` · ${places.length - 3} more paid place${places.length > 4 ? 's' : ''}` : '';
  return `<div class="rewards-bar">
    <div class="bar-track" role="img" aria-label="How the pot splits: ${esc(podium)}${esc(rest)}">${segments}</div>
    <p class="muted bar-legend">How the pot splits — ${esc(podium)}${esc(rest)}.</p>
  </div>`;
}

// The phase timeline: the bounty's dated milestones on one track — when it
// was published, when entries opened, any dated step the requirements name
// (results, judging, payout), and when entries close — with the stretch
// already lived filled in and "now" marked where it falls.
function phaseTimelineHtml(detail, req) {
  const nodes = [];
  const seen = new Set();
  const addNode = (label, iso) => {
    const t = new Date(iso || '').getTime();
    if (!Number.isFinite(t) || seen.has(t)) return;
    seen.add(t);
    nodes.push({ label, at: t, iso });
  };
  addNode('Published', detail.publishedAt);
  if (detail.opensAt && detail.opensAt !== detail.publishedAt) addNode('Entries opened', detail.opensAt);
  if (req?.deadlines && typeof req.deadlines === 'object') {
    for (const [key, value] of Object.entries(req.deadlines)) {
      if (typeof value === 'string' && value && value !== detail.deadline) {
        addNode(key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), value);
      }
    }
  }
  addNode('Entries close', detail.deadline);
  nodes.sort((a, b) => a.at - b.at);
  const close = nodes.find((n) => n.iso === detail.deadline);
  if (nodes.length < 2 || !close) return '';
  const start = nodes[0].at;
  const now = Date.now();
  // The track runs to the last dated step, not just the close, so a results
  // date weeks later sits at its true place instead of clamping to the end.
  const span = Math.max(nodes[nodes.length - 1].at - start, 1);
  const lived = Math.min(Math.max((now - start) / span, 0), 1);
  // Milestones cluster — a bounty's dated steps often land within hours of
  // its close — and centred labels would print over each other. Each node
  // takes the first label lane whose previous node sits at least a label's
  // width away (about 15% of the track); its dot stays on the track and
  // only its label steps down a lane, a full label's height per lane.
  const laneLastPos = [];
  for (const n of nodes) {
    n.pos = Math.min(Math.max((n.at - start) / span, 0), 1);
    let lane = 0;
    while (laneLastPos[lane] !== undefined && n.pos - laneLastPos[lane] < 0.15) lane += 1;
    laneLastPos[lane] = n.pos;
    n.lane = lane;
  }
  const laneCount = laneLastPos.length;
  const items = nodes.map((n) => {
    const state = n.at <= now ? 'node-done' : (n === close ? 'node-close' : 'node-next');
    return `<li class="tl-node ${state}" style="left:${(n.pos * 100).toFixed(1)}%">
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-label" style="margin-top:${7 + n.lane * 46}px">${esc(n.label)}</span>
      <span class="tl-date">${esc(fmtDate(n.iso))}</span>
    </li>`;
  }).join('');
  return `<section class="panel timeline-panel">
    <h2>Timeline</h2>
    <div class="timeline" style="height:${84 + (laneCount - 1) * 46}px">
      <div class="tl-track"><div class="tl-fill" style="width:${(lived * 100).toFixed(1)}%"></div></div>
      <ol class="tl-nodes">${items}</ol>
    </div>
    <p class="muted">${now >= close.at
      ? 'Entries have closed; the results follow the last dated step above.'
      : `${esc(countdownText(detail.deadline, now))} — the filled stretch is the time already lived since ${esc(nodes[0].label.toLowerCase())}.`}</p>
  </section>`;
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

// The related rail: up to three other bounties from the board list, the
// same category first and then the biggest pots, each a small card with
// its pot and its clock. The list is the board's first page — usually
// already in the API cache from the board itself, so it costs nothing.
function relatedBountiesHtml(detail, page) {
  const items = (page?.items || []).filter((item) => item.slug !== detail.slug);
  if (!items.length) return '';
  const pot = (item) => Number(item.potUsd) || Number(item.rewardAmount) || 0;
  const sameCategory = items
    .filter((item) => (item.category || '') === (detail.category || ''))
    .sort((a, b) => pot(b) - pot(a));
  const others = items
    .filter((item) => (item.category || '') !== (detail.category || ''))
    .sort((a, b) => pot(b) - pot(a));
  const picks = [...sameCategory, ...others].slice(0, 3);
  if (!picks.length) return '';
  const now = Date.now();
  const cards = picks.map((item) => `<article class="card mini-card" style="--cat-hue:${hueFor(item.category || 'Bounty')}">
    <div class="card-top">
      <span class="chip chip-cat"><span class="cat-dot" aria-hidden="true"></span>${esc(item.category || 'Bounty')}</span>
      <span class="chip countdown" data-deadline="${esc(item.deadline || '')}">${esc(countdownText(item.deadline, now))}</span>
    </div>
    <h3><a href="#/bounty/${esc(item.slug)}">${esc(item.title)}</a></h3>
    <dl class="card-stats">
      <div><dt>Live pot</dt><dd>${esc(fmtUSD(pot(item)))}</dd></div>
      <div><dt>Entries</dt><dd>${esc(fmtNum(item.submissionCount))}</dd></div>
    </dl>
  </article>`).join('');
  return `<section>
    <h2>Related bounties</h2>
    <div class="grid grid-mini">${cards}</div>
  </section>`;
}

export async function renderBounty(app, slug) {
  app.innerHTML = `<section class="panel" aria-busy="true">
    <div class="skel skel-chip"></div>
    <div class="skel skel-title wide"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-line"></div>
    <div class="skel skel-stats"></div>
  </section>`;
  const [detail, req, page] = await Promise.all([
    getCompetition(slug),
    getRequirements(slug).catch(() => null),
    getCompetitionsPage(null).catch(() => null),
  ]);
  const left = timeLeft(detail.deadline);
  const pot = detail.potUsd ?? detail.rewardAmount;
  app.innerHTML = `<section>
    <p class="crumbs"><a href="#/">&larr; All bounties</a></p>
    <div class="page-head">
      <span class="chip chip-cat" style="--cat-hue:${hueFor(detail.category || 'Bounty')}"><span class="cat-dot" aria-hidden="true"></span>${esc(detail.category || 'Bounty')}</span>
      <span class="chip ${left.open ? 'chip-open' : 'chip-closed'} countdown" data-deadline="${esc(detail.deadline || '')}">${esc(countdownText(detail.deadline))}</span>
      <span class="chip">${esc(detail.status)}${left.open ? ' · taking entries' : ' · closed'}</span>
      <h1>${esc(detail.title)}</h1>
      <p class="lede">${esc(detail.summary || '')}</p>
      <p class="muted">Sponsored by ${esc(detail.sponsor?.name || 'make.fun')}</p>
    </div>
    ${factsBlockHtml(detail, req)}
    ${phaseTimelineHtml(detail, req)}
    <section class="panel">
      <h2>Rewards <span class="muted">— live pot ${esc(fmtUSD(pot))}</span></h2>
      ${rewardsTable(detail)}
      ${rewardsBarHtml(detail)}
      <p><a class="button" href="#/bounty/${esc(detail.slug)}/leaderboard">View the leaderboard</a></p>
    </section>
    <section class="panel prose">
      <h2>About this bounty</h2>
      ${mdLite(detail.description)}
    </section>
    ${requirementsChecklistHtml(req, detail.slug)}
    ${relatedBountiesHtml(detail, page)}
  </section>`;
  const copyBtn = app.querySelector('.copy-button');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyTextToClipboard(copyBtn.dataset.command || '');
      copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed — select the text';
      setTimeout(() => { copyBtn.textContent = 'Copy command'; }, 2500);
    });
  }
  // Every clock on the page — the head chip and the related cards — ticks
  // once a second from its own deadline, with nothing refetched.
  const clockEls = app.querySelectorAll('.countdown');
  if (!clockEls.length) return null;
  const clockTimer = setInterval(() => {
    const now = Date.now();
    clockEls.forEach((el) => { el.textContent = countdownText(el.dataset.deadline, now); });
  }, 1000);
  return () => clearInterval(clockTimer);
}
