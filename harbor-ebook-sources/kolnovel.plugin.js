const BASE = "https://kolnovel.com";
const HARBOR_PAGE = 48;

function abs(value, base) {
  if (!value) return undefined;
  try { return new URL(String(value).trim(), base || BASE).href; } catch (_) { return undefined; }
}

async function getDoc(url) {
  const response = await harbor.http(abs(url), {
    responseType: "text",
    timeoutMs: 18000,
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error("http " + response.status + " for " + url);
  return harbor.parseHtml(response.body);
}

async function getDocOrNull(url) {
  try { return await getDoc(url); } catch (_) { return null; }
}

function seriesSlug(value) {
  const match = String(value || "").match(/\/series\/([^/?#]+)\/?/i);
  return match ? match[1] : "";
}

function genreSlug(value) {
  const match = String(value || "").match(/\/genre\/([^/?#]+)\/?/i);
  return match ? match[1] : "";
}

function numberFrom(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function statusOf(text) {
  const value = String(text || "").trim().toLowerCase();
  if (/completed|complete|مكتمل|مكتملة|منتهي|منتهية/.test(value)) return "completed";
  if (/ongoing|publishing|مستمر|مستمرة|قيد النشر/.test(value)) return "ongoing";
  if (/hiatus|متوقف|متوقفة/.test(value)) return "hiatus";
  return value || undefined;
}

function cardToSummary(card) {
  const link = card.querySelector(".mdinfo h2 a, .mdthumb a");
  const href = link && abs(link.attr("href"));
  const id = seriesSlug(href);
  const title = link && (link.attr("title") || link.text());
  if (!id || !title) return null;
  const image = card.querySelector(".mdthumb img");
  const last = card.querySelector(".nchapter a");
  return {
    id,
    title: title.trim(),
    cover: image && abs(image.attr("data-src") || image.attr("src")),
    description: card.querySelector(".contexcerpt")?.text(),
    lastChapter: last?.text()
  };
}

function trendToSummary(card) {
  const link = card.querySelector(".trenti a, .thumbtr a");
  const href = link && abs(link.attr("href"));
  const id = seriesSlug(href);
  const title = link && (link.attr("title") || link.text());
  if (!id || !title) return null;
  const image = card.querySelector(".thumbtr img");
  return {
    id,
    title: title.trim(),
    cover: image && abs(image.attr("data-src") || image.attr("src")),
    status: statusOf(card.querySelector(".thumbtr .status")?.text()),
    description: card.querySelector(".trendsys")?.text()
  };
}

function cardHasTag(card, tagId) {
  if (!tagId) return true;
  return card.querySelectorAll(".mdgenre a").some((link) => genreSlug(link.attr("href")) === tagId);
}

function summariesFrom(doc, tagId) {
  if (!doc) return [];
  return doc.querySelectorAll(".listupd article.maindet")
    .filter((card) => cardHasTag(card, tagId))
    .map(cardToSummary)
    .filter(Boolean);
}

function pageUrl(kind, page, value) {
  const suffix = page > 1 ? "/page/" + page + "/" : "/";
  if (kind === "genre") return BASE + "/genre/" + value + suffix;
  if (kind === "search") return BASE + suffix + "?s=" + encodeURIComponent(value);
  const order = kind === "latest" ? "update" : "popular";
  return BASE + "/series/?page=" + page + "&status=&type=&order=" + order;
}

async function browse(kind, value, offset, tagId) {
  const sitePageSize = kind === "popular" ? 20 : 25;
  const firstPage = Math.floor(offset / sitePageSize) + 1;
  const innerOffset = offset % sitePageSize;
  const pages = await Promise.all([0, 1, 2].map((step) => getDocOrNull(pageUrl(kind, firstPage + step, value))));
  const combined = pages.flatMap((doc) => summariesFrom(doc, kind === "search" ? tagId : undefined));
  return combined.slice(innerOffset, innerOffset + HARBOR_PAGE);
}

async function trending(offset) {
  if (offset > 0) return [];
  const doc = await getDoc("/");
  return doc.querySelectorAll(".trendarea .trendlist").map(trendToSummary).filter(Boolean);
}

const plugin = {
  id: "kolnovel-ar",
  name: "KolNovel (Arabic)",

  async popular(offset, tagId) {
    if (tagId === "__trending") return trending(offset);
    if (tagId === "__latest") return browse("latest", "", offset);
    if (tagId && tagId !== "__popular") return browse("genre", tagId, offset);
    return browse("popular", "", offset);
  },

  async search(query, offset, tagId) {
    const category = tagId && !tagId.startsWith("__") ? tagId : undefined;
    return browse("search", query, offset, category);
  },

  async detail(id) {
    const doc = await getDoc("/series/" + id + "/");
    const root = doc.querySelector(".sertoinfo");
    if (!root) return null;
    const title = root.querySelector("h1")?.text() || id;
    const image = doc.querySelector(".sertothumb img");
    const author = root.querySelector(".sertoauth a[href*='/writer/']");
    const synopsis = root.querySelector(".sersys > p");
    const yearMatch = root.text().match(/صدر في سنة\s*(\d{4})/);
    return {
      id,
      title,
      altTitle: root.querySelector(".alter")?.text(),
      cover: image && abs(image.attr("data-src") || image.attr("src")),
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      status: statusOf(root.querySelector(".sertostat span")?.text()),
      description: synopsis?.text(),
      contentRating: "safe",
      author: author?.text(),
      lastChapter: doc.querySelector(".eplister li .epl-num")?.text()
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + id + "/");
    return doc.querySelectorAll(".eplister li").map((row) => {
      const link = row.querySelector("a[href]");
      const href = link && abs(link.attr("href"));
      const numberText = row.querySelector(".epl-num")?.text() || "";
      const title = row.querySelector(".epl-title")?.text() || numberText;
      const volumeMatch = title.match(/المجلد\s*(\d+(?:\.\d+)?)/);
      return {
        id: href || "",
        chapter: numberFrom(numberText) || numberFrom(title),
        title,
        volume: volumeMatch ? volumeMatch[1] : null,
        pages: 1,
        language: "ar",
        group: "KolNovel",
        publishAt: row.querySelector(".epl-date")?.text() || undefined
      };
    }).filter((chapter) => chapter.id);
  },

  async pageUrls(chapterId) {
    const postMatch = String(chapterId || "").match(/-(\d+)\/?(?:[?#].*)?$/);
    if (!postMatch) return [];
    const data = await harbor.http(BASE + "/wp-admin/admin-ajax.php", {
      method: "POST",
      responseType: "json",
      timeoutMs: 30000,
      headers: {
        "user-agent": "Mozilla/5.0",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: "action=ts_ln_dl_url&post_id=" + encodeURIComponent(postMatch[1])
    });
    const url = data && abs(data.url);
    return url ? [url] : [];
  },

  async tags() {
    const doc = await getDoc("/series/");
    const seen = new Set();
    const tags = [
      { id: "__popular", name: "Popular — الأكثر شعبية", group: "Browse" },
      { id: "__trending", name: "Trending — الرائج هذا الأسبوع", group: "Browse" },
      { id: "__latest", name: "Latest Releases — آخر الإصدارات", group: "Browse" }
    ];
    for (const link of doc.querySelectorAll("a[href*='/genre/']")) {
      const id = genreSlug(link.attr("href"));
      const name = link.text().replace(/^#\s*/, "").trim();
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      tags.push({ id, name, group: "التصنيف" });
    }
    return tags;
  }
};
