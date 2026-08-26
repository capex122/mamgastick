const BASE = "https://lite.wuxiaworld.com";
const FULL_BASE = "https://www.wuxiaworld.com";
const CATALOGUE_PAGE_SIZE = 24;
const TOC_PAGE_SIZE = 100;

function abs(value, base) {
  if (!value) return undefined;
  try { return new URL(String(value).trim(), base || BASE).href; } catch (_) { return undefined; }
}

async function getDoc(url) {
  const response = await harbor.http(abs(url), {
    responseType: "text",
    timeoutMs: 30000,
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error("http " + response.status + " for " + url);
  return harbor.parseHtml(response.body);
}

function slugFrom(value) {
  const match = String(value || "").match(/\/novel\/([^/?#]+)/i);
  return match ? match[1] : "";
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statusOf(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("completed")) return "completed";
  if (text.includes("ongoing")) return "ongoing";
  if (text.includes("hiatus")) return "hiatus";
  return undefined;
}

function cardToSummary(card) {
  const link = card.querySelector(".title a, a.cover");
  const href = link && abs(link.attr("href"));
  const id = slugFrom(href);
  const rawTitle = card.querySelector(".title a")?.text() || link?.attr("title") || "";
  if (!id || !rawTitle) return null;
  const tagText = card.querySelector(".tag")?.text() || "";
  const parts = tagText.split("·").map((part) => part.trim()).filter(Boolean);
  return {
    id,
    title: cleanTitle(rawTitle),
    cover: abs(card.querySelector("img")?.attr("src")),
    status: statusOf(parts[0]),
    genres: parts.slice(1).join(",").split(",").map((genre) => genre.trim()).filter(Boolean),
    description: card.querySelector(".syn")?.text(),
    siteUrl: FULL_BASE + "/novel/" + id
  };
}

function browseOptions(tagId) {
  const value = String(tagId || "");
  if (value.startsWith("sort:")) return { sort: value.slice(5), status: "all" };
  if (value.startsWith("status:")) return { sort: "popular", status: value.slice(7) };
  return { sort: "popular", status: "all" };
}

function catalogueUrl(query, options) {
  return BASE + "/novels?q=" + encodeURIComponent(query || "") +
    "&sort=" + encodeURIComponent(options.sort) +
    "&status=" + encodeURIComponent(options.status);
}

async function catalogue(query, offset, tagId) {
  const targetPage = Math.floor(offset / CATALOGUE_PAGE_SIZE);
  let url = catalogueUrl(query, browseOptions(tagId));
  let doc;
  for (let page = 0; page <= targetPage; page += 1) {
    doc = await getDoc(url);
    if (page === targetPage) break;
    const next = doc.querySelector("a.btn.next");
    url = next && abs(next.attr("href"));
    if (!url) return [];
  }
  return doc.querySelectorAll(".novel-grid .novel-cell").map(cardToSummary).filter(Boolean);
}

function volumeFrom(title) {
  const match = String(title || "").match(/(?:Book|Volume)\s*(\d+(?:\.\d+)?)/i);
  return match ? match[1] : undefined;
}

function chapterFrom(title) {
  const matches = Array.from(String(title || "").matchAll(/Chapter\s*(\d+(?:\.\d+)?)/gi));
  return matches.length ? matches[matches.length - 1][1] : undefined;
}

function chapterRows(doc, startPosition) {
  return doc.querySelectorAll("ul.toc li a").map((link, index) => {
    const title = link.text().trim();
    return {
      id: abs(link.attr("href")) || "",
      chapter: chapterFrom(title),
      position: startPosition + index,
      title,
      volume: volumeFrom(title)
    };
  }).filter((chapter) => chapter.id);
}

const plugin = {
  id: "wuxiaworld-en",
  name: "Wuxiaworld (English)",

  async popular(offset, tagId) {
    return catalogue("", offset, tagId);
  },

  async search(query, offset, tagId) {
    return catalogue(query, offset, tagId);
  },

  async detail(id) {
    const doc = await getDoc("/novel/" + id);
    const root = doc.querySelector(".novel-head");
    if (!root) return null;
    const meta = root.querySelector(".muted.small")?.text() || "";
    const authorMatch = meta.match(/Author:\s*(.*?)\s*·/i);
    const chapterMatch = meta.match(/([\d,]+)\s+chapters?/i);
    const description = doc.querySelector("main > .chapter-body")?.text();
    return {
      id,
      title: cleanTitle(root.querySelector("h1")?.text() || id),
      cover: abs(root.querySelector(".cover img")?.attr("src")),
      status: statusOf(meta),
      description,
      author: authorMatch ? authorMatch[1].trim() : undefined,
      chapters: chapterMatch ? Number(chapterMatch[1].replace(/,/g, "")) : undefined,
      siteUrl: FULL_BASE + "/novel/" + id
    };
  },

  async chapters(id) {
    const first = await getDoc("/novel/" + id);
    const meta = first.querySelector(".novel-head .muted.small")?.text() || "";
    const countMatch = meta.match(/([\d,]+)\s+chapters?/i);
    const total = countMatch ? Number(countMatch[1].replace(/,/g, "")) : TOC_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(total / TOC_PAGE_SIZE));
    const chapters = chapterRows(first, 0);
    for (let page = 2; page <= pageCount; page += 8) {
      const end = Math.min(pageCount, page + 7);
      const docs = await Promise.all(Array.from({ length: end - page + 1 }, (_, index) =>
        getDoc("/novel/" + id + "?toc=" + (page + index))
      ));
      docs.forEach((doc, index) => {
        chapters.push(...chapterRows(doc, (page + index - 1) * TOC_PAGE_SIZE));
      });
    }
    return chapters;
  },

  async content(chapterId) {
    const doc = await getDoc(chapterId);
    const title = doc.querySelector("#chapter-title")?.text().trim() || "";
    const paragraphs = doc.querySelectorAll("#chapter-body > p")
      .map((node) => node.text().trim())
      .filter((text) => text && !/^Previous Chapter$/i.test(text) && text !== title);
    return paragraphs.join("\n\n");
  },

  async tags() {
    return [
      { id: "sort:popular", name: "Popular", group: "Browse" },
      { id: "sort:new", name: "New Releases", group: "Browse" },
      { id: "sort:chapters", name: "Most Chapters", group: "Browse" },
      { id: "sort:rating", name: "Top Rated", group: "Browse" },
      { id: "status:ongoing", name: "Ongoing", group: "Status" },
      { id: "status:completed", name: "Completed", group: "Status" },
      { id: "status:hiatus", name: "Hiatus", group: "Status" }
    ];
  }
};
