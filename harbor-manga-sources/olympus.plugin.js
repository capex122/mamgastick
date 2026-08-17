const BASE = "https://olympustaff.com";
const PAGE_SIZE = 48;
function absolute(value, base) { if (!value) return undefined; try { return new URL(value, base || BASE).href; } catch (_) { return undefined; } }
function seriesSlug(url) { const m = String(url || "").match(/\/series\/([^/?#]+)(?:\/?(?:$|[?#]))/); return m ? m[1] : ""; }
function chapterNumber(value) { const m = String(value || "").match(/(?:chapter|الفصل|\/)(\d+(?:\.\d+)?)(?:\/?(?:$|[?#]))/i); return m ? m[1] : null; }
async function documentAt(url, headers) { const r = await harbor.http(url, { headers: Object.assign({ "user-agent": "Mozilla/5.0" }, headers || {}) }); return r.ok ? harbor.parseHtml(r.body) : null; }
function parseCards(doc) {
  if (!doc) return [];
  const result = [], seen = new Set();
  const cards = doc.querySelectorAll(".bs, .search-result-item, .card, .manga-card, .series-card");
  for (const card of cards) {
    const link = card.querySelector("a[href*='/series/']");
    const href = link && absolute(link.attr("href"));
    const id = seriesSlug(href);
    const heading = card.querySelector("h1, h2, h3, h4, h5, .title, .card-title, .tt");
    const title = (link && link.attr("title")) || (heading && heading.text()) || (link && link.text());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const image = card.querySelector("img");
    result.push({ id, title, cover: image && absolute(image.attr("data-src") || image.attr("src")) });
  }
  for (const link of doc.querySelectorAll("a[href*='/series/']")) {
    const href = absolute(link.attr("href")), id = seriesSlug(href);
    if (!id || seen.has(id)) continue;
    const heading = link.querySelector("h1, h2, h3, h4, h5, .title, .tt");
    const image = link.querySelector("img");
    const title = link.attr("title") || (heading && heading.text()) || (image && image.attr("alt")) || link.text();
    if (!title) continue;
    seen.add(id);
    result.push({ id, title, cover: image && absolute(image.attr("data-src") || image.attr("src")) });
  }
  return result;
}
const plugin = {
  id: "olympus-ar", name: "Olympus Staff (Arabic)",
  async popular(offset) { const page = Math.floor(offset / PAGE_SIZE) + 1; return parseCards(await documentAt(`${BASE}/series?page=${page}`)); },
  async search(query, offset) {
    if (offset > 0 || String(query).trim().length < 2) return [];
    return parseCards(await documentAt(`${BASE}/ajax/search?keyword=${encodeURIComponent(query)}`, { "x-requested-with": "XMLHttpRequest" }));
  },
  async detail(id) {
    const doc = await documentAt(`${BASE}/series/${encodeURIComponent(id)}`); if (!doc) return null;
    const title = doc.querySelector("h1, .series-title, .manga-title")?.text(); if (!title) return null;
    const image = doc.querySelector(".series-cover img, .manga-cover img, main img, .container img");
    return { id, title, cover: image && absolute(image.attr("data-src") || image.attr("src")), description: doc.querySelector(".description, .series-description, .story, .summary")?.text(), status: doc.querySelector(".status")?.text(), author: doc.querySelector(".author")?.text() };
  },
  async chapters(id) {
    const doc = await documentAt(`${BASE}/series/${encodeURIComponent(id)}`); if (!doc) return [];
    const result = [], seen = new Set();
    for (const link of doc.querySelectorAll(`a[href*='/series/${id}/']`)) {
      const url = absolute(link.attr("href"));
      if (!url || !new RegExp(`/series/${id}/\\d+/?$`).test(new URL(url).pathname) || seen.has(url)) continue;
      seen.add(url); result.push({ id: url, chapter: chapterNumber(url) || chapterNumber(link.text()), title: link.text(), pages: 0, language: "ar", group: "Olympus Staff" });
    }
    return result;
  },
  async pageUrls(chapterId) {
    const doc = await documentAt(chapterId); if (!doc) return [];
    const result = [], seen = new Set();
    for (const img of doc.querySelectorAll("img.manga-chapter-img, .chapter-content img, .reading-content img, .episode-content img")) {
      const url = absolute(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src"), chapterId);
      if (url && !seen.has(url) && !/logo|avatar|icon/i.test(url)) { seen.add(url); result.push(url); }
    }
    return result;
  }
};
