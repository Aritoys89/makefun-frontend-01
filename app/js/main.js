// funboard's boot and hash router. The board module loads with the page;
// the bounty, leaderboard and profile modules load lazily by import() the
// first time their route is visited, keeping the first load small.
//
// Screenshot contract: window.__shotReady is false while a route loads and
// true once its data has rendered (or its error has been shown).

import { renderBoard } from './board.js';
import { esc } from './format.js';

const app = document.getElementById('app');
let cleanup = null;

function showError(err) {
  app.innerHTML = `<section class="panel error">
    <h1>Something went wrong</h1>
    <p>${esc(err && err.message ? err.message : err)}</p>
    <p><a href="#/">Back to the bounty board</a></p>
  </section>`;
}

async function route() {
  window.__shotReady = false;
  if (cleanup) { cleanup(); cleanup = null; }
  window.scrollTo(0, 0);
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean)
    .map((p) => decodeURIComponent(p));
  try {
    if (parts.length === 0) {
      cleanup = await renderBoard(app);
    } else if (parts[0] === 'bounty' && parts.length === 2) {
      const view = await import('./bounty.js');
      cleanup = await view.renderBounty(app, parts[1]);
    } else if (parts[0] === 'bounty' && parts.length === 3 && parts[2] === 'leaderboard') {
      const view = await import('./leaderboard.js');
      cleanup = await view.renderLeaderboard(app, parts[1]);
    } else if (parts[0] === 'u' && parts.length === 2) {
      const view = await import('./profile.js');
      cleanup = await view.renderProfile(app, parts[1]);
    } else {
      app.innerHTML = `<section class="panel">
        <h1>Page not found</h1>
        <p>No surface lives at this address.</p>
        <p><a href="#/">Back to the bounty board</a></p>
      </section>`;
    }
  } catch (err) {
    showError(err);
  }
  window.__shotReady = true;
}

window.addEventListener('hashchange', route);
route();
