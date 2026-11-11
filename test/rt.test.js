const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const item = (o) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`;
let calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  const ym = new URL(url).searchParams.get('DEAL_YMD');
  const items = ym === '202610' ? [
    item({ aptNm: '남산타운', umdNm: '신당동', excluUseAr: '84.93', dealYear: '2026', dealMonth: '10', dealDay: '21', dealAmount: '149,500', floor: '7', dealingGbn: '직거래' }),
    item({ aptNm: '남산타운', umdNm: '신당동', excluUseAr: '84.93', dealYear: '2026', dealMonth: '10', dealDay: '3', dealAmount: '145,000', floor: '12' }),
    item({ aptNm: '남산타운', umdNm: '신당동', excluUseAr: '59.8', dealYear: '2026', dealMonth: '10', dealDay: '11', dealAmount: '99,000', floor: '3', cdealType: 'O' }),
  ] : [];
  return { status: 200, text: async () => `<response><header><resultCode>000</resultCode></header><body><items>${items.join('')}</items><totalCount>${items.length}</totalCount></body></response>` };
};
process.env.MOLIT_SERVICE_KEY = 'k%2B1';
const rt = require('../api/rt');

function get(path) {
  return new Promise((ok) => {
    const s = http.createServer((q, r) => rt(q, r)).listen(0, () => {
      http.get({ port: s.address().port, path }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { s.close(); ok({ status: res.statusCode, cache: res.headers['cache-control'], body: JSON.parse(b) }); });
      });
    });
  });
}

test('returns station-format apts with CDN caching', async () => {
  calls = [];
  const r = await get('/api/rt?code=11140&months=3');
  assert.equal(r.status, 200);
  assert.match(r.cache, /s-maxage=21600/);
  assert.equal(r.body.name, '서울특별시 중구');
  assert.equal(r.body.apts.length, 1);
  assert.deepEqual(r.body.apts[0], { n: '남산타운', g: '중구', d: '신당동', t: [[20261003, 145000, 8493, 12], [20261021, 149500, 8493, 7, 'D']] });
  assert.equal(calls.length, 3);
});

test('city district names keep only the last word for matching', async () => {
  const r = await get('/api/rt?code=41111&months=1');
  assert.equal(r.body.name, '경기도 수원 장안구');
});

test('rejects a bad code and reports a missing key', async () => {
  assert.equal((await get('/api/rt?code=abc')).status, 400);
  const save = process.env.MOLIT_SERVICE_KEY; delete process.env.MOLIT_SERVICE_KEY;
  try { const r = await get('/api/rt?code=11140'); assert.equal(r.status, 503); assert.match(r.body.error, /인증키/); }
  finally { process.env.MOLIT_SERVICE_KEY = save; }
});

test('kind=분양권 uses the presale API', async () => {
  calls = [];
  await get('/api/rt?code=44200&months=1&kind=%EB%B6%84%EC%96%91%EA%B6%8C');
  assert.ok(calls[0].includes('RTMSDataSvcSilvTrade'));
});
