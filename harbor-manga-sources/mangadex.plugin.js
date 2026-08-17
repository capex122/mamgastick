const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const PAGE_SIZE = 48;
async function json(url) { return harbor.http(url, { responseType: "json", headers: { "user-agent": "Harbor-Manga/1.0" } }); }
function titleOf(a) { const t = a.title || {}; return t.en || t.ar || Object.values(t)[0] || "Untitled"; }
function relation(item, type) { return (item.relationships || []).find((r) => r.type === type); }
function summary(item) {
  const a = item.attributes || {}, cover = relation(item, "cover_art");
  const file = cover && cover.attributes && cover.attributes.fileName;
  const descriptions = a.description || {};
  let altTitle;
  for (const title of a.altTitles || []) { if (title.ar || title.en) { altTitle = title.ar || title.en; break; } }
  return { id: item.id, title: titleOf(a), altTitle, cover: file ? `${UPLOADS}/covers/${item.id}/${file}.512.jpg` : undefined,
    year: a.year || undefined, status: a.status || undefined, description: descriptions.en || descriptions.ar || Object.values(descriptions)[0],
    contentRating: a.contentRating || undefined, lastChapter: a.lastChapter || undefined };
}
function mangaQuery(offset, search) {
  const p = new URLSearchParams();
  p.set("limit", String(PAGE_SIZE)); p.set("offset", String(offset)); p.append("includes[]", "cover_art");
  p.append("availableTranslatedLanguage[]", "ar"); p.append("availableTranslatedLanguage[]", "en");
  p.append("contentRating[]", "safe"); p.append("contentRating[]", "suggestive");
  if (search) { p.set("title", search); p.set("order[relevance]", "desc"); } else p.set("order[followedCount]", "desc");
  return p;
}
const plugin = {
  id: "mangadex-ar-en", name: "MangaDex (Arabic & English)",
  async popular(offset) { const r = await json(`${API}/manga?${mangaQuery(offset)}`); return r && Array.isArray(r.data) ? r.data.map(summary) : []; },
  async search(query, offset) { const r = await json(`${API}/manga?${mangaQuery(offset, query)}`); return r && Array.isArray(r.data) ? r.data.map(summary) : []; },
  async detail(id) { const r = await json(`${API}/manga/${encodeURIComponent(id)}?includes[]=cover_art`); return r && r.data ? summary(r.data) : null; },
  async chapters(id) {
    const p = new URLSearchParams(); p.set("limit", "500"); p.append("translatedLanguage[]", "ar"); p.append("translatedLanguage[]", "en");
    p.append("includes[]", "scanlation_group"); p.set("order[volume]", "desc"); p.set("order[chapter]", "desc");
    const r = await json(`${API}/manga/${encodeURIComponent(id)}/feed?${p}`); if (!r || !Array.isArray(r.data)) return [];
    return r.data.map((item) => { const a = item.attributes || {}, group = relation(item, "scanlation_group"); return {
      id: item.id, chapter: a.chapter == null ? null : String(a.chapter), title: a.title || undefined,
      volume: a.volume == null ? null : String(a.volume), pages: Number.isInteger(a.pages) ? a.pages : 0,
      language: a.translatedLanguage === "ar" ? "ar" : "en", group: group && group.attributes ? group.attributes.name : undefined,
      publishAt: a.publishAt || undefined }; });
  },
  async pageUrls(chapterId) {
    const r = await json(`${API}/at-home/server/${encodeURIComponent(chapterId)}`); if (!r || !r.baseUrl || !r.chapter) return [];
    return (r.chapter.data || []).map((file) => `${r.baseUrl}/data/${r.chapter.hash}/${file}`);
  },
  async tags() {
    const r = await json(`${API}/manga/tag`); if (!r || !Array.isArray(r.data)) return [];
    return r.data.map((item) => ({ id: item.id, name: item.attributes.name.en || item.attributes.name.ar || Object.values(item.attributes.name)[0], group: item.attributes.group || "genre" }));
  }
};
