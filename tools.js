/* 문멘토 중개 AI · AI 도구와 계약 일정
   - AI 도구: 입력칸을 채우면 ChatGPT·Claude에 그대로 붙여넣을 지시문을 만들어 줌 (API 키 없이 작동)
   - 손님 시세 브리핑·광고 필수항목 점검·계약 일정은 앱이 직접 계산 */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const D=()=>window.MM&&MM.data;
const LS="mm-tools-v1";
let saved={}; try{ saved=JSON.parse(localStorage.getItem(LS)||"{}") }catch(e){}
const keep=()=>{ try{ localStorage.setItem(LS,JSON.stringify(saved)) }catch(e){} };
function toast(m){ const t=document.createElement("div"); t.className="toast"; t.textContent=m; document.body.appendChild(t); setTimeout(()=>t.remove(),2000); }
async function copy(text){ try{ await navigator.clipboard.writeText(text); toast("복사했어요"); }catch(e){ const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast("복사했어요"); } }

/* ---------- 메뉴 전환 ---------- */
function show(view){
  const V=["home","map","listings","cust","contracts","calc","tools","policy"];
  document.querySelectorAll("nav.views button").forEach(b=>b.classList.toggle("on",b.dataset.view===view||(view==="calc"&&b.dataset.view==="contracts")));
  V.forEach(v=>{ const el=$("#view-"+v); if(el) el.hidden=v!==view; }); $(".foot").hidden=view!=="map";
  if(view==="map") setTimeout(()=>MM.relayout&&MM.relayout(),30);
  if(view==="tools") renderTools(); if(view==="calc") renderSched(); if(view==="policy") renderPolicy();
  if(view==="home"&&MM.renderHome) MM.renderHome();
  if(view==="listings"&&MM.renderListings) MM.renderListings();
  if(view==="cust"&&MM.renderCust) MM.renderCust(); if(view==="contracts"&&MM.renderContracts) MM.renderContracts();
  try{ history.replaceState(null,"",view==="map"?location.pathname+location.search+(location.hash.startsWith("#v=")?"":location.hash):view==="home"?location.pathname+location.search:"#v="+view); }catch(e){}
  window.scrollTo(0,0);
}
MM.show=show;
document.querySelectorAll("nav.views button").forEach(b=>b.onclick=()=>show(b.dataset.view));

/* ---------- 공통: 입력 양식 ---------- */
function field(f,v){
  const [k,label,type,opts,hint]=f; const val=v??"";
  const full=type==="area"||type==="full"?" full":"";
  let inp;
  if(type==="sel") inp=`<select id="f_${k}">${opts.map(o=>`<option ${o===val?"selected":""}>${esc(o)}</option>`).join("")}</select>`;
  else if(type==="area") inp=`<textarea id="f_${k}" placeholder="${esc(opts||"")}">${esc(val)}</textarea>`;
  else inp=`<input id="f_${k}" type="${type==="date"?"date":"text"}" value="${esc(val)}" placeholder="${esc(type==="date"?"":opts||"")}">`;
  return `<div class="field${full}"><label for="f_${k}">${esc(label)}</label>${inp}${hint?`<span class="hint">${esc(hint)}</span>`:""}</div>`;
}
const read=fs=>Object.fromEntries(fs.map(f=>[f[0],($("#f_"+f[0])||{}).value?.trim()||""]));
const line=(k,v)=>v?`- ${k}: ${v}\n`:"";

/* ---------- AI 도구 정의 ---------- */
const AD_FIELDS=[["office","중개사무소 명칭"],["addrOffice","중개사무소 소재지"],["tel","중개사무소 연락처"],["regNo","중개사무소 등록번호"],["agent","개업공인중개사 성명"],
  ["addr","매물 소재지"],["area","면적"],["price","가격"],["ptype","중개대상물 종류"],["deal","거래 형태"],["floors","총 층수"],["approval","사용승인일"],["floor","해당 층"],["dir","방향"],["rooms","방·욕실 수"],["moveIn","입주 가능일"],["parking","주차 대수"],["mgmt","관리비"]];
