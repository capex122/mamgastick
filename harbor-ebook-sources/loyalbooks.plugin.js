// Loyal Books source plugin for Harbor eBook.
// Public-domain eBooks are exposed as a single full-text chapter when available;
// audiobook tracks come from each book's public RSS feed.

const BASE = "https://www.loyalbooks.com";
const PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 20;

async function requestText(url) {
  const response = await harbor.http(url, { responseType: "text", timeoutMs: 30000 });
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
  return response.body || "";
}

async function getDoc(path) {
  return harbor.parseHtml(await requestText(absolute(path)));
}

function absolute(url) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
  if (url.startsWith("//")) return "https:" + url;
  return BASE + (url.startsWith("/") ? url : "/" + url);
}

function idFromHref(href) {
  return (href || "").replace(/^https?:\/\/(?:www\.)?loyalbooks\.com\/book\//i, "").replace(/^\/book\//, "").replace(/\/$/, "");
}

function clean(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return (value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function durationSeconds(value) {
  const parts = clean(value).split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || undefined;
}

function cardToSummary(cell) {
  const link = cell.querySelector("a[href^='/book/']");
  const title = clean(link?.querySelector("b")?.text());
  const href = link?.attr("href") || "";
  if (!href || !title) return null;
  const text = clean(cell.text());
  const author = clean(text.startsWith(title) ? text.slice(title.length) : "");
  const ratingId = cell.querySelector("div[id^='star']")?.attr("id") || "";
  const score = Number(ratingId.replace(/\D/g, "")) || undefined;
  return {
    id: idFromHref(href),
    title,
    author: author || undefined,
    cover: absolute(cell.querySelector("img")?.attr("src")),
    score,
    status: "completed",
    siteUrl: absolute(href),
  };
}

function parseCards(doc) {
  return doc.querySelectorAll("table.layout2-blue td.layout2-blue").map(cardToSummary).filter(Boolean);
}

const plugin = {
  id: "loyalbooks-en",
  name: "Loyal Books (English)",

  async popular(offset) {
    const page = Math.floor(Math.max(0, offset) / PAGE_SIZE) + 1;
    const path = page === 1 ? "/Top_100" : "/Top_100/" + page;
    return parseCards(await getDoc(path));
  },

  async search(query, offset) {
    const needle = clean(query).toLowerCase();
    if (!needle) return [];
    const sitemap = await requestText(BASE + "/sitemap.xml");
    const ids = [];
    const locPattern = /<loc>https?:\/\/(?:www\.)?loyalbooks\.com\/book\/([^<]+)<\/loc>/gi;
    let match;
    while ((match = locPattern.exec(sitemap))) {
      const id = decodeXml(match[1]);
      const searchable = decodeURIComponent(id).replace(/[-_]+/g, " ").toLowerCase();
      if (searchable.includes(needle) && !ids.includes(id)) ids.push(id);
    }
    const pageIds = ids.slice(Math.max(0, offset), Math.max(0, offset) + SEARCH_PAGE_SIZE);
    const results = [];
    for (let i = 0; i < pageIds.length; i += 6) {
      const batch = await Promise.all(pageIds.slice(i, i + 6).map((id) => plugin.detail(id)));
      results.push(...batch.filter(Boolean));
    }
    return results;
  },

  async detail(id) {
    const doc = await getDoc("/book/" + encodeURIComponent(id));
    const title = clean(doc.querySelector("span[itemprop='name']")?.text());
    if (!title) return null;
    const genres = doc.querySelectorAll("a[href^='/genre/']").map((node) => clean(node.text())).filter(Boolean);
    const score = Number(clean(doc.querySelector("span[itemprop='ratingValue']")?.text())) || undefined;
    return {
      id,
      title,
      author: clean(doc.querySelector("a[itemprop='author']")?.text()) || undefined,
      cover: absolute(doc.querySelector("img[itemprop='image']")?.attr("src")),
      description: clean(doc.querySelector("font.book-description")?.text()) || undefined,
      status: "completed",
      originalLanguage: "en",
      genres,
      score,
      chapters: doc.querySelector("a[href^='/download/text/']") ? 1 : 0,
      siteUrl: BASE + "/book/" + encodeURIComponent(id),
    };
  },

  async chapters(id) {
    const doc = await getDoc("/book/" + encodeURIComponent(id));
    const href = doc.querySelector("a[href^='/download/text/']")?.attr("href");
    return href ? [{ id: absolute(href), chapter: "1", title: "Full text", position: 0 }] : [];
  },

  async content(chapterId) {
    if (!/^https:\/\/www\.loyalbooks\.com\/download\/text\//i.test(chapterId)) throw new Error("Invalid Loyal Books text chapter URL");
    return await requestText(chapterId);
  },

  async audiobookChapters(id) {
    const xml = await requestText(BASE + "/book/" + encodeURIComponent(id) + "/feed");
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
    return items.map((item, position) => {
      const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
      const url = decodeXml(item.match(/<enclosure\b[^>]*\burl=["']([^"']+)["']/i)?.[1]);
      const duration = decodeXml(item.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i)?.[1]);
      const chapterMatch = clean(title).match(/^(\d+)\s*[-–:]\s*(.*)$/);
      return {
        id: absolute(url),
        title: clean(chapterMatch?.[2] || title) || "Chapter " + (position + 1),
        chapter: chapterMatch?.[1] || String(position + 1),
        duration: durationSeconds(duration),
        language: "en",
      };
    }).filter((track) => /^https?:\/\//i.test(track.id || ""));
  },

  async audiobookStream(chapterId) {
    if (!/^https?:\/\//i.test(chapterId)) return null;
    return { url: absolute(chapterId), format: "mp3" };
  },
};

harbor.register(plugin);
