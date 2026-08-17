const BASE = "https://3asq.online";
const PAGE_SIZE = 48;

function absolute(value, base) {
  if (!value) return undefined;
  try { return new URL(value, base || BASE).href; } catch (_) { return undefined; }
}
function slugFrom(url) {
  const match = String(url || "").match(/\/manga\/([^/?#]+)\/?/);
  return match ? match[1] : "";
}
function chapterNumber(value) {
  const match = String(value || "").match(/(?:chapter|الفصل|\/)(\d+(?:\.\d+)?)(?:\/?(?:$|[?#]))/i);
  return match ? match[1] : null;
}
async function documentAt(url) {
  const response = await harbor.http(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) return null;
  return harbor.parseHtml(response.body);
}
function summaries(doc) {
  if (!doc) return [];
  const rows = doc.querySelectorAll(".c-tabs-item__content, .page-item-detail, .row.c-tabs-item__content");
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const link = row.querySelector(".post-title a, .item-summary a, a[href*='/manga/']");
    const href = link && absolute(link.attr("href"));
    const id = slugFrom(href);
    const title = link && link.text();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const image = row.querySelector("img");
    const chapter = row.querySelector(".latest-chap a, .chapter-item a, a[href*='/manga/'][href$='/']");
    result.push({
      id,
      title,
      cover: image && absolute(image.attr("data-src") || image.attr("src")),
      lastChapter: chapter ? chapter.text() : undefined
    });
  }
  return result;
}

const plugin = {
  id: "3asq-ar",
  name: "3asq (Arabic)",
  async popular(offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return summaries(await documentAt(`${BASE}/manga/?page=${page}&order=popular`));
  },
  async search(query, offset) {
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    return summaries(await documentAt(`${BASE}/page/${page}/?s=${encodeURIComponent(query)}&post_type=wp-manga`));
  },
  async detail(id) {
    const doc = await documentAt(`${BASE}/manga/${encodeURIComponent(id)}/`);
    if (!doc) return null;
    const title = doc.querySelector(".post-title h1, .post-title")?.text();
    if (!title) return null;
    const image = doc.querySelector(".summary_image img, .tab-summary img");
    const description = doc.querySelector(".description-summary, .summary__content")?.text();
    const statusText = doc.querySelector(".post-status .summary-content, .post-content_item .summary-content")?.text();
    const author = doc.querySelector(".author-content, .post-content_item.mg_author .summary-content")?.text();
    return { id, title, cover: image && absolute(image.attr("data-src") || image.attr("src")), description, status: statusText, author };
  },
  async chapters(id) {
    const response = await harbor.http(`${BASE}/manga/${encodeURIComponent(id)}/ajax/chapters/`, {
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: ""
    });
    const doc = response.ok ? await harbor.parseHtml(response.body) : null;
    if (!doc) return [];
    const result = [];
    const seen = new Set();
    for (const link of doc.querySelectorAll(".wp-manga-chapter a, .listing-chapters_wrap a")) {
      const url = absolute(link.attr("href"));
      if (!url || seen.has(url)) continue;
      seen.add(url);
      result.push({ id: url, chapter: chapterNumber(url) || chapterNumber(link.text()), title: link.text(), pages: 0, language: "ar", group: "3asq" });
    }
    return result;
  },
  async pageUrls(chapterId) {
    const doc = await documentAt(chapterId);
    if (!doc) return [];
    const urls = [];
    const seen = new Set();
    for (const img of doc.querySelectorAll(".reading-content img, .page-break img, img.wp-manga-chapter-img")) {
      const url = absolute(img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src"), chapterId);
      if (url && !seen.has(url)) { seen.add(url); urls.push(url); }
    }
    return urls;
  }
};
