const test = require('node:test');
const assert = require('node:assert');
const molit = require('../lib/molit');

test('without a key, a month comes from the proxy and rate limits are retried', async () => {
  delete process.env.MOLIT_SERVICE_KEY;
  let n = 0;
  const fetchImpl = async () => { n++; return n === 1
    ? { ok: false, status: 429, json: async () => ({ error: 'rate_limited', retry_after_ms: 1 }) }
    : { ok: true, status: 200, json: async () => ({ items: [{ name: '창신쌍용1', district: '창신동', area_m2: 79.87, floor: 8, price_10k: 101700, deal_date: '2026-10-20', build_year: 1992, deal_type: '중개거래' }] }) }; };
  const rows = await molit.fetchMonthProxy('11110', '202610', fetchImpl);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(rows[0], { apt: '창신쌍용1', dong: '창신동', jibun: '', area: 79.87, y: '2026', m: '10', d: '20', price: 101700, floor: '8', built: '1992', gbn: '중개거래', own: '' });
});

test('old map codes point to the new administrative codes', () => {
  assert.deepStrictEqual(molit.ALIAS['41190'].map((x) => x[0]), ['41192', '41194', '41196']);
  assert.deepStrictEqual(molit.ALIAS['29170'].map((x) => x[0]), ['12300']);
  const dongFilter = molit.ALIAS['28140'][0][1];
  assert.strictEqual(dongFilter({ dong: '송림동' }), true);
  assert.strictEqual(dongFilter({ dong: '신포동' }), false);
});
