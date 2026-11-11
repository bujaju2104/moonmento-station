// 사이트용 실거래 API: GET /api/rt?code=11140[&months=12][&kind=분양권]
// 국토교통부 아파트 매매(또는 분양권·입주권 전매) 실거래를 시군구 단위로 받아
// 역세권 지도가 쓰는 형식 {apts:[{n,g,d,t:[[계약일,금액,전용×100,층]]}]} 으로 돌려준다.
// 같은 요청은 Vercel CDN이 6시간 동안 재사용해서 국토부 호출 수를 아낀다.
const { fetchRegion, MolitError } = require('../lib/molit');
const { BY_CODE } = require('../lib/regions');

function kstStamp(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3).toISOString();
  return k.slice(0, 10) + ' ' + k.slice(11, 16);
}

function toApts(rows, region) {
  const g = region ? region.name.split(' ').pop() : '';
  const by = new Map();
  for (const r of rows) {
    const key = r.dong + '|' + r.apt;
    if (!by.has(key)) by.set(key, { n: r.apt, g, d: r.dong, t: [] });
    const t = [Number(r.y + r.m + r.d), r.price, Math.round(r.area * 100), Number(r.floor) || 0];
    if (r.gbn === '직거래') t.push('D');
    if (r.kind === '입주권') t.push('입');
    by.get(key).t.push(t);
  }
  const apts = [...by.values()];
  for (const a of apts) a.t.sort((x, y) => x[0] - y[0]);
  return apts.sort((a, b) => b.t.length - a.t.length);
}

module.exports = async function rt(req, res) {
  const url = new URL(req.url, 'http://x');
  const code = url.searchParams.get('code') || '';
  const kind = url.searchParams.get('kind') === '분양권' ? '분양권' : '매매';
  const months = Math.max(1, Math.min(24, Math.round(Number(url.searchParams.get('months')) || 12)));
  const send = (status, obj, cache) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache || 'no-store');
    res.end(JSON.stringify(obj));
  };
  if (!/^\d{5}$/.test(code)) return send(400, { error: 'code는 시군구 코드 5자리예요 (예: 11140).' });
  const region = BY_CODE[code];
  try {
    const rows = await fetchRegion(code, months, kind);
    return send(200, {
      asOf: kstStamp(),
      source: kind === '분양권' ? '국토교통부 아파트 분양권전매 실거래가' : '국토교통부 아파트 매매 실거래가',
      code, name: region ? `${region.sido} ${region.name}` : code, kind, months,
      apts: toApts(rows, region),
    }, 'public, s-maxage=21600, stale-while-revalidate=86400');
  } catch (e) {
    return send(e instanceof MolitError ? 503 : 500, { error: e instanceof MolitError ? e.message : '실거래를 불러오지 못했어요: ' + e.message });
  }
};
module.exports._toApts = toApts;
