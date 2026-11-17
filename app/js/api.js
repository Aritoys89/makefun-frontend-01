// The make.fun public API client: GET only, read-only.
// Answers are kept in an in-memory cache and revalidated with If-None-Match:
// the API's ETags are bound to the minute, so a revalidation inside the same
// minute answers 304 and costs no body at all. Repeat visits to a view are
// served from the cache while one revalidation is in flight at most.

const BASE = 'https://make.fun/api';
const cache = new Map(); // url -> { etag, data }
const inflight = new Map(); // url -> Promise

export function absUrl(path) {
  if (!path) return '';
  const s = String(path);
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return 'https://make.fun' + (s.startsWith('/') ? s : '/' + s);
}

export function getJSON(path) {
  const url = BASE + path;
  if (inflight.has(url)) return inflight.get(url);
  const promise = (async () => {
    const hit = cache.get(url);
    const headers = {};
    if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      // A failed revalidation with a cached answer on hand serves the
      // cached answer rather than breaking the view.
      if (hit) return hit.data;
      throw err;
    }
    if (res.status === 304 && hit) return hit.data;
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
    const data = await res.json();
    cache.set(url, { etag: res.headers.get('ETag'), data });
    return data;
  })();
  inflight.set(url, promise);
  promise.then(() => inflight.delete(url), () => inflight.delete(url));
  return promise;
}

// One page of the board list, with the cursor the API hands back for the
// next page (null when the list is complete). The board's "load more"
// button follows it, so the first load fetches one page only.
export async function getCompetitionsPage(cursor) {
  const path = '/competitions?status=open' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
  const data = await getJSON(path);
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return { items, nextCursor: Array.isArray(data) ? null : (data.next_cursor ?? null) };
}

export function getCompetition(slug) {
  return getJSON(`/competitions/${encodeURIComponent(slug)}`);
}

export function getRequirements(slug) {
  return getJSON(`/competitions/${encodeURIComponent(slug)}/requirements`);
}

export function getLeaderboard(slug) {
  return getJSON(`/competitions/${encodeURIComponent(slug)}/leaderboard`);
}

export function getProfile(handle) {
  return getJSON(`/profiles/${encodeURIComponent(handle)}`);
}
