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
    const res = await fetch(url, { headers });
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

// The board list is one page today; follow next_cursor a few pages at most
// so the board stays complete if the list ever grows past one page.
export async function getCompetitions() {
  const items = [];
  let path = '/competitions?status=open';
  for (let page = 0; page < 4 && path; page += 1) {
    const data = await getJSON(path);
    const batch = Array.isArray(data) ? data : (data.items ?? []);
    items.push(...batch);
    const cursor = data && !Array.isArray(data) ? data.next_cursor : null;
    path = cursor ? `/competitions?status=open&cursor=${encodeURIComponent(cursor)}` : null;
  }
  return items;
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
