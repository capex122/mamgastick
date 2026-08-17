# Harbor Arabic & English Manga Sources

Harbor source repository containing:

- 3asq (Arabic)
- Olympus Staff (Arabic)
- MangaDex Arabic
- MangaDex English

Host this directory over HTTPS and paste the public `repo.json` URL into Harbor under **Manga → Set up a source → Extensions**.

The site-backed parsers use only `harbor.http` and `harbor.parseHtml`; the MangaDex providers use the public MangaDex API. Site layout changes can require selector updates.
