// Loyal Books source plugin for Harbor eBook.
// Public-domain eBooks are exposed as a single full-text chapter when available;
// audiobook tracks come from each book's public RSS feed.

const BASE = "https://www.loyalbooks.com";
const PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 20;

async function requestText(url) {
  const response = await harbor.http(url, { responseType: "text", timeoutMs: 45000 });
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

function audioChapterRange(title, description) {
  const value = clean(title) + " " + clean(description);
  const match = value.match(/(?:chapters?|chap\.?|فصل|الفصول)\s*([0-9]+)(?:\s*[-–—]\s*([0-9]+))?/i);
  if (!match) return null;
  return { start: match[1], end: match[2] || match[1] };
}

function splitFullBookText(value) {
  const text = (value || "").replace(/\r\n?/g, "\n");
  const heading = /^(?:chapter|chap\.?)\s+([0-9]+|[ivxlcdm]+)(?:\s*[-:.—]\s*(.*))?\s*$/gim;
  const matches = Array.from(text.matchAll(heading));
  return matches
    .map((match, position) => ({
      title: clean(match[2]) || clean(match[0]),
      chapter: match[1],
      text: text.slice(
        (match.index || 0) + match[0].length,
        matches[position + 1]?.index ?? text.length,
      ).trim(),
    }))
    .filter((chapter) => chapter.text.length >= 200);
}

function textChapterId(url, index) {
  return "txt:" + encodeURIComponent(url) + ":" + index;
}

function parseTextChapterId(id) {
  const match = (id || "").match(/^txt:(.+):(\d+)$/);
  if (!match) return null;
  try {
    return { url: decodeURIComponent(match[1]), index: Number(match[2]) };
  } catch (_) {
    return null;
  }
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
    audiobook: true,
    score,
    status: "completed",
    siteUrl: absolute(href),
  };
}

function parseCards(doc) {
  return doc.querySelectorAll("table.layout2-blue td.layout2-blue").map(cardToSummary).filter(Boolean);
}

function parseCardsFromHtml(html) {
  const books = [];
  const cells = html.match(/<td\b[^>]*class=["'][^"']*\blayout2-blue\b[^"']*["'][^>]*>[\s\S]*?<\/td>/gi) || [];
  for (const cell of cells) {
    const href = decodeXml(cell.match(/<a\b[^>]*href=["'](\/book\/[^"']+)["']/i)?.[1]);
    const title = clean(decodeXml(cell.match(/<b>([\s\S]*?)<\/b>/i)?.[1]).replace(/<[^>]+>/g, " "));
    if (!href || !title) continue;
    const image = decodeXml(cell.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1]);
    const author = clean(
      decodeXml(cell.match(/<\/b>\s*<\/a>\s*<br\s*\/?>([^<]*)/i)?.[1]).replace(/<[^>]+>/g, " "),
    );
    const score = Number(cell.match(/\bid=["']star(\d+)["']/i)?.[1]) || undefined;
    books.push({
      id: idFromHref(href),
      title,
      author: author || undefined,
      cover: absolute(image),
      audiobook: true,
      score,
      status: "completed",
      siteUrl: absolute(href),
    });
  }
  return books;
}

const plugin = {
  id: "loyalbooks-en",
  name: "Loyal Books (English)",

  async popular(offset) {
    const page = Math.floor(Math.max(0, offset) / PAGE_SIZE) + 1;
    const path = page === 1 ? "/Top_100" : "/Top_100/" + page;
    const html = await requestText(absolute(path));
    const parsed = parseCards(await harbor.parseHtml(html));
    return parsed.length ? parsed : parseCardsFromHtml(html);
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
      audiobook: true,
      description: clean(doc.querySelector("font.book-description")?.text()) || undefined,
      status: "completed",
      originalLanguage: "en",
      genres,
      score,
      siteUrl: BASE + "/book/" + encodeURIComponent(id),
    };
  },

  async chapters(id) {
    const doc = await getDoc("/book/" + encodeURIComponent(id));
    const href = doc.querySelector("a[href^='/download/text/']")?.attr("href");
    if (!href) return [];
    const url = absolute(href);
    const sections = splitFullBookText(await requestText(url));
    return sections.map((section, position) => ({
      id: textChapterId(url, position),
      chapter: section.chapter,
      title: section.title,
      position,
    }));
  },

  async content(chapterId) {
    const selected = parseTextChapterId(chapterId);
    if (!selected || !/^https:\/\/www\.loyalbooks\.com\/download\/text\//i.test(selected.url)) {
      throw new Error("Invalid Loyal Books text chapter ID");
    }
    const sections = splitFullBookText(await requestText(selected.url));
    return sections[selected.index]?.text || "";
  },

  async audiobookChapters(id) {
    // Loyal Books exposes the complete, non-paginated track list in one RSS feed.
    // Parse every item in source order and retain its own enclosure as the track id.
    const xml = await requestText(BASE + "/book/" + encodeURIComponent(id) + "/feed");
    const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
    return items.map((item, position) => {
      const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
      const description = clean(decodeXml(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1]));
      const url = decodeXml(item.match(/<enclosure\b[^>]*\burl=["']([^"']+)["']/i)?.[1]);
      const duration = decodeXml(item.match(/<itunes:duration>([\s\S]*?)<\/itunes:duration>/i)?.[1]);
      const chapterMatch = clean(title).match(/^(\d+)\s*[-–:]\s*(.*)$/);
      const displayTitle = clean(chapterMatch?.[2] || title) || "Chapter " + (position + 1);
      const range = audioChapterRange(displayTitle, description);
      const coversMultipleChapters = !!range && range.start !== range.end;
      return {
        id: absolute(url),
        title: displayTitle,
        description: description || undefined,
        chapter: coversMultipleChapters ? undefined : (range?.start || chapterMatch?.[1] || String(position + 1)),
        chapterStart: coversMultipleChapters ? range.start : undefined,
        chapterEnd: coversMultipleChapters ? range.end : undefined,
        duration: durationSeconds(duration),
        language: "en",
      };
    }).filter((track) => /^https?:\/\//i.test(track.id || ""));
  },

  async audiobookStream(chapterId) {
    // Each chapter id is its selected RSS item's direct enclosure URL.
    if (!/^https?:\/\//i.test(chapterId)) return null;
    return { url: absolute(chapterId), format: "mp3" };
  },
};

harbor.register(plugin);