const TOOLS=[
 {id:"blog",name:"매물 소개글 (블로그 초안)",tag:"3주차",desc:"매물 정보와 메모·녹음 텍스트를 넣으면 네이버 블로그 초안을 쓰게 하는 지시문을 만들어요. 발행은 직접 해요.",
  f:[["title","단지·건물명","text","예: 남산타운 6단지"],["addr","소재지","text","예: 중구 신당동"],["deal","거래","sel",["매매","전세","월세"]],["price","가격","text","예: 14억 5,000만"],
     ["area","면적","text","예: 전용 59㎡ (25평형)"],["floor","층·향","text","예: 12층 / 총 20층, 남향"],["station","가까운 역","text","예: 버티고개역 도보 3분"],["tone","글 분위기","sel",["다정한 ~요체","전문가 리포트","짧고 핵심만"]],
     ["memo","특징 메모·녹음 텍스트","area","현장에서 녹음한 내용이나 메모를 그대로 붙여넣으세요"]],
  build:v=>`너는 서울 아파트를 중개하는 공인중개사의 네이버 블로그 글을 쓰는 보조 작가야.\n아래 매물 정보와 현장 메모로 블로그 초안을 써 줘.\n\n[매물 정보]\n${line("단지",v.title)}${line("소재지",v.addr)}${line("거래",v.deal)}${line("가격",v.price)}${line("면적",v.area)}${line("층·향",v.floor)}${line("교통",v.station)}\n[현장 메모]\n${v.memo||"(없음)"}\n\n[쓰는 방법]\n- 말투: ${v.tone}\n- 제목 후보 3개 (지역명+단지명+핵심 장점, 30자 안팎)\n- 소제목 4~6개로 나누고, 가격·면적·층·교통은 표로 정리\n- 메모에 없는 사실(학군, 개발 호재, 시세)은 지어내지 말고 "[확인 필요]"로 표시\n- "무조건 오른다", "최저가" 같은 과장·단정 표현 금지\n- 끝에 중개대상물 표시·광고 필수 항목(사무소 명칭·소재지·연락처·등록번호·대표 성명, 매물 소재지·면적·가격·종류·거래형태 등) 자리를 빈칸으로 남겨 줘\n- 해시태그 15개`},
 {id:"ad",name:"광고 문구 + 필수 표시 점검",tag:"2주차",desc:"네이버 매물 광고에 꼭 들어가야 하는 표시 항목이 빠졌는지 앱이 바로 점검하고, 광고 문구 지시문도 만들어요.",
  f:AD_FIELDS.map(([k,l])=>[k,l,"text"]).concat([["point","강조할 장점","area","예: 역 도보 3분, 올수리, 남향 고층"]]),
  check:v=>AD_FIELDS.map(([k,l])=>({l,ok:!!v[k]})),
  build:v=>`너는 공인중개사의 매물 광고 문구를 다듬는 보조야. 아래 정보로 네이버 부동산 매물 설명(400자 이내)과 짧은 한 줄 소개(40자 이내)를 써 줘.\n\n${AD_FIELDS.map(([k,l])=>line(l,v[k])).join("")}${line("강조할 장점",v.point)}\n[지켜야 할 것]\n- 위 정보에 없는 내용은 쓰지 말 것 (허위·과장 광고 금지)\n- "급매", "최저가", "확정 수익" 같은 근거 없는 표현 금지\n- 가격·면적은 위 숫자 그대로 쓸 것\n- 마지막에 빠진 필수 표시 항목이 있으면 목록으로 알려 줘`},
 {id:"consult",name:"상담 정리 + 답장 초안",tag:"4주차",desc:"손님 문자나 상담 녹음 텍스트를 넣으면 조건·예산·다음 할 일을 정리하고 답장 초안을 쓰게 해요.",
  f:[["who","손님 구분","sel",["매수","매도","임차","임대","투자 상담"]],["text","손님 문자·상담 내용","area","카톡·문자나 녹음 텍스트를 붙여넣으세요 (이름·전화번호는 지우고)"],["mine","내 매물·상황 메모","area","예: 신당동 59㎡ 2건 보유, 이번 주 토요일 오후 가능"]],
  build:v=>`너는 공인중개사의 상담을 돕는 비서야. 아래 ${v.who} 손님 대화를 정리하고 답장 초안을 써 줘.\n\n[손님 대화]\n${v.text||"(없음)"}\n\n[중개사 메모]\n${v.mine||"(없음)"}\n\n[출력 형식]\n1. 손님 조건 표: 지역 / 예산 / 면적·방 / 입주 시기 / 대출 여부 / 꼭 원하는 것 / 싫어하는 것\n2. 아직 모르는 정보와 다음에 물어볼 질문 3개\n3. 다음 할 일과 날짜 제안\n4. 카톡 답장 초안 2가지 (짧게, 정중하게)\n- 대화에 없는 내용은 추측하지 말고 "모름"으로 쓸 것`},
 {id:"role",name:"반론 대응 롤플레이",tag:"4주차",desc:"손님이 자주 하는 반대 이유로 상담 연습을 해요. AI가 손님 역할을 하고, 끝나면 피드백을 줘요.",
  f:[["case","상황","sel",["가격을 더 깎아 달라","중개보수 할인해 달라","다른 부동산이 더 싸다","지금 사도 되나요, 더 떨어지지 않나요","재개발 지금 들어가도 되나요","생각해 보고 연락 줄게요"]],["detail","매물·손님 상황","area","예: 신당동 84㎡ 15억, 30대 맞벌이 첫 집"],["level","손님 난이도","sel",["보통","까다로움","아주 까다로움"]]],
  build:v=>`우리 롤플레이를 하자. 너는 부동산 사무실을 찾은 손님이고, 나는 공인중개사야.\n\n[상황] 손님이 "${v.case}"라고 말하는 장면\n[매물·손님 정보] ${v.detail||"(자유롭게 설정)"}\n[손님 난이도] ${v.level}\n\n[규칙]\n- 한 번에 손님 대사 한두 문장만 말하고 내 대답을 기다려\n- 내 대답이 설득력 있으면 조금씩 마음을 열고, 아니면 더 반박해\n- 내가 "끝"이라고 하면 역할에서 나와서 피드백을 줘: 잘한 점 2개, 고칠 점 2개, 더 좋은 답변 예시 1개\n- 법·세금 관련 내 답변이 틀렸으면 피드백에서 꼭 짚어 줘\n\n손님 첫 대사로 시작해 줘.`},
 {id:"brief",name:"손님용 시세 브리핑",tag:"4주차",desc:"단지를 고르면 앱이 실거래로 브리핑 문안을 바로 만들어요. AI로 다듬는 지시문도 함께 나와요.",
  f:[["apt","단지 이름","text","예: 남산타운 (지도 자료에 있는 단지)"],["area","전용면적 (㎡, 숫자)","text","예: 59"],["client","손님 이름","text","예: 김OO님"],["purpose","손님 목적","sel",["실거주 매수","투자","매도 상담","갈아타기"]]],
  auto:true},
 {id:"special",name:"특약 초안 (검토용)",tag:"3주차",desc:"계약 조건을 넣으면 특약 초안과 빠진 확인사항을 뽑게 해요. 반드시 중개사가 검토하고 고쳐서 써야 해요.",
  f:[["kind","계약 종류","sel",["아파트 매매","아파트 매매 (토지거래허가구역)","재개발 지분 매매","전세","월세"]],["cond","합의한 조건","area","예: 잔금 시 임차인 퇴거, 기본 옵션 에어컨 2대 포함, 누수 발견 시 매도인 수리"],["risk","걱정되는 부분","area","예: 매수인 대출 미승인, 토허 불허가"]],
  build:v=>`너는 공인중개사의 계약서 특약 작성을 돕는 보조야. 법률 자문이 아니라 중개사가 검토할 초안을 만드는 거야.\n\n[계약 종류] ${v.kind}\n[합의한 조건]\n${v.cond||"(없음)"}\n[걱정되는 부분]\n${v.risk||"(없음)"}\n\n[출력]\n1. 특약 초안 (번호를 붙여 한 문장씩, 누가·언제까지·어기면 어떻게 되는지가 드러나게)\n2. 계약 전에 꼭 확인할 서류·사항 체크리스트\n3. 이 조건에서 분쟁이 자주 생기는 지점 3가지\n- 확실하지 않은 법 조항 번호는 쓰지 말고 "[확인 필요]"로 표시\n- 맨 끝에 "본 초안은 참고용이며 중개사·법률 전문가 검토 후 사용"이라고 적어 줘`}
];

