// 국토교통부 건축HUB 건축물대장정보 — 표제부(getBrTitleInfo)
// 공공데이터포털 데이터셋 15134735. 실거래와 같은 인증키(MOLIT_SERVICE_KEY)를 쓰되, 이 데이터셋도 활용신청돼 있어야 한다.
const { serviceKey, getText, tag, MolitError } = require('./molit');

const API = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const FIELDS = ['regstrKindCdNm', 'platPlc', 'newPlatPlc', 'bldNm', 'dongNm', 'mainAtchGbCdNm', 'mainPurpsCdNm', 'etcPurps', 'strctCdNm', 'etcStrct',
  'platArea', 'archArea', 'bcRat', 'totArea', 'vlRat', 'grndFlrCnt', 'ugrndFlrCnt', 'hhldCnt', 'fmlyCnt', 'hoCnt', 'useAprDay', 'rideUseElvtCnt',
  'indrAutoUtcnt', 'oudrAutoUtcnt', 'indrMechUtcnt', 'oudrMechUtcnt', 'mgmBldrgstPk'];

const pad = (v, n) => String(v || '').replace(/[^\d]/g, '').padStart(n, '0');

function parcel(q) {
  const s = String(q.sigunguCd || '').replace(/[^\d]/g, ''), b = String(q.bjdongCd || '').replace(/[^\d]/g, '');
  if (!/^\d{5}$/.test(s) || !/^\d{5}$/.test(b) || !String(q.bun || '').replace(/[^\d]/g, '')) {
    throw new MolitError('시군구코드(5)·법정동코드(5)·본번이 필요해요. 지번 주소로 다시 찾아 주세요.');
  }
  return { sigunguCd: s, bjdongCd: b, platGbCd: q.platGbCd === '1' ? '1' : '0', bun: pad(q.bun, 4), ji: pad(q.ji || 0, 4) };
}

async function brTitle(q) {
  const p = parcel(q);
  const qs = new URLSearchParams({ ...p, numOfRows: '50', pageNo: '1' }).toString();
  const { status, txt } = await getText(`${API}?serviceKey=${serviceKey()}&${qs}`);
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|Forbidden|Unauthorized/i.test(txt) || status === 401 || status === 403) {
    throw new MolitError('인증키가 건축물대장 API에 등록되지 않았어요. 공공데이터포털에서 "국토교통부_건축HUB_건축물대장정보 서비스" 활용신청을 확인해 주세요.');
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(txt)) throw new MolitError('오늘 건축물대장 API 호출 한도를 다 썼어요.');
  if (!txt.includes('<response')) throw new MolitError('건축물대장 응답 오류: ' + txt.slice(0, 120));
  const rc = tag(txt, 'resultCode');
  if (rc && rc !== '00' && rc !== '000') throw new MolitError(`건축물대장 API 오류 ${rc} ${tag(txt, 'resultMsg')}`);
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(txt))) { const o = {}; for (const f of FIELDS) o[f] = tag(m[1], f); items.push(o); }
  const dong = String(q.dong || '').replace(/\s+/g, '');
  const pick = dong ? items.filter((x) => x.dongNm.replace(/\s+/g, '') === dong || x.dongNm.replace(/\s+/g, '') === dong + '동') : [];
  return { parcel: p, total: items.length, items: pick.length ? pick : items };
}

module.exports = { brTitle, parcel };
