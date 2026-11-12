const test = require('node:test');
const assert = require('node:assert');
const item = (o) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`;
let last = '';
global.fetch = async (url) => { last = String(url); const u = new URL(url);
  const items = u.searchParams.get('bun') === '0703'
    ? [item({ bldNm: '창신쌍용아파트 2지구', dongNm: '206동', regstrKindCdNm: '표제부', totArea: '11405.88', useAprDay: '19931012' }), item({ bldNm: '창신쌍용아파트 2지구', dongNm: '207동', regstrKindCdNm: '표제부', strctCdNm: '철근콘크리트구조', totArea: '17025.68', grndFlrCnt: '15', hhldCnt: '161', useAprDay: '19931012' })]
    : [item({ platPlc: '서울특별시 중구 신당동 236-206번지', regstrKindCdNm: '일반건축물', mainPurpsCdNm: '단독주택', strctCdNm: '블록구조', etcStrct: '세멘부록조', totArea: '19.5', grndFlrCnt: '1', useAprDay: '19690902' })];
  return { status: 200, text: async () => `<response><header><resultCode>00</resultCode></header><body><items>${items.join('')}</items></body></response>` }; };
process.env.MOLIT_SERVICE_KEY = 'k%2B1';
const { brTitle } = require('../lib/building');
const mcp = require('../api/mcp');

test('single house parcel', async () => {
  const r = await brTitle({ sigunguCd: '11140', bjdongCd: '16200', bun: '236', ji: '206' });
  assert.ok(last.includes('getBrTitleInfo?serviceKey=k%2B1&sigunguCd=11140&bjdongCd=16200&platGbCd=0&bun=0236&ji=0206'));
  assert.equal(r.items[0].totArea, '19.5'); assert.equal(r.items[0].useAprDay, '19690902'); assert.equal(r.items[0].etcStrct, '세멘부록조');
});
test('apartment dong filter', async () => {
  const r = await brTitle({ sigunguCd: '11110', bjdongCd: '17400', bun: '703', dong: '207' });
  assert.equal(r.items.length, 1); assert.equal(r.items[0].hhldCnt, '161');
});
test('missing parcel is a readable error', async () => {
  await assert.rejects(brTitle({ sigunguCd: '11140' }), /시군구코드/);
});
test('connector tool building_title', async () => {
  const r = await mcp._callTool('building_title', { sigungu_cd: '11110', bjdong_cd: '17400', bun: '703', dong: '207동' });
  assert.match(r.text, /207동 · 표제부 .* 연면적 17025.68㎡ .* 사용승인 19931012/);
});
