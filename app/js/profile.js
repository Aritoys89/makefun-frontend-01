// An account's public profile (#/u/<handle>): who they are, their record,
// their entries and their payouts — one API request for the whole page.
// Avatars are hosted on make.fun and send Cross-Origin-Resource-Policy:
// same-origin, so the <img> carries crossorigin="anonymous".

import { getProfile, absUrl } from './api.js';
import { esc, fmtUSD, fmtNum, fmtDate, microRate, shortAddr } from './format.js';

function scoreText(score) {
  if (!score) return '';
  if ((score.column?.source || '').includes('micro')) return microRate(score.value);
  return score.display ?? String(score.value ?? '');
}

function entryRow(sol) {
  const comp = sol.competition || {};
  const bits = [];
  if (sol.placement) bits.push(`Placed #${sol.placement}`);
  if (sol.prize_usd) bits.push(`won ${fmtUSD(sol.prize_usd)}`);
  const score = scoreText(sol.score);
  if (score) bits.push(`${sol.score.column?.title || 'Score'} ${score}`);
  bits.push(`entered ${fmtDate(sol.entered_at)}`);
  return `<li class="entry-row">
    <div><a href="#/bounty/${esc(comp.slug)}">${esc(comp.title || comp.slug || 'Bounty')}</a></div>
    <div class="entry-title">${esc(sol.title || '')}</div>
    <div class="muted">${esc(bits.join(' · '))}</div>
  </li>`;
}

function payoutRow(p) {
  const amount = p.amount_usd ?? p.prize_usd ?? p.amount;
  const when = p.paid_at ?? p.created_at ?? p.at;
  const comp = p.competition?.title ?? p.competition_slug ?? p.competition ?? '';
  return `<li class="entry-row">
    <div><strong>${esc(fmtUSD(amount))}</strong>${comp ? ` — ${esc(comp)}` : ''}</div>
    <div class="muted">${esc(fmtDate(when))}</div>
  </li>`;
}

export async function renderProfile(app, handle) {
  app.innerHTML = '<section class="panel"><p class="muted">Loading profile…</p></section>';
  const p = await getProfile(handle);
  const avatarPath = p.avatar?.url || p.image;
  const initial = esc((p.handle || '?').charAt(0).toUpperCase());
  const avatar = avatarPath
    ? `<span class="avatar-pick avatar-pick-lg">${initial}<img crossorigin="anonymous" alt="" src="${esc(absUrl(avatarPath))}"></span>`
    : '';
  const record = p.record || {};
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
    <dl class="facts panel">
      <div><dt>Entered</dt><dd>${esc(fmtNum(record.competitions_entered))}</dd></div>
      <div><dt>Placed</dt><dd>${esc(fmtNum(record.competitions_placed))}</dd></div>
      <div><dt>Won</dt><dd>${esc(fmtNum(record.competitions_won))}</dd></div>
      <div><dt>Podiums</dt><dd>${esc(fmtNum(record.podium_finishes))}</dd></div>
      <div><dt>Best placement</dt><dd>${record.best_placement ? '#' + esc(record.best_placement) : '—'}</dd></div>
      <div><dt>Prizes won</dt><dd>${esc(fmtUSD(record.prize_usd))}</dd></div>
    </dl>
    <section class="panel">
      <h2>Entries</h2>
      ${Array.isArray(p.solutions) && p.solutions.length
        ? `<ul class="plain">${p.solutions.map(entryRow).join('')}</ul>`
        : '<p class="muted">No entries yet.</p>'}
    </section>
    ${Array.isArray(p.payouts) && p.payouts.length ? `<section class="panel">
      <h2>Payouts</h2>
      <ul class="plain">${p.payouts.map(payoutRow).join('')}</ul>
    </section>` : ''}
  </section>`;
  return null;
}
