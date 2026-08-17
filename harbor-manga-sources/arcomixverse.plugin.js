const BASE = "https://arcomixverse.blogspot.com";
const BLOG_ID = "5818567583521580171";
const BLOGGER = `https://www.blogger.com/feeds/${BLOG_ID}/posts/default`;
const PAGE_SIZE = 48;

async function json(url) {
  return harbor.http(url, { responseType: "json", headers: { "user-agent": "Harbor-Manga/1.0" } });
}
function value(object, key) { return object && object[key] && object[key].$t; }
function postId(entry) {
  const match = String(value(entry, "id") || "").match(/\.post-(\d+)$/);
  return match ? match[1] : "";
}
function alternate(entry) {
  const link = (entry.link || []).find((item) => item.rel === "alternate");
  return link && link.href;
}
function decodeHtml(text) {
  return String(text || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function stripHtml(text) {
  return decodeHtml(String(text || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function images(content) {
  const result = [], seen = new Set();
  const expression = /<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>/gi;
  let match;
  while ((match = expression.exec(content || ""))) {
    const url = decodeHtml(match[2]);
    if (!seen.has(url) && !/blogger_logo|profile_images/i.test(url)) { seen.add(url); result.push(url); }
  }
  return result;
}
function labels(entry) { return (entry.category || []).map((item) => item.term).filter(Boolean); }
function synopsis(content) {
  const match = String(content || "").match(/<p\b[^>]*id=["']synopsis["'][^>]*>([\s\S]*?)(?:<div\b[^>]*id=["']extra-info["']|$)/i);
  return match ? stripHtml(match[1]) : undefined;
}
function chapterLabel(content) {
  const match = String(content || "").match(/\bdata-label\s*=\s*["']([^"']+)["']/i);
  return match ? decodeHtml(match[1]).trim() : "";
}
function chapterNumber(title) {
  const match = String(title || "").match(/(?:#|العدد\s*|الفصل\s*)(\d+(?:\.\d+)?)/i);
  return match ? match[1] : null;
}
function summary(entry) {
  const id = postId(entry), title = value(entry, "title"), content = value(entry, "content") || "";
  if (!id || !title) return null;
  const categories = labels(entry), cover = images(content)[0];
  let status;
  if (categories.includes("مكتمل")) status = "completed";
  else if (categories.includes("مستمر") || categories.includes("Update")) status = "ongoing";
  const published = value(entry, "published"), year = published ? Number(published.slice(0, 4)) : undefined;
  return { id, title: stripHtml(title), cover, year, status, description: synopsis(content), contentRating: "safe" };
}
async function entryById(id) {
  const response = await json(`${BLOGGER}/${encodeURIComponent(id)}?alt=json`);
  return response && response.entry ? response.entry : null;
}
function seriesFeed(offset, query) {
  const params = new URLSearchParams();
  params.set("alt", "json"); params.set("max-results", String(PAGE_SIZE)); params.set("start-index", String(offset + 1));
  params.set("orderby", "updated"); if (query) params.set("q", query);
  return `${BASE}/feeds/posts/default/-/Series?${params}`;
}

const plugin = {
  id: "arcomixverse-ar",
  name: "Arcomix Verse (Arabic)",
  async popular(offset) {
    const response = await json(seriesFeed(offset, ""));
    return response && response.feed && Array.isArray(response.feed.entry) ? response.feed.entry.map(summary).filter(Boolean) : [];
  },
  async search(query, offset) {
    const response = await json(seriesFeed(offset, query));
    return response && response.feed && Array.isArray(response.feed.entry) ? response.feed.entry.map(summary).filter(Boolean) : [];
  },
  async detail(id) {
    const entry = await entryById(id);
    return entry ? summary(entry) : null;
  },
  async chapters(id) {
    const series = await entryById(id);
    if (!series) return [];
    const label = chapterLabel(value(series, "content"));
    if (!label) return [];
    const params = new URLSearchParams(); params.set("alt", "json"); params.set("max-results", "500"); params.set("orderby", "published");
    const response = await json(`${BASE}/feeds/posts/default/-/${encodeURIComponent(label)}?${params}`);
    if (!response || !response.feed || !Array.isArray(response.feed.entry)) return [];
    return response.feed.entry.filter((entry) => labels(entry).includes("Chapter")).map((entry) => {
      const title = stripHtml(value(entry, "title"));
      return { id: postId(entry), chapter: chapterNumber(title), title, pages: images(value(entry, "content")).length,
        language: "ar", group: "Arcomix Verse", publishAt: value(entry, "published") || undefined };
    }).filter((chapter) => chapter.id);
  },
  async pageUrls(chapterId) {
    const entry = await entryById(chapterId);
    return entry ? images(value(entry, "content")) : [];
  }
};
