// 단지 위치 찾기 — 카카오 로컬(장소·주소 검색)을 k-skill-proxy로 조회한다.
// 국토부 실거래에는 좌표가 없어서, 중개노트 지도에 단지를 찍을 때 쓴다.
const PROXY = (process.env.KSKILL_PROXY_URL || 'https://k-skill-proxy.nomadamas.org').replace(/\/$/, '');
const cache = new Map();

async function search(q, fetchImpl) {
  const r = await fetchImpl(`${PROXY}/v1/kakao-local/geocode?q=${encodeURIComponent(q)}&size=5`, { headers: { accept: 'application/json' } });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.documents) ? j.documents : [];
}

const norm = (v) => String(v || '').replace(/\(.*?\)|아파트|\s/g, '');

function pick(docs, apt, dong) {
  const home = docs.filter((d) => /아파트|주거/.test(d.category_name || ''));
  const k = norm(apt);
  const named = home.find((d) => norm(d.place_name).includes(k) || k.includes(norm(d.place_name)));
  const inDong = (d) => !dong || String(d.address_name || '').includes(dong);
  const d = named || home.find(inDong) || docs.find((x) => !x.place_name && inDong(x));
  return d && d.x && d.y ? { lat: +(+d.y).toFixed(6), lng: +(+d.x).toFixed(6), place: d.place_name || d.address_name || '' } : null;
}

async function locateApt(region, dong, apt, fetchImpl = global.fetch) {
  const key = `${region}|${dong}|${apt}`;
  if (cache.has(key)) return cache.get(key);
  let hit = null;
  for (const q of [`${region} ${dong} ${apt}`, `${dong} ${apt} 아파트`]) {
    try { hit = pick(await search(q.replace(/\s+/g, ' ').trim(), fetchImpl), apt, dong); } catch { hit = null; }
    if (hit) break;
  }
  cache.set(key, hit);
  return hit;
}

async function locateMany(region, items, fetchImpl = global.fetch, conc = 6) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      const it = items[k];
      out[k] = { apt: it.apt, dong: it.dong || '', ...(await locateApt(region, it.dong || '', it.apt, fetchImpl) || {}) };
    }
  }));
  return out;
}

module.exports = { locateApt, locateMany, _pick: pick, _cache: cache };
