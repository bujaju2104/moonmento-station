// GET /api/building?sigunguCd=11140&bjdongCd=16200&bun=236&ji=206[&dong=207동]
// 건축물대장 표제부 요약. 같은 필지는 Vercel CDN이 하루 동안 재사용한다.
const { brTitle } = require('../lib/building');
const { MolitError } = require('../lib/molit');

module.exports = async function building(req, res) {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const send = (status, obj, cache) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', cache || 'no-store'); res.end(JSON.stringify(obj)); };
  try {
    const r = await brTitle(q);
    return send(200, { ...r, source: '국토교통부 건축HUB 건축물대장정보 (표제부)' }, 'public, s-maxage=86400, stale-while-revalidate=604800');
  } catch (e) {
    return send(e instanceof MolitError ? 400 : 500, { error: e instanceof MolitError ? e.message : '건축물대장을 불러오지 못했어요: ' + e.message });
  }
};
