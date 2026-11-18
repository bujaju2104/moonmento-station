const test = require('node:test');
const assert = require('node:assert');
const { locateApt, locateMany, _pick, _cache } = require('../lib/geo');

const doc = (o) => ({ address_name: '서울 종로구 창신동 702', category_name: '부동산 > 주거시설 > 아파트', place_name: '창신쌍용1단지아파트', x: '127.0140155', y: '37.5805114', ...o });

test('picks the apartment place whose name matches', () => {
  const r = _pick([doc({ category_name: '서비스 > 건물관리사무소', place_name: '관리사무소', x: '1', y: '2' }), doc()], '창신쌍용1', '창신동');
  assert.deepStrictEqual(r, { lat: 37.580511, lng: 127.014015, place: '창신쌍용1단지아파트' });
});

test('falls back to the second query and caches results', async () => {
  _cache.clear();
  const seen = [];
  const fetchImpl = async (url) => { seen.push(decodeURIComponent(url.split('q=')[1].split('&')[0])); return { ok: true, json: async () => ({ documents: seen.length === 1 ? [] : [doc()] }) }; };
  const r = await locateApt('서울특별시 종로구', '창신동', '창신쌍용1', fetchImpl);
  assert.strictEqual(r.lat, 37.580511);
  assert.deepStrictEqual(seen, ['서울특별시 종로구 창신동 창신쌍용1', '창신동 창신쌍용1 아파트']);
  await locateApt('서울특별시 종로구', '창신동', '창신쌍용1', fetchImpl);
  assert.strictEqual(seen.length, 2);
});

test('locateMany keeps order and leaves misses without coordinates', async () => {
  _cache.clear();
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ documents: url.includes(encodeURIComponent('없는단지')) ? [] : [doc()] }) });
  const out = await locateMany('서울특별시 종로구', [{ apt: '창신쌍용1', dong: '창신동' }, { apt: '없는단지', dong: '창신동' }], fetchImpl);
  assert.strictEqual(out[0].lat, 37.580511);
  assert.strictEqual(out[1].apt, '없는단지');
  assert.strictEqual(out[1].lat, undefined);
});
