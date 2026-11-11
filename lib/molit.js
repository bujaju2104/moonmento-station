// 국토교통부 아파트 매매 실거래가 API 호출과 중개노트 형식(§v2) 변환
const { BY_CODE } = require('./regions');

const APIS = [
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', // 상세 자료
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade', // 일반 자료
];
let apiIdx = 0; // 상세 API 활용신청이 안 돼 있으면 일반 API로 넘어가고 기억해 둠
// 아파트 분양권·입주권 전매 실거래 (짓고 있는 단지)
const PRESALE_API = 'https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';

class MolitError extends Error {}

// 요청마다 쓸 인증키: 커넥터 주소의 ?key= 값이 있으면 그것, 없으면 서버 환경변수
// (동시에 들어온 요청끼리 키가 섞이지 않도록 요청 단위로 보관)
const { AsyncLocalStorage } = require('node:async_hooks');
const keyStore = new AsyncLocalStorage();
const withRequestKey = (k, fn) => keyStore.run(String(k || '').trim(), fn);

function serviceKey() {
  const k = keyStore.getStore() || (process.env.MOLIT_SERVICE_KEY || '').trim();
  if (!k) throw new MolitError('공공데이터포털 인증키가 없어요. 커넥터 주소 끝에 ?key=인증키 를 붙여 주세요.');
  // Encoding 키(%가 들어 있음)는 그대로, Decoding 키는 인코딩해서 사용
  return k.includes('%') ? k : encodeURIComponent(k);
}

const unxml = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unxml(m[1]) : '';
};

function parseItems(xml) {
  const rows = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const g = (n) => tag(m[1], n);
    if (g('cdealType') === 'O') continue; // 해제(취소)된 거래 제외
    const price = Number(g('dealAmount').replace(/,/g, ''));
    if (!g('aptNm') || !price) continue;
    rows.push({
      apt: g('aptNm'),
      dong: g('umdNm'),
      jibun: g('jibun'),
      area: Number(g('excluUseAr')),
      y: g('dealYear'),
      m: ('0' + g('dealMonth')).slice(-2),
      d: ('0' + g('dealDay')).slice(-2),
      price,
      floor: g('floor'),
      built: g('buildYear'),
      gbn: g('dealingGbn'),
      own: g('ownershipGbn'),
    });
  }
  return rows;
}

async function getText(url) {
  let last;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
      const txt = await r.text();
      return { status: r.status, txt };
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 500 * (t + 1)));
    }
  }
  throw new MolitError('국토부 서버에 연결하지 못했어요: ' + (last && last.message));
}

async function fetchMonth(code, ym, kind = '매매') {
  const presale = kind === '분양권';
  const rows = [];
  let page = 1, total = 0;
  do {
    const url = `${presale ? PRESALE_API : APIS[apiIdx]}?serviceKey=${serviceKey()}&LAWD_CD=${code}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}`;
    const { status, txt } = await getText(url);
    if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|Forbidden|Unauthorized/i.test(txt) || status === 401 || status === 403) {
      if (presale) throw new MolitError('인증키가 아파트 분양권전매 실거래가 API에 등록되지 않았어요. 공공데이터포털에서 "국토교통부_아파트 분양권전매 실거래가 자료" 활용신청을 해 주세요.');
      if (apiIdx + 1 < APIS.length) { apiIdx++; return fetchMonth(code, ym, kind); }
      throw new MolitError('인증키가 아파트 매매 실거래가 API에 등록되지 않았어요. 공공데이터포털 활용신청을 확인해 주세요.');
    }
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(txt)) throw new MolitError('오늘 국토부 API 호출 한도를 다 썼어요. 내일 다시 시도해 주세요.');
    if (!txt.includes('<response')) throw new MolitError(`국토부 응답 오류(${code} ${ym}): ${txt.slice(0, 120)}`);
    const rc = tag(txt, 'resultCode');
    if (rc && rc !== '000' && rc !== '00') throw new MolitError(`국토부 API 오류 ${rc} ${tag(txt, 'resultMsg')}`);
    total = Number(tag(txt, 'totalCount') || 0);
    rows.push(...parseItems(txt).map((r) => (presale ? { ...r, kind: r.own === '입' ? '입주권' : '분양권' } : r)));
    page++;
  } while ((page - 1) * 1000 < total);
  return rows;
}

function recentMonths(n, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    out.push(x.getUTCFullYear() + ('0' + (x.getUTCMonth() + 1)).slice(-2));
  }
  return out;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function fetchRegion(code, months, kind = '매매') {
  const list = recentMonths(months);
  let all = (await pool(list, 6, (ym) => fetchMonth(code, ym, kind))).flat();
  if (!all.length && /^5[12]/.test(code)) {
    // 강원·전북 특별자치도 이전 코드로 한 번 더
    const old = (code[1] === '1' ? '42' : '45') + code.slice(2);
    all = (await pool(list, 6, (ym) => fetchMonth(old, ym, kind))).flat();
  }
  return all;
}

const clean = (s) => String(s).replace(/[|§,:\/\n#]/g, ' ');

function kstStamp(now = new Date()) {
  const k = new Date(now.getTime() + 9 * 3600e3).toISOString();
  return k.slice(0, 10) + ' ' + k.slice(11, 16);
}

// 중개노트 앱이 읽는 형식 (Apps Script 수집기의 build_ 와 같은 구조, 좌표·역 정보는 비움)
function buildDoc(code, months, rows, now) {
  const r = BY_CODE[code] || { code, sido: '', name: code };
  const g = {};
  for (const t of rows) {
    const k = t.apt + '|' + t.dong + '|' + Math.round(t.area);
    (g[k] = g[k] || []).push(t);
  }
  const recs = Object.keys(g).map((k) => {
    const T = g[k].sort((a, b) => (b.y + b.m + b.d).localeCompare(a.y + a.m + a.d));
    const f = T[0];
    const mm = {};
    for (const t of T) (mm[t.y + '-' + t.m] = mm[t.y + '-' + t.m] || []).push(t.price);
    const mo = Object.keys(mm).sort().map((m) => `${m}:${Math.round(mm[m].reduce((a, b) => a + b, 0) / mm[m].length)}:${mm[m].length}`).join(',');
    const trades = T.slice(0, 12).map((t) => `${t.y}-${t.m}-${t.d}/${clean(t.floor)}/${t.price}/${t.area}${t.gbn === '직거래' ? '/D' : ''}`).join(',');
    return { n: T.length, line: `§v2|${clean(f.apt)}|${clean(f.dong)}|${Math.round(f.area)}|${clean(f.built)}|||${trades}|${mo}|${T.length}|§` };
  }).sort((a, b) => b.n - a.n);
  const head = `#META|${code}|${(r.sido + ' ' + r.name).trim()}|${kstStamp(now)}|${recs.length}|${months}|${rows.length}`;
  return head + '\n' + recs.map((x) => x.line).join('\n');
}

module.exports = { withRequestKey, fetchMonth, fetchRegion, buildDoc, parseItems, recentMonths, MolitError, _setApiIdx: (i) => (apiIdx = i) };