/* ---------- AI 도구 화면 ---------- */
let curTool=null;
function renderTools(){
  const box=$("#view-tools");
  if(!curTool){
    box.innerHTML=`<div><h1 class="view">AI 도구</h1><p class="lede" style="margin-top:4px">입력칸을 채우면 ChatGPT나 Claude에 그대로 붙여넣을 지시문이 만들어져요. 손님 이름·전화번호 같은 개인정보는 넣지 마세요.</p></div>
    <div class="tgrid">${TOOLS.map(t=>`<button type="button" class="tcard" data-tool="${t.id}"><em>실무교육 ${t.tag}</em><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join("")}
      <button type="button" class="tcard" data-goto="calc"><em>실무교육 4주차</em><b>계약 일정 계산기</b><span>계약일·중도금·잔금을 넣으면 토허·거래신고·등기·취득세 기한까지 날짜로 정리해요.</span></button></div>
    <div class="warn">AI가 쓴 글은 초안이에요. 숫자·법·세금은 꼭 원본으로 확인한 뒤 손님에게 보내세요.</div>`;
    box.querySelectorAll("[data-tool]").forEach(b=>b.onclick=()=>{ curTool=b.dataset.tool; renderTools(); });
    box.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>show(b.dataset.goto));
    return;
  }
  const t=TOOLS.find(x=>x.id===curTool); const v0=saved[t.id]||{};
  box.innerHTML=`<button type="button" class="back">← AI 도구</button>
    <div><h1 class="view">${esc(t.name)}</h1><p class="lede" style="margin-top:4px">${esc(t.desc)}</p></div>
    <div class="form">${t.f.map(f=>field(f,v0[f[0]])).join("")}</div>
    <div class="btns"><button type="button" class="btn pri" id="go">${t.auto?"브리핑 만들기":"지시문 만들기"}</button><button type="button" class="btn" id="clr">입력 지우기</button></div>
    <div id="out"></div>`;
  box.querySelector(".back").onclick=()=>{ curTool=null; renderTools(); };
  $("#clr").onclick=()=>{ delete saved[t.id]; keep(); renderTools(); };
  $("#go").onclick=()=>run(t);
  if(t.id==="ad") t.f.forEach(f=>{ const el=$("#f_"+f[0]); if(el) el.addEventListener("input",()=>adCheck(t)); });
  if(Object.keys(v0).length) run(t,true);
}
function outBox(title,text,extra=""){
  return `<div class="out"><h3>${esc(title)}</h3>${extra}<pre>${esc(text)}</pre>
    <div class="btns"><button type="button" class="btn pri" data-copy>복사하기</button>
    <a class="btn" target="_blank" rel="noopener" href="https://chatgpt.com/?q=${encodeURIComponent(text.slice(0,2000))}">ChatGPT에서 열기</a>
    <a class="btn" target="_blank" rel="noopener" href="https://claude.ai/new?q=${encodeURIComponent(text.slice(0,2000))}">Claude에서 열기</a></div>
    <p class="note" style="margin:0">긴 내용은 열기 버튼에서 잘릴 수 있어요. 그럴 땐 복사해서 붙여넣으세요.</p></div>`;
}
function bindCopy(texts){ document.querySelectorAll("#out [data-copy]").forEach((b,i)=>b.onclick=()=>copy(texts[i])); }
function adCheck(t){
  const v=read(t.f); const c=t.check(v); const miss=c.filter(x=>!x.ok);
  const el=$("#adcheck"); if(!el) return;
  el.innerHTML=`<b>${miss.length?`필수 표시 항목 ${miss.length}개가 비어 있어요`:"필수 표시 항목이 모두 채워졌어요"}</b><ul>${c.map(x=>`<li><span class="${x.ok?"ok":"ng"}">${x.ok?"✓":"✕"}</span>${esc(x.l)}</li>`).join("")}</ul>`;
}
async function run(t,silent){
  const v=read(t.f); saved[t.id]=v; keep();
  if(t.auto) return runBrief(v,silent);
  const text=t.build(v);
  const extra=t.id==="ad"?`<div class="check" id="adcheck"></div><p class="note" style="margin:0">기준: 공인중개사법 제18조의2와 국토교통부 「중개대상물의 표시·광고 명시사항 세부기준」(인터넷 광고). 건물 종류에 따라 해당 없는 항목은 "해당 없음"으로 적으면 돼요.</p>`:"";
  $("#out").innerHTML=outBox("ChatGPT·Claude에 붙여넣을 지시문",text,extra);
  if(t.id==="ad") adCheck(t);
  bindCopy([text]);
  if(!silent) $("#out").scrollIntoView({behavior:"smooth",block:"start"});
}
async function runBrief(v,silent){
  const d=D(); if(!d){ $("#out").innerHTML=`<div class="empty">자료를 불러오는 중이에요</div>`; return; }
  await d.ready;
  const name=v.apt.replace(/\s/g,"");
  const cands=d.apts.filter(a=>a.n.replace(/\s/g,"")===name).concat(d.apts.filter(a=>a.n.replace(/\s/g,"").includes(name)&&a.n.replace(/\s/g,"")!==name)).slice(0,6);
  if(!name||!cands.length){ $("#out").innerHTML=`<div class="empty">${name?"그 이름의 단지를 자료에서 못 찾았어요. 지도 탭 검색창에서 정확한 이름을 확인해 보세요.":"단지 이름을 넣어 주세요."}</div>`; return; }
  const a=cands[0]; const ar=d.areas(a);
  let key=parseInt(v.area,10); if(!ar.some(x=>x[0]===key)) key=[...ar].sort((x,y)=>y[1]-x[1])[0][0];
  const S=d.summary(a,key);
  const q=d.pos(a); const near=q?d.nearest(q,2):[];
  const recent=[...S.T].slice(-3).reverse();
  const nm=v.client||"손님";
  const text=`${nm}, 요청하신 ${a.g} ${a.d} ${a.n} 전용 ${key}㎡ 실거래 정리해 드려요.\n\n`+
    `■ 최근 거래: ${d.won(S.last[1])} (${d.ymd(S.last[0])}, ${S.last[3]}층)\n`+
    `■ 최근 1년 최고가: ${d.won(S.high[1])} (${d.ymd(S.high[0])}, ${S.high[3]}층)\n`+
    `■ 최근 1년 거래: ${S.n}건\n`+
    `■ 최근 3건: ${recent.map(t=>`${d.ymd(t[0]).slice(2)} ${d.won(t[1])}(${t[3]}층)`).join(" / ")}\n`+
    (near.length?`■ 교통: ${near.map(x=>`${x.s.name}역 약 ${Math.round(x.d/10)*10}m`).join(", ")} (직선거리)\n`:"")+
    `\n국토교통부 실거래가 기준(${(d.asOf||"").replace(/-/g,".")} 자료)이고, 신고 시차로 최근 거래가 더 있을 수 있어요. 궁금하신 점 편하게 물어봐 주세요.\n\n문멘토프라퍼티 010.6336.1828 · 010.4336.5038`;
  const prompt=`너는 공인중개사가 손님에게 보내는 시세 브리핑을 다듬는 보조야. 아래 실거래 정리를 바탕으로 ${v.purpose} 손님에게 보낼 카톡 메시지를 다정하고 짧게 다듬어 줘. 숫자는 바꾸지 말고, 자료에 없는 전망·호재는 쓰지 마.\n\n${text}`;
  const others=cands.length>1?`<p class="note" style="margin:0">같은 이름 단지가 더 있어요: ${cands.slice(1).map(x=>`${esc(x.n)}(${esc(x.g)} ${esc(x.d)})`).join(", ")}. 다른 단지면 이름을 더 정확히 넣어 주세요.</p>`:"";
  const defMode=/매도/.test(v.purpose)?"sell":"buy";
  $("#out").innerHTML=`<div class="out"><h3>${esc(a.n)} · ${esc(a.g)} ${esc(a.d)} · 전용 ${key}㎡</h3>${others}<pre>${esc(text)}</pre><div class="btns"><button type="button" class="btn pri" data-copy>브리핑 복사</button></div></div>
    <div class="out"><h3>손님용 브리핑 이미지</h3><p class="note" style="margin:0">카톡으로 바로 보낼 수 있는 4:5 이미지예요. 매수 손님에겐 지금 가격이 최고가 대비 어느 수준인지, 매도 손님에겐 최근 거래와 최고가를 앞에 보여줘요.</p>
      <div class="chips" role="group" aria-label="이미지 종류"><button type="button" class="chip ${defMode==="buy"?"on":""}" data-bimg="buy">매수 손님용</button><button type="button" class="chip ${defMode==="sell"?"on":""}" data-bimg="sell">매도 손님용</button></div>
      <div class="bimg"><img id="bimg" alt="실거래 브리핑 이미지 미리보기"></div>
      <div class="btns"><a class="btn pri" id="bsave" download>이미지 저장</a><button type="button" class="btn" id="bshare">카톡 등으로 공유</button></div></div>`+outBox("AI로 다듬기 (선택)",prompt);
  bindCopy([text,prompt]);
  const ctx={a,key,S,near,nm:v.client||"",asOf:d.asOf,d};
  const paint=async mode=>{ document.querySelectorAll("[data-bimg]").forEach(b=>b.classList.toggle("on",b.dataset.bimg===mode));
    const cv=await briefImage(mode,ctx); const url=cv.toDataURL("image/png"); $("#bimg").src=url;
    const fn=`${a.n}_${key}㎡_${mode==="buy"?"매수":"매도"}브리핑.png`; $("#bsave").href=url; $("#bsave").download=fn;
    $("#bshare").onclick=()=>cv.toBlob(async bl=>{ const f=new File([bl],fn,{type:"image/png"}); if(navigator.canShare&&navigator.canShare({files:[f]})){ try{ await navigator.share({files:[f],title:`${a.n} 실거래 브리핑`}); }catch(e){} } else toast("이 기기는 바로 공유가 안 돼요. 이미지 저장 후 보내 주세요"); }); };
  document.querySelectorAll("[data-bimg]").forEach(b=>b.onclick=()=>paint(b.dataset.bimg));
  paint(defMode);
  if(!silent) $("#out").scrollIntoView({behavior:"smooth",block:"start"});
}


/* ---------- 손님용 브리핑 이미지 (캔버스 1080×1350) ---------- */
async function briefImage(mode,{a,key,S,near,nm,asOf,d}){
  try{ await Promise.all(["700 40px 'IBM Plex Sans KR'","500 40px 'IBM Plex Sans KR'","500 40px 'IBM Plex Mono'"].map(f=>document.fonts.load(f))); }catch(e){}
  const W=1080,H=1350,P=72, cv=document.createElement("canvas"); cv.width=W; cv.height=H; const g=cv.getContext("2d");
  const F=(w,px,mono)=>`${w} ${px}px ${mono?"'IBM Plex Mono',":""}'IBM Plex Sans KR',sans-serif`;
  const C={ink:"#15201b",muted:"#5b6a63",faint:"#8a9690",line:"#dbe3df",soft:"#f4f7f5",pine:"#1d5c47",pineSoft:"#e1eee8",gold:"#a5761a",goldSoft:"#f6ecd6",red:"#b3372e"};
  const acc=mode==="buy"?C.pine:C.gold, accSoft=mode==="buy"?C.pineSoft:C.goldSoft;
  const T=S.T, last=S.last, high=S.high; let low=T[0]; T.forEach(t=>{ if(t[1]<low[1]) low=t; });
  const toD=n=>{ const s=String(n); return new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)); };
  const cut=toD(last[0]); cut.setDate(cut.getDate()-90);
  const r3=T.filter(t=>toD(t[0])>=cut); const avg3=r3.length?Math.round(r3.reduce((x,t)=>x+t[1],0)/r3.length):0;
  const gap=high[1]?((last[1]-high[1])/high[1]*100):0;
  const won=d.won, ws=d.wonShort, ymd=d.ymd;
  const rr=(x,y,w,h,r,fill)=>{ g.beginPath(); g.roundRect(x,y,w,h,r); g.fillStyle=fill; g.fill(); };
  const fit=(txt,font,max)=>{ let px=parseInt(font.match(/(\d+)px/)[1]); g.font=font; while(g.measureText(txt).width>max&&px>24){ px-=2; g.font=font.replace(/\d+px/,px+"px"); } return g.font; };
  g.fillStyle="#fff"; g.fillRect(0,0,W,H); g.fillStyle=acc; g.fillRect(0,0,W,14);
  // 머리
  g.textBaseline="alphabetic"; g.fillStyle=acc; g.font=F(700,30); g.fillText("실거래 시세 브리핑",P,96);
  const badge=mode==="buy"?"매수 검토용":"매도 검토용"; g.font=F(700,28); const bw=g.measureText(badge).width+44; rr(W-P-bw,62,bw,50,25,accSoft); g.fillStyle=acc; g.fillText(badge,W-P-bw+22,97);
  let y=150; if(nm){ g.fillStyle=C.muted; g.font=F(500,32); g.fillText(`${nm.replace(/님?$/,"")}님께 드리는 자료`,P,y); y+=16; }
  g.fillStyle=C.ink; g.font=fit(a.n,F(700,68),W-2*P); g.fillText(a.n,P,y+70); y+=70;
  g.fillStyle=C.muted; g.font=F(500,32); g.fillText(`${a.g} ${a.d} · 전용 ${key}㎡`,P,y+50); y+=50;
  // 큰 숫자
  y+=36; rr(P,y,W-2*P,200,24,accSoft);
  const big=mode==="buy"?["최근 실거래가",last]:["최근 1년 최고가",high];
  g.fillStyle=acc; g.font=F(700,30); g.fillText(big[0],P+40,y+60);
  g.fillStyle=C.ink; g.font=fit(won(big[1][1]),F(700,84,true),W-2*P-80); g.fillText(won(big[1][1]),P+40,y+150);
  g.fillStyle=C.muted; g.font=F(500,28); const sub=`${ymd(big[1][0])} · ${big[1][3]}층`; g.fillText(sub,W-P-40-g.measureText(sub).width,y+60);
  y+=200;
  // 3칸
  y+=28; const boxes=mode==="buy"
    ?[["1년 최고가",ws(high[1]),ymd(high[0]).slice(2)],["최고가 대비",(gap>0?"+":"")+gap.toFixed(1)+"%",gap<0?"최근 거래가 더 낮음":gap>0?"최근 거래가 신고가":"최고가와 같음"],["최근 3개월 평균",avg3?ws(avg3):"거래 없음",`${r3.length}건 기준`]]
    :[["최근 실거래",ws(last[1]),ymd(last[0]).slice(2)+" · "+last[3]+"층"],["최근 3개월 평균",avg3?ws(avg3):"거래 없음",`${r3.length}건 기준`],["1년 거래",S.n+"건",`최저 ${ws(low[1])}`]];
  const bw3=(W-2*P-2*20)/3;
  boxes.forEach((b,i)=>{ const x=P+i*(bw3+20); g.strokeStyle=C.line; g.lineWidth=2; g.beginPath(); g.roundRect(x,y,bw3,150,18); g.stroke();
    g.fillStyle=C.muted; g.font=F(500,26); g.fillText(b[0],x+24,y+44);
    g.fillStyle=i===1&&mode==="buy"?(gap<0?C.pine:C.red):C.ink; g.font=fit(b[1],F(700,44,true),bw3-48); g.fillText(b[1],x+24,y+100);
    g.fillStyle=C.faint; g.font=fit(b[2],F(500,22),bw3-48); g.fillText(b[2],x+24,y+134); });
  y+=150;
  // 그래프
  y+=40; g.fillStyle=C.ink; g.font=F(700,30); g.fillText(`전용 ${key}㎡ 실거래 흐름 (최근 1년)`,P,y); y+=24;
  const cx=P+70, cw=W-2*P-90, cy=y+10, ch=260;
  const xs=T.map(t=>toD(t[0]).getTime()), x0=Math.min(...xs), x1=Math.max(...xs)||x0+1;
  let lo=Math.min(...T.map(t=>t[1])), hi=Math.max(...T.map(t=>t[1])); const pad=Math.max((hi-lo)*0.15,hi*0.03); lo-=pad; hi+=pad;
  const X=t=>cx+(x1===x0?cw/2:(toD(t[0]).getTime()-x0)/(x1-x0)*cw), Y=v=>cy+ch-(v-lo)/(hi-lo)*ch;
  g.strokeStyle=C.line; g.lineWidth=1.5; g.fillStyle=C.faint; g.font=F(500,22,true); g.textAlign="right";
  for(let i=0;i<=3;i++){ const v=lo+(hi-lo)*i/3, yy=Y(v); g.beginPath(); g.moveTo(cx,yy); g.lineTo(cx+cw,yy); g.stroke(); g.fillText(ws(Math.round(v)),cx-12,yy+8); }
  g.textAlign="center"; const ym=n=>{ const s=String(n); return `${s.slice(2,4)}.${s.slice(4,6)}`; };
  [T[0],T[Math.floor(T.length/2)],last].forEach((t,i)=>{ if(i===1&&T.length<5) return; g.fillText(ym(t[0]),X(t),cy+ch+36); });
  g.textAlign="left";
  g.strokeStyle=acc; g.lineWidth=4; g.lineJoin="round"; g.beginPath(); T.forEach((t,i)=>i?g.lineTo(X(t),Y(t[1])):g.moveTo(X(t),Y(t[1]))); g.globalAlpha=.35; g.stroke(); g.globalAlpha=1;
  T.forEach(t=>{ g.beginPath(); g.arc(X(t),Y(t[1]),7,0,7); g.fillStyle=acc; g.fill(); });
  const mark=(t,label,col)=>{ const px=X(t),py=Y(t[1]); g.beginPath(); g.arc(px,py,13,0,7); g.fillStyle="#fff"; g.fill(); g.lineWidth=5; g.strokeStyle=col; g.stroke();
    g.font=F(700,24); const tw=g.measureText(label).width+24; let lx=Math.min(Math.max(px-tw/2,cx),cx+cw-tw), ly=py-58; if(ly<cy-20) ly=py+24; rr(lx,ly,tw,40,10,col); g.fillStyle="#fff"; g.fillText(label,lx+12,ly+29); };
  if(high!==last) mark(high,"최고 "+ws(high[1]),C.gold);
  mark(last,"최근 "+ws(last[1]),C.pine);
  y=cy+ch+100;
  // 한 줄 요약
  const lines=[];
  if(mode==="buy"){ lines.push(gap<0?`최근 거래가 1년 최고가보다 ${Math.abs(gap).toFixed(1)}% 낮은 수준이에요`:gap>0?`최근 거래가 1년 최고가를 새로 썼어요`:`최근 거래가 1년 최고가와 같아요`); }
  else { lines.push(`최근 3개월 ${r3.length}건 거래${avg3?`, 평균 ${won(avg3)}`:""}이에요`); }
  if(near&&near.length) lines.push(`${near.map(x=>`${x.s.name}역 약 ${Math.round(x.d/10)*10}m`).join(" · ")} (직선거리)`);
  g.font=F(500,30); lines.forEach((l,i)=>{ g.fillStyle=i?C.muted:C.ink; g.font=i?F(500,26):F(700,30); g.fillText((i?"":"✔ ")+l,P,y+i*44); });
  // 바닥
  g.fillStyle=C.soft; g.fillRect(0,H-150,W,150);
  g.fillStyle=C.faint; g.font=F(500,22); g.fillText(`국토교통부 아파트 매매 실거래가 기준 · ${(asOf||"").replace(/-/g,".")} 자료 · 신고 시차로 최근 거래가 늘 수 있어요`,P,H-102);
  g.fillStyle=C.ink; g.font=F(700,32); g.fillText("문멘토프라퍼티",P,H-50);
  g.font=F(500,30,true); const tel="010.6336.1828 · 010.4336.5038"; g.fillText(tel,W-P-g.measureText(tel).width,H-50);
  return cv;
}
/* ---------- 계약 일정 ---------- */
const SF=[["contract","계약일","date"],["middle","중도금일","date"],["balance","잔금일","date"],["th","토지거래허가구역","sel",["해당 (허가 받은 뒤 계약)","해당 없음"]],["thApply","토허 신청일 (해당 시)","date"],["loan","주택담보대출","sel",["받음","안 받음"]]];
const loc=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
function addD(s,n){ const d=new Date(s+"T00:00:00"); d.setDate(d.getDate()+n); return loc(d); }
function fmt(s){ if(!s) return ""; const d=new Date(s+"T00:00:00"); return `${s.replace(/-/g,".")} (${"일월화수목금토"[d.getDay()]})`; }
function dday(s){ const t=new Date(); t.setHours(0,0,0,0); const n=Math.round((new Date(s+"T00:00:00")-t)/864e5); return n===0?"오늘":n>0?`D-${n}`:`${-n}일 지남`; }
function renderSched(){
  const v0=saved.sched||{};
  $("#view-calc").innerHTML=`<div><h1 class="view">계약 일정 계산</h1><p class="lede" style="margin-top:4px">아파트 매매 기준이에요. 날짜를 넣으면 토허부터 등기·취득세까지 기한을 정리해요.</p></div>
    <div class="form">${SF.map(f=>field(f,v0[f[0]])).join("")}</div>
    <div class="btns"><button type="button" class="btn pri" id="sgo">일정 만들기</button></div><div id="sout"></div>`;
  $("#sgo").onclick=()=>runSched();
  if(Object.keys(v0).length) runSched(true);
}
function runSched(silent){
  const v=read(SF); saved.sched=v; keep();
  if(!v.contract&&!v.balance){ $("#sout").innerHTML=`<div class="empty">계약일이나 잔금일을 넣어 주세요.</div>`; return; }
  const rows=[];
  if(v.th.startsWith("해당")&&v.thApply){ rows.push([v.thApply,"토지거래허가 신청","허가를 받은 뒤에 계약해요."]); rows.push([addD(v.thApply,15),"토허 처리 기한 (신청일부터 15일)","관할 구청에서 허가 여부를 정해요. 보완 요청이 오면 늦어질 수 있어요."]); }
  if(v.contract){ rows.push([v.contract,"매매계약 체결","계약금 입금 확인, 계약서·확인설명서 교부"]);
    rows.push([addD(v.contract,30),"부동산 거래신고 기한 (계약일부터 30일)","중개사가 신고해요. 서울은 전 지역이 규제지역이라 자금조달계획서와 증빙도 함께 내요."]); }
  if(v.middle) rows.push([v.middle,"중도금","입금 확인 후 영수증 교부"]);
  if(v.balance){ rows.push([v.balance,"잔금·소유권 이전","관리비·공과금 정산, 열쇠 인도"]);
    rows.push([addD(v.balance,60),"소유권이전등기 신청 기한 (잔금일부터 60일)","보통 잔금일에 법무사가 바로 신청해요."]);
    rows.push([addD(v.balance,60),"취득세 신고·납부 기한 (잔금일부터 60일)","등기 전에 내는 경우가 많아요."]);
    if(v.loan==="받음") rows.push([addD(v.balance,183),"주담대 전입 기한 (약 6개월)","수도권·규제지역 주담대는 6개월 안 전입 조건이 붙어요. 대출 약정서 날짜로 다시 확인하세요."]);
    if(v.th.startsWith("해당")) rows.push([addD(v.balance,730),"토허 실거주 의무 (약 2년)","허가 조건의 이용 의무 기간이에요. 정확한 시작일은 허가증으로 확인하세요."]); }
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  const today=loc(new Date());
  const txt=rows.map(r=>`${fmt(r[0])}  ${r[1]}`).join("\n");
  $("#sout").innerHTML=`<div class="sched"><table><thead><tr><th>날짜</th><th>할 일</th><th>메모</th></tr></thead><tbody>${rows.map(r=>{ const n=Math.round((new Date(r[0]+"T00:00:00")-new Date(today+"T00:00:00"))/864e5); return `<tr class="${n<0?"past":n<=7?"soon":""}"><td class="d">${fmt(r[0])}<br><small>${dday(r[0])}</small></td><td><b>${esc(r[1])}</b></td><td class="note">${esc(r[2])}</td></tr>`; }).join("")}</tbody></table></div>
    <div class="btns"><button type="button" class="btn pri" id="scopy">손님에게 보낼 일정 복사</button></div>
    <div class="warn">법정 기한은 일반 기준이에요. 공휴일·관청 사정·대출 조건에 따라 달라질 수 있으니 관할 구청과 은행에 꼭 확인하세요.</div>`;
  $("#scopy").onclick=()=>copy(`[계약 일정 안내]\n${txt}\n\n문멘토프라퍼티 010.6336.1828 · 010.4336.5038`);
}

/* ---------- 정권별 부동산 대책 ---------- */
let POL=null, pGov="전체", pCat="전체", pQ="";
const polReady=fetch("data/policies.json").then(r=>r.json()).then(d=>{ POL=d; MM.policies=d.policies; const h=$("#view-home"); if(h&&!h.hidden&&MM.renderHome) MM.renderHome(); return d; }).catch(()=>null);
const DIRC={강화:"#b3372e",완화:"#2f5f9e",공급:"#1d5c47",혼합:"#a5761a",임대차:"#a5761a"};
const govOf=d=>(POL.govs.find(g=>d>=g.from&&d<=g.to)||{}).k||"";
const CATS=["전체","세금","대출","공급","규제지역","토지거래허가","재건축·정비","청약·분양","임대차"];
const catHit=(p,c)=>c==="전체"||(c==="재건축·정비"?/재건축|정비|조합/.test(p.cat):c==="청약·분양"?/청약|분양/.test(p.cat):p.cat.includes(c));
async function renderPolicy(){
  const box=$("#view-policy");
  if(!POL){ box.innerHTML=`<div class="empty">대책 자료를 불러오는 중이에요…</div>`; await polReady; if(!POL){ box.innerHTML=`<div class="empty">대책 자료를 불러오지 못했어요.</div>`; return; } }
  const list=POL.policies.filter(p=>(pGov==="전체"||govOf(p.date)===pGov)&&catHit(p,pCat)&&(!pQ||(p.title+p.summary+p.detail).includes(pQ))).slice().reverse();
  const cnt=k=>POL.policies.filter(p=>govOf(p.date)===k).length;
  box.innerHTML=`<div><h1 class="view">정권별 부동산 대책</h1><p class="lede" style="margin-top:4px">2003년부터 지금까지 주요 대책 ${POL.policies.length}건이에요. 손님 상담 때 "그때 무슨 대책이 있었는지" 바로 찾아 설명할 수 있어요.</p></div>
    <div class="chips" role="group" aria-label="정권">${["전체",...POL.govs.map(g=>g.k)].map(k=>`<button type="button" class="chip ${pGov===k?"on":""}" data-gov="${k}">${k}${k==="전체"?"":` <span class="num">${cnt(k)}</span>`}</button>`).join("")}</div>
    <div class="chips" role="group" aria-label="분야">${CATS.map(c=>`<button type="button" class="chip ${pCat===c?"on":""}" data-cat="${c}">${c}</button>`).join("")}</div>
    <div class="field"><input id="pq" type="search" placeholder="검색 (예: 양도세, LTV, 토지거래허가)" value="${esc(pQ)}"></div>
    ${pGov!=="전체"?(()=>{const g=POL.govs.find(x=>x.k===pGov);const ps=POL.policies.filter(p=>govOf(p.date)===pGov);const n=d=>ps.filter(p=>p.dir===d).length;return `<div class="stats"><div class="stat"><b>${n("강화")}</b><span>강화</span></div><div class="stat"><b>${n("완화")}</b><span>완화</span></div><div class="stat"><b>${n("공급")+n("혼합")+n("임대차")}</b><span>공급·기타</span></div></div><p class="note" style="margin:0">${esc(pGov)} 정부 ${esc(g.label)}</p>`})():""}
    <div class="list">${list.length?list.map((p,i)=>`<details class="row" style="display:block"><summary style="cursor:pointer;list-style:none">
      <span class="pill" style="--lc:${DIRC[p.dir]||"#888"}"><i></i>${esc(p.dir)}</span> <span class="pill">${esc(p.cat)}</span> <span class="num note">${p.date.replace(/-/g,".")} · ${esc(govOf(p.date))}</span>
      <div class="t" style="margin-top:6px">${esc(p.title)}</div><div class="s">${esc(p.summary)}</div></summary>
      ${p.detail?`<ul style="margin:10px 0 4px;padding-left:18px;font-size:14px;line-height:1.6">${p.detail.split("\n").map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      <div class="btns" style="margin-top:8px"><button type="button" class="btn" data-pcopy="${POL.policies.indexOf(p)}">손님 설명용 복사</button></div></details>`).join(""):`<div class="empty">조건에 맞는 대책이 없어요</div>`}</div>
    <div class="warn">발표 내용 요약이에요. 국회 통과·시행 과정에서 바뀐 경우가 있으니, 손님에게 안내하기 전에 보도자료 원문과 시행일을 꼭 확인하세요.</div>`;
  box.querySelectorAll("[data-gov]").forEach(b=>b.onclick=()=>{ pGov=b.dataset.gov; renderPolicy(); });
  box.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{ pCat=b.dataset.cat; renderPolicy(); });
  const q=$("#pq"); q.oninput=()=>{ pQ=q.value.trim(); clearTimeout(q._t); q._t=setTimeout(()=>{ renderPolicy().then(()=>{ const n=$("#pq"); n.focus(); n.setSelectionRange(n.value.length,n.value.length); }); },250); };
  box.querySelectorAll("[data-pcopy]").forEach(b=>b.onclick=e=>{ e.preventDefault(); const p=POL.policies[+b.dataset.pcopy];
    copy(`[${p.date.replace(/-/g,".")} ${p.title}]\n${p.summary}${p.detail?"\n\n"+p.detail.split("\n").map(x=>"· "+x).join("\n"):""}\n\n※ 발표 기준 요약이에요. 시행 내용은 원문으로 확인해 주세요.\n문멘토프라퍼티 010.6336.1828 · 010.4336.5038`); });
}

{ const h=location.hash; const v=h.startsWith("#v=")?h.slice(3):(h&&h.length>1?"map":"home"); setTimeout(()=>show(v),0); }
})();
