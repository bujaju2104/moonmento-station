// 문멘토 실거래 MCP 서버 — 국토교통부 아파트 매매 실거래가를 바로 조회한다.
// Claude.ai 사용자 지정 커넥터(Streamable HTTP, 상태 없음)로 연결해서
// 중개노트 앱과 Claude 대화에서 함께 쓴다.
const { fetchRegion, fetchMonth, buildDoc, MolitError, withRequestKey } = require('../lib/molit');
const { REGIONS, BY_CODE } = require('../lib/regions');

const SERVER = { name: 'moonmento-rt', title: '문멘토 실거래', version: '1.0.0' };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const CODE = { type: 'string', pattern: '^\\d{5}$', description: '시군구 코드 5자리 (예: 중구 11140). 모르면 find_region으로 찾기' };

const TOOLS = [
  {
    name: 'find_region',
    title: '시군구 코드 찾기',
    description: '지역 이름(예: "중구", "성남 분당", "천안")으로 실거래 조회에 쓰는 시군구 코드 5자리를 찾는다.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '지역 이름 일부' } }, required: ['query'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'apt_trades',
    title: '아파트 매매 실거래 (한 달)',
    description: '국토교통부 아파트 매매(기본) 또는 분양권·입주권 전매 실거래가를 시군구·계약월 단위로 바로 조회한다. 해제(취소)된 거래는 뺀다. 금액 단위는 만원.',
    inputSchema: {
      type: 'object',
      properties: {
        lawd_cd: CODE,
        ym: { type: 'string', pattern: '^\\d{6}$', description: '계약 연월 YYYYMM (예: 202610)' },
        dong: { type: 'string', description: '법정동 이름으로 거르기 (선택, 예: 신당동)' },
        kind: { type: 'string', enum: ['매매', '분양권'], default: '매매', description: '매매(기본) 또는 분양권(분양권·입주권 전매, 짓고 있는 단지)' },
        apt: { type: 'string', description: '단지 이름 일부로 거르기 (선택)' },
      },
      required: ['lawd_cd', 'ym'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'apt_trade_doc',
    title: '중개노트용 실거래 묶음',
    description: '시군구의 최근 N개월 아파트 매매 실거래를 단지·면적별로 묶어 문멘토 중개노트 앱 형식(#META, §v2 줄)으로 돌려준다. 앱 전용.',
    inputSchema: {
      type: 'object',
      properties: { lawd_cd: CODE, months: { type: 'integer', minimum: 1, maximum: 24, default: 12, description: '최근 몇 개월 (기본 12)' }, kind: { type: 'string', enum: ['매매', '분양권'], default: '매매', description: '매매(기본) 또는 분양권(분양권·입주권 전매, 짓고 있는 단지)' }, },
      required: ['lawd_cd'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

const bad = (msg) => { throw new MolitError(msg); };
const checkCode = (c) => (/^\d{5}$/.test(String(c || '')) ? String(c) : bad('lawd_cd는 시군구 코드 5자리예요. find_region으로 먼저 찾아 주세요.'));

async function callTool(name, a = {}) {
  if (name === 'find_region') {
    const q = String(a.query || '').replace(/\s+/g, '');
    if (!q) bad('찾을 지역 이름을 넣어 주세요.');
    const hits = REGIONS.filter((r) => (r.sido + r.name).replace(/\s+/g, '').includes(q) || r.name.replace(/\s+/g, '').includes(q)).slice(0, 30);
    return { text: hits.length ? hits.map((r) => `${r.code} ${r.sido} ${r.name}`).join('\n') : `"${a.query}"에 맞는 시군구가 없어요.`, data: { regions: hits } };
  }
  if (name === 'apt_trades') {
    const code = checkCode(a.lawd_cd);
    if (!/^\d{6}$/.test(String(a.ym || ''))) bad('ym은 YYYYMM 형식이에요 (예: 202610).');
    const kind = a.kind === '분양권' ? '분양권' : '매매';
    let rows = await fetchMonth(code, String(a.ym), kind);
    if (a.dong) rows = rows.filter((r) => r.dong.includes(a.dong));
    if (a.apt) rows = rows.filter((r) => r.apt.replace(/\s+/g, '').includes(String(a.apt).replace(/\s+/g, '')));
    rows.sort((x, y) => (y.y + y.m + y.d).localeCompare(x.y + x.m + x.d));
    const r = BY_CODE[code];
    const head = `${r ? r.sido + ' ' + r.name : code} ${a.ym} 아파트 ${kind === '분양권' ? '분양권·입주권 전매' : '매매'} ${rows.length}건 (국토교통부 실거래가, 해제 거래 제외, 금액 단위 만원)`;
    const lines = rows.slice(0, 300).map((t) => `${t.y}-${t.m}-${t.d} | ${t.dong} ${t.apt} | 전용 ${t.area}㎡ | ${t.floor}층 | ${t.price.toLocaleString('ko-KR')}만원${t.gbn === '직거래' ? ' | 직거래' : ''}${t.kind ? ' | ' + t.kind : ''}`);
    return { text: [head, ...lines, rows.length > 300 ? `… 외 ${rows.length - 300}건` : ''].filter(Boolean).join('\n'), data: { region: code, ym: a.ym, count: rows.length, trades: rows } };
  }
  if (name === 'apt_trade_doc') {
    const code = checkCode(a.lawd_cd);
    const months = Math.max(1, Math.min(24, Math.round(Number(a.months) || 12)));
    const kind = a.kind === '분양권' ? '분양권' : '매매';
    const rows = await fetchRegion(code, months, kind);
    return { text: buildDoc(code, months, rows) + (kind === '분양권' ? '\n#KIND|분양권' : '') };
  }
  const e = new Error('Unknown tool: ' + name);
  e.rpc = -32602;
  throw e;
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // 알림(notification)은 응답하지 않음
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (method) {
      case 'initialize': {
        const asked = params && params.protocolVersion;
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER,
          instructions: '국토교통부 아파트 매매 실거래가를 바로 조회해요. 지역 코드를 모르면 find_region부터 쓰세요. 금액은 만원 단위, 해제 거래는 제외돼요. 실거래는 계약 후 30일 안에 신고되므로 최근 한 달은 덜 채워져 있을 수 있어요.',
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS });
      case 'tools/call': {
        try {
          const out = await callTool(params && params.name, (params && params.arguments) || {});
          const result = { content: [{ type: 'text', text: out.text }] };
          if (out.data) result.structuredContent = out.data;
          return ok(result);
        } catch (e) {
          if (e.rpc) return fail(e.rpc, e.message);
          return ok({ isError: true, content: [{ type: 'text', text: e instanceof MolitError ? e.message : '조회 중 오류가 났어요: ' + e.message }] });
        }
      }
      default:
        return fail(-32601, 'Method not found: ' + method);
    }
  } catch (e) {
    return fail(-32603, e.message);
  }
}

function authorized(req) {
  const tok = (process.env.ACCESS_TOKEN || '').trim();
  if (!tok) return true;
  const url = new URL(req.url, 'http://x');
  const given = url.searchParams.get('k') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return given === tok;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : null;
}

module.exports = async function mcp(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    if (obj === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'GET' && !authorized(req)) return send(401, { error: '접속 키가 맞지 않아요.' });
  if (req.method === 'GET') return send(405, { error: 'MCP 클라이언트는 POST로 접속해요.', server: SERVER });
  if (req.method === 'DELETE') return send(405, { error: '세션을 쓰지 않는 서버예요.' });
  if (req.method !== 'POST') return send(405, { error: 'POST만 받아요.' });
  if (!authorized(req)) return send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: '접속 키가 맞지 않아요.' } });
  const key = new URL(req.url, 'http://x').searchParams.get('key');
  let body;
  try { body = await readBody(req); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (Array.isArray(body)) {
    const out = (await withRequestKey(key, () => Promise.all(body.map(handle)))).filter(Boolean);
    return out.length ? send(200, out) : send(202);
  }
  const out = await withRequestKey(key, () => handle(body));
  return out ? send(200, out) : send(202);
};

module.exports._handle = handle;
module.exports._callTool = callTool;
