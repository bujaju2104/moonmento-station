/* 문멘토 역세권 지도
   - 카카오맵 위에 서울 지하철 노선·역을 그리고, 역을 누르면 반경 안 아파트를 가까운 순서로 보여줌
   - 실거래는 /api/rt 로 국토교통부에서 시군구 단위로 바로 받음 (전국). 서버를 못 쓰면 서울 고정 자료(data/apts.json)
   - 서울 밖은 카카오 장소 검색으로 전철역·장소를 찾아 같은 방식으로 반경 단지를 보여줌
   - 좌표가 없는 단지는 카카오 장소 검색으로 위치를 찾아 이 기기에 저장(다음부터 바로 표시) */
(function(){
"use strict";
const MM = window.MM = {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const WALK = 80; // m/분
const GEO_KEY = "mm-station-geo-v1";

let SUB=null, APTS=[], GU=[], ASOF="";
let map=null, ps=null, geocoder=null, started=false, failed=false;
/* 지역(시군구)별 실거래: code -> {state:"loading"|"live"|"fail", asOf, name, p:Promise} */
const REG={}; let LIVE=false;
const SEOUL_CODE={"종로구":"11110","중구":"11140","용산구":"11170","성동구":"11200","광진구":"11215","동대문구":"11230","중랑구":"11260","성북구":"11290","강북구":"11305","도봉구":"11320","노원구":"11350","은평구":"11380","서대문구":"11410","마포구":"11440","양천구":"11470","강서구":"11500","구로구":"11530","금천구":"11545","영등포구":"11560","동작구":"11590","관악구":"11620","서초구":"11650","강남구":"11680","송파구":"11710","강동구":"11740"};
let EXTRA=[]; // 카카오에서 찾은 서울 밖 전철역 {name,lat,lng,lines:[],kakao:true}
let radius=500, sel=null, selApt=null, sortBy="dist";
let stOverlays=[], aptOverlays=[], circle=null, lineObjs={}, hiddenLines=new Set();
let geoCache={};

/* ---------- 숫자·거리 ---------- */
const won = m => { m=Math.round(m); const e=Math.floor(m/10000), r=m%10000; if(!e) return r.toLocaleString("ko-KR")+"만"; return e+"억"+(r?" "+r.toLocaleString("ko-KR")+"만":""); };
const wonShort = m => (m/10000).toFixed(m>=100000?1:2).replace(/\.?0+$/,"")+"억";
const ymd = n => { const s=String(n); return `${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`; };
const ym2 = n => { const s=String(n); return `${s.slice(2,4)}.${s.slice(4,6)}`; };
function dist(a,b){ const R=6371000,t=Math.PI/180; const dLa=(b[0]-a[0])*t, dLo=(b[1]-a[1])*t; const x=Math.sin(dLa/2)**2+Math.cos(a[0]*t)*Math.cos(b[0]*t)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
const walk = m => Math.max(1,Math.round(m/WALK));
const meters = m => m<1000?`${Math.round(m/10)*10}m`:`${(m/1000).toFixed(1)}km`;

/* ---------- 구 경계 (역이 속한 구) ---------- */
function inRing(x,y,r){ let c=false; for(let i=0,j=r.length-1;i<r.length;j=i++){ const [xi,yi]=r[i],[xj,yj]=r[j]; if((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) c=!c; } return c; }
function guOf(p){ for(const g of GU) if(g.rings.some(r=>inRing(p[1],p[0],r))) return g.name; return null; }
function gusNear(p, m){
  const out=new Set(); const g=guOf(p); if(g) out.add(g);
  for(const gu of GU){ if(out.has(gu.name)) continue;
    if(gu.rings.some(r=>r.some(([lng,lat])=>dist(p,[lat,lng])<m))) out.add(gu.name); }
  return out;
}

/* ---------- 데이터 ---------- */
const lineById = id => SUB.lines.find(l=>l.id===id) || {name:id,color:"#888"};
const stColor = s => s.lines.length?lineById(s.lines[0]).color:"#6b7a73";
function aptKey(a){ return `${a.g}|${a.d}|${a.n}`; }
function pos(a){ return a.p || (geoCache[aptKey(a)]||null); }
function loadGeo(){ try{ geoCache=JSON.parse(localStorage.getItem(GEO_KEY)||"{}") }catch(e){ geoCache={} } }
function saveGeo(){ try{ localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)) }catch(e){} }

function summary(a, areaKey){
  const T = areaKey==null ? a.t : a.t.filter(t=>Math.floor(t[2]/100)===areaKey);
  if(!T.length) return null;
  const last=T[T.length-1];
  let high=T[0]; for(const t of T) if(t[1]>high[1]) high=t;
  let prev=null; for(const t of T.slice(0,-1)) if(!prev||t[1]>prev[1]) prev=t;
  return {n:T.length,last,high,prev,T};
}
function areas(a){ const m=new Map(); for(const t of a.t){ const k=Math.floor(t[2]/100); m.set(k,(m.get(k)||0)+1); } return [...m.entries()].sort((x,y)=>x[0]-y[0]); }

/* ---------- 시작 ---------- */
async function loadData(){
  const [s,a,g,baked] = await Promise.all([
    fetch("data/subway.json").then(r=>r.json()),
    fetch("data/apts.json").then(r=>r.json()),
    fetch("data/gu.json").then(r=>r.json()),
    fetch("data/geo.json").then(r=>r.ok?r.json():{}).catch(()=>({}))
  ]);
  SUB=s; APTS=a.apts; GU=g; ASOF=(a.asOf||"").slice(0,10);
  for(const x of APTS){ x.c=SEOUL_CODE[x.g]||""; x.stat=true; }
  loadGeo();
  for(const k in baked) if(!(k in geoCache)) geoCache[k]=baked[k];
  setSrc();
}
function setSrc(){
  const live=Object.values(REG).filter(r=>r.state==="live");
  const txt = live.length
    ? `국토교통부 실거래가 직통 조회 (최근 12개월 계약, ${live.map(r=>r.asOf).sort().pop().replace(/-/g,".")} 기준, 해제 거래 제외)`
    : `국토교통부 아파트 매매 실거래가 (서울, 2025.11~${ASOF.slice(0,7).replace("-",".")} 계약, ${ASOF.replace(/-/g,".")} 기준)`;
  document.querySelectorAll('[id="srcRt"]').forEach(el=>el.textContent=txt); // 패널에도 같은 문구가 복사돼 있음
}

/* ---------- 지역별 실거래 (국토부 직통) ---------- */
function loadRegion(code){
  if(!/^\d{5}$/.test(code||"")) return Promise.resolve(false);
  if(REG[code]) return REG[code].p;
  const r=REG[code]={state:"loading"};
  r.p=fetch(`/api/rt?code=${code}&months=12`).then(x=>x.ok?x.json():x.json().then(j=>Promise.reject(new Error(j.error||x.status)))).then(j=>{
    const old=new Map(APTS.filter(a=>a.c===code).map(a=>[aptKey(a),a]));
    APTS=APTS.filter(a=>a.c!==code);
    for(const a of j.apts){ a.c=code; const o=old.get(aptKey(a)); if(o&&o.p) a.p=o.p; APTS.push(a); }
    r.state="live"; r.asOf=j.asOf; r.name=j.name; LIVE=true; setSrc(); return true;
  }).catch(e=>{ r.state="fail"; r.err=String(e.message||e); return false; });
  return r.p;
}
/* 좌표 → 시군구 코드 (카카오 행정구역, 법정동 코드 앞 5자리) */
function codeAt(lat,lng){
  return new Promise(res=>{
    if(!geocoder){ const g=guOf([lat,lng]); return res(g?SEOUL_CODE[g]:null); }
    try{ geocoder.coord2RegionCode(lng,lat,(rs,st)=>{ const b=st===kakao.maps.services.Status.OK&&rs.find(x=>x.region_type==="B"); res(b?String(b.code).slice(0,5):null); }); }
    catch(e){ res(null); }
  });
}
async function codesNear(p, m){
  const pts=[p]; const dLat=m/111000, dLng=m/(111000*Math.cos(p[0]*Math.PI/180));
  for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) pts.push([p[0]+a*dLat,p[1]+b*dLng]);
  const out=new Set(); for(const q of pts){ const c=await codeAt(q[0],q[1]); if(c) out.add(c); }
  return [...out];
}
async function ensureNear(p, m){
  const codes=await codesNear(p, m);
  regState={loading:codes.filter(c=>!REG[c]||REG[c].state==="loading").length};
  if(regState.loading) renderPanel();
  await Promise.all(codes.map(loadRegion));
  regState=null;
  return codes;
}
let regState=null;
const dataReady = loadData().catch(e=>{ showMsg("자료를 불러오지 못했어요. 새로고침해 주세요."); throw e; });

MM.kakaoFailed = function(){
  if(failed||started) return; failed=true;
  dataReady.then(()=>{ renderPanel(); showMsg("카카오 지도를 불러오지 못했어요. 인터넷 연결을 확인하거나, 카카오 개발자 사이트의 JavaScript SDK 도메인에 이 주소가 등록돼 있는지 확인해 주세요. 역 검색과 단지 목록은 그대로 쓸 수 있어요."); });
};
setTimeout(()=>{ if(!started) MM.kakaoFailed(); }, 9000);

MM.start = async function(){
  if(started) return; started=true; failed=false;
  await dataReady;
  const K=kakao.maps;
  map = new K.Map($("#map"), {center:new K.LatLng(37.5565,126.99), level:8});
  map.addControl(new K.ZoomControl(), K.ControlPosition.RIGHT);
  ps = new K.services.Places();
  geocoder = new K.services.Geocoder();
  drawLines(); drawStations();
  K.event.addListener(map,"zoom_changed",zoomClass); zoomClass();
  K.event.addListener(map,"idle",findExtraStations);
  hideMsg();
  const h=decodeURIComponent(location.hash.slice(1));
  if(h){ const s=SUB.stations.find(x=>x.name===h.replace(/역$/,"")); if(s) selectStation(s); }
  renderPanel();
  if(/[?&]fill\b/.test(location.search)) fillAll();
};
/* 관리자용: 주소 끝에 ?fill 을 붙여 열면 서울 전체 단지 위치를 한 번에 찾고, 끝나면 geo.json 내려받기 */
async function fillAll(){
  const center=g=>{ let la=0,lo=0,n=0; for(const r of g.rings) for(const [x,y] of r){ lo+=x; la+=y; n++; } return [la/n,lo/n]; };
  const C={}; GU.forEach(g=>C[g.name]=center(g));
  const todo=APTS.filter(a=>!a.p && !(aptKey(a) in geoCache));
  let done=0, found=0, i=0;
  const show=()=>showMsg(`서울 전체 단지 위치 찾는 중 ${done}/${todo.length} (찾음 ${found}). 창을 닫지 마세요.`);
  show();
  const worker=async()=>{ while(i<todo.length){ const a=todo[i++]; const c=C[a.g]||[37.5565,126.99];
    const r=await findApt(a,new kakao.maps.LatLng(c[0],c[1])); geoCache[aptKey(a)]=r; if(r) found++; done++;
    if(done%20===0){ saveGeo(); show(); } await new Promise(r=>setTimeout(r,80)); } };
  await Promise.all([worker(),worker(),worker(),worker()]);
  saveGeo();
  const total=APTS.filter(a=>pos(a)).length;
  showMsg(`끝났어요. 지도에 찍히는 단지 ${total.toLocaleString()}/${APTS.length.toLocaleString()}개. geo.json 파일을 내려받았어요.`);
  exportGeo();
}
function zoomClass(){ const lv=map.getLevel(); const el=$("#map"); el.classList.toggle("zoomed",lv<=5); el.classList.toggle("zoomed2",lv<=3); }

/* ---------- 노선 ---------- */
function chains(lineId){
  const es=SUB.edges.filter(e=>e[2]===lineId); const adj=new Map(); const used=new Set();
  const add=(a,b,i)=>{ if(!adj.has(a)) adj.set(a,[]); adj.get(a).push([b,i]); };
  es.forEach((e,i)=>{ add(e[0],e[1],i); add(e[1],e[0],i); });
  const out=[];
  const ends=[...adj.keys()].filter(k=>adj.get(k).length!==2);
  const walkFrom=start=>{ const path=[start]; let cur=start;
    for(;;){ const nx=(adj.get(cur)||[]).find(([,i])=>!used.has(i)); if(!nx) break; used.add(nx[1]); cur=nx[0]; path.push(cur); }
    if(path.length>1) out.push(path); };
  ends.forEach(walkFrom); [...adj.keys()].forEach(walkFrom);
  return out;
}
function stPos(name){ const s=SUB.stations.find(x=>x.name===name); if(s) return [s.lat,s.lng]; return SUB.outside[name]||null; }
function drawLines(){
  const K=kakao.maps;
  for(const l of SUB.lines){
    const objs=[];
    for(const ch of chains(l.id)){
      const path=ch.map(stPos).filter(Boolean).map(p=>new K.LatLng(p[0],p[1]));
      if(path.length<2) continue;
      objs.push(new K.Polyline({map, path, strokeWeight:4, strokeColor:l.color, strokeOpacity:.85, strokeStyle:"solid", zIndex:1}));
    }
    if(objs.length) lineObjs[l.id]=objs;
  }
  $("#linePanel").innerHTML = SUB.lines.filter(l=>lineObjs[l.id]).map(l=>`<button type="button" class="lchip" data-line="${l.id}" style="--lc:${l.color}"><i></i>${esc(l.name)}</button>`).join("");
}
function toggleLine(id){
  if(hiddenLines.has(id)) hiddenLines.delete(id); else hiddenLines.add(id);
  (lineObjs[id]||[]).forEach(o=>o.setMap(hiddenLines.has(id)?null:map));
  document.querySelectorAll(`[data-line="${id}"]`).forEach(b=>b.classList.toggle("off",hiddenLines.has(id)));
  stOverlays.forEach(({s,ov})=>{ const vis=s.lines.some(x=>!hiddenLines.has(x)); ov.setMap(vis?map:null); });
}

/* ---------- 서울 밖 전철역 (카카오 장소 분류: 지하철역 SW8) ---------- */
let extraOverlays=[], extraTimer=0;
const inSeoulData = (lat,lng) => lat>37.40&&lat<37.74&&lng>126.73&&lng<127.21;
function findExtraStations(){
  clearTimeout(extraTimer);
  extraTimer=setTimeout(()=>{
    if(!map||!ps||map.getLevel()>7) return;
    const c=map.getCenter(); if(inSeoulData(c.getLat(),c.getLng())) return;
    try{ ps.categorySearch("SW8",(data,status)=>{ if(status!==kakao.maps.services.Status.OK) return; data.forEach(addExtra); },{useMapBounds:true}); }catch(e){}
  },400);
}
function extraName(pl){ return String(pl.place_name||"").replace(/\s*\S*호선$|\s*\S*선$/,"").replace(/역$/,""); }
function addExtra(pl){
  const name=extraName(pl); const lat=+pl.y, lng=+pl.x;
  if(!name||SUB.stations.some(s=>s.name===name)||EXTRA.some(s=>s.name===name&&dist([s.lat,s.lng],[lat,lng])<400)) return null;
  const line=(String(pl.place_name).match(/(\S*선)$/)||[])[1]||"";
  const s={name,lat,lng,lines:[],line,kakao:true}; EXTRA.push(s);
  if(map){ const el=document.createElement("div"); el.className="st kk"; el.style.setProperty("--lc","#6b7a73");
    el.innerHTML=`<div class="dot"></div><div class="nm">${esc(name)}</div>`; el.title=`${name}역${line?" · "+line:""}`;
    el.addEventListener("click",e=>{ e.stopPropagation(); selectStation(s); });
    const ov=new kakao.maps.CustomOverlay({map, position:new kakao.maps.LatLng(lat,lng), content:el, zIndex:3, clickable:true});
    stOverlays.push({s,ov,el}); }
  return s;
}
const allStations = () => SUB.stations.concat(EXTRA);

/* ---------- 역 ---------- */
function drawStations(){
  const K=kakao.maps;
  for(const s of SUB.stations){
    const el=document.createElement("div");
    el.className="st"+(s.lines.length>1?" x":"");
    el.style.setProperty("--lc",stColor(s));
    el.innerHTML=`<div class="dot"></div><div class="nm">${esc(s.name)}</div>`;
    el.title=`${s.name}역 · ${s.lines.map(id=>lineById(id).name).join(", ")}`;
    el.addEventListener("click",e=>{ e.stopPropagation(); selectStation(s); });
    const ov=new K.CustomOverlay({map, position:new K.LatLng(s.lat,s.lng), content:el, zIndex:s.lines.length>1?4:3, clickable:true});
    stOverlays.push({s,ov,el});
  }
}
function selectStation(s, keepView){
  sel=s; selApt=null;
  stOverlays.forEach(o=>o.el.classList.toggle("sel",o.s===s));
  history.replaceState(null,"","#"+encodeURIComponent(s.name+(s.place?"":"역")));
  if(map){
    const K=kakao.maps, c=new K.LatLng(s.lat,s.lng);
    if(circle) circle.setMap(null);
    circle=new K.Circle({map, center:c, radius, strokeWeight:2, strokeColor:"#a5761a", strokeOpacity:.9, strokeStyle:"dash", fillColor:"#a5761a", fillOpacity:.07, zIndex:2});
    if(!keepView){ map.setLevel(radius<=250?3:radius<=500?4:5); map.setCenter(c); }
  }
  refresh();
  const job=++selJob;
  ensureNear([s.lat,s.lng], radius+800).then(codes=>{ if(job!==selJob) return; selCodes=codes; refresh(true); locateMissing(s); });
}
let selJob=0, selCodes=[];
function stationApts(){
  if(!sel) return [];
  const p=[sel.lat,sel.lng]; const out=[];
  for(const a of APTS){ const q=pos(a); if(!q) continue; const d=dist(p,q); if(d<=radius) out.push({a,d,q}); }
  const recent=x=>x.a.t.length?x.a.t[x.a.t.length-1][0]:0;
  out.sort(sortBy==="price"?((x,y)=>(y.a.t.at(-1)?.[1]||0)-(x.a.t.at(-1)?.[1]||0)):sortBy==="count"?((x,y)=>y.a.t.length-x.a.t.length):sortBy==="recent"?((x,y)=>recent(y)-recent(x)):((x,y)=>x.d-y.d));
  return out;
}

/* ---------- 좌표 없는 단지 위치 찾기 (카카오 장소 검색) ---------- */
let geoJob=0, geoState=null;
async function locateMissing(s){
  if(!ps) return;
  const job=++geoJob; const p=[s.lat,s.lng];
  const gus=gusNear(p, radius+1200); const codes=new Set(selCodes);
  const todo=APTS.filter(a=>!a.p && (codes.size?codes.has(a.c):gus.has(a.g)) && !(aptKey(a) in geoCache));
  if(!todo.length){ geoState=null; renderPanel(); return; }
  geoState={done:0,total:todo.length};
  renderPanel();
  const K=kakao.maps, loc=new K.LatLng(s.lat,s.lng);
  let i=0;
  const worker=async()=>{
    while(i<todo.length && job===geoJob){
      const a=todo[i++];
      geoCache[aptKey(a)] = await findApt(a, loc);
      geoState.done++;
      if(geoState.done%8===0){ saveGeo(); refresh(true); }
      await new Promise(r=>setTimeout(r,90));
    }
  };
  await Promise.all([worker(),worker(),worker(),worker()]);
  if(job!==geoJob) return;
  saveGeo(); geoState=null; refresh(true);
}
function search(q, loc){
  return new Promise(res=>{
    try{ ps.keywordSearch(q,(data,status)=>res(status===kakao.maps.services.Status.OK?data:[]),{location:loc,radius:20000,size:5}); }
    catch(e){ res([]); }
  });
}
async function findApt(a, loc){
  const norm=s=>s.replace(/\(.*?\)|아파트|\s/g,"");
  const tries=[`${a.d} ${a.n}`, `${a.g} ${a.n} 아파트`, `${a.g} ${a.d} ${a.n}`];
  for(const q of tries){
    const rs=await search(q, loc);
    const ad=String(a.d||"").split(" ").pop();
    const good=rs.filter(r=>{ const addr=r.address_name||""; return addr.includes(a.g.replace(/[구시군]$/,""))&&addr.includes(ad); });
    const pick=good.find(r=>/아파트|주거/.test(r.category_name||"")&&norm(r.place_name).includes(norm(a.n).slice(0,2)))
      || good.find(r=>/아파트|주거/.test(r.category_name||""))
      || good.find(r=>norm(r.place_name).includes(norm(a.n)));
    if(pick) return [+(+pick.y).toFixed(6), +(+pick.x).toFixed(6)];
  }
  return null;
}

/* ---------- 지도 위 단지 핀 ---------- */
function drawApts(list){
  aptOverlays.forEach(o=>o.ov.setMap(null)); aptOverlays=[];
  if(!map) return;
  const K=kakao.maps;
  list.forEach((x,i)=>{
    const el=document.createElement("div");
    el.className="ap"+(selApt===x.a?" on":"");
    el.innerHTML=`<b>${i+1}</b><span class="tag">${esc(x.a.n)}</span>`;
    el.title=x.a.n;
    el.addEventListener("click",e=>{ e.stopPropagation(); openApt(x.a); });
    const ov=new K.CustomOverlay({map, position:new K.LatLng(x.q[0],x.q[1]), content:el, zIndex:selApt===x.a?9:5, clickable:true, yAnchor:1});
    aptOverlays.push({a:x.a,ov,el});
  });
}

/* ---------- 화면 ---------- */
function refresh(soft){ const list=stationApts(); drawApts(list); renderPanel(list); }
const QUICK=["신당","청구","약수","왕십리","동대문역사문화공원","충정로","공덕","옥수","금호","강남","잠실","목동"];
function renderPanel(list){
  if(!SUB){ $("#panel").innerHTML=`<div class="empty">자료를 불러오는 중이에요…</div>`; return; }
  const foot=`<div class="foot-in">${$(".foot").innerHTML}</div>`;
  if(!sel){
    $("#panel").innerHTML=`<h1 class="view">역을 누르면 역세권 단지가 나와요</h1>
      <p class="lede">지도에서 역을 누르거나 위 검색창에 역·아파트·동네 이름을 쓰세요. 전국 어디든 반경 안의 아파트가 가까운 순서로, 국토교통부 최근 실거래가와 함께 나와요.</p>
      <div class="stats"><div class="stat"><b>전국</b><span>250개 시군구</span></div><div class="stat"><b>${allStations().length}</b><span>지도에 표시된 역</span></div><div class="stat"><b>${LIVE?"직통":"서울"}</b><span>${LIVE?"국토부 실거래":"고정 자료"}</span></div></div>
      <h2 class="note" style="margin:4px 0 0;font-weight:700;color:var(--ink)">자주 보는 역</h2>
      <div class="quick">${QUICK.map(n=>`<button type="button" data-st="${esc(n)}">${esc(n)}역</button>`).join("")}</div>${foot}`;
    bindPanel(); return;
  }
  list=list||stationApts();
  const tr=list.reduce((s,x)=>s+x.a.t.length,0);
  const prices=list.map(x=>x.a.t.at(-1)).filter(Boolean);
  const med=prices.length?prices.map(t=>t[1]).sort((a,b)=>a-b)[Math.floor(prices.length/2)]:0;
  const failed=selCodes.filter(c=>REG[c]&&REG[c].state==="fail"&&!APTS.some(a=>a.c===c));
  const prog=(regState&&regState.loading?`<div class="progress">국토부 실거래 받는 중…<span class="bar"><i style="width:40%"></i></span></div>`:"")
    +(failed.length?`<div class="note" style="color:var(--red,#b3372e)">이 지역 실거래를 받지 못했어요. ${esc(REG[failed[0]].err||"")}</div>`:"")+(geoState?`<div class="progress">단지 위치 찾는 중 ${geoState.done}/${geoState.total}<span class="bar"><i style="width:${Math.round(geoState.done/geoState.total*100)}%"></i></span></div>`:"");
  $("#panel").innerHTML=`<div><h1 class="view">${esc(sel.name)}${sel.place?"":"역"} 반경 ${meters(radius)}</h1>
    <div class="pills" style="margin-top:6px">${sel.lines.map(id=>{const l=lineById(id);return `<span class="pill" style="--lc:${l.color}"><i></i>${esc(l.name)}</span>`}).join("")}${sel.line?`<span class="pill"><i></i>${esc(sel.line)}</span>`:""}<span class="pill">도보 약 ${walk(radius)}분 이내</span></div></div>
    <div class="stats"><div class="stat"><b>${list.length}</b><span>단지</span></div><div class="stat"><b>${tr.toLocaleString()}</b><span>거래 (1년)</span></div><div class="stat"><b>${med?wonShort(med):"-"}</b><span>최근 거래 중간값</span></div></div>
    ${prog}
    <div class="chips" role="group" aria-label="정렬">${[["dist","가까운 순"],["price","최근가 높은 순"],["count","거래 많은 순"],["recent","최근 거래 순"]].map(([k,l])=>`<button type="button" class="chip ${sortBy===k?"on":""}" data-sort="${k}">${l}</button>`).join("")}</div>
    <div class="list">${list.length?list.map((x,i)=>{const t=x.a.t.at(-1);return `<button type="button" class="row ${selApt===x.a?"on":""}" data-apt="${APTS.indexOf(x.a)}">
      <span class="no">${i+1}</span>
      <span><span class="t">${esc(x.a.n)}</span><span class="s" style="display:block">${esc(x.a.d)} · ${meters(x.d)} · 도보 ${walk(x.d)}분</span></span>
      <span class="r">${t?`<span class="p">${wonShort(t[1])}</span><br>${Math.floor(t[2]/100)}㎡ · ${ym2(t[0])}`:"거래 없음"}</span></button>`}).join(""):`<div class="empty">${regState||geoState?"실거래와 단지 위치를 찾고 있어요. 잠시만 기다려 주세요.":"반경 안에 실거래가 있는 아파트가 없어요. 반경을 넓혀 보세요."}</div>`}</div>
    <p class="note">최근가는 가장 최근 계약 1건이에요(면적 다를 수 있음). 단지를 누르면 면적별 그래프와 전체 거래가 나와요.</p>${foot}`;
  bindPanel();
}
function bindPanel(){
  document.querySelectorAll("[data-st]").forEach(b=>b.onclick=()=>{ const s=SUB.stations.find(x=>x.name===b.dataset.st); if(s) selectStation(s); });
  document.querySelectorAll("[data-sort]").forEach(b=>b.onclick=()=>{ sortBy=b.dataset.sort; refresh(); });
  document.querySelectorAll("[data-apt]").forEach(b=>b.onclick=()=>openApt(APTS[+b.dataset.apt]));
  document.querySelectorAll("#panel #geoExport").forEach(b=>b.onclick=exportGeo);
}

/* ---------- 단지 상세 ---------- */
let curArea=null;
function openApt(a, areaKey){
  selApt=a;
  aptOverlays.forEach(o=>{ o.el.classList.toggle("on",o.a===a); o.ov.setZIndex(o.a===a?9:5); });
  document.querySelectorAll("[data-apt]").forEach(b=>b.classList.toggle("on",APTS[+b.dataset.apt]===a));
  const ar=areas(a);
  if(areaKey==null){ const top=[...ar].sort((x,y)=>y[1]-x[1])[0]; areaKey=top?top[0]:null; }
  curArea=areaKey;
  const S=summary(a,areaKey);
  const q=pos(a);
  const near=q?allStations().map(s=>({s,d:dist(q,[s.lat,s.lng])})).sort((x,y)=>x.d-y.d).slice(0,3).filter(x=>x.d<3000):[];
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(a.n)} 실거래">
    <h2><span>${esc(a.n)}<span class="note" style="display:block;font-weight:500">${esc(a.g)} ${esc(a.d)}</span></span><button type="button" class="x" aria-label="닫기">×</button></h2>
    ${near.length?`<div class="near">${near.map(({s,d})=>`<span>${esc(s.name)}역 <b>${meters(d)}</b> · 도보 ${walk(d)}분 ${s.line?`<span class="pill"><i></i>${esc(s.line)}</span>`:""}${s.lines.map(id=>`<span class="pill" style="--lc:${lineById(id).color}"><i></i>${esc(lineById(id).name)}</span>`).join(" ")}</span>`).join("")}</div>`:`<div class="note">${q?"3km 안에 전철역이 없어요.":"지도 위치를 아직 못 찾은 단지예요."}</div>`}
    <div class="chips" role="group" aria-label="전용면적">${ar.map(([k,n])=>`<button type="button" class="chip ${k===areaKey?"on":""}" data-area="${k}">전용 ${k}㎡ <span class="num">${n}건</span></button>`).join("")}</div>
    ${S?`<div class="cards">
      <div style="--ac:var(--gold)"><span>최근 1년 최고가</span><b>${wonShort(S.high[1])}</b><small>${ymd(S.high[0])} · ${S.high[3]}층</small></div>
      <div style="--ac:var(--blue)"><span>직전까지 최고가</span><b>${S.prev?wonShort(S.prev[1]):"-"}</b><small>${S.prev?ymd(S.prev[0])+" · "+S.prev[3]+"층":"거래 1건"}</small></div>
      <div style="--ac:var(--pine)"><span>최근 거래</span><b>${wonShort(S.last[1])}</b><small>${ymd(S.last[0])} · ${S.last[3]}층</small></div></div>
      <div class="chart" id="chart"></div>
      <div class="tbl"><table><thead><tr><th>계약일</th><th style="text-align:right">거래가</th><th style="text-align:right">전용</th><th style="text-align:right">층</th></tr></thead><tbody>
      ${[...S.T].reverse().map(t=>`<tr><td class="num">${ymd(t[0])}</td><td class="n">${won(t[1])}</td><td class="n">${(t[2]/100).toFixed(2)}㎡</td><td class="n">${t[3]}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty">이 면적은 최근 1년 거래가 없어요.</div>`}
    <div class="links">
      <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(a.d+" "+a.n+" 아파트")}" target="_blank" rel="noopener">네이버에서 보기</a>
      ${q?`<a href="https://map.kakao.com/link/map/${encodeURIComponent(a.n)},${q[0]},${q[1]}" target="_blank" rel="noopener">카카오맵에서 보기</a>`:""}
      <a href="https://rt.molit.go.kr/" target="_blank" rel="noopener">국토부 원본</a>
    </div>
    <p class="note">최고가는 이 자료(최근 1년)에 있는 거래 중 최고 금액이에요. 역대 최고가가 아니에요. 직전까지 최고가는 가장 최근 거래 이전의 최고 금액이에요.</p>
  </div>`;
  sheet.hidden=false;
  sheet.querySelector(".x").onclick=closeApt;
  sheet.onclick=e=>{ if(e.target===sheet) closeApt(); };
  sheet.querySelectorAll("[data-area]").forEach(b=>b.onclick=()=>openApt(a,+b.dataset.area));
  sheet.querySelectorAll(".near button").forEach(b=>b.onclick=()=>{});
  if(S) drawChart($("#chart"), S.T);
  if(map&&q&&!sel){ map.setCenter(new kakao.maps.LatLng(q[0],q[1])); map.setLevel(3); }
}
function closeApt(){ $("#sheet").hidden=true; $("#sheet").innerHTML=""; }
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#sheet").hidden) closeApt(); });

/* ---------- 실거래 그래프 (한 면적 = 한 계열) ---------- */
function drawChart(box, T){
  const W=Math.max(300,Math.round(box.clientWidth||640)),H=W<500?220:260,L=48,R=12,Tp=14,B=28;
  const t0=dToX(T[0][0]), t1=dToX(T[T.length-1][0]);
  const xs=t1-t0||30;
  let lo=Math.min(...T.map(t=>t[1])), hi=Math.max(...T.map(t=>t[1]));
  const pad=Math.max((hi-lo)*.15, hi*.03); lo=Math.max(0,lo-pad); hi=hi+pad;
  const step=niceStep((hi-lo)/4); lo=Math.floor(lo/step)*step; hi=Math.ceil(hi/step)*step;
  const X=d=>L+(dToX(d)-t0+ (t1===t0?15:0))/xs*(W-L-R);
  const Y=v=>Tp+(1-(v-lo)/(hi-lo))*(H-Tp-B);
  const ticks=[]; for(let v=lo;v<=hi+1;v+=step) ticks.push(v);
  const months=[]; { const s=String(T[0][0]),e=String(T[T.length-1][0]); let y=+s.slice(0,4),m=+s.slice(4,6); const ye=+e.slice(0,4),me=+e.slice(4,6); while(y<ye||(y===ye&&m<=me)){ months.push(y*10000+m*100+1); m++; if(m>12){m=1;y++;} } }
  const every=Math.ceil(months.length/(W<500?4:6));
  const path=T.map((t,i)=>`${i?"L":"M"}${X(t[0]).toFixed(1)},${Y(t[1]).toFixed(1)}`).join("");
  const pol=(MM.policies||[]).filter(p=>{const n=+p.date.replace(/-/g,""); return n>=T[0][0]&&n<=T[T.length-1][0];});
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="실거래가 추이, ${T.length}건">
    ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6ebe8"/><text x="${L-8}" y="${Y(v)+4}" text-anchor="end" font-size="11" fill="#5b6a63" font-family="IBM Plex Mono,monospace">${wonShort(v)}</text>`).join("")}
    ${months.filter((m,i)=>i%every===0 && dToX(m)>=t0-1).map(m=>`<text x="${X(m)}" y="${H-9}" text-anchor="middle" font-size="11" fill="#5b6a63" font-family="IBM Plex Mono,monospace">${ym2(m)}</text>`).join("")}
    ${pol.map(p=>{const x=X(+p.date.replace(/-/g,""));return `<line x1="${x}" x2="${x}" y1="${Tp}" y2="${H-B}" stroke="${p.dir==="강화"?"#b3372e":p.dir==="완화"?"#2f5f9e":"#a5761a"}" stroke-dasharray="3 4" stroke-width="1.2" opacity=".75"><title>${p.date} ${p.title}</title></line>`}).join("")}
    <path d="${path}" fill="none" stroke="#1d5c47" stroke-width="2" stroke-linejoin="round" opacity=".55"/>
    ${T.map((t,i)=>`<circle cx="${X(t[0]).toFixed(1)}" cy="${Y(t[1]).toFixed(1)}" r="4.5" fill="#1d5c47" stroke="#fff" stroke-width="2" data-i="${i}"/>`).join("")}
    <rect x="${L}" y="${Tp}" width="${W-L-R}" height="${H-Tp-B}" fill="transparent" id="hit"/>
  </svg><div class="tip" hidden></div>${pol.length?`<div class="note" style="margin-top:6px">점선은 정부 대책 발표일이에요 (빨강 강화 · 파랑 완화 · 금색 공급·혼합).<br>${pol.map(p=>`${p.date.slice(2).replace(/-/g,".")} ${p.title}`).join("<br>")}</div>`:""}`;
  const svg=box.querySelector("svg"), tip=box.querySelector(".tip");
  const move=ev=>{ const r=svg.getBoundingClientRect(); const px=(ev.clientX-r.left)/r.width*W;
    let best=0,bd=1e9; T.forEach((t,i)=>{ const d=Math.abs(X(t[0])-px); if(d<bd){bd=d;best=i;} });
    const t=T[best]; tip.hidden=false; tip.innerHTML=`${ymd(t[0])}<br><b>${won(t[1])}</b> · ${t[3]}층`;
    tip.style.left=(X(t[0])/W*r.width)+"px"; tip.style.top=(Y(t[1])/H*r.height)+"px";
    svg.querySelectorAll("circle").forEach((c,i)=>c.setAttribute("r",i===best?7:4.5)); };
  svg.addEventListener("pointermove",move); svg.addEventListener("pointerdown",move);
  svg.addEventListener("pointerleave",()=>{ tip.hidden=true; svg.querySelectorAll("circle").forEach(c=>c.setAttribute("r",4.5)); });
}
function dToX(n){ const s=String(n); return Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8))/864e5; }
function niceStep(x){ const p=10**Math.floor(Math.log10(x)); const f=x/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; }

/* ---------- 검색 ---------- */
function placeSearch(q){ return new Promise(res=>{ if(!ps) return res([]); try{ ps.keywordSearch(q,(d,st)=>res(st===kakao.maps.services.Status.OK?d:[]),{size:8}); }catch(e){ res([]); } }); }
let searchSeq=0;
async function goPlace(p){
  const lat=+p.y, lng=+p.x;
  if(p.category_group_code==="SW8"){ const s=addExtra(p)||allStations().find(x=>x.name===extraName(p)); if(s){ selectStation(s); return; } }
  const s={name:p.place_name, lat, lng, lines:[], place:true};
  selectStation(s);
  if(/아파트|주거/.test(p.category_name||"")){
    const codes=new Set(await ensureNear([lat,lng], radius+800));
    const norm=v=>String(v).replace(/\(.*?\)|아파트|\d+단지|\s/g,"");
    const k=norm(p.place_name);
    const c=APTS.filter(a=>codes.has(a.c)&&norm(a.n).length>=2&&(norm(a.n)===k||k.includes(norm(a.n))||norm(a.n).includes(k)));
    const a=c.sort((x,y)=>(norm(y.n)===k)-(norm(x.n)===k)||norm(y.n).length-norm(x.n).length)[0];
    if(a){ if(!pos(a)) { geoCache[aptKey(a)]=[lat,lng]; saveGeo(); refresh(true); } openApt(a); }
  }
}
function onSearch(){
  const v=$("#q").value.trim().replace(/역$/,"");
  const box=$("#sugg");
  if(!v||!SUB){ box.hidden=true; return; }
  const sts=allStations().filter(s=>s.name.includes(v)).slice(0,6);
  const aps=APTS.filter(a=>a.n.includes(v)||(`${a.d} ${a.n}`).includes(v)).slice(0,8);
  const seq=++searchSeq;
  if(ps) placeSearch(v).then(pl=>{
    if(seq!==searchSeq||box.hidden) return;
    const extra=pl.filter(p=>!(p.category_group_code==="SW8"&&sts.some(s=>s.name===extraName(p)))).slice(0,6);
    const em=box.querySelector(".empty"); if(em&&extra.length) em.remove();
    if(!extra.length){ if(em) em.textContent="찾는 역이나 단지가 없어요"; return; }
    box.insertAdjacentHTML("beforeend", extra.map((p,i)=>`<button type="button" data-gp="${i}"><span class="pill">${p.category_group_code==="SW8"?"역":/아파트|주거/.test(p.category_name||"")?"단지":"장소"}</span>${esc(p.place_name)}<span class="k">${esc(p.address_name||"")}</span></button>`).join(""));
    box.querySelectorAll("[data-gp]").forEach(b=>b.onclick=()=>{ box.hidden=true; $("#q").value=""; goPlace(extra[+b.dataset.gp]); });
  });
  if(!sts.length&&!aps.length){ box.innerHTML=`<div class="empty" style="border:0">${ps?"전국에서 찾는 중…":"찾는 역이나 단지가 없어요"}</div>`; box.hidden=false; return; }
  box.innerHTML=sts.map(s=>`<button type="button" data-gs="${esc(s.name)}"><span class="pill" style="--lc:${stColor(s)}"><i></i>역</span>${esc(s.name)}역<span class="k">${s.lines.map(id=>lineById(id).name).join(", ")}</span></button>`).join("")
    +aps.map(a=>`<button type="button" data-ga="${APTS.indexOf(a)}"><span class="pill">단지</span>${esc(a.n)}<span class="k">${esc(a.g)} ${esc(a.d)}</span></button>`).join("");
  box.hidden=false;
  box.querySelectorAll("[data-gs]").forEach(b=>b.onclick=()=>{ box.hidden=true; $("#q").value=""; selectStation(allStations().find(s=>s.name===b.dataset.gs)); });
  box.querySelectorAll("[data-ga]").forEach(b=>b.onclick=async()=>{ box.hidden=true; $("#q").value=""; const a=APTS[+b.dataset.ga];
    if(!pos(a)&&ps){ geoCache[aptKey(a)]=await findApt(a,new kakao.maps.LatLng(37.5565,126.99)); saveGeo(); }
    const q=pos(a);
    if(q){ const near=allStations().slice().sort((x,y)=>dist(q,[x.lat,x.lng])-dist(q,[y.lat,y.lng]))[0];
      if(near){ const d=dist(q,[near.lat,near.lng]); if(d>radius) setRadius(d<=1000?1000:radius); selectStation(near,true); if(map){ map.setCenter(new kakao.maps.LatLng(q[0],q[1])); map.setLevel(4);} } }
    openApt(a); });
}
$("#q").addEventListener("input",onSearch);
$("#q").addEventListener("focus",onSearch);
$("#q").addEventListener("keydown",e=>{ if(e.key==="Enter"){ const f=$("#sugg button"); if(f) f.click(); } if(e.key==="Escape") $("#sugg").hidden=true; });
document.addEventListener("click",e=>{ if(!e.target.closest(".searchbar")) $("#sugg").hidden=true; });

/* ---------- 도구 ---------- */
function setRadius(r){ radius=r; document.querySelectorAll("[data-r]").forEach(b=>b.classList.toggle("on",+b.dataset.r===r)); }
document.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{ setRadius(+b.dataset.r); if(sel) selectStation(sel); });
$("#lineBtn").onclick=()=>{ $("#linePanel").hidden=!$("#linePanel").hidden; };
$("#linePanel").addEventListener("click",e=>{ const b=e.target.closest("[data-line]"); if(b) toggleLine(b.dataset.line); });
$("#seoulBtn").onclick=()=>{ if(map){ map.setLevel(8); map.setCenter(new kakao.maps.LatLng(37.5565,126.99)); } };
function exportGeo(){
  const out={}; for(const k in geoCache) if(geoCache[k]) out[k]=geoCache[k];
  const blob=new Blob([JSON.stringify(out)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="geo.json"; a.click();
}
$("#geoExport").onclick=exportGeo;
function showMsg(t){ const m=$("#mapMsg"); m.textContent=t; m.hidden=false; }
function hideMsg(){ $("#mapMsg").hidden=true; }

dataReady.then(()=>renderPanel());
renderPanel();
MM.data={ready:dataReady, get apts(){return APTS}, get subway(){return SUB}, get asOf(){return ASOF}, pos, dist, summary, areas, won, wonShort, ymd,
  loadRegion, codeAt, findPlace:q=>placeSearch(q), nearest:(p,n=3)=>allStations().map(s=>({s,d:dist(p,[s.lat,s.lng])})).sort((x,y)=>x.d-y.d).slice(0,n), lineName:id=>lineById(id).name};
MM.relayout=()=>{ if(map){ map.relayout(); if(sel) map.setCenter(new kakao.maps.LatLng(sel.lat,sel.lng)); } };
MM._test={get state(){return {sel,radius,geoState}},selectStation:n=>selectStation(SUB.stations.find(s=>s.name===n)),openApt:n=>openApt(APTS.find(a=>a.n===n))};
})();
