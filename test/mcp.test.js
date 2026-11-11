const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const xml = (items, total) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items
  .map((i) => `<item>${Object.entries(i).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`)
  .join('')}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total ?? items.length}</totalCount></body></response>`;

const SAMPLE = [
  { aptNm: '남산타운', umdNm: '신당동', jibun: '844', excluUseAr: '84.93', dealYear: '2026', dealMonth: '10', dealDay: '3', dealAmount: '145,000', floor: '12', buildYear: '2002', dealingGbn: '중개거래', cdealType: '' },
  { aptNm: '남산타운', umdNm: '신당동', jibun: '844', excluUseAr: '84.93', dealYear: '2026', dealMonth: '10', dealDay: '21', dealAmount: '149,500', floor: '7', buildYear: '2002', dealingGbn: '직거래', cdealType: '' },
  { aptNm: '남산타운', umdNm: '신당동', jibun: '844', excluUseAr: '59.8', dealYear: '2026', dealMonth: '10', dealDay: '11', dealAmount: '99,000', floor: '3', buildYear: '2002', dealingGbn: '중개거래', cdealType: 'O' },
];

let calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  const ym = new URL(url).searchParams.get('DEAL_YMD');
  const body = ym === '202610' ? xml(SAMPLE) : xml([]);
  return { status: 200, text: async () => body };
};
process.env.MOLIT_SERVICE_KEY = 'abc%2Bdef';
process.env.ACCESS_TOKEN = 'secret-1';

const handler = require('../api/mcp');
const { buildDoc, recentMonths } = require('../lib/molit');

function serve() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => handler(req, res)).listen(0, () => ok(s));
  });
}
async function rpc(port, body, k = 'secret-1') {
  const r = await new Promise((ok, no) => {
    const req = http.request({ port, method: 'POST', path: '/api/mcp?k=' + k, headers: { 'content-type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => ok({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on('error', no); req.end(JSON.stringify(body));
  });
  return r;
}

test('MCP handshake, tool list and auth', async () => {
  const s = await serve(); const { port } = s.address();
  try {
    const init = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.protocolVersion, '2025-06-18');
    assert.equal(init.body.result.serverInfo.name, 'moonmento-rt');
    const note = await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    const list = await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.body.result.tools.map((t) => t.name), ['find_region', 'apt_trades', 'apt_trade_doc']);
    const denied = await rpc(port, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'wrong');
    assert.equal(denied.status, 401);
  } finally { s.close(); }
});

test('find_region finds district codes', async () => {
  const { _callTool } = handler;
  const r = await _callTool('find_region', { query: '분당' });
  assert.match(r.text, /41135 경기도 성남 분당구/);
});

test('apt_trades returns one month, drops cancelled deals, passes encoded key as-is', async () => {
  calls = [];
  const r = await handler._handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'apt_trades', arguments: { lawd_cd: '11140', ym: '202610' } } });
  const res = r.result;
  assert.equal(res.structuredContent.count, 2);
  assert.match(res.content[0].text, /서울특별시 중구 202610 아파트 매매 2건/);
  assert.match(res.content[0].text, /2026-10-21 \| 신당동 남산타운 \| 전용 84.93㎡ \| 7층 \| 149,500만원 \| 직거래/);
  assert.ok(calls[0].includes('serviceKey=abc%2Bdef&LAWD_CD=11140&DEAL_YMD=202610'));
});

test('apt_trade_doc builds the 중개노트 §v2 format', async () => {
  const r = await handler._callTool('apt_trade_doc', { lawd_cd: '11140', months: 3 });
  const lines = r.text.split('\n');
  assert.match(lines[0], /^#META\|11140\|서울특별시 중구\|\d{4}-\d\d-\d\d \d\d:\d\d\|1\|3\|2$/);
  assert.equal(lines[1], '§v2|남산타운|신당동|85|2002|||2026-10-21/7/149500/84.93/D,2026-10-03/12/145000/84.93|2026-10:147250:2|2|§');
});

test('key in the connector URL is used for MOLIT calls', async () => {
  const s = await serve(); const { port } = s.address();
  try {
    calls = [];
    const r = await rpc(port, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'apt_trades', arguments: { lawd_cd: '11140', ym: '202610' } } }, 'secret-1&key=url%2Bkey');
    assert.equal(r.body.result.structuredContent.count, 2);
    assert.ok(calls[0].includes('serviceKey=url%2Bkey&'));
  } finally { s.close(); }
});

test('kind=분양권 calls the presale API and labels 입주권', async () => {
  const save = global.fetch; const seen = [];
  global.fetch = async (url) => { seen.push(String(url)); return { status: 200, text: async () => xml([
    { aptNm: '더샵탕정인피니티시티3차', umdNm: '탕정면', excluUseAr: '84.98', dealYear: '2026', dealMonth: '10', dealDay: '2', dealAmount: '52,300', floor: '21', ownershipGbn: '분', cdealType: '' },
    { aptNm: '더샵탕정인피니티시티', umdNm: '탕정면', excluUseAr: '84.97', dealYear: '2026', dealMonth: '10', dealDay: '5', dealAmount: '55,000', floor: '9', ownershipGbn: '입', cdealType: '' },
  ]) }; };
  try {
    const r = await handler._handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'apt_trades', arguments: { lawd_cd: '44200', ym: '202610', kind: '분양권' } } });
    assert.ok(seen[0].includes('/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade?'));
    assert.match(r.result.content[0].text, /분양권·입주권 전매 2건/);
    assert.match(r.result.content[0].text, /더샵탕정인피니티시티 \| 전용 84.97㎡ \| 9층 \| 55,000만원 \| 입주권/);
    const doc = await handler._callTool('apt_trade_doc', { lawd_cd: '44200', months: 1, kind: '분양권' });
    assert.match(doc.text, /§v2\|더샵탕정인피니티시티3차\|탕정면\|85\|/);
    assert.match(doc.text, /#KIND\|분양권$/);
  } finally { global.fetch = save; }
});

test('bad input comes back as a readable tool error', async () => {
  const r = await handler._handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'apt_trades', arguments: { lawd_cd: '중구', ym: '202610' } } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /5자리/);
});

test('recentMonths counts back from the current Korean month', () => {
  assert.deepEqual(recentMonths(3, new Date('2026-11-30T16:00:00Z')), ['202612', '202611', '202610']);
});

test('api limit message is surfaced', async () => {
  const save = global.fetch;
  global.fetch = async () => ({ status: 200, text: async () => '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>' });
  try {
    const r = await handler._handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'apt_trades', arguments: { lawd_cd: '11140', ym: '202610' } } });
    assert.match(r.result.content[0].text, /호출 한도/);
  } finally { global.fetch = save; }
});
