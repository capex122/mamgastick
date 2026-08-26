const BASE = "https://lite.wuxiaworld.com";
const FULL_BASE = "https://www.wuxiaworld.com";
const API_BASE = "https://api2.wuxiaworld.com";
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

async function getText(url) {
  const response = await harbor.http(abs(url), {
    responseType: "text",
    timeoutMs: 30000,
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error("http " + response.status + " for " + url);
  return response.body;
}

async function novelMetadata(id) {
  const html = await getText(FULL_BASE + "/novel/" + id);
  const match = html.match(/window\.__REACT_QUERY_STATE__\s*=\s*(\{.*?\});\s*window\.__APP_CONTEXT__/s);
  if (!match) return null;
  const state = JSON.parse(match[1]);
  for (const query of state.queries || []) {
    const item = query && query.state && query.state.data && query.state.data.item;
    if (item && item.slug === id) return item;
  }
  return null;
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

function encodeVarint(value) {
  const bytes = [];
  let number = Math.max(0, Number(value) || 0);
  do {
    let byte = number % 128;
    number = Math.floor(number / 128);
    if (number) byte += 128;
    bytes.push(byte);
  } while (number);
  return bytes;
}

function readVarint(bytes, cursor) {
  let value = 0;
  let factor = 1;
  while (cursor.index < bytes.length) {
    const byte = bytes[cursor.index++];
    value += (byte & 127) * factor;
    if (!(byte & 128)) break;
    factor *= 128;
  }
  return value;
}

function protobufFields(bytes) {
  const fields = {};
  const cursor = { index: 0 };
  while (cursor.index < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    let value;
    if (wire === 0) value = readVarint(bytes, cursor);
    else if (wire === 2) {
      const length = readVarint(bytes, cursor);
      value = bytes.slice(cursor.index, cursor.index + length);
      cursor.index += length;
    } else if (wire === 1) {
      value = bytes.slice(cursor.index, cursor.index + 8);
      cursor.index += 8;
    } else if (wire === 5) {
      value = bytes.slice(cursor.index, cursor.index + 4);
      cursor.index += 4;
    } else break;
    (fields[field] || (fields[field] = [])).push({ wire, value });
  }
  return fields;
}

function fieldNumber(fields, number) {
  const entry = fields[number] && fields[number][0];
  return entry && entry.wire === 0 ? entry.value : undefined;
}

function fieldText(fields, number) {
  const entry = fields[number] && fields[number][0];
  return entry && entry.wire === 2 ? new TextDecoder().decode(new Uint8Array(entry.value)) : undefined;
}

async function chapterGroup(novelId, novelSlug, group) {
  const novel = encodeVarint(novelId);
  const groupId = encodeVarint(group.id);
  const wrappedGroup = [8, ...groupId];
  const filter = [10, wrappedGroup.length, ...wrappedGroup];
  const message = [8, ...novel, 18, filter.length, ...filter];
  const response = await harbor.grpc(API_BASE + "/wuxiaworld.api.v2.Chapters/GetChapterList", message, {
    mode: "grpc-web",
    timeoutMs: 30000,
  });
  if (!response.ok) throw new Error(response.grpcMessage || "Wuxiaworld gRPC " + (response.grpcStatus ?? response.status));
  const responseFields = protobufFields(response.body);
  const result = [];
  for (const groupEntry of responseFields[1] || []) {
    const groupFields = protobufFields(groupEntry.value);
    const volume = String(fieldNumber(groupFields, 3) || group.order || "");
    const volumeTitle = fieldText(groupFields, 2) || group.title || undefined;
    for (const chapterEntry of groupFields[6] || []) {
      const chapterFields = protobufFields(chapterEntry.value);
      const sponsorEntry = chapterFields[15] && chapterFields[15][0];
      const sponsorFields = sponsorEntry ? protobufFields(sponsorEntry.value) : {};
      if (fieldNumber(sponsorFields, 1) === 1) continue;
      const slug = fieldText(chapterFields, 3);
      const title = fieldText(chapterFields, 2) || slug || "";
      const offset = fieldNumber(chapterFields, 17);
      const publishedEntry = chapterFields[18] && chapterFields[18][0];
      const publishedFields = publishedEntry ? protobufFields(publishedEntry.value) : {};
      const publishedSeconds = fieldNumber(publishedFields, 1);
      if (!slug) continue;
      result.push({
        id: BASE + "/novel/" + novelSlug + "/" + slug,
        chapter: chapterFrom(title),
        position: typeof offset === "number" ? Math.max(0, offset - 1) : result.length,
        title,
        volume: volume || undefined,
        volumeTitle,
        publishAt: publishedSeconds ? new Date(publishedSeconds * 1000).toISOString() : undefined
      });
    }
  }
  return result;
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
    const results = await Promise.all([getDoc("/novel/" + id), novelMetadata(id).catch(() => null)]);
    const doc = results[0];
    const source = results[1];
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
      author: source?.authorName?.value || (authorMatch ? authorMatch[1].trim() : undefined),
      genres: Array.isArray(source?.genres) ? source.genres : [],
      chapters: source?.chapterInfo?.chapterCount?.value || (chapterMatch ? Number(chapterMatch[1].replace(/,/g, "")) : undefined),
      volumes: Array.isArray(source?.chapterInfo?.chapterGroups) ? source.chapterInfo.chapterGroups.length : undefined,
      siteUrl: FULL_BASE + "/novel/" + id
    };
  },

  async chapters(id) {
    const source = await novelMetadata(id).catch(() => null);
    const groups = source?.chapterInfo?.chapterGroups;
    if (source?.id && Array.isArray(groups) && groups.length) {
      const lists = await Promise.all(groups.map((group) => chapterGroup(source.id, id, group)));
      return lists.flat().sort((left, right) => left.position - right.position);
    }
    const first = await getDoc("/novel/" + id);
    const meta = first.querySelector(".novel-head .muted.small")?.text() || "";
    const countMatch = meta.match(/([\d,]+)\s+chapters?/i);
    const total = countMatch ? Number(countMatch[1].replace(/,/g, "")) : TOC_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(total / TOC_PAGE_SIZE));
    const chapters = chapterRows(first, 0);
    const docs = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      getDoc("/novel/" + id + "?toc=" + (index + 2))
    ));
    docs.forEach((doc, index) => chapters.push(...chapterRows(doc, (index + 1) * TOC_PAGE_SIZE)));
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
