const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const PAGE_SIZE = 48;
const LANGUAGE = "en";
async function json(url) { return harbor.http(url, { responseType: "json", headers: { "user-agent": "Harbor-Manga/1.1" } }); }
function relation(item, type) { return (item.relationships || []).find((entry) => entry.type === type); }
function localized(values) { return values && (values[LANGUAGE] || Object.values(values)[0]); }
function summary(item) {
  const a = item.attributes || {}, cover = relation(item, "cover_art"), descriptions = a.description || {};
  const file = cover && cover.attributes && cover.attributes.fileName;
  let altTitle; for (const value of a.altTitles || []) { if (value[LANGUAGE]) { altTitle = value[LANGUAGE]; break; } }
  return { id: item.id, title: localized(a.title) || "Untitled", altTitle,
    cover: file ? `${UPLOADS}/covers/${item.id}/${file}.512.jpg` : undefined,
    year: a.year || undefined, status: a.status || undefined, description: localized(descriptions),
    contentRating: a.contentRating || undefined, lastChapter: a.lastChapter || undefined };
}
function mangaQuery(offset, search, tagId) {
  const p = new URLSearchParams(); p.set("limit", String(PAGE_SIZE)); p.set("offset", String(offset)); p.append("includes[]", "cover_art");
  p.append("availableTranslatedLanguage[]", LANGUAGE); p.append("contentRating[]", "safe"); p.append("contentRating[]", "suggestive");
  if (tagId) p.append("includedTags[]", tagId);
  if (search) { p.set("title", search); p.set("order[relevance]", "desc"); } else p.set("order[followedCount]", "desc"); return p;
}
function feedUrl(id, offset) {
  const p = new URLSearchParams(); p.set("limit", "500"); p.set("offset", String(offset)); p.append("translatedLanguage[]", LANGUAGE);
  p.append("includes[]", "scanlation_group"); p.set("order[volume]", "desc"); p.set("order[chapter]", "desc");
  return `${API}/manga/${encodeURIComponent(id)}/feed?${p}`;
}
async function fullFeed(id) {
  const first = await json(feedUrl(id, 0)); if (!first || !Array.isArray(first.data)) return [];
  const total = Math.min(Number(first.total) || first.data.length, 5000), pages = [first.data], offsets = [];
  for (let offset = 500; offset < total; offset += 500) offsets.push(offset);
  for (let start = 0; start < offsets.length; start += 5) {
    const batch = await Promise.all(offsets.slice(start, start + 5).map((offset) => json(feedUrl(id, offset))));
    for (const response of batch) if (response && Array.isArray(response.data)) pages.push(response.data);
  }
  return pages.flat().filter((item) => {
    const attributes = item.attributes || {};
    return !attributes.externalUrl && Number(attributes.pages) > 0;
  });
}
const plugin = {
  id: "mangadex-en", name: "MangaDex (English)",
  async popular(offset, tagId) { const r = await json(`${API}/manga?${mangaQuery(offset, "", tagId)}`); return r && Array.isArray(r.data) ? r.data.map(summary) : []; },
  async search(query, offset, tagId) { const r = await json(`${API}/manga?${mangaQuery(offset, query, tagId)}`); return r && Array.isArray(r.data) ? r.data.map(summary) : []; },
  async detail(id) { const r = await json(`${API}/manga/${encodeURIComponent(id)}?includes[]=cover_art`); return r && r.data ? summary(r.data) : null; },
  async chapters(id) { return (await fullFeed(id)).map((item) => { const a = item.attributes || {}, group = relation(item, "scanlation_group"); return {
    id: item.id, chapter: a.chapter == null ? null : String(a.chapter), title: a.title || undefined,
    volume: a.volume == null ? null : String(a.volume), pages: Number.isInteger(a.pages) ? a.pages : 0, language: LANGUAGE,
    group: group && group.attributes ? group.attributes.name : undefined, publishAt: a.publishAt || undefined }; }); },
  async pageUrls(chapterId) {
    const r = await json(`${API}/at-home/server/${encodeURIComponent(chapterId)}?forcePort443=false`);
    if (!r || !r.baseUrl || !r.chapter || !r.chapter.hash) return [];
    const original = Array.isArray(r.chapter.data) ? r.chapter.data : [];
    if (original.length) return original.map((file) => `${r.baseUrl}/data/${r.chapter.hash}/${file}`);
    const compressed = Array.isArray(r.chapter.dataSaver) ? r.chapter.dataSaver : [];
    return compressed.map((file) => `${r.baseUrl}/data-saver/${r.chapter.hash}/${file}`);
  },
  async tags() { const r = await json(`${API}/manga/tag`); if (!r || !Array.isArray(r.data)) return [];
    return r.data.map((item) => ({ id: item.id, name: localized(item.attributes.name), group: item.attributes.group || "genre" })); }
};
