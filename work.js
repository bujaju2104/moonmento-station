/* 문멘토 중개 AI · 매물 정리와 계약·달력
   - 매물: 광고글·메모를 붙여넣으면 매물별로 나눠 표로 정리, 엑셀 다운로드
   - 계약: 계약서 사진(글자 인식)·PDF·붙여넣기로 종류·소재지·금액·당사자·날짜를 뽑고, 확인 후 저장하면 달력에 일정 표시
   - 저장은 이 기기(브라우저)에만 돼요. 로그인·구독 버전에서 계정 저장으로 옮길 예정 */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const K_L="mm-listings-v1", K_C="mm-contracts-v1";
const load=k=>{ try{ return JSON.parse(localStorage.getItem(k)||"[]") }catch(e){ return [] } };
const store=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); return true }catch(e){ toast("저장 공간이 부족해요. 엑셀로 내려받고 일부를 지워 주세요"); return false } };
let LIST=load(K_L), CONS=load(K_C);
function toast(m){ const t=document.createElement("div"); t.className="toast"; t.textContent=m; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }
async function copy(text){ try{ await navigator.clipboard.writeText(text); }catch(e){ const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } toast("복사했어요"); }
const loadScript=(src)=>new Promise((res,rej)=>{ if(document.querySelector(`script[src="${src}"]`)) return res(); const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=()=>rej(new Error("load "+src)); document.head.appendChild(s); });
const LIB={
  xlsx:"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  pdf:"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfWorker:"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  ocr:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  ocrLang:"https://cdn.jsdelivr.net/npm/@tesseract.js-data/kor@1.0.0/4.0.0_best_int"
};

/* ---------- 금액·날짜 ---------- */
const pad=n=>String(n).padStart(2,"0");
const iso=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;
const locISO=d=>iso(d.getFullYear(),d.getMonth()+1,d.getDate());
const TODAY=()=>locISO(new Date());
function addD(s,n){ const d=new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return locISO(d); }
function addM(s,n){ const d=new Date(s+"T00:00:00"); const day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+n); const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); d.setDate(Math.min(day,last)); return locISO(d); }
const fmtD=s=>s?s.replace(/-/g,"."):"";
const wd=s=>s?"일월화수목금토"[new Date(s+"T00:00:00").getDay()]:"";
function won(m){ m=Math.round(+m||0); if(!m) return ""; const e=Math.floor(m/10000), r=m%10000; if(!e) return r.toLocaleString("ko-KR")+"만"; return e+"억"+(r?" "+r.toLocaleString("ko-KR")+"만":""); }
/* 한글 금액 → 원 (예: 일십오억원정, 금 일억오천만원) */
function korNum(s){
  const D={영:0,공:0,일:1,이:2,삼:3,사:4,오:5,육:6,륙:6,칠:7,팔:8,구:9}, U={십:10,백:100,천:1000}, B={만:1e4,억:1e8,조:1e12};
  s=s.replace(/[^영공일이삼사오육륙칠팔구십백천만억조0-9]/g,""); if(!s) return 0;
  let total=0, sect=0, num=0, digits="";
  for(const ch of s){
    if(/[0-9]/.test(ch)){ digits+=ch; continue; }
    if(digits){ num=+digits; digits=""; }
    if(ch in D) num=D[ch];
    else if(ch in U){ sect+=(num||1)*U[ch]; num=0; }
    else if(ch in B){ sect+=num; total+=(sect||1)*B[ch]; sect=0; num=0; }
  }
  if(digits) num=+digits;
  return total+sect+num;
}
/* 금액 문자열 → 만원 */
function toMan(s){
  if(s==null) return 0; s=String(s).replace(/\s/g,"");
  let m;
  if((m=s.match(/([\d.]+)억(?:([\d,]+)(?:천)?만?)?/))){ let v=parseFloat(m[1])*10000; if(m[2]){ let r=+m[2].replace(/,/g,""); if(/천/.test(s)&&r<10) r*=1000; v+=r; } return Math.round(v); }
  if((m=s.match(/([\d,]+)만/))) return +m[1].replace(/,/g,"");
  if((m=s.match(/^[\d,]{7,}원?$/))) return Math.round(+s.replace(/[^\d]/g,"")/10000);
  if(/[일이삼사오육칠팔구십백천만억]/.test(s)){ const w=korNum(s); if(w) return Math.round(w/10000); }
  if((m=s.match(/^[\d,]+$/))) return +s.replace(/,/g,"");
  return 0;
}
/* 문자열에서 날짜 모두 찾기 */
function findDates(t){
  const out=[]; let m;
  const re1=/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while((m=re1.exec(t))) out.push({i:m.index,d:iso(+m[1],+m[2],+m[3])});
  const re2=/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g;
  while((m=re2.exec(t))) out.push({i:m.index,d:iso(+m[1],+m[2],+m[3])});
  const re3=/(?<![\d.])(\d{2})\.(\d{1,2})\.(\d{1,2})(?![\d.])/g;
  while((m=re3.exec(t))) if(+m[2]<=12&&+m[3]<=31) out.push({i:m.index,d:iso(2000+ +m[1],+m[2],+m[3])});
  return out.filter(x=>!isNaN(new Date(x.d+"T00:00:00"))).sort((a,b)=>a.i-b.i);
}

/* ======================================================================
   매물 정리
   ====================================================================== */
const L_COLS=[["complex","단지·건물"],["dongho","동·호"],["zone","재개발 구역"],["region","지역"],["address","주소(지번)"],["ptype","유형"],["deal","거래"],["price","매매가·보증금(만원)"],["rent","월세(만원)"],["deposit","승계 보증금(만원)"],["appraisal","감정가(만원)"],["estAppraisal","추정감정가(만원)"],["supply","공급(㎡)"],["area","전용(㎡)"],["pyeong","평형"],["floor","층"],["dir","향"],["rooms","방/욕실"],["moveIn","입주"],["articleNo","네이버 매물번호"],["confirmed","확인일"],["ownerName","소유주 성함"],["ownerTel","소유주 전화"],["memo","메모"]];
const L_MONEY=["price","rent","deposit","appraisal","estAppraisal"];
const L_XCOLS=L_COLS.slice(0,12).concat([["premium","프리미엄(만원)"],["invest","실투자금(만원)"]],L_COLS.slice(12));
const calcL=r=>{ const p=+r.price||0, base=+r.appraisal||+r.estAppraisal||0, dep=+r.deposit||0; return {premium:r.deal==="매매"&&p&&base?p-base:"", invest:r.deal==="매매"&&p?p-dep:""}; };
const naverUrl=no=>`https://m.land.naver.com/article/info/${encodeURIComponent(no)}`;
LIST.forEach(r=>{ if(r.owner&&!r.ownerTel){ const t=String(r.owner).match(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/); r.ownerTel=t?t[0]:""; r.ownerName=r.ownerName||String(r.owner).replace(t?t[0]:"","").trim(); } });
const DIRS=["남동향","남서향","북동향","북서향","남향","북향","동향","서향"];
const PTYPES=["아파트","오피스텔","빌라","다세대","연립","단독","다가구","상가주택","상가","사무실","건물","토지","분양권","재개발","재건축"];
function splitBlocks(t){
  t=t.replace(/\r/g,"").trim(); if(!t) return [];
  let bl=t.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
  if(bl.length===1){
    const lines=t.split("\n").map(x=>x.trim()).filter(Boolean);
    const starts=lines.map((l,i)=>/^(\d+[.)]\s|[-•▶■●◆*]\s?)/.test(l)?i:-1).filter(i=>i>=0);
    if(starts.length>1) bl=starts.map((s,k)=>lines.slice(s,starts[k+1]).join("\n"));
    else if(lines.length>2&&lines.every(l=>/(매매|전세|월세)/.test(l))) bl=lines;
  }
  return bl;
}
function parseKV(t){
  const map={단지:"complex",단지명:"complex",건물:"complex",동호:"dongho","동·호":"dongho",지역:"region",소재지:"region",유형:"ptype",거래:"deal",매매가:"price",가격:"price",보증금:"price",월세:"rent",공급:"supply",공급면적:"supply",전용:"area",전용면적:"area",평형:"pyeong",층:"floor",향:"dir",방향:"dir","방/욕실":"rooms",방욕실:"rooms",입주:"moveIn",입주가능일:"moveIn",매물번호:"articleNo",확인일:"confirmed",소유주:"ownerName",성함:"ownerName",소유주성함:"ownerName",집주인:"ownerName",연락처:"ownerTel",전화:"ownerTel",전화번호:"ownerTel",소유주전화:"ownerTel",구역:"zone",재개발구역:"zone",주소:"address",지번:"address",감정가:"appraisal",추정감정가:"estAppraisal",승계보증금:"deposit",보증금승계:"deposit",메모:"memo"};
  const o={}; let n=0;
  t.split("\n").forEach(l=>{ const m=l.match(/^\s*[-•]?\s*([가-힣/·]+)\s*[:：]\s*(.+)$/); if(m&&map[m[1]]){ o[map[m[1]]]=m[2].trim(); n++; } });
  return n>=3?o:null;
}
function parseListing(t){
  const kv=parseKV(t);
  if(kv){ L_MONEY.forEach(k=>{ if(kv[k]) kv[k]=toMan(kv[k])||kv[k]; }); return finishL(kv,t); }
  const o={}; const flat=t.replace(/\s+/g," ");
  const lines=t.split("\n").map(x=>x.trim()).filter(Boolean);
  let m;
  o.deal=(flat.match(/매매|전세|월세|반전세|단기임대/)||[""])[0]; if(o.deal==="반전세") o.deal="월세";
  // 가격: "월세 1억/150", "전세 5억 5,000", "매매 14억 5,000", "14.5억"
  if((m=flat.match(/(?:보증금\s*)?([\d.,]+\s*억(?:\s*[\d,]+)?|[\d,]{3,}\s*만?)\s*\/\s*([\d,]+)/))&&/월세|반전세|\//.test(flat)){ o.price=toMan(m[1]); o.rent=+m[2].replace(/,/g,""); if(!o.deal) o.deal="월세"; }
  else if((m=flat.match(/([\d.]+\s*억(?:\s*(?:[\d]{1,2},\d{3}|\d{3,4}|\d\s*천)(?!\s*(?:층|평|㎡|m|동|호|\/)))?)/))) o.price=toMan(m[1]);
  else if((m=flat.match(/([\d,]{4,})\s*만\s*원?/))) o.price=+m[1].replace(/,/g,"");
  if((m=flat.match(/월\s*([\d,]+)\s*만?/))&&!o.rent&&/월세/.test(o.deal)) o.rent=+m[1].replace(/,/g,"");
  // 면적: 84/59m², 공급 84 전용 59, 59㎡, 32평
  if((m=flat.match(/([\d.]+)\s*\/\s*([\d.]+)\s*(?:m²|㎡|m2|제곱미터)/i))){ o.supply=m[1]; o.area=m[2]; }
  else { if((m=flat.match(/전용\s*([\d.]+)\s*(?:m²|㎡|m2)?/))) o.area=m[1]; if((m=flat.match(/공급\s*([\d.]+)\s*(?:m²|㎡|m2)?/))) o.supply=m[1];
    if(!o.area&&(m=flat.match(/([\d.]+)\s*(?:m²|㎡|m2)/))) o.area=m[1]; }
  if((m=flat.match(/(\d{1,3})\s*평(?:형)?/))) o.pyeong=m[1]+"평";
  else if(o.supply) o.pyeong=Math.round(o.supply/3.3058)+"평";
  if((m=flat.match(/(저|중|고|\d{1,3})\s*\/\s*(\d{1,3})\s*층/))) o.floor=`${m[1]}/${m[2]}층`;
  else if((m=flat.match(/(\d{1,3})\s*층/))) o.floor=m[1]+"층";
  o.dir=DIRS.find(d=>flat.includes(d))||"";
  if((m=flat.match(/방\s*(\d)\s*[,/·]?\s*(?:욕실|화장실)\s*(\d)/))||(m=flat.match(/(\d)\s*룸\s*(\d)\s*욕/))) o.rooms=`${m[1]}/${m[2]}`;
  if((m=flat.match(/(즉시\s*입주|입주\s*협의|협의\s*가능|(?:20\d{2}\s*년\s*)?\d{1,2}월\s*(?:초|중|말|\d{1,2}일)?\s*입주(?:\s*(?:가능|협의))?)/))) o.moveIn=m[1].replace(/\s+/g," ");
  if((m=flat.match(/(?:매물번호|매물 번호|NO\.?)\s*[:：]?\s*(\d{8,12})/i))||(m=flat.match(/(?<!\d)(2\d{9})(?!\d)/))) o.articleNo=m[1];
  const dts=findDates(flat); if((m=flat.match(/확인(?:매물)?\s*([\d.]+)/))){ const d=findDates(m[1].length<=8?("20"+m[1]):m[1])[0]; if(d) o.confirmed=d.d; } else if(dts.length) o.confirmed=dts[0].d;
  o.ptype=PTYPES.find(p=>flat.includes(p))||"";
  if((m=flat.match(/((?:서울(?:특별시|시)?\s*)?[가-힣]+구\s*[가-힣0-9]+(?:동|가))/))) o.region=m[1].replace(/서울(특별시|시)?\s*/,"");
  else { const cands=[...flat.matchAll(/(?<![가-힣])([가-힣]{1,4}\d?동)(?![가-힣])/g)].map(x=>x[1]).filter(x=>!DIRS.some(d=>d.startsWith(x))&&!/^(남|북|동|서)동$/.test(x)); if(cands[0]) o.region=cands[0]; }
  if((m=flat.match(/(\d{2,4})\s*동\s*(\d{2,5})\s*호/))) o.dongho=`${m[1]}동 ${m[2]}호`;
  else if((m=flat.match(/(?<![\d가-힣])(\d{2,4})\s*동(?![가-힣])/))) o.dongho=m[1]+"동";
  if((m=flat.match(/(01[016789][-\s.]?\d{3,4}[-\s.]?\d{4})/))) o.ownerTel=m[1];
  const AMT="([\\d.]+\\s*억(?:\\s*(?:[\\d]{1,2},\\d{3}|\\d{3,4}|\\d\\s*천))?(?:\\s*만)?|[\\d,]{4,}\\s*만)";
  if((m=flat.match(/([가-힣]{1,6})\s?(\d{1,3})\s?구역/))) o.zone=`${m[1]}${m[2]}구역`;
  if((m=flat.match(new RegExp("(?<!추정\\s*)감정(?:가|평가액|가액)\\s*[:：]?\\s*"+AMT)))) o.appraisal=toMan(m[1]);
  if((m=flat.match(new RegExp("(?:추정\\s*감정가(?:액)?|감정가\\s*추정)\\s*[:：]?\\s*"+AMT)))) o.estAppraisal=toMan(m[1]);
  if(o.deal==="매매"){
    if((m=flat.match(new RegExp("매매(?:가)?\\s*[:：]?\\s*"+AMT)))) o.price=toMan(m[1]);
    if((m=flat.match(new RegExp("(?:승계\\s*)?(?:보증금|전세금|전세가|세\\s*안고)\\s*(?:승계)?\\s*[:：]?\\s*"+AMT)))) o.deposit=toMan(m[1]);
    if(!o.rent&&(m=flat.match(/월(?:세)?\s*([\d,]+)\s*만?/))) o.rent=+m[1].replace(/,/g,"");
  }
  if((m=flat.match(/((?:서울(?:특별시|시)?\s*)?[가-힣]+구\s*[가-힣0-9]+(?:동|가)\s*\d+(?:-\d+)?)/))) o.address=m[1].replace(/\s+/g," ");
  if((m=flat.match(/(?:소유주|소유자|집주인|건물주|매도인|성함)\s*[:：]?\s*([가-힣]{2,4})(?:\s*(?:님|씨|사장님))?/))&&!/연락|전화|번호|확인|직접|본인/.test(m[1])) o.ownerName=m[1];
  // 단지명: 첫 줄에서 거래·숫자 앞부분
  let first=lines[0]||""; first=first.replace(/^(\d+[.)]\s*|[-•▶■●◆*]\s*)/,"");
  let cname=first.split(/매매|전세|월세|반전세|\d+\s*억|\d+\s*동\s*\d|\d+\s*평|[,|]/)[0].trim();
  if(o.region) cname=cname.replace(o.region,"").trim();
  cname=cname.replace(/^(서울(특별시|시)?\s*)?[가-힣]+구\s+(?=[가-힣]+동\s)/,"").replace(/^[가-힣]+\d?동\s+/,"").replace(/\s*(아파트)$/,"").trim();
  { const dm=cname.match(/\s(\d{1,4})\s*동$/); if(dm){ if(!o.dongho) o.dongho=dm[1]+"동"; cname=cname.slice(0,dm.index).trim(); } }
  o.complex=cname.slice(0,30);
  o.memo=lines.slice(1).join(" / ").slice(0,300);
  return finishL(o,t);
}
function finishL(o,raw){ o.id=uid(); o.raw=raw; o.added=TODAY(); L_COLS.forEach(([k])=>{ if(o[k]==null) o[k]=""; }); if(o.area&&!o.pyeong&&!o.supply) o.pyeong=""; return o; }

