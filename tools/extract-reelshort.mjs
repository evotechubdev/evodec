const movieUrl = process.argv[2];
if (!movieUrl) throw new Error('Informe a URL do filme.');

const decodeHtml = value => value
  .replaceAll('&quot;', '"')
  .replaceAll('&#x27;', "'")
  .replaceAll('&amp;', '&');

const movieHtml = await fetch(movieUrl).then(response => {
  if (!response.ok) throw new Error(`Filme HTTP ${response.status}`);
  return response.text();
});
const hrefs = [...movieHtml.matchAll(/href="([^"]*\/episodes\/[^"]+)"/g)]
  .map(match => new URL(decodeHtml(match[1]), movieUrl).href)
  .filter((value, index, all) => all.indexOf(value) === index);

const results = new Array(hrefs.length);
let nextIndex = 0;
async function worker() {
  while (nextIndex < hrefs.length) {
    const index = nextIndex++;
    const html = await fetch(hrefs[index]).then(response => {
      if (!response.ok) throw new Error(`Episódio ${index + 1} HTTP ${response.status}`);
      return response.text();
    });
    const blocks = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    const roots = blocks.map(match => {
      try { return JSON.parse(match[1]); } catch { return null; }
    }).filter(Boolean);
    const queue = [...roots];
    let data = null;
    while (queue.length && !data) {
      const value = queue.shift();
      if (value?.contentUrl) data = value;
      else if (Array.isArray(value)) queue.push(...value);
      else if (value && typeof value === 'object') queue.push(...Object.values(value));
    }
    if (!data?.contentUrl) throw new Error(`Episódio ${index + 1} sem contentUrl`);
    results[index] = {
      number: index + 1,
      duration: data.duration || '',
      contentUrl: data.contentUrl,
      pageUrl: hrefs[index],
    };
  }
}

await Promise.all(Array.from({ length: Math.min(8, hrefs.length) }, worker));
console.log(JSON.stringify(results, null, 2));
