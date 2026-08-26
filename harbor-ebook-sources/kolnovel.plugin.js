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
  const match = normalizeDigits(text).match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function normalizeDigits(text) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return String(text || "").replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit);
    return String(arabicIndex >= 0 ? arabicIndex : persian.indexOf(digit));
  });
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .replace(/\s+(?:kol|كول)$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFanEdition(value) {
  return /(?:fan[ -]?made|fan edition|نسخة\s*الفان)/iu.test(String(value || ""));
}

function chapterFrom(text) {
  const normalized = normalizeDigits(text);
  const match = normalized.match(/الفصل\s*(\d+(?:\.\d+)?)/);
  return match ? match[1] : numberFrom(normalized);
}

function volumeFrom(text) {
  const normalized = normalizeDigits(text);
  const numeric = normalized.match(/(?:المجلد|مجلد)\s*(\d+(?:\.\d+)?)/);
  if (numeric) return numeric[1];
  const named = normalized.match(/(?:المجلد|مجلد)\s*([^\s:]+)/);
  if (!named) return null;
  const ordinals = {
    "الأول": "1", "الاول": "1", "الأولى": "1", "الاولى": "1",
    "الثاني": "2", "الثانية": "2", "الثالث": "3", "الثالثة": "3",
    "الرابع": "4", "الرابعة": "4", "الخامس": "5", "الخامسة": "5",
    "السادس": "6", "السادسة": "6", "السابع": "7", "السابعة": "7",
    "الثامن": "8", "الثامنة": "8", "التاسع": "9", "التاسعة": "9",
    "العاشر": "10", "العاشرة": "10"
  };
  return ordinals[named[1]] || null;
}

function volumeTitleFrom(text) {
  const normalized = normalizeDigits(text).replace(/\s+/g, " ").trim();
  const match = normalized.match(/((?:المجلد|مجلد)\s+.+?)(?=\s+الفصل(?:\s|$))/);
  return match ? match[1].replace(/\s*:\s*/, ": ").trim() : undefined;
}

function cleanChapterBlock(value) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const boundaries = [
    /\.shola-[a-z-]*/i,
    /\bfunction\s+shola[A-Z]/,
    /\bdocument\.getElementById\s*\(/i,
    /🔥\s*تحدي\s+/,
    /شراء\s+عملة\s+الشعلة/,
    /[🏆💎]\s*أكبر\s+الداعمين/
  ];
  let cut = text.length;
  for (const pattern of boundaries) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  text = text.slice(0, cut).trim();
  if (!text) return "";
  if (/(?:querySelectorAll|classList\.(?:add|remove)|modalId|background\s*:|border-radius\s*:|font-family\s*:|justify-content\s*:|box-sizing\s*:|var\s*\(--)/i.test(text)) return "";
  if (/(?:حققنا\s+هدف\s+الشهر|الهدف\s*:\s*[\d,]+|شعلة\s+الهدف)/.test(text)) return "";
  return text;
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
    title: cleanTitle(title),
    cover: image && abs(image.attr("data-src") || image.attr("src")),
    description: card.querySelector(".contexcerpt")?.text(),
    lastChapter: last?.text(),
    siteUrl: href,
    isFanMade: isFanEdition(title)
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
    title: cleanTitle(title),
    cover: image && abs(image.attr("data-src") || image.attr("src")),
    status: statusOf(card.querySelector(".thumbtr .status")?.text()),
    description: card.querySelector(".trendsys")?.text(),
    siteUrl: href,
    isFanMade: isFanEdition(title)
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
    const rows = doc.querySelectorAll(".eplister li");
    const volumes = new Set(rows.map((row) => volumeFrom(row.querySelector(".epl-num")?.text() || "")).filter((value) => value !== null));
    const rawTitle = title;
    return {
      id,
      title: cleanTitle(rawTitle),
      altTitle: root.querySelector(".alter")?.text(),
      cover: image && abs(image.attr("data-src") || image.attr("src")),
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      status: statusOf(root.querySelector(".sertostat span")?.text()),
      description: synopsis?.text(),
      author: author?.text(),
      genres: root.querySelectorAll("a[href*='/genre/']").map((link) => link.text().replace(/^#\s*/, "").trim()).filter(Boolean),
      chapters: rows.length || undefined,
      volumes: volumes.size || undefined,
      siteUrl: BASE + "/series/" + id + "/",
      isFanMade: isFanEdition(rawTitle)
    };
  },

  async chapters(id) {
    const doc = await getDoc("/series/" + id + "/");
    const rows = doc.querySelectorAll(".eplister li").slice().reverse();
    return rows.map((row, position) => {
      const link = row.querySelector("a[href]");
      const href = link && abs(link.attr("href"));
      const numberText = row.querySelector(".epl-num")?.text() || "";
      const title = row.querySelector(".epl-title")?.text() || numberText;
      return {
        id: href || "",
        chapter: chapterFrom(numberText) || numberFrom(title),
        position,
        title,
        volume: volumeFrom(numberText) ?? undefined,
        volumeTitle: volumeTitleFrom(numberText),
        publishAt: row.querySelector(".epl-date")?.text() || undefined,
        views: row.querySelector(".epl-views, .epl-view")?.text().replace(/\s*(?:views?|مشاهدة)$/iu, "").trim() || undefined
      };
    }).filter((chapter) => chapter.id);
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const root = doc.querySelector("#kol_content, .epcontent");
    if (!root) return "";
    let nodes = doc.querySelectorAll("#kol_content > p, #kol_content > blockquote");
    if (!nodes.length) nodes = root.querySelectorAll("p, blockquote");
    return nodes.map((node) => cleanChapterBlock(node.text())).filter(Boolean).join("\n\n");
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