let lFilter={q:"",deal:"전체"}, lDraft=null, lMode="table", lZone=null, zmap=null, zOv=[];
function renderListings(){
  const box=$("#view-listings");
  const rows=LIST.filter(x=>(lFilter.deal==="전체"||x.deal===lFilter.deal)&&(!lFilter.q||Object.values(x).join(" ").includes(lFilter.q)));
  box.innerHTML=`<div><h1 class="view">매물 정리</h1><p class="lede" style="margin-top:4px">네이버 광고글, 카톡 메모, 엑셀에서 복사한 줄을 그대로 붙여넣으세요. 매물마다 나눠서 표로 정리하고, 엑셀로 받을 수 있어요.</p></div>
    <div class="out" style="background:#fff">
      <div class="field"><label for="lpaste">붙여넣기 (여러 매물은 빈 줄로 구분)</label>
      <textarea id="lpaste" placeholder="예)&#10;남산타운 6동 매매 14억 5,000 84/59㎡ 12/20층 남향 즉시입주&#10;&#10;신당푸르지오 전세 7억 전용 84㎡ 5층 2027년 1월 입주"></textarea></div>
      <div class="btns"><button type="button" class="btn pri" id="lparse">정리하기</button><button type="button" class="btn" id="lai">AI로 정리 지시문</button></div>
      ${lDraft?`<div class="warn">${lDraft.length}건을 찾았어요. 맞는지 확인하고 <b>저장</b>을 눌러 주세요. 칸을 눌러 바로 고칠 수 있어요.</div>${lTable(lDraft,true)}<div class="btns"><button type="button" class="btn pri" id="lsave">${lDraft.length}건 저장</button><button type="button" class="btn" id="lcancel">취소</button></div>`:""}
    </div>
    <div class="bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <h2 class="sec" style="margin:0;font-size:16px">내 매물 <span class="num">${LIST.length}</span></h2>
      <div class="chips">${["전체","매매","전세","월세"].map(d=>`<button type="button" class="chip ${lFilter.deal===d?"on":""}" data-ld="${d}">${d}</button>`).join("")}</div>
      <input id="lq" type="search" placeholder="검색" value="${esc(lFilter.q)}" style="flex:1;min-width:120px;border:1px solid var(--line);border-radius:10px;padding:8px 10px">
    </div>
    <div class="chips"><button type="button" class="chip ${lMode==="table"?"on":""}" data-lm="table">표로 보기</button><button type="button" class="chip ${lMode==="zone"?"on":""}" data-lm="zone">재개발 구역별 보기</button></div>
    ${!LIST.length?`<div class="empty">아직 저장한 매물이 없어요</div>`:lMode==="zone"?`<div id="zoneBox"></div>`:lTable(rows,false)}
    <div class="btns"><button type="button" class="btn pri" id="lxlsx" ${LIST.length?"":"disabled"}>엑셀로 내려받기</button><button type="button" class="btn" id="lcopy" ${rows.length?"":"disabled"}>손님용 목록 복사</button>${LIST.length?`<button type="button" class="btn" id="ldelall" style="color:var(--red)">전체 삭제</button>`:""}</div>
    <p class="note">이 기기(브라우저)에만 저장돼요. 다른 기기에서 보려면 엑셀로 내려받아 두세요. 로그인 버전이 나오면 계정에 저장돼요.</p>`;
  bindL(rows);
}
function lTable(rows,draft){
  return `<div class="tbl ltable" style="max-height:${draft?"none":"60vh"}"><table><thead><tr>${draft?"":"<th></th>"}${L_COLS.map(([k,l])=>`<th>${l}</th>`).join("")}</tr></thead><tbody>
  ${rows.map(r=>`<tr data-lid="${r.id}">${draft?"":`<td><button type="button" class="linkbtn" data-ldel="${r.id}" aria-label="삭제">삭제</button></td>`}${L_COLS.map(([k])=>`<td contenteditable="true" data-k="${k}" class="${L_MONEY.includes(k)||["supply","area"].includes(k)?"n":""}">${esc(L_MONEY.includes(k)&&k!=="rent"&&r[k]?won(r[k]):k==="rent"&&r[k]?r[k]+"만":r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function cellVal(k,txt){ txt=txt.trim(); if(k==="rent") return toMan(txt)||(+txt.replace(/[^\d]/g,"")||""); if(L_MONEY.includes(k)) return toMan(txt)||txt; return txt; }
function bindL(rows){
  $("#lparse").onclick=()=>{ const t=$("#lpaste").value; const bl=splitBlocks(t); if(!bl.length){ toast("붙여넣은 내용이 없어요"); return; } lDraft=bl.map(parseListing); renderListings(); };
  $("#lai").onclick=()=>copy(`아래 부동산 매물 글을 매물마다 나눠서, 매물 하나당 아래 형식으로만 써 줘. 매물 사이는 빈 줄 하나. 모르는 칸은 비워 둬. 숫자는 지어내지 마.\n\n단지: \n동호: \n지역: (예: 중구 신당동)\n유형: (아파트/오피스텔/빌라 등)\n거래: (매매/전세/월세)\n가격: (매매가 또는 보증금, 예: 14억 5000)\n월세: (만원)\n공급: (㎡)\n전용: (㎡)\n층: (예: 12/20층)\n향: \n방/욕실: \n입주: \n매물번호: \n확인일: \n메모: \n\n[매물 글]\n${$("#lpaste").value||"(여기에 붙여넣기)"}`);
  const draftSave=()=>{ document.querySelectorAll("#view-listings tr[data-lid] td[data-k]").forEach(td=>{ const id=td.parentElement.dataset.lid; const arr=lDraft&&lDraft.find(x=>x.id===id)?lDraft:LIST; const r=arr.find(x=>x.id===id); if(r) r[td.dataset.k]=cellVal(td.dataset.k,td.textContent); }); };
  if($("#lsave")) $("#lsave").onclick=()=>{ draftSave(); LIST=LIST.concat(lDraft); lDraft=null; store(K_L,LIST); $("#lpaste").value=""; toast("저장했어요"); renderListings(); };
  if($("#lcancel")) $("#lcancel").onclick=()=>{ lDraft=null; renderListings(); };
  document.querySelectorAll("#view-listings [data-ld]").forEach(b=>b.onclick=()=>{ lFilter.deal=b.dataset.ld; renderListings(); });
  document.querySelectorAll("#view-listings [data-lm]").forEach(b=>b.onclick=()=>{ lMode=b.dataset.lm; renderListings(); });
  if(lMode==="zone"&&$("#zoneBox")) renderZone(rows);
  const q=$("#lq"); q.oninput=()=>{ lFilter.q=q.value.trim(); clearTimeout(q._t); q._t=setTimeout(()=>{ renderListings(); const n=$("#lq"); n.focus(); n.setSelectionRange(n.value.length,n.value.length); },300); };
  document.querySelectorAll("#view-listings tr[data-lid] td[data-k]").forEach(td=>td.addEventListener("blur",()=>{ const id=td.parentElement.dataset.lid; if(lDraft&&lDraft.some(x=>x.id===id)) return; const r=LIST.find(x=>x.id===id); if(r){ r[td.dataset.k]=cellVal(td.dataset.k,td.textContent); store(K_L,LIST); } }));
  document.querySelectorAll("[data-ldel]").forEach(b=>b.onclick=()=>{ if(!confirm("이 매물을 지울까요?")) return; LIST=LIST.filter(x=>x.id!==b.dataset.ldel); store(K_L,LIST); renderListings(); });
  if($("#ldelall")) $("#ldelall").onclick=()=>{ if(!confirm(`매물 ${LIST.length}건을 모두 지울까요? 되돌릴 수 없어요. 먼저 엑셀로 받아 두세요.`)) return; LIST=[]; store(K_L,LIST); renderListings(); };
  $("#lxlsx").onclick=()=>xlsx("매물정리",L_XCOLS,LIST.map(r=>({...r,...calcL(r)})));
  $("#lcopy").onclick=()=>copy(rows.map((r,i)=>`${i+1}. ${r.complex}${r.dongho?" "+r.dongho:""} (${r.region||""})\n   ${r.deal} ${r.price?won(r.price):""}${r.rent?" / 월 "+r.rent+"만":""} · ${r.area?"전용 "+r.area+"㎡":""}${r.pyeong?" ("+r.pyeong+")":""} · ${r.floor} ${r.dir}${r.moveIn?" · "+r.moveIn:""}`).join("\n")+"\n\n문멘토프라퍼티 010.6336.1828 · 010.4336.5038");
}

/* ---------- 재개발 구역별 보기 ---------- */
function renderZone(rows){
  const groups={}; rows.forEach(r=>{ const z=r.zone||"구역 미지정"; (groups[z]=groups[z]||[]).push(r); });
  const names=Object.keys(groups).sort((a,b)=>(a==="구역 미지정")-(b==="구역 미지정")||groups[b].length-groups[a].length);
  if(!lZone||!groups[lZone]) lZone=names[0];
  const G=groups[lZone]||[];
  const C=G.map(r=>({r,...calcL(r)}));
  const nums=k=>C.map(x=>+x[k]).filter(v=>v>0);
  const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):0;
  const minInv=nums("invest").length?Math.min(...nums("invest")):0;
  $("#zoneBox").innerHTML=`<div class="chips">${names.map(z=>`<button type="button" class="chip ${z===lZone?"on":""}" data-zone="${esc(z)}">${esc(z)} <span class="num">${groups[z].length}</span></button>`).join("")}</div>
    <div class="stats stats4"><div class="stat"><b>${G.length}</b><span>매물</span></div><div class="stat"><b>${avg(nums("premium"))?won(avg(nums("premium"))):"-"}</b><span>평균 프리미엄</span></div><div class="stat"><b>${minInv?won(minInv):"-"}</b><span>최저 실투자금</span></div><div class="stat"><b>${avg(C.map(x=>+x.r.price).filter(v=>v>0))?won(avg(C.map(x=>+x.r.price).filter(v=>v>0))):"-"}</b><span>평균 매매가</span></div></div>
    <div id="zmap" class="zmap"><div class="note" style="padding:12px">지도를 불러오는 중이에요…</div></div>
    <div class="zcards">${C.map((x,i)=>{ const r=x.r; return `<article class="zcard" data-zid="${r.id}">
      <header><span class="no">${i+1}</span><div><b>${esc(r.complex||r.address||"이름 없음")}${r.dongho?" "+esc(r.dongho):""}</b><div class="note">${esc(r.address||r.region||"")}${r.ptype?" · "+esc(r.ptype):""}${r.area?" · 전용 "+esc(r.area)+"㎡":""}${r.pyeong?" ("+esc(r.pyeong)+")":""}</div></div><span class="pill">${esc(r.deal||"")}</span></header>
      <dl class="zkv">
        <dt>매매가</dt><dd class="num big">${r.price?won(r.price):"-"}</dd>
        <dt>감정가</dt><dd class="num">${r.appraisal?won(r.appraisal):"-"}</dd>
        <dt>추정감정가</dt><dd class="num">${r.estAppraisal?won(r.estAppraisal):"-"}</dd>
        <dt>프리미엄</dt><dd class="num strong">${x.premium!==""?won(x.premium):"-"}${x.premium!==""&&!r.appraisal&&r.estAppraisal?' <small>(추정 기준)</small>':""}</dd>
        <dt>승계 보증금</dt><dd class="num">${r.deposit?won(r.deposit):"-"}${r.rent?` / 월 ${esc(r.rent)}만`:""}</dd>
        <dt>실투자금</dt><dd class="num strong">${x.invest!==""?won(x.invest):"-"}</dd>
        <dt>소유주</dt><dd>${esc(r.ownerName||"-")}${r.ownerTel?` · <a href="tel:${esc(r.ownerTel.replace(/[^\d]/g,""))}">${esc(r.ownerTel)}</a>`:""}</dd>
      </dl>
      ${r.memo?`<p class="note" style="margin:0">${esc(r.memo)}</p>`:""}
      <div class="btns">${r.articleNo?`<a class="btn" href="${naverUrl(r.articleNo)}" target="_blank" rel="noopener">네이버 매물 ${esc(r.articleNo)}</a>`:""}<button type="button" class="btn" data-zfocus="${r.id}">지도에서 보기</button>${r.ownerTel?`<a class="btn" href="sms:${esc(r.ownerTel.replace(/[^\d]/g,""))}">문자</a>`:""}</div>
    </article>`; }).join("")}</div>
    <p class="note">프리미엄 = 매매가 − 감정가(없으면 추정감정가), 실투자금 = 매매가 − 승계 보증금이에요. 감정가는 조합 통지 금액으로 꼭 확인하세요. 표로 보기에서 칸을 눌러 감정가·성함 등을 고칠 수 있어요.</p>`;
  document.querySelectorAll("[data-zone]").forEach(b=>b.onclick=()=>{ lZone=b.dataset.zone; renderZone(rows); });
  document.querySelectorAll("[data-zfocus]").forEach(b=>b.onclick=()=>{ const o=zOv.find(z=>z.id===b.dataset.zfocus); if(o&&zmap){ zmap.setCenter(o.pos); zmap.setLevel(2); $("#zmap").scrollIntoView({behavior:"smooth",block:"center"}); } else toast("이 매물은 위치를 못 찾았어요. 주소(지번)를 넣어 주세요"); });
  drawZoneMap(G);
}
async function drawZoneMap(G){
  const box=$("#zmap"); if(!box) return;
  if(!(window.kakao&&kakao.maps&&kakao.maps.Map&&kakao.maps.services)){ box.innerHTML=`<div class="note" style="padding:12px">카카오 지도를 쓸 수 없어서 지도 없이 보여 드려요.</div>`; return; }
  const K=kakao.maps; box.innerHTML="";
  zmap=new K.Map(box,{center:new K.LatLng(37.5665,127.016),level:5}); zOv=[];
  const geo=new K.services.Geocoder(), ps=new K.services.Places();
  const find=r=>new Promise(res=>{
    if(r.lat&&r.lng) return res([+r.lat,+r.lng]);
    const viaPlace=()=>{ const q=[r.region,r.complex].filter(Boolean).join(" "); if(!q) return res(null); ps.keywordSearch(q,(d,st)=>res(st===K.services.Status.OK?[+d[0].y,+d[0].x]:null)); };
    if(r.address) geo.addressSearch(r.address,(d,st)=>{ if(st===K.services.Status.OK) res([+d[0].y,+d[0].x]); else viaPlace(); }); else viaPlace();
  });
  const pts=[]; let changed=false;
  for(const [i,r] of G.entries()){
    const p=await find(r); if(!p) continue;
    if(!r.lat){ r.lat=p[0]; r.lng=p[1]; changed=true; }
    const el=document.createElement("div"); el.className="ap"; el.innerHTML=`<b>${i+1}</b><span class="tag">${esc((r.complex||r.address||"").slice(0,12))}${r.price?" "+esc(won(r.price)):""}</span>`;
    el.onclick=()=>{ const c=document.querySelector(`[data-zid="${r.id}"]`); if(c){ c.scrollIntoView({behavior:"smooth",block:"center"}); c.classList.add("flash"); setTimeout(()=>c.classList.remove("flash"),1200); } };
    const pos=new K.LatLng(p[0],p[1]); new K.CustomOverlay({map:zmap,position:pos,content:el,yAnchor:1,clickable:true}); zOv.push({id:r.id,pos}); pts.push(pos);
  }
  if(changed) store(K_L,LIST);
  if(pts.length){ const b=new K.LatLngBounds(); pts.forEach(p=>b.extend(p)); zmap.setBounds(b); box.classList.add("zoomed2"); }
  else box.insertAdjacentHTML("beforeend",`<div class="note" style="position:absolute;left:10px;top:10px;z-index:3;background:#fff;padding:6px 10px;border-radius:8px">주소(지번)를 넣으면 지도에 표시돼요</div>`);
}

/* ---------- 엑셀 ---------- */
async function xlsx(name,cols,rows){
  try{ await loadScript(LIB.xlsx); }catch(e){ return csv(name,cols,rows); }
  const data=[cols.map(c=>c[1])].concat(rows.map(r=>cols.map(([k])=>r[k]??"")));
  const ws=XLSX.utils.aoa_to_sheet(data); ws["!cols"]=cols.map(([k,l])=>({wch:Math.max(8,Math.min(40,Math.max(l.length*2,...rows.map(r=>String(r[k]??"").length))+2))}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,name.slice(0,30));
  XLSX.writeFile(wb,`${name}_${TODAY()}.xlsx`);
}
function csv(name,cols,rows){
  const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const t="﻿"+[cols.map(c=>q(c[1])).join(",")].concat(rows.map(r=>cols.map(([k])=>q(r[k])).join(","))).join("\r\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([t],{type:"text/csv"})); a.download=`${name}_${TODAY()}.csv`; a.click();
}

/* ======================================================================
   계약서 읽기
   ====================================================================== */
const C_COLS=[["kind","종류"],["region","지역"],["address","소재지"],["unit","동·호"],["area","면적(㎡)"],["price","매매대금·보증금(만원)"],["rent","월세(만원)"],["down","계약금(만원)"],["middleAmt","중도금(만원)"],["balanceAmt","잔금(만원)"],
  ["contract","계약일"],["middle","중도금일"],["balance","잔금일"],["moveIn","입주·인도일"],["start","임대 시작"],["end","임대 만료"],
  ["seller","매도인·임대인"],["buyer","매수인·임차인"],["sellerTel","매도·임대인 연락처"],["buyerTel","매수·임차인 연락처"],["agentOther","공동중개"],["th","토지거래허가"],["memo","특약·메모"]];
const AMT_KEYS={price:/(매매\s*대금|매\s*매\s*대\s*금|보\s*증\s*금|전세\s*금|임대\s*보증금)/,down:/계\s*약\s*금/,middleAmt:/중\s*도\s*금/,balanceAmt:/잔\s*금/,rent:/(차\s*임|월\s*세|월\s*차임)/};
function amountAfter(t,re){
  const g=new RegExp(re.source,"g"); let m, best=null;
  while((m=g.exec(t))){ const nx=t.slice(m.index+m[0].length,m.index+m[0].length+18); if(/^[\s()월세·:：]*(금|₩|\\|[\d일이삼사오육칠팔구십])/.test(nx)){ best=m; break; } }
  if(!best) return 0; m=best;
  if(/^[\s()월세·:：]*(금\s*)?없음/.test(t.slice(m.index+m[0].length,m.index+m[0].length+18))) return 0;
  const seg=t.slice(m.index+m[0].length, m.index+m[0].length+90);
  let a;
  if((a=seg.match(/[₩\\]\s*([\d,]{4,})/))) return Math.round(+a[1].replace(/,/g,"")/10000);
  if((a=seg.match(/금\s*([영공일이삼사오육륙칠팔구십백천만억조\s]{2,})\s*원/))) return Math.round(korNum(a[1])/10000);
  if((a=seg.match(/([\d,]{5,})\s*원/))) return Math.round(+a[1].replace(/,/g,"")/10000);
  if((a=seg.match(/([\d.]+\s*억(?:\s*[\d,]+)?(?:\s*만)?)/))) return toMan(a[1]);
  if((a=seg.match(/([\d,]+)\s*만\s*원/))) return +a[1].replace(/,/g,"");
  return 0;
}
function dateAfter(t,re,span=140){
  const m=t.match(re); if(!m) return "";
  const seg=t.slice(m.index, m.index+m[0].length+span);
  const d=findDates(seg)[0]; return d?d.d:"";
}
const roleRe=r=>r.split("").join("\\s*");
function lastRole(t,role){ const g=new RegExp(roleRe(role),"g"); let m,last=null; while((m=g.exec(t))) last=m; return last; }
function nameAfter(t,role){
  const L=lastRole(t,role);
  if(L){ const seg=t.slice(L.index,L.index+160); let m=seg.match(/성\s*명\s*[:：]?\s*([가-힣]{2,4})(?![가-힣])/); if(m) return m[1]; }
  { const m=t.match(new RegExp(roleRe(role)+"\\s*[(（]\\s*([가-힣]{2,4})\\s*[)）]")); if(m) return m[1]; }
  // 서명란: "매도인 ... 성명 홍길동" 또는 "매도인: 홍길동"
  let re=new RegExp(role+"[\\s\\S]{0,120}?성\\s*명\\s*[:：]?\\s*([가-힣]{2,4})(?![가-힣])");
  let m=t.match(re); if(m) return m[1];
  re=new RegExp(role+"\\s*[:：(]?\\s*([가-힣]{2,4})(?:\\s|\\(|$|,|인|\\))"); m=t.match(re);
  if(m&&!/주소|성명|주민|전화|대리|이하|및|은|는|과|와/.test(m[1])) return m[1];
  return "";
}
function telAfter(t,role){ const L=lastRole(t,role); if(!L) return ""; const m=t.slice(L.index,L.index+180).match(/(01[016789][-\s.)]?\d{3,4}[-\s.]?\d{4})/); return m?m[1].replace(/[\s.)]/g,"-").replace(/--+/g,"-"):""; }
function parseContract(text){
  const t=text.replace(/\r/g,"");
  const kvc=parseCKV(t); if(kvc) return kvc;
  const flat=t.replace(/[ \t]+/g," ");
  const o={id:uid(),added:TODAY(),raw:t.slice(0,4000)};
  const head=flat.slice(0,200);
  const cnt=re=>(flat.match(re)||[]).length;
  const saleN=cnt(/매\s*도\s*인|매\s*수\s*인/g), leaseN=cnt(/임\s*대\s*인|임\s*차\s*인/g);
  const isSale=/매\s*매\s*계\s*약\s*서/.test(head)||(!/임\s*대\s*차/.test(head)&&saleN>=leaseN&&saleN>0);
  const isLease=!isSale&&(/임\s*대\s*차|전\s*세|월\s*세/.test(head)||leaseN>0);
  for(const k in AMT_KEYS) o[k]=amountAfter(flat,AMT_KEYS[k])||"";
  if(isSale&&!isLease) o.kind="매매"; else if(isLease) o.kind=o.rent?"월세":"전세"; else o.kind=o.rent?"월세":(o.price?"매매":"");
  let m;
  if((m=flat.match(/소\s*재\s*지\s*[:：]?\s*([^\n]{6,80})/))) o.address=m[1].replace(/\s*(토\s*지|지\s*목|건\s*물|구\s*조|임\s*차\s*할|면\s*적|용\s*도|대\s*지\s*권).*$/,"").trim();
  const addrSrc=o.address||flat;
  if((m=addrSrc.match(/((?:서울(?:특별시|시)?|[가-힣]+(?:시|도))?\s*[가-힣]+(?:구|시|군)\s*[가-힣0-9]+(?:동|가|읍|면|리))/))) o.region=m[1].replace(/서울(특별시|시)?\s*/,"").trim();
  if((m=flat.match(/(\d{1,4})\s*동\s*(\d{1,5})\s*호/))) o.unit=`${m[1]}동 ${m[2]}호`;
  if((m=flat.match(/(?:전\s*용|면\s*적|건\s*물)[^\n]{0,30}?([\d.]+)\s*(?:㎡|m²|m2|제곱미터)/))) o.area=m[1];
  // 날짜
  const dts=findDates(flat);
  o.middle=AMT_KEYS.middleAmt.test(flat)?dateAfter(flat,AMT_KEYS.middleAmt):"";
  o.balance=dateAfter(flat,/잔\s*금/);
  if((m=flat.match(/(?:임\s*대\s*차\s*기\s*간|임\s*대\s*기\s*간|존\s*속\s*기\s*간)[\s\S]{0,200}/))){ const d=findDates(m[0]); if(d[0]) o.start=d[0].d; if(d[1]) o.end=d[1].d; }
  if(!o.start&&(m=flat.match(/인\s*도\s*일?[\s\S]{0,80}/))){ const d=findDates(m[0]); if(d[0]) o.moveIn=d[0].d; }
  if(!o.end&&(m=flat.match(/(?:부터|~)\s*[\s\S]{0,40}?(20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*까지/))){ const d=findDates(m[1]); if(d[0]) o.end=d[0].d; }
  if(o.kind!=="매매"&&!o.moveIn) o.moveIn=o.start||o.balance||"";
  // 계약일: "계약일" 옆 날짜 → 없으면 서명란(매도인/임대인 마지막 등장) 바로 앞 날짜 → 없으면 가장 이른 날짜
  o.contract=dateAfter(flat,/계\s*약\s*일(?!자)/,40);
  if(!o.contract){ const L=lastRole(flat,isSale?"매도인":"임대인"); const roleIdx=L?L.index:-1; const before=dts.filter(x=>x.i<roleIdx&&roleIdx-x.i<80).pop(); if(before) o.contract=before.d; }
  if(!o.contract&&dts.length){ const used=new Set([o.middle,o.balance,o.start,o.end,o.moveIn]); const cand=dts.map(x=>x.d).filter(d=>!used.has(d)).sort(); o.contract=cand[0]||dts.map(x=>x.d).sort()[0]; }
  const S=o.kind==="매매"?["매도인","매수인"]:["임대인","임차인"];
  o.seller=nameAfter(flat,S[0]); o.buyer=nameAfter(flat,S[1]);
  o.sellerTel=telAfter(flat,S[0]); o.buyerTel=telAfter(flat,S[1]);
  o.th=/토지\s*거래\s*허가/.test(flat)?"해당":"";
  if((m=flat.match(/특\s*약\s*사\s*항([\s\S]{0,800})/))) o.memo=m[1].split(/20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*\n|매\s*도\s*인\s*주|임\s*대\s*인\s*주|개\s*업\s*공\s*인/)[0].replace(/\s+/g," ").trim().slice(0,400);
  C_COLS.forEach(([k])=>{ if(o[k]==null) o[k]=""; });
  return o;
}
function parseCKV(t){
  const map={종류:"kind",지역:"region",소재지:"address","동·호":"unit",동호:"unit",면적:"area",매매대금:"price",보증금:"price","매매대금·보증금":"price",월세:"rent",계약금:"down",중도금:"middleAmt",잔금:"balanceAmt",계약일:"contract",중도금일:"middle",잔금일:"balance","입주·인도일":"moveIn",입주일:"moveIn",인도일:"moveIn","임대 시작":"start",임대시작:"start","임대 만료":"end",임대만료:"end",만료일:"end","매도인·임대인":"seller",매도인:"seller",임대인:"seller","매수인·임차인":"buyer",매수인:"buyer",임차인:"buyer","매도·임대인 연락처":"sellerTel","매수·임차인 연락처":"buyerTel",공동중개:"agentOther",토지거래허가:"th","특약·메모":"memo",특약:"memo",메모:"memo"};
  const o={}; let n=0;
  t.split("\n").forEach(l=>{ const m=l.match(/^\s*[-•]?\s*([가-힣·/ ]{2,12}?)\s*[:：]\s*(.*)$/); if(m&&map[m[1].trim()]){ o[map[m[1].trim()]]=m[2].trim(); n++; } });
  if(n<4) return null;
  ["price","rent","down","middleAmt","balanceAmt"].forEach(k=>{ if(o[k]) o[k]=toMan(o[k])||o[k]; });
  ["contract","middle","balance","moveIn","start","end"].forEach(k=>{ if(o[k]){ const d=findDates(o[k])[0]; o[k]=d?d.d:""; } });
  o.id=uid(); o.added=TODAY(); o.raw=t.slice(0,4000);
  C_COLS.forEach(([k])=>{ if(o[k]==null) o[k]=""; });
  return o;
}

/* ---------- 파일 → 글자 ---------- */
async function fileToText(file,progress){
  if(/pdf$/i.test(file.name)||file.type==="application/pdf"){
    await loadScript(LIB.pdf); pdfjsLib.GlobalWorkerOptions.workerSrc=LIB.pdfWorker;
    const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
    let text="";
    for(let i=1;i<=Math.min(pdf.numPages,8);i++){ const pg=await pdf.getPage(i); const c=await pg.getTextContent();
      let prev=null;
      for(const it of c.items){ if(!it.str&&!it.hasEOL) continue; const x=it.transform[4], y=it.transform[5], fs=Math.hypot(it.transform[0],it.transform[1])||10;
        if(prev){ if(Math.abs(y-prev.y)>fs*0.5) text+="\n"; else if(x-(prev.x+prev.w)>fs*0.25) text+=" "; }
        text+=it.str; prev={x,y,w:it.width||0}; if(it.hasEOL){ text+="\n"; prev=null; } }
      text+="\n"; }
    if(text.replace(/\s/g,"").length>80) return text;
    // 스캔 PDF → 그림으로 바꿔 글자 인식
    let all="";
    for(let i=1;i<=Math.min(pdf.numPages,4);i++){ const pg=await pdf.getPage(i); const vp=pg.getViewport({scale:2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise; all+=await ocr(cv,p=>progress(`글자 인식 ${i}쪽 ${p}%`))+"\n"; }
    return all;
  }
  if(/^text\//.test(file.type)||/\.txt$/i.test(file.name)) return await file.text();
  if(/^image\//.test(file.type)||/\.(jpe?g|png|webp|heic)$/i.test(file.name)) return await ocr(await shrink(file),p=>progress(`글자 인식 ${p}%`));
  throw new Error("지원하지 않는 파일이에요. 사진(JPG·PNG)이나 PDF로 올려 주세요. 한글(HWP) 파일은 PDF로 저장해서 올려 주세요.");
}
async function shrink(file){
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error("사진을 열 수 없어요. 아이폰 HEIC 사진이면 JPG로 바꿔 주세요.")); i.src=URL.createObjectURL(file); });
  const max=2400, s=Math.min(1,max/Math.max(img.width,img.height));
  const c=document.createElement("canvas"); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s);
  const x=c.getContext("2d"); x.filter="grayscale(1) contrast(1.35)"; x.drawImage(img,0,0,c.width,c.height); return c;
}
let worker=null;
async function ocr(src,progress){
  await loadScript(LIB.ocr);
  if(!worker){ worker=await Tesseract.createWorker("kor",1,{langPath:LIB.ocrLang,logger:m=>{ if(m.status==="recognizing text") progress(Math.round(m.progress*100)); else if(/loading/.test(m.status)) progress(0); }}); }
  const r=await worker.recognize(src); return r.data.text;
}

/* ---------- 일정 만들기 ---------- */
const EV_COL={할일:"#7a5bb5",상담:"#0e7c86",계약:"#1d5c47",중도금:"#2f5f9e",잔금:"#b3372e",신고:"#a5761a",등기:"#7c4932",입주:"#2f5f9e",만료:"#b3372e",갱신:"#a5761a",토허:"#794698"};
function events(c){
  const nm=`${c.region||c.address||"계약"}${c.unit?" "+c.unit:""} ${c.kind}`.trim(); const E=[];
  const add=(d,type,t)=>{ if(d) E.push({d,type,t,cid:c.id,nm}); };
  add(c.contract,"계약","계약");
  if(c.contract) add(addD(c.contract,30),"신고",c.kind==="매매"?"거래신고 기한":"전월세 신고 기한");
  add(c.middle,"중도금","중도금"+(c.middleAmt?" "+won(c.middleAmt):""));
  add(c.balance,"잔금","잔금"+(c.balanceAmt?" "+won(c.balanceAmt):""));
  if(c.kind==="매매"){ if(c.balance){ add(addD(c.balance,60),"등기","등기·취득세 기한"); } }
  else{
    add(c.moveIn&&c.moveIn!==c.balance?c.moveIn:"","입주","입주·전입신고");
    add(c.end,"만료","임대차 만료");
    if(c.end){ add(addM(c.end,-6),"갱신","갱신 의사 확인 시작 (만료 6개월 전)"); add(addM(c.end,-2),"갱신","갱신 의사 마감 (만료 2개월 전)"); }
  }
  return E;
}
const custEvents=()=>CUST.flatMap(c=>(c.appts||[]).filter(a=>a.on&&a.d).map(a=>({d:a.d,type:"상담",t:`${a.time?a.time+" ":""}${a.t}`,cid:"u:"+c.id,nm:`${c.name||"손님"}${c.type?" ("+c.type+")":""}`})));
const todoEvents=()=>TODO.filter(t=>!t.key&&!t.done&&t.d).map(t=>({d:t.d,type:"할일",t:`${t.time?t.time+" ":""}${t.text}`,cid:"t:"+t.id,nm:`내 할 일${t.cat?" · "+t.cat:""}`}));
const allEvents=()=>CONS.flatMap(events).concat(custEvents(),todoEvents()).sort((a,b)=>a.d.localeCompare(b.d)||a.t.localeCompare(b.t));

/* ---------- 계약·달력 화면 ---------- */
let cTab="cal", cDraft=null, calYM=null, calSel=null, cBusy="";
function renderContracts(){
  const box=$("#view-contracts");
  if(!calYM){ const t=new Date(); calYM=[t.getFullYear(),t.getMonth()]; }
  box.innerHTML=`<div><h1 class="view">계약·달력</h1><p class="lede" style="margin-top:4px">계약서 사진이나 PDF를 올리면 날짜·금액·당사자를 읽어서 달력에 일정이 잡혀요.</p></div>
    <div class="chips" role="tablist">${[["cal","달력"],["add","계약서 올리기"],["list",`계약 목록 ${CONS.length}`]].map(([k,l])=>`<button type="button" class="chip ${cTab===k?"on":""}" data-ct="${k}">${l}</button>`).join("")}<button type="button" class="chip" data-gocalc>일정 계산기</button></div>
    <div id="cbody"></div>`;
  box.querySelectorAll("[data-ct]").forEach(b=>b.onclick=()=>{ cTab=b.dataset.ct; renderContracts(); });
  box.querySelector("[data-gocalc]").onclick=()=>MM.show&&MM.show("calc");
  ({cal:cCal,add:cAdd,list:cList})[cTab]();
}
function cCal(){
  const [y,mo]=calYM; const first=new Date(y,mo,1), days=new Date(y,mo+1,0).getDate(), pre=first.getDay();
  const E=allEvents(); const by={}; E.forEach(e=>(by[e.d]=by[e.d]||[]).push(e));
  const today=TODAY(); const cells=[];
  for(let i=0;i<pre;i++) cells.push(`<div class="cd empty"></div>`);
  for(let d=1;d<=days;d++){ const k=iso(y,mo+1,d); const ev=by[k]||[];
    cells.push(`<button type="button" class="cd ${k===today?"td":""} ${calSel===k?"sel":""}" data-day="${k}"><span class="dn">${d}</span>${ev.slice(0,3).map(e=>`<span class="ev" style="--ec:${EV_COL[e.type]}">${esc(e.t.split(" ")[0])}</span>`).join("")}${ev.length>3?`<span class="more">+${ev.length-3}</span>`:""}</button>`); }
  const upcoming=E.filter(e=>e.d>=today).slice(0,12);
  const selList=calSel?(by[calSel]||[]):null;
  $("#cbody").innerHTML=`<div class="calhead"><button type="button" class="btn" data-mv="-1" aria-label="이전 달">‹</button><b>${y}년 ${mo+1}월</b><button type="button" class="btn" data-mv="1" aria-label="다음 달">›</button><button type="button" class="btn" data-mv="0">오늘</button></div>
    <div class="calw">${"일월화수목금토".split("").map(w=>`<span>${w}</span>`).join("")}</div>
    <div class="cal">${cells.join("")}</div>
    <div class="maplegend">${Object.entries(EV_COL).map(([k,c])=>`<span><i style="background:${c}"></i>${k}</span>`).join("")}</div>
    ${selList?`<h2 class="sec2">${fmtD(calSel)} (${wd(calSel)})</h2>${evList(selList)}`:""}
    <h2 class="sec2">다가오는 일정</h2>${upcoming.length?evList(upcoming):`<div class="empty">${CONS.length?"다가오는 일정이 없어요":"계약서를 올리면 일정이 여기에 나와요"}</div>`}
    <div class="btns">${CONS.length?`<button type="button" class="btn" id="icsAll">휴대폰 달력에 넣기 (.ics)</button>`:""}</div>`;
  document.querySelectorAll("[data-mv]").forEach(b=>b.onclick=()=>{ const v=+b.dataset.mv; if(!v){ const t=new Date(); calYM=[t.getFullYear(),t.getMonth()]; calSel=TODAY(); } else { const d=new Date(calYM[0],calYM[1]+v,1); calYM=[d.getFullYear(),d.getMonth()]; } cCal(); });
  document.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{ calSel=calSel===b.dataset.day?null:b.dataset.day; cCal(); });
  bindEv();
  if($("#icsAll")) $("#icsAll").onclick=()=>ics(allEvents());
}
function evList(E){
  const today=TODAY();
  return `<div class="list">${E.map(e=>{ const n=Math.round((new Date(e.d+"T00:00:00")-new Date(today+"T00:00:00"))/864e5);
    return `<button type="button" class="row evrow" data-open-c="${e.cid}" style="grid-template-columns:10px 1fr auto"><span style="width:6px;height:100%;border-radius:3px;background:${EV_COL[e.type]}"></span><span><span class="t">${esc(e.t)}</span><span class="s" style="display:block">${esc(e.nm)}</span></span><span class="r"><span class="num">${fmtD(e.d).slice(5)} (${wd(e.d)})</span><br><b style="color:${n<0?"var(--faint)":n<=3?"var(--red)":"var(--muted)"}">${n===0?"오늘":n>0?"D-"+n:(-n)+"일 지남"}</b></span></button>`; }).join("")}</div>`;
}
function bindEv(){ document.querySelectorAll("[data-open-c]").forEach(b=>b.onclick=()=>{ const id=b.dataset.openC; if(id.startsWith("u:")) openU(id.slice(2)); else if(id.startsWith("t:")){ MM.show("home"); setTimeout(()=>{ const el=$("#todoSec"); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); },50); } else openC(id); }); }

function cAdd(){
  $("#cbody").innerHTML=`<div class="out" style="background:#fff">
    <div class="drop" id="cdrop"><b>계약서 사진·PDF 올리기</b><span class="note">여러 장이면 한 번에 고르세요. 사진은 계약서를 반듯하게, 그림자 없이 찍을수록 정확해요.</span>
      <div class="btns"><label class="btn pri" for="cfile">사진·파일 고르기</label><label class="btn" for="ccam">카메라로 찍기</label></div>
      <input id="cfile" type="file" accept="image/*,.pdf,application/pdf,.txt" multiple hidden><input id="ccam" type="file" accept="image/*" capture="environment" hidden>
      ${cBusy?`<div class="progress">${esc(cBusy)}<span class="bar"><i style="width:${(cBusy.match(/(\d+)%/)||[0,30])[1]}%"></i></span></div>`:""}</div>
    <div class="field"><label for="ctext">또는 계약서 내용 붙여넣기</label><textarea id="ctext" placeholder="계약서 글, 카톡으로 받은 계약 조건, AI가 정리해 준 결과를 붙여넣어도 돼요"></textarea></div>
    <div class="btns"><button type="button" class="btn pri" id="cparse">읽어서 정리하기</button><button type="button" class="btn" id="cai">사진을 AI로 읽게 하는 지시문</button></div>
    <p class="note" style="margin:0">사진 글자 인식은 이 기기 안에서 처리돼요(처음 한 번 인식 자료 약 10MB를 받아요). 손글씨나 흐린 사진은 틀릴 수 있어서, 저장 전에 꼭 확인해 주세요. 잘 안 읽히면 <b>AI 지시문</b>을 복사해 ChatGPT·Claude에 사진과 함께 넣고, 나온 결과를 위 칸에 붙여넣으세요.</p>
  </div>
  <div id="cdraft"></div>`;
  const onFiles=async files=>{
    if(!files.length) return; let text="";
    try{ for(const [i,f] of [...files].entries()){ cBusy=`${i+1}/${files.length} ${f.name} 읽는 중`; cAddBusy(); text+=await fileToText(f,p=>{ cBusy=`${i+1}/${files.length} ${typeof p==="number"?`글자 인식 ${p}%`:p}`; cAddBusy(); })+"\n"; } }
    catch(e){ cBusy=""; cAddBusy(); toast(e.message||"파일을 읽지 못했어요"); return; }
    cBusy=""; cAddBusy(); $("#ctext").value=text.trim(); draftFrom(text);
  };
  $("#cfile").onchange=e=>onFiles(e.target.files); $("#ccam").onchange=e=>onFiles(e.target.files);
  const dz=$("#cdrop"); dz.ondragover=e=>{ e.preventDefault(); dz.classList.add("on"); }; dz.ondragleave=()=>dz.classList.remove("on"); dz.ondrop=e=>{ e.preventDefault(); dz.classList.remove("on"); onFiles(e.dataTransfer.files); };
  $("#cparse").onclick=()=>{ const t=$("#ctext").value; if(!t.trim()){ toast("내용을 붙여넣거나 파일을 올려 주세요"); return; } draftFrom(t); };
  $("#cai").onclick=()=>copy(`첨부한 부동산 계약서 사진을 읽고 아래 형식으로만 답해 줘. 모르는 칸은 비워 두고, 금액은 숫자로(예: 15억 2000만), 날짜는 2026-11-20처럼 써 줘. 보이지 않는 내용은 지어내지 마.\n\n종류: (매매/전세/월세)\n소재지: \n동·호: \n면적: (㎡)\n매매대금·보증금: \n월세: \n계약금: \n중도금: \n잔금: \n계약일: \n중도금일: \n잔금일: \n입주·인도일: \n임대 시작: \n임대 만료: \n매도인·임대인: (이름만)\n매수인·임차인: (이름만)\n토지거래허가: (해당/해당 없음)\n특약: (요약)`);
  if(cDraft) showDraft();
}
function cAddBusy(){ const dz=$("#cdrop"); if(!dz) return; let p=dz.querySelector(".progress"); if(!cBusy){ if(p) p.remove(); return; } if(!p){ p=document.createElement("div"); p.className="progress"; dz.appendChild(p); } p.innerHTML=`${esc(cBusy)}<span class="bar"><i style="width:${(cBusy.match(/(\d+)%/)||[0,30])[1]}%"></i></span>`; }
function draftFrom(t){ cDraft=parseContract(t); showDraft(); $("#cdraft").scrollIntoView({behavior:"smooth",block:"start"}); }
function cForm(c){
  const date=k=>["contract","middle","balance","moveIn","start","end"].includes(k), money=k=>["price","rent","down","middleAmt","balanceAmt"].includes(k);
  return `<div class="form">${C_COLS.map(([k,l])=>{ const v=c[k]??"";
    if(k==="kind") return `<div class="field"><label for="c_${k}">${l}</label><select id="c_${k}">${["매매","전세","월세"].map(x=>`<option ${x===v?"selected":""}>${x}</option>`).join("")}</select></div>`;
    if(k==="th") return `<div class="field"><label for="c_${k}">${l}</label><select id="c_${k}">${["","해당"].map(x=>`<option value="${x}" ${x===v?"selected":""}>${x||"해당 없음"}</option>`).join("")}</select></div>`;
    if(k==="memo") return `<div class="field full"><label for="c_${k}">${l}</label><textarea id="c_${k}">${esc(v)}</textarea></div>`;
    return `<div class="field ${k==="address"?"full":""}"><label for="c_${k}">${l}${money(k)&&v?` <span class="hint">= ${won(v)}</span>`:""}</label><input id="c_${k}" type="${date(k)?"date":"text"}" value="${esc(v)}" ${money(k)?'inputmode="numeric"':""} class="${!v&&["kind","contract","balance","price"].includes(k)?"miss":""}"></div>`; }).join("")}</div>`;
}
function readForm(c){ C_COLS.forEach(([k])=>{ const el=$("#c_"+k); if(el){ let v=el.value.trim(); if(["price","rent","down","middleAmt","balanceAmt"].includes(k)&&v) v=toMan(v)||v; c[k]=v; } }); return c; }
function showDraft(){
  const c=cDraft; const missing=["contract","balance","price"].filter(k=>!c[k]).length;
  $("#cdraft").innerHTML=`<div class="out"><h3>읽은 내용 확인</h3>${missing?`<div class="warn">빈 칸(노란색)이 ${missing}개 있어요. 계약서를 보고 채워 주세요.</div>`:`<div class="note">빠진 핵심 칸은 없어요. 그래도 숫자와 날짜는 계약서와 한 번 대조해 주세요.</div>`}
    ${cForm(c)}<div class="btns"><button type="button" class="btn pri" id="csave">저장하고 달력에 넣기</button><button type="button" class="btn" id="ccancel">취소</button></div></div>`;
  $("#csave").onclick=()=>{ readForm(c); if(!c.contract&&!c.balance){ toast("계약일이나 잔금일은 꼭 넣어 주세요"); return; } const i=CONS.findIndex(x=>x.id===c.id); if(i>=0) CONS[i]=c; else CONS.push(c); store(K_C,CONS); cDraft=null; const first=events(c).map(e=>e.d).sort().find(d=>d>=TODAY())||c.contract||c.balance; if(first){ const d=new Date(first+"T00:00:00"); calYM=[d.getFullYear(),d.getMonth()]; calSel=first; } cTab="cal"; toast("저장했어요. 달력에 일정이 들어갔어요"); renderContracts(); };
  $("#ccancel").onclick=()=>{ cDraft=null; $("#cdraft").innerHTML=""; };
}
function cList(){
  const rows=[...CONS].sort((a,b)=>(b.contract||b.balance||"").localeCompare(a.contract||a.balance||""));
  $("#cbody").innerHTML=`${rows.length?`<div class="tbl ltable" style="max-height:65vh"><table><thead><tr><th></th>${C_COLS.filter(([k])=>k!=="memo").map(([,l])=>`<th>${l}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(c=>`<tr><td><button type="button" class="linkbtn" data-open-c="${c.id}">열기</button></td>${C_COLS.filter(([k])=>k!=="memo").map(([k])=>`<td class="${["price","rent","down","middleAmt","balanceAmt"].includes(k)?"n":""}">${esc(["price","rent","down","middleAmt","balanceAmt"].includes(k)?won(c[k]):["contract","middle","balance","moveIn","start","end"].includes(k)?fmtD(c[k]):c[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`:`<div class="empty">아직 저장한 계약이 없어요. <b>계약서 올리기</b>에서 시작하세요.</div>`}
    <div class="btns"><button type="button" class="btn pri" id="cxlsx" ${rows.length?"":"disabled"}>엑셀로 내려받기</button><button type="button" class="btn" id="exlsx" ${rows.length?"":"disabled"}>일정 엑셀로 내려받기</button></div>
    <p class="note">이 기기(브라우저)에만 저장돼요. 계약서에는 개인정보가 있으니 공용 PC에서는 쓰지 마세요.</p>`;
  bindEv();
  $("#cxlsx").onclick=()=>xlsx("계약목록",C_COLS,rows.map(c=>({...c})));
  $("#exlsx").onclick=()=>xlsx("계약일정",[["d","날짜"],["w","요일"],["t","할 일"],["nm","계약"]],allEvents().map(e=>({...e,w:wd(e.d)})));
}
function openC(id){
  const c=CONS.find(x=>x.id===id); if(!c) return;
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" aria-label="계약 상세"><h2><span>${esc(c.region||c.address||"계약")} ${esc(c.unit||"")}<span class="note" style="display:block;font-weight:500">${esc(c.kind)} · ${won(c.price)}${c.rent?" / 월 "+c.rent+"만":""}</span></span><button type="button" class="x" aria-label="닫기">×</button></h2>
    <h3 class="sec2" style="margin:0">일정</h3>${evList(events(c))}
    <h3 class="sec2" style="margin:0">계약 내용 (고칠 수 있어요)</h3>${cForm(c)}
    <div class="btns"><button type="button" class="btn pri" id="cupd">저장</button><button type="button" class="btn" id="cics">휴대폰 달력에 넣기</button><button type="button" class="btn" id="ccp">손님용 일정 복사</button><button type="button" class="btn" id="cdel" style="color:var(--red)">삭제</button></div></div>`;
  sheet.hidden=false;
  const close=()=>{ sheet.hidden=true; sheet.innerHTML=""; };
  sheet.querySelector(".x").onclick=close; sheet.onclick=e=>{ if(e.target===sheet) close(); };
  sheet.querySelectorAll("[data-open-c]").forEach(b=>b.disabled=true);
  $("#cupd").onclick=()=>{ readForm(c); store(K_C,CONS); close(); toast("저장했어요"); renderContracts(); };
  $("#cdel").onclick=()=>{ if(!confirm("이 계약을 지울까요? 달력 일정도 같이 지워져요.")) return; CONS=CONS.filter(x=>x.id!==c.id); store(K_C,CONS); close(); renderContracts(); };
  $("#cics").onclick=()=>ics(events(c));
  $("#ccp").onclick=()=>copy(`[${c.kind} 계약 일정 안내]\n${c.address||c.region} ${c.unit||""}\n`+events(c).filter(e=>!/신고|등기|갱신/.test(e.type)).map(e=>`· ${fmtD(e.d)} (${wd(e.d)}) ${e.t}`).join("\n")+"\n\n문멘토프라퍼티 010.6336.1828 · 010.4336.5038");
}
function ics(E){
  const z=s=>s.replace(/-/g,""); const now=new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z";
  const body=E.map(e=>`BEGIN:VEVENT\r\nUID:${e.cid}-${z(e.d)}-${encodeURIComponent(e.t).slice(0,20)}@moonmento\r\nDTSTAMP:${now}\r\nDTSTART;VALUE=DATE:${z(e.d)}\r\nDTEND;VALUE=DATE:${z(addD(e.d,1))}\r\nSUMMARY:${(e.t+" · "+e.nm).replace(/[,;]/g," ")}\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nDESCRIPTION:${e.t.replace(/[,;]/g," ")}\r\nEND:VALARM\r\nEND:VEVENT`).join("\r\n");
  const t=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//moonmento//contracts//KO\r\nCALSCALE:GREGORIAN\r\n${body}\r\nEND:VCALENDAR\r\n`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([t],{type:"text/calendar"})); a.download=`계약일정_${TODAY()}.ics`; a.click();
  toast("파일을 열면 휴대폰 달력에 추가돼요 (하루 전 알림)");
}



/* ======================================================================
   손님 · 통화녹음 분석
   ====================================================================== */
const K_U="mm-customers-v1"; let CUST=load(K_U);
const WD="일월화수목금토";
function relDates(sent, base){
  const out=[]; const b=new Date(base+"T00:00:00"); let m;
  const push=(d,i)=>out.push({d:locISO(d),i});
  const R={오늘:0,금일:0,내일:1,낼:1,모레:2,글피:3};
  for(const k in R){ const i=sent.indexOf(k); if(i>=0&&!/내일모레/.test(sent.slice(i-2,i+3))){ const d=new Date(b); d.setDate(d.getDate()+R[k]); push(d,i); } }
  const re=/(이번\s*주|이번주|다음\s*주|담주|다다음\s*주|돌아오는)?\s*([월화수목금토일])요일/g;
  while((m=re.exec(sent))){ const tw=WD.indexOf(m[2]); const pre=(m[1]||"").replace(/\s/g,"");
    const d=new Date(b); const mon=new Date(b); mon.setDate(b.getDate()-((b.getDay()+6)%7));
    if(pre==="이번주"){ d.setTime(mon.getTime()); d.setDate(mon.getDate()+((tw+6)%7)); }
    else if(pre==="다음주"||pre==="담주"){ d.setTime(mon.getTime()); d.setDate(mon.getDate()+7+((tw+6)%7)); }
    else if(pre==="다다음주"){ d.setTime(mon.getTime()); d.setDate(mon.getDate()+14+((tw+6)%7)); }
    else { let add=(tw-b.getDay()+7)%7; if(add===0) add=7; d.setDate(b.getDate()+add); }
    push(d,m.index); }
  const re2=/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while((m=re2.exec(sent))){ let y=b.getFullYear(); const d=new Date(y,+m[1]-1,+m[2]); if(d<new Date(b.getTime()-30*864e5)) d.setFullYear(y+1); push(d,m.index); }
  const re3=/(이번\s*달|다음\s*달|담달)\s*(\d{1,2})\s*일/g;
  while((m=re3.exec(sent))){ const d=new Date(b.getFullYear(),b.getMonth()+(/다음|담/.test(m[1])?1:0),+m[2]); push(d,m.index); }
  const seen=new Set(); return out.filter(x=>!seen.has(x.d)&&seen.add(x.d)).sort((a,b)=>a.i-b.i);
}
function relTime(sent){
  const m=sent.match(/(오전|오후|아침|저녁|밤|낮|점심)?\s*(\d{1,2})\s*시\s*(반|(\d{1,2})\s*분)?/); if(!m) return "";
  let h=+m[2]; const mi=m[3]==="반"?30:(+m[4]||0);
  if(/오후|저녁|밤/.test(m[1]||"")&&h<12) h+=12; else if(!m[1]&&h>=1&&h<=7) h+=12; else if(/낮|점심/.test(m[1]||"")&&h<6) h+=12;
  if(h>23) return ""; return `${pad(h)}:${pad(mi)}`;
}
function apptTitle(sent){
  if(/계약/.test(sent)) return "계약"; if(/잔금/.test(sent)) return "잔금"; if(/대출|은행/.test(sent)) return "대출 상담";
  if(/보러|방문|임장|집\s*보|구경|둘러|현장/.test(sent)) return "집 보기"; if(/미팅|만나|뵙|상담|사무실/.test(sent)) return "상담";
  if(/통화|전화|연락|문자|카톡/.test(sent)) return "연락"; return "약속";
}
function spokenMan(s){
  const n=x=>/^\d/.test(x)?+x:korNum(x);
  let m=s.match(/([\d.]+|[일이삼사오육칠팔구십]+)\s*억\s*(?:([\d]+|[일이삼사오육칠팔구])\s*천)?(?:\s*([\d]+|[일이삼사오육칠팔구])\s*백)?/);
  if(m) return Math.round(parseFloat(n(m[1]))*10000+(m[2]?n(m[2])*1000:0)+(m[3]?n(m[3])*100:0));
  m=s.match(/([\d]+|[일이삼사오육칠팔구])\s*천\s*만?/); if(m) return n(m[1])*1000;
  m=s.match(/([\d,]{3,})\s*만/); if(m) return +m[1].replace(/,/g,"");
  return 0;
}
function sentences(t){ return t.replace(/\r/g,"").split(/\n+|(?<=[.?!])\s+|(?<=(?:요|다|죠|네|까)\s?[.?!]?)\s+(?=[가-힣])/).map(x=>x.replace(/^(참석자|화자|발화자)\s*\d+\s*[\d:]*\s*/,"").replace(/^\d{1,2}:\d{2}(:\d{2})?\s*/,"").trim()).filter(x=>x.length>1); }
function analyzeCall(text){
  const base=TODAY(); const S=sentences(text); const flat=text.replace(/\s+/g," ");
  const o={id:uid(),added:base,raw:text.slice(0,20000)}; let m;
  // 이름·연락처
  if((m=flat.match(/([가-힣]{2,4})\s*(?:고객님|손님|어머님|아버님)(?!\s*(?:소개|추천|통해))/))&&!/저희|우리|다른|이번|그|사장|실장|부장/.test(m[1])) o.name=m[1];
  if(!o.name&&(m=flat.match(/(?:저는|제\s*이름은|이름은)\s*([가-힣]{2,4}?)(?:이고|이에요|예요|입니다|이라고|라고)/))) o.name=m[1];
  if((m=flat.match(/(01[016789][-\s.]?\d{3,4}[-\s.]?\d{4})/))) o.tel=m[1];
  // 구분
  const sc={매수:(flat.match(/사려|살려고|매수|구입|구매|사고 싶|살 집|매매로/g)||[]).length,매도:(flat.match(/팔려|팔고|매도|내놓|처분/g)||[]).length,전세:(flat.match(/전세/g)||[]).length,월세:(flat.match(/월세|반전세/g)||[]).length,투자:(flat.match(/투자|갭|재개발|입주권|프리미엄|수익/g)||[]).length};
  o.type=Object.entries(sc).sort((a,b)=>b[1]-a[1])[0][1]?Object.entries(sc).sort((a,b)=>b[1]-a[1])[0][0]:"";
  // 금액
  const amts=[]; S.forEach(x=>{ const v=spokenMan(x); if(v>=500) amts.push({v,x}); });
  const bud=amts.filter(a=>/예산|까지|최대|정도|선에서|이하|안쪽|넘으면|생각|가능|맞춰/.test(a.x)&&!/대출|현금|보증금|월세|관리비/.test(a.x));
  o.budget=bud.length?Math.max(...bud.map(a=>a.v)):"";
  const cash=amts.find(a=>/현금|자기\s*자본|가진\s*돈|모아둔|자금/.test(a.x)); o.cash=cash?cash.v:"";
  const loan=amts.find(a=>/대출/.test(a.x)&&!(cash&&a===cash)); o.loanAmt=loan?loan.v:"";
  o.amounts=amts.map(a=>won(a.v)).filter((v,i,arr)=>arr.indexOf(v)===i).join(", ");
  // 지역·역·단지·구역
  const d=MM.data, sub=d&&d.subway, apts=d&&d.apts||[];
  const regions=new Set();
  if(sub) sub.stations.forEach(st=>{ if(st.name.length>=2&&(flat.includes(st.name+"역")||(st.name.length>=3&&flat.includes(st.name)))) regions.add(st.name+"역"); });
  const dongs=new Set(apts.map(a=>a.d)); dongs.forEach(dn=>{ if(dn.length>=3&&flat.includes(dn)) regions.add(dn); });
  ["강남","강북","강서","강동","송파","서초","용산","마포","성동","광진","중구","종로","동대문","성북","노원","은평","양천","영등포","동작","관악","구로","금천","도봉","중랑","서대문"].forEach(g=>{ if(flat.includes(g+"구")||(g.length>=3&&flat.includes(g))) regions.add(g.endsWith("구")?g:g+"구"); });
  (flat.match(/[가-힣]{1,6}\s?\d{1,3}\s?구역/g)||[]).forEach(z=>regions.add(z.replace(/\s/g,"")));
  const cx=new Set(); apts.forEach(a=>{ if(a.n.length>=4&&flat.includes(a.n)) cx.add(a.n); });
  o.regions=[...regions].slice(0,12).join(", "); o.complexes=[...cx].slice(0,10).join(", ");
  // 면적·방
  const py=[...flat.matchAll(/(\d{2})\s*평/g)].map(x=>x[1]+"평"); const sq=[...flat.matchAll(/(\d{2,3})\s*(?:㎡|제곱|미터)/g)].map(x=>x[1]+"㎡");
  if((m=flat.match(/방\s*(\d|두|세|네)\s*개/))||(m=flat.match(/(쓰리룸|투룸|원룸)/))) py.push(m[0]);
  o.size=[...new Set(py.concat(sq))].join(", ");
  // 입주·대출·학군
  if((m=flat.match(/((?:내년|올해|20\d{2}\s*년)?\s*(?:\d{1,2}\s*월|봄|여름|가을|겨울|상반기|하반기)\s*(?:초|중순|중|말|쯤|안에)?\s*(?:에|까지)?\s*(?:입주|이사|들어가|들어와|이주))/))) o.moveIn=m[1].replace(/\s+/g," ").trim();
  else if(/즉시\s*입주|바로\s*(?:들어|입주|이사)/.test(flat)) o.moveIn="즉시 입주 희망";
  o.loan=/대출|디딤돌|보금자리|LTV|DSR|주담대|신생아/.test(flat)?(flat.match(/디딤돌|보금자리|신생아\s*특례|LTV|DSR/g)||["대출 필요"]).filter((v,i,a)=>a.indexOf(v)===i).join(", "):"";
  o.school=/학군|초등학교|중학교|고등학교|학교|학원가|초품아/.test(flat)?"학군 중요":"";
  // 원하는 것·피하는 것
  o.wants=S.filter(x=>/꼭|무조건|중요|원해|원하|좋겠|선호|있으면|가까운|가까웠/.test(x)&&!/싫|별로|빼고|안\s*돼|안돼|말고/.test(x)).slice(0,6).join("\n");
  o.avoids=S.filter(x=>/싫|별로|빼고|안\s*돼|안돼|말고|피하|아니면\s*좋|부담/.test(x)).slice(0,6).join("\n");
  // 약속 일정
  const ap=[]; S.forEach(x=>{ const ds=relDates(x,base); if(!ds.length) return; if(!/보|방문|만나|뵙|연락|통화|전화|계약|잔금|미팅|상담|오시|가실|갈게|올게|드릴게|임장|은행|대출|시간/.test(x)) return; ds.forEach(dd=>ap.push({id:uid(),d:dd.d,time:relTime(x),t:apptTitle(x),src:x.slice(0,80),on:true})); });
  o.appts=ap.slice(0,8);
  o.memo="";
  return o;
}
function matchListings(c){
  const want={매수:"매매",투자:"매매",매도:"",전세:"전세",월세:"월세"}[c.type]||"";
  const keys=(c.regions+","+c.complexes).split(",").map(x=>x.trim().replace(/역$/,"")).filter(x=>x.length>=2);
  return LIST.map(r=>{ let sc=0; const hay=[r.complex,r.region,r.zone,r.address,r.memo].join(" ");
    if(want&&r.deal===want) sc+=2; if(keys.some(k=>hay.includes(k))) sc+=3;
    const val=c.type==="투자"?(+calcL(r).invest||+r.price):+r.price;
    if(c.budget&&val){ if(val<=c.budget*1.05) sc+=2; else if(val>c.budget*1.2) sc-=3; }
    return {r,sc,val}; }).filter(x=>x.sc>=3).sort((a,b)=>b.sc-a.sc).slice(0,5);
}
const U_F=[["name","손님 이름"],["tel","연락처"],["type","구분"],["budget","예산(만원)"],["cash","현금(만원)"],["loanAmt","대출(만원)"],["regions","원하는 지역·역·구역"],["complexes","언급한 단지"],["size","면적·방"],["moveIn","입주·이사 시기"],["loan","대출"],["school","학군"],["wants","원하는 것"],["avoids","피하는 것"],["memo","메모"]];
let uDraft=null, uBusy="";
function renderCust(){
  const box=$("#view-cust");
  box.innerHTML=`<div><h1 class="view">손님 상담 분석</h1><p class="lede" style="margin-top:4px">통화녹음을 글자로 바꾼 파일(.txt)이나 상담 메모를 넣으면 손님이 원하는 조건과 약속 일정을 뽑아 줘요. 저장하면 약속은 달력과 홈에 들어가요.</p></div>
    <div class="out" style="background:#fff">
      <div class="drop"><b>통화녹음 텍스트 올리기</b><span class="note">갤럭시 통화녹음 '텍스트 변환', 클로바노트 '텍스트 내보내기'로 받은 .txt 파일이면 돼요. 녹음 파일(m4a)은 먼저 글자로 바꿔 주세요.</span>
        <div class="btns"><label class="btn pri" for="ufile">텍스트 파일 고르기</label></div><input id="ufile" type="file" accept=".txt,text/plain,.md,.srt,.vtt" hidden>${uBusy?`<div class="note">${esc(uBusy)}</div>`:""}</div>
      <div class="field"><label for="utext">또는 대화 내용·메모 붙여넣기</label><textarea id="utext" placeholder="예) 손님: 신당역 근처로 84㎡ 보고 있어요. 예산은 15억까지고 현금은 6억 정도 있어요. 학군이 중요하고 1층은 싫어요. 이번 주 토요일 오후 2시에 집 보러 갈게요."></textarea></div>
      <div class="btns"><button type="button" class="btn pri" id="ugo">분석하기</button></div>
    </div>
    <div id="udraft"></div>
    <h2 class="sec2">내 손님 <span class="num">${CUST.length}</span></h2>
    ${CUST.length?`<div class="list">${[...CUST].reverse().map(c=>{ const nx=(c.appts||[]).filter(a=>a.on&&a.d>=TODAY()).sort((a,b)=>a.d.localeCompare(b.d))[0]; return `<button type="button" class="row" data-uopen="${c.id}" style="grid-template-columns:1fr auto"><span><span class="t">${esc(c.name||"이름 없음")} <span class="pill">${esc(c.type||"상담")}</span></span><span class="s" style="display:block">${esc([c.budget?"예산 "+won(c.budget):"",c.regions,c.size].filter(Boolean).join(" · "))}</span></span><span class="r">${nx?`<b>${fmtD(nx.d).slice(5)} ${esc(nx.t)}</b><br>${esc(nx.time||"")}`:esc(fmtD(c.added))}</span></button>`; }).join("")}</div>
      <div class="btns"><button type="button" class="btn" id="uxlsx">손님 목록 엑셀</button></div>`:`<div class="empty">아직 저장한 손님이 없어요</div>`}
    <p class="note">녹음 내용에는 개인정보가 많아요. 이 기기에만 저장되고, AI 지시문으로 복사할 때는 이름·전화번호를 지우고 쓰세요.</p>`;
  $("#ufile").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ uBusy=`${f.name} 읽는 중`; const t=await f.text(); uBusy=""; $("#utext").value=t; uDraft=analyzeCall(t); showUDraft(); }catch(err){ uBusy=""; toast("파일을 읽지 못했어요"); } };
  $("#ugo").onclick=()=>{ const t=$("#utext").value; if(!t.trim()){ toast("내용을 넣어 주세요"); return; } uDraft=analyzeCall(t); showUDraft(); };
  document.querySelectorAll("[data-uopen]").forEach(b=>b.onclick=()=>openU(b.dataset.uopen));
  if($("#uxlsx")) $("#uxlsx").onclick=()=>xlsx("손님목록",U_F.concat([["appts","약속"]]),CUST.map(c=>({...c,appts:(c.appts||[]).filter(a=>a.on).map(a=>`${a.d} ${a.time} ${a.t}`).join(" / ")})));
  if(uDraft) showUDraft();
}
function uForm(c){
  return `<div class="form">${U_F.map(([k,l])=>{ const v=c[k]??"";
    if(k==="type") return `<div class="field"><label for="u_${k}">${l}</label><select id="u_${k}">${["","매수","매도","전세","월세","투자"].map(x=>`<option ${x===v?"selected":""}>${x}</option>`).join("")}</select></div>`;
    if(["wants","avoids","memo"].includes(k)) return `<div class="field full"><label for="u_${k}">${l}</label><textarea id="u_${k}" style="min-height:70px">${esc(v)}</textarea></div>`;
    return `<div class="field ${["regions","complexes"].includes(k)?"full":""}"><label for="u_${k}">${l}${["budget","cash","loanAmt"].includes(k)&&v?` <span class="hint">= ${won(v)}</span>`:""}</label><input id="u_${k}" value="${esc(v)}"></div>`; }).join("")}</div>
    <h3 class="sec3">약속 일정 (체크한 것만 달력에 들어가요)</h3>
    <div class="appts">${(c.appts||[]).map(a=>`<div class="appt" data-aid="${a.id}"><input type="checkbox" ${a.on?"checked":""} aria-label="달력에 넣기"><input type="date" value="${a.d}"><input type="time" value="${a.time||""}"><input class="at" value="${esc(a.t)}" aria-label="일정 이름"><small>${esc(a.src||"")}</small></div>`).join("")}</div>
    <button type="button" class="linkbtn" id="uaddap">+ 일정 직접 추가</button>`;
}
function readU(c){
  U_F.forEach(([k])=>{ const el=$("#u_"+k); if(el){ let v=el.value.trim(); if(["budget","cash","loanAmt"].includes(k)&&v) v=toMan(v)||v; c[k]=v; } });
  c.appts=[...document.querySelectorAll(".appt")].map(r=>{ const [cb,dt,tm,tt]=r.querySelectorAll("input"); return {id:r.dataset.aid,on:cb.checked,d:dt.value,time:tm.value,t:tt.value.trim()||"약속",src:(c.appts.find(a=>a.id===r.dataset.aid)||{}).src||""}; }).filter(a=>a.d);
  return c;
}
function bindAddAp(c,rerender){ const b=$("#uaddap"); if(b) b.onclick=()=>{ readU(c); c.appts.push({id:uid(),d:TODAY(),time:"",t:"약속",src:"",on:true}); rerender(); }; }
function matchHtml(c){ const ms=matchListings(c); return ms.length?`<h3 class="sec3">조건에 맞는 내 매물</h3><div class="list">${ms.map(x=>`<div class="row" style="grid-template-columns:1fr auto"><span><span class="t">${esc(x.r.complex||x.r.address)} ${esc(x.r.dongho||"")}</span><span class="s" style="display:block">${esc([x.r.zone,x.r.region,x.r.deal,x.r.area?"전용 "+x.r.area+"㎡":""].filter(Boolean).join(" · "))}</span></span><span class="r"><span class="p">${x.r.price?won(x.r.price):""}</span>${c.type==="투자"&&calcL(x.r).invest!==""?`<br>실투자 ${won(calcL(x.r).invest)}`:""}</span></div>`).join("")}</div>`:(LIST.length?`<p class="note">조건에 딱 맞는 내 매물은 아직 없어요.</p>`:""); }
function aiPrompt(c){ return `아래는 부동산 손님과의 통화 내용이야. 공인중개사 입장에서 정리해 줘.\n1) 손님 조건 표 (구분, 예산, 현금·대출, 지역, 면적·방, 입주 시기, 꼭 원하는 것, 싫어하는 것)\n2) 손님이 말한 약속·일정 (날짜·시간·할 일)\n3) 아직 확인 못 한 질문 3개\n4) 다음 연락 때 보낼 카톡 초안\n대화에 없는 내용은 추측하지 말고 "모름"으로 써 줘. 이름·전화번호는 쓰지 마.\n\n[통화 내용]\n${(c.raw||"").replace(/01[016789][-\\s.]?\\d{3,4}[-\\s.]?\\d{4}/g,"[전화번호]").slice(0,12000)}`; }
function showUDraft(){
  const c=uDraft; const box=$("#udraft");
  const draw=()=>{ box.innerHTML=`<div class="out"><h3>분석 결과 (고칠 수 있어요)</h3>
    ${c.amounts?`<p class="note" style="margin:0">대화에 나온 금액: ${esc(c.amounts)}</p>`:""}
    ${uForm(c)}${matchHtml(c)}
    <div class="btns"><button type="button" class="btn pri" id="usave">손님 저장 + 달력에 넣기</button><button type="button" class="btn" id="uai">AI로 더 자세히 (복사)</button><button type="button" class="btn" id="ucancel">취소</button></div></div>`;
    bindAddAp(c,()=>draw());
    $("#usave").onclick=()=>{ readU(c); CUST.push(c); store(K_U,CUST); uDraft=null; toast(`저장했어요. 약속 ${c.appts.filter(a=>a.on).length}건이 달력에 들어갔어요`); renderCust(); };
    $("#uai").onclick=()=>copy(aiPrompt(c));
    $("#ucancel").onclick=()=>{ uDraft=null; box.innerHTML=""; };
  };
  draw(); box.scrollIntoView({behavior:"smooth",block:"start"});
}
function openU(id){
  const c=CUST.find(x=>x.id===id); if(!c) return; const sheet=$("#sheet");
  const draw=()=>{ sheet.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" aria-label="손님 상세"><h2><span>${esc(c.name||"손님")}<span class="note" style="display:block;font-weight:500">${esc(c.type||"")} · ${esc(fmtD(c.added))} 상담</span></span><button type="button" class="x" aria-label="닫기">×</button></h2>
    ${c.tel?`<div class="btns"><a class="btn" href="tel:${esc(c.tel.replace(/[^\d]/g,""))}">전화</a><a class="btn" href="sms:${esc(c.tel.replace(/[^\d]/g,""))}">문자</a></div>`:""}
    ${uForm(c)}${matchHtml(c)}
    <details><summary class="note">통화 원문 보기</summary><pre style="white-space:pre-wrap;font-size:13px;max-height:300px;overflow:auto">${esc(c.raw||"")}</pre></details>
    <div class="btns"><button type="button" class="btn pri" id="uupd">저장</button><button type="button" class="btn" id="uai2">AI로 더 자세히 (복사)</button><button type="button" class="btn" id="udel" style="color:var(--red)">삭제</button></div></div>`;
    sheet.hidden=false; const close=()=>{ sheet.hidden=true; sheet.innerHTML=""; };
    sheet.querySelector(".x").onclick=close; sheet.onclick=e=>{ if(e.target===sheet) close(); };
    bindAddAp(c,()=>draw());
    $("#uupd").onclick=()=>{ readU(c); store(K_U,CUST); close(); toast("저장했어요"); if(!$("#view-cust").hidden) renderCust(); if(!$("#view-home").hidden) renderHome(); if(!$("#view-contracts").hidden) renderContracts(); };
    $("#uai2").onclick=()=>copy(aiPrompt(c));
    $("#udel").onclick=()=>{ if(!confirm("이 손님을 지울까요? 약속 일정도 같이 지워져요.")) return; CUST=CUST.filter(x=>x.id!==c.id); store(K_U,CUST); close(); renderCust(); };
  };
  draw();
}

/* ======================================================================
   내 할 일 · 말이나 글로 넣으면 정리
   ====================================================================== */
const T_CAT=["연락","방문","계약","서류","광고","기타"];
function tCat(x){
  if(/계약|잔금|중도금|가계약|계약금/.test(x)) return "계약";
  if(/서류|등기|신고|등본|대장|확인서|세금|취득세|토허|허가|은행|대출|발급|떼/.test(x)) return "서류";
  if(/전화|통화|문자|카톡|연락|답장|안내/.test(x)) return "연락";
  if(/보러|방문|임장|현장|미팅|만나|뵙|사진|촬영/.test(x)) return "방문";
  if(/광고|블로그|올리|포스팅|릴스|인스타|카드뉴스|네이버|등록/.test(x)) return "광고";
  return "기타";
}
function extraDate(x,base){
  const b=new Date(base+"T00:00:00"); const mon=new Date(b); mon.setDate(b.getDate()-((b.getDay()+6)%7));
  if(/이번\s*주\s*(안에|중|까지|내)/.test(x)){ const d=new Date(mon); d.setDate(mon.getDate()+4); return locISO(d<b?b:d); }
  if(/다음\s*주\s*(안에|중|까지|내)?/.test(x)&&!/요일/.test(x)){ const d=new Date(mon); d.setDate(mon.getDate()+7); return locISO(d); }
  if(/이번\s*달\s*(안에|중|까지|말)|월말/.test(x)) return locISO(new Date(b.getFullYear(),b.getMonth()+1,0));
  if(/주말/.test(x)){ const d=new Date(mon); d.setDate(mon.getDate()+5); return locISO(d<b?b:d); }
  return "";
}
function cleanTodo(x){
  let t=x.replace(/^(음+|어+|아+|그+|자|일단|우선|먼저|그리고|또)[,.\s]+/,"")
    .replace(/(오늘|금일|내일|낼|모레|글피)\s*(까지|중에|중으로|안에|에)?/g,"")
    .replace(/(이번\s*주|다음\s*주|담주|다다음\s*주|돌아오는)?\s*[월화수목금토일]요일\s*(까지|에|날)?/g,"")
    .replace(/(이번\s*주|다음\s*주|이번\s*달|월말|주말)\s*(안에|중에|중|까지|내|말)?/g,"")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일\s*(까지|에)?/g,"")
    .replace(/(오전|오후|아침|저녁|밤|낮|점심)?\s*\d{1,2}\s*시\s*(반|\d{1,2}\s*분)?\s*(까지|에)?/g,"")
    .replace(/\s*(해야\s*(돼|되|해|함|합니다|겠다|겠어)|하기로\s*했어|할\s*것|하자|해야지|해야겠다|잊지\s*말고)[요.!]*$/,"")
    .replace(/[,.\s]+$/,"").replace(/\s+(꼭|반드시|잊지\s*말고)$/,"").replace(/^[,.\s]+/,"").replace(/\s{2,}/g," ").trim();
  return t.length>=2?t:x.trim();
}
function parseTodos(text){
  const base=TODAY();
  const parts=text.replace(/\r/g,"").split(/\n+|(?<=[.!?。])\s+|\s*(?:그리고|그\s*다음에?|그담에|다음으로|또\s+|하고\s+나서)\s*/).map(x=>x&&x.trim()).filter(x=>x&&x.length>=2);
  return parts.map(x=>{ const ds=relDates(x,base); const d=ds.length?ds[0].d:extraDate(x,base);
    return {id:uid(),text:cleanTodo(x),src:x,d,time:relTime(x),cat:tCat(x),imp:/급|꼭|반드시|중요|빨리|잊지/.test(x),done:false,added:base,on:true}; });
}
let tRec=null, tDraft=null;
function todoInputHtml(){
  return `<div class="tin2"><textarea id="tin" rows="2" placeholder="말하거나 적어 주세요. 여러 개도 한 번에 돼요.&#10;예) 내일 오전 10시 김OO님 잔금 서류 챙기기 그리고 금요일까지 신당10구역 매물 블로그 올리기"></textarea>
    <div class="btns"><button type="button" class="btn" id="tmic">🎤 말로 입력</button><label class="btn" for="tfile">녹음 텍스트 넣기</label><input id="tfile" type="file" accept=".txt,text/plain" hidden><button type="button" class="btn pri" id="tgo">정리해서 추가</button></div>
    <div id="tdraft">${tDraft?tDraftHtml():""}</div></div>`;
}
function tDraftHtml(){
  return `<div class="out"><h3>할 일 ${tDraft.length}개로 정리했어요 (고칠 수 있어요)</h3><div class="appts">${tDraft.map(t=>`<div class="appt tdr" data-tid="${t.id}"><input type="checkbox" ${t.on?"checked":""} aria-label="추가하기"><input type="date" value="${t.d}"><input type="time" value="${t.time}"><input class="at" value="${esc(t.text)}" aria-label="할 일"><small>${esc(t.cat)}${t.imp?" · 중요":""} · "${esc(t.src.slice(0,60))}"</small></div>`).join("")}</div>
    <div class="btns"><button type="button" class="btn pri" id="tsave">추가하기</button><button type="button" class="btn" id="tcancel">취소</button></div></div>`;
}
function readTDraft(){ document.querySelectorAll(".tdr").forEach(r=>{ const t=tDraft.find(x=>x.id===r.dataset.tid); if(!t) return; const [cb,dt,tm,tx]=r.querySelectorAll("input"); t.on=cb.checked; t.d=dt.value; t.time=tm.value; t.text=tx.value.trim()||t.text; t.cat=tCat(t.text+" "+t.src); }); }
function addTodos(list){ list.filter(t=>t.on).forEach(t=>{ delete t.on; TODO.push(t); }); store(K_T,TODO); }
function bindTodoInput(){
  const ta=$("#tin"); if(!ta) return;
  const go=()=>{ const v=ta.value.trim(); if(!v){ toast("할 일을 말하거나 적어 주세요"); return; }
    const L=parseTodos(v); if(!L.length) return;
    if(L.length===1){ addTodos(L); toast(`추가했어요${L[0].d?` · ${fmtD(L[0].d).slice(5)}${L[0].time?" "+L[0].time:""}`:""}`); renderHome(); return; }
    tDraft=L; $("#tdraft").innerHTML=tDraftHtml(); bindTDraft(); };
  $("#tgo").onclick=go;
  ta.onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); go(); } };
  $("#tfile").onchange=async e=>{ const f=e.target.files[0]; if(!f) return; try{ ta.value=(await f.text()).slice(0,8000); go(); }catch(err){ toast("파일을 읽지 못했어요"); } };
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; const mic=$("#tmic");
  mic.onclick=()=>{
    if(!SR){ toast("이 브라우저는 음성 입력을 지원하지 않아요. 키보드의 마이크 버튼으로 말해 주세요"); ta.focus(); return; }
    if(tRec){ tRec.stop(); return; }
    const r=new SR(); r.lang="ko-KR"; r.continuous=true; r.interimResults=true; const start=ta.value?ta.value.replace(/\s*$/," "):""; let fin="";
    r.onresult=ev=>{ let tmp=""; for(let i=ev.resultIndex;i<ev.results.length;i++){ const t=ev.results[i][0].transcript; if(ev.results[i].isFinal) fin+=t+"\n"; else tmp+=t; } ta.value=start+fin+tmp; };
    r.onerror=ev=>{ toast(ev.error==="not-allowed"?"마이크 사용을 허용해 주세요":"음성 입력이 멈췄어요"); };
    r.onend=()=>{ tRec=null; mic.textContent="🎤 말로 입력"; mic.classList.remove("rec"); if(ta.value.trim()&&fin) go(); };
    tRec=r; r.start(); mic.textContent="⏹ 다 말했어요"; mic.classList.add("rec"); toast("말씀하세요. 다 말하면 버튼을 다시 눌러 주세요");
  };
  if(tDraft) bindTDraft();
}
function bindTDraft(){
  $("#tsave").onclick=()=>{ readTDraft(); const n=tDraft.filter(t=>t.on).length; addTodos(tDraft); tDraft=null; toast(`할 일 ${n}개를 추가했어요`); renderHome(); };
  $("#tcancel").onclick=()=>{ tDraft=null; $("#tdraft").innerHTML=""; };
}
function todoListHtml(todos){
  const today=TODAY();
  const L=todos.filter(t=>!t.key).sort((a,b)=>(a.done-b.done)||((a.d||"9999")+(a.time||"")).localeCompare((b.d||"9999")+(b.time||"")));
  return `<ul class="todo">${L.map(t=>{ const n=t.d?Math.round((new Date(t.d+"T00:00:00")-new Date(today+"T00:00:00"))/864e5):null;
    return `<li><label><input type="checkbox" data-tid="${t.id}" ${t.done?"checked":""}><span class="${t.done?"done":""}">${t.imp?`<b style="color:var(--red)">중요</b> `:""}${esc(t.text)}<br><small>${t.cat?`<span class="pill">${esc(t.cat)}</span> `:""}${t.d?`${fmtD(t.d).slice(5)} (${wd(t.d)})${t.time?" "+t.time:""} · <b style="color:${n<0?"var(--red)":n<=1?"var(--gold)":"var(--muted)"}">${n===0?"오늘":n>0?"D-"+n:(-n)+"일 지남"}</b>`:"날짜 없음"}</small></span></label><button type="button" class="linkbtn" data-tdel="${t.id}">삭제</button></li>`; }).join("")||`<li class="note">아직 할 일이 없어요</li>`}</ul>`;
}
/* ======================================================================
   홈 대시보드
   ====================================================================== */
const K_T="mm-todos-v1"; let TODO=load(K_T);
const CHECK={
  계약:"계약서·확인설명서 준비, 등기부등본 당일 다시 떼기, 신분증·도장 안내",
  중도금:"중도금 입금 확인하고 영수증 주고받기",
  잔금:"대출 실행·관리비·공과금 정산 확인, 열쇠·비밀번호 인도 준비, 법무사 일정 확인",
  신고:"실거래(전월세) 신고 기한 — 자금조달계획서 등 서류 챙기기",
  등기:"등기 신청·취득세 납부 완료 여부 확인",
  입주:"전입신고·확정일자 안내",
  갱신:"임대인·임차인에게 갱신 여부 확인 연락",
  만료:"만료 전 재계약·이사 일정 확인",
  상담:"손님 조건에 맞는 매물 미리 뽑아 두고, 전날 확인 연락"
};
function weekRange(){ const t=new Date(); t.setHours(0,0,0,0); const mon=new Date(t); mon.setDate(t.getDate()-((t.getDay()+6)%7)); const sun=new Date(mon); sun.setDate(mon.getDate()+6); return [locISO(mon),locISO(sun)]; }
function renderHome(){
  const box=$("#view-home"); const today=TODAY(); const [ws,we]=weekRange();
  const E=allEvents();
  const late=E.filter(e=>e.d<today&&e.d>=addD(today,-14)&&["계약","중도금","잔금","신고","등기"].includes(e.type));
  const week=E.filter(e=>e.d>=today&&e.d<=we);
  const next=E.filter(e=>e.d>we&&e.d<=addD(today,21));
  const active=CONS.filter(c=>{ const last=(c.kind==="매매"?c.balance:(c.balance||c.moveIn))||c.contract; return last&&last>=addD(today,-30); });
  const balWeek=week.filter(e=>e.type==="잔금").length;
  const checks=[...late,...week].filter(e=>e.type!=="할일").map(e=>({e,txt:CHECK[e.type]||""}));
  const todos=TODO.filter(t=>!t.done||t.doneAt===today);
  const pol=(MM.policies||[]).slice(-2).reverse();
  const hour=new Date().getHours();
  box.innerHTML=`<div><h1 class="view">${hour<12?"좋은 아침이에요":hour<18?"오늘도 힘내세요":"오늘 하루 수고하셨어요"}</h1><p class="lede" style="margin-top:4px">${fmtD(today)} (${wd(today)}) · 이번 주 ${fmtD(ws).slice(5)}~${fmtD(we).slice(5)}</p></div>
    <div class="stats stats4">
      <button type="button" class="stat" data-go="contracts"><b>${week.length}</b><span>이번 주 일정</span></button>
      <button type="button" class="stat ${late.length?"alert":""}" data-go="contracts"><b>${late.length}</b><span>지난 일정 확인</span></button>
      <button type="button" class="stat" data-go="contracts"><b>${balWeek}</b><span>이번 주 잔금</span></button>
      <button type="button" class="stat" data-go="listings"><b>${LIST.length}</b><span>내 매물</span></button>
    </div>
    <div class="quick2">
      <button type="button" class="btn pri" data-go="contracts" data-sub="add">계약서 올리기</button>
      <button type="button" class="btn" data-go="cust">통화녹음 분석</button>
      <button type="button" class="btn" data-go="map">역세권 찾기</button>
      <button type="button" class="btn" data-go="tools">AI 도구</button>
    </div>
    <section class="card2"><h2 class="sec2">이번 주 일정</h2>
      ${late.length?`<div class="warn" style="margin:6px 0">지난 2주 안에 지난 일정이 ${late.length}건 있어요. 처리됐는지 확인해 주세요.</div>${evList(late)}`:""}
      ${week.length?evList(week):`<div class="empty">${CONS.length?"이번 주 남은 계약 일정이 없어요":"계약서를 올리면 이번 주 일정이 여기에 모여요"}</div>`}
      ${next.length?`<h3 class="sec3">다음 3주</h3>${evList(next.slice(0,8))}`:""}
    </section>
    <section class="card2"><h2 class="sec2">이번 주 확인할 사항</h2>
      ${checks.length?`<ul class="todo">${checks.map(({e,txt})=>{ const k="auto-"+e.cid+"-"+e.d+"-"+e.type; const done=TODO.some(t=>t.key===k&&t.done); return `<li><label><input type="checkbox" data-auto="${esc(k)}" ${done?"checked":""}><span class="${done?"done":""}"><b>${fmtD(e.d).slice(5)} ${esc(e.t)}</b> · ${esc(e.nm)}<br><small>${esc(txt)}</small></span></label></li>`; }).join("")}</ul>`:`<div class="note">계약 일정에서 자동으로 뽑은 확인 사항이 여기에 나와요.</div>`}
      <h3 class="sec3" id="todoSec">내 할 일</h3>
      ${todoInputHtml()}
      ${todoListHtml(todos)}
    </section>
    ${pol.length?`<section class="card2"><h2 class="sec2">최근 부동산 대책</h2><div class="list">${pol.map(p=>`<button type="button" class="row" data-go="policy" style="grid-template-columns:1fr auto"><span><span class="t">${esc(p.title)}</span><span class="s" style="display:block">${esc(p.summary)}</span></span><span class="r num">${fmtD(p.date)}</span></button>`).join("")}</div></section>`:""}
    <p class="note">${active.length?`진행 중인 계약 ${active.length}건 · `:""}모든 자료는 이 기기에만 저장돼요.</p>`;
  box.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{ if(b.dataset.sub) cTab=b.dataset.sub; MM.show(b.dataset.go); });
  bindEv();
  box.querySelectorAll("[data-auto]").forEach(cb=>cb.onchange=()=>{ const k=cb.dataset.auto; TODO=TODO.filter(t=>t.key!==k); if(cb.checked) TODO.push({id:uid(),key:k,done:true,doneAt:TODAY()}); store(K_T,TODO); renderHome(); });
  box.querySelectorAll("[data-tid]").forEach(cb=>cb.onchange=()=>{ const t=TODO.find(x=>x.id===cb.dataset.tid); if(t){ t.done=cb.checked; t.doneAt=cb.checked?TODAY():""; store(K_T,TODO); renderHome(); } });
  box.querySelectorAll("[data-tdel]").forEach(b=>b.onclick=()=>{ TODO=TODO.filter(t=>t.id!==b.dataset.tdel); store(K_T,TODO); renderHome(); });
  bindTodoInput();
}
MM.renderHome=renderHome; MM.renderCust=renderCust;
MM.renderListings=renderListings; MM.renderContracts=renderContracts;
MM._work={parseTodos,analyzeCall,relDates,parseListing,splitBlocks,parseContract,toMan,korNum,events,get LIST(){return LIST},get CONS(){return CONS}};
})();
