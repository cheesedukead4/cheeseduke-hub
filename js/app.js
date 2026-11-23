/*
 * 倉儲 IT 整合中心｜全部畫面
 * ---------------------------------------------------------------
 * 頁面：入口（首頁）、總覽、行事曆、專案、進度看板、工程師討論（有委外專案才顯示）、操作指南、管理（人員與權限、備份，只有管理員）。
 *       網址 #portal #overview #calendar #projects #board #vendor #guide #users。
 * 資料（WIStore，見 cloud-store.js），每一筆都有 id：
 *   projects  { id, code, name, category: wh|it|gn, status: plan|active|hold|done, priority: high|mid|low,
 *               start, end (YYYY-MM-DD), owner, folder, url (系統網址，入口頁用), desc, progress (0-100，沒有任務時才用), createdAt, updatedAt, updatedBy }
 *             沒填 url 時，用說明裡的「App：網址」或「入口網址：網址」。
 *             vendor＝委外工程師負責：留言由 Claude 整理成給工程師的討論重點（brief），不直接修改；有「工程師討論清單」可列印／複製。
 *   links     入口頁的常用連結（不是專案的系統，例如夥伴交接看板）{ id, title, url, category: wh|it|gn, note }
 *   guides    「操作指南」頁的各系統操作說明書，一章一筆 { id, order, title, md (Markdown), docTitle, importedAt, importedBy }
 *             管理員按「匯入說明書」，選從 Claude 文件匯出的 Markdown（每個「## 標題」是一章），整份取代。存在雲端，登入才看得到。
 *   tasks     { id, title, projectId, status: todo|doing|review|done, priority, due, assignee, note, progress (0-100，任務自己的執行進度), doneAt, ... }
 *   events    { id, title, type: inbound|outbound|inventory|it|meeting|other, date, start, end (HH:MM), projectId, location, note, ... }
 *   requests  給 Claude 的留言 { id, projectId, taskId?, taskTitle?, text, status: open|review|approved|done|closed, replies: [{ id, by, text, at }], createdAt, createdBy }
 *             有 taskId 的是針對某個任務的留言（在任務視窗下方留言），專案詳情也會列出並標「任務：…」。
 *             open 待處理 → Claude 改好、給 demo 後回覆並改成 review 待你確認 → 你按「核准上線」改成 approved → Claude 上線後改成 done。
 *             Claude 端：「倉儲 IT 整合中心」的 Claude 對話每 30 秒檢查一次（開發工具/claude-hub.mjs watch），直接轉給那個專案的 Claude 對話，
 *             用雲端後端的 autoReply 回覆；轉送沒在運作時，打開專案資料夾的 hook 也會讀到留言。
 * 專案的資料夾（folder，或說明裡的「資料夾：路徑」）用來對應 Claude 打開的資料夾。
 * 任務進度＝任務自己的 progress（已完成一律 100%）；專案進度＝所有任務進度的平均；沒有任務時用專案的 progress。
 * 權限：WIAuth.can('edit') 可以新增、修改、刪除；管理員全部都有。這是畫面權限，雲端後端只擋「不在名單的人」。
 */
(function(){
'use strict';

/* ================= constants ================= */
const WD=['日','一','二','三','四','五','六'];
const VIEWS=['portal','overview','calendar','projects','board','vendor','guide','users'];
const COLL={event:'events',task:'tasks',project:'projects',link:'links'};
const CAT={wh:'倉儲',it:'IT',gn:'綜合'};
const PSTATUS={plan:['規劃中',''],active:['進行中','info'],hold:['暫停','warn'],done:['已完成','ok']};
const PORDER={active:0,plan:1,hold:2,done:3};
const TSTATUS=[['todo','待辦'],['doing','進行中'],['review','待驗收'],['done','已完成']];
const TLABEL=Object.fromEntries(TSTATUS);
const PRIO={high:'高',mid:'中',low:'低'};
const PRANK={high:0,mid:1,low:2};
const ETYPE={inbound:['進貨','wh'],outbound:['出貨','wh'],inventory:['盤點','wh'],it:['IT 維運','it'],meeting:['會議','gn'],other:['其他','gn']};
const REQ={open:['待處理','info'],review:['待你確認','warn'],approved:['已核准上線','ok'],done:['已上線','ok'],closed:['已取消','']};
const PERMS=[{id:'edit',label:'新增與修改',desc:'可以新增、修改、刪除專案、任務與行程；沒勾的人只能查看'}];
const PERM_LABEL=Object.fromEntries(PERMS.map(p=>[p.id,p.label]));
const LS_PREF='wi_prefs';
const BACKUP_APP='wi-hub';

/* ================= helpers ================= */
const $=(s,el=document)=>el.querySelector(s);
const E=o=>Object.entries(o||{});
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ds=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const pd=s=>{if(!s||typeof s!=='string')return null;const a=s.split('-').map(Number);if(!a[0]||!a[1]||!a[2])return null;return new Date(a[0],a[1]-1,a[2]);};
const TODAY=()=>ds(new Date());
const dayDiff=(a,b)=>Math.round((pd(b)-pd(a))/86400000);
const addDays=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return ds(d);};
const mdw=s=>{const d=pd(s);return d?`${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`:'';};
const fmtD=s=>{const d=pd(s);if(!d)return '—';return (d.getFullYear()!==new Date().getFullYear()?d.getFullYear()+'/':'')+(d.getMonth()+1)+'/'+d.getDate();};
const nowHM=()=>{const d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes());};
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y0=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y0)/86400000+1)/7);}
function rel(s){const n=dayDiff(TODAY(),s);if(n===0)return '今天';if(n===1)return '明天';if(n===-1)return '昨天';return n>0?`${n} 天後`:`${-n} 天前`;}

/* ================= login & store ================= */
const AU=window.WIAuth, ST=window.WIStore;
const isAdmin=()=>!!(AU&&AU.isAdmin());
const canEdit=()=>!!(AU&&AU.can('edit'));
const myName=()=>(AU&&AU.name())||'';

/* ================= state ================= */
const S={
  projects:{},tasks:{},events:{},requests:{},links:{},guides:{},
  guideCh:'',guideQ:'',guideLastQ:'',
  view:'portal',cat:'all',
  calMonth:TODAY().slice(0,7),selDay:TODAY(),
  boardProject:'all',projStatus:'all',showAllDone:false,vlFilter:'open',
  openProject:null,loaded:false
};
Object.defineProperty(S,'canWrite',{get:canEdit});
try{const p=JSON.parse(localStorage.getItem(LS_PREF)||'{}');if(['all','wh','it'].includes(p.cat))S.cat=p.cat;}catch(e){}
const savePref=()=>{try{localStorage.setItem(LS_PREF,JSON.stringify({cat:S.cat}));}catch(e){}};
const LS_GUIDE='wi_guide_ch';   // 操作指南上次看的章（只記在這台裝置）
try{S.guideCh=localStorage.getItem(LS_GUIDE)||'';}catch(e){}

const P=id=>id?S.projects[id]:null;
const catP=p=>p&&CAT[p.category]?p.category:'gn';
const catT=t=>{const p=P(t.projectId);return p?catP(p):'gn';};
const catE=e=>{const p=P(e.projectId);return p?catP(p):(ETYPE[e.type]?ETYPE[e.type][1]:'gn');};
const inCat=c=>S.cat==='all'||S.cat===c;

function pullFromStore(){
  const m=kind=>{const o={};for(const r of ST.list(kind))if(r&&r.id!=null)o[r.id]=r;return o;};
  S.projects=m('projects');S.tasks=m('tasks');S.events=m('events');S.requests=m('requests');S.links=m('links');S.guides=m('guides');
}
async function put(coll,id,data){
  if(!canEdit()){toast('你目前只有檢視權限，無法修改資料');return false;}
  try{
    const rec=Object.assign({},data,{id,updatedBy:myName()});
    if(!rec.createdBy)rec.createdBy=myName();
    ST.save(coll,rec);return true;
  }catch(e){toast('儲存失敗：'+e.message);return false;}
}
async function drop(coll,id){
  if(!canEdit()){toast('你目前只有檢視權限，無法修改資料');return false;}
  try{ST.remove(coll,id);return true;}catch(e){toast('刪除失敗：'+e.message);return false;}
}

/* ================= derived ================= */
// 任務自己的執行進度：已完成一律 100%，其他用任務的 progress
const tpct=t=>t.status==='done'?100:Math.max(0,Math.min(100,Math.round(+t.progress||0)));
function prog(id){
  const p=P(id);const ts=Object.values(S.tasks).filter(t=>t.projectId===id);
  const done=ts.filter(t=>t.status==='done').length;
  const pct=ts.length?Math.round(ts.reduce((s,t)=>s+tpct(t),0)/ts.length):(p.status==='done'?100:Math.max(0,Math.min(100,Math.round(+p.progress||0))));
  let tpos=null;const s=pd(p.start),e=pd(p.end),now=pd(TODAY());
  if(s&&e&&e>s)tpos=Math.max(0,Math.min(100,Math.round((now-s)/(e-s)*100)));
  let health=null;
  if(p.status==='done')health=['ok','已完成'];
  else if(p.status==='hold')health=['warn','暫停中'];
  else if(p.end&&p.end<TODAY())health=['bad','已逾期'];
  else if(p.status==='active'&&tpos!==null&&pct+15<tpos)health=['warn','進度落後'];
  else if(p.status==='active')health=['ok','進度正常'];
  else health=['','尚未開始'];
  return {pct,done,total:ts.length,tpos,health};
}
function endLabel(p){
  if(!p.end)return '未設截止日';
  if(p.status==='done')return fmtD(p.end)+' 截止';
  const n=dayDiff(TODAY(),p.end);
  return n<0?`逾期 ${-n} 天`:n===0?'今天截止':`剩 ${n} 天`;
}
function dueInfo(t){
  if(!t.due)return null;
  if(t.status==='done')return ['',fmtD(t.due)];
  const n=dayDiff(TODAY(),t.due);
  if(n<0)return ['bad',`逾期 ${-n} 天`];
  if(n===0)return ['warn','今天到期'];
  if(n<=2)return ['warn',n===1?'明天到期':`${n} 天後到期`];
  return ['',fmtD(t.due)+' 到期'];
}
function dayIndex(){
  const idx={};const g=k=>idx[k]||(idx[k]={ev:[],ts:[],ps:[]});
  for(const x of E(S.events))if(x[1].date&&inCat(catE(x[1])))g(x[1].date).ev.push(x);
  for(const x of E(S.tasks))if(x[1].due&&inCat(catT(x[1])))g(x[1].due).ts.push(x);
  for(const x of E(S.projects))if(x[1].end&&x[1].status!=='done'&&inCat(catP(x[1])))g(x[1].end).ps.push(x);
  for(const k in idx){
    idx[k].ev.sort((a,b)=>(a[1].start||'').localeCompare(b[1].start||''));
    idx[k].ts.sort((a,b)=>(a[1].status==='done')-(b[1].status==='done'));
  }
  return idx;
}
function nextCode(cat){
  const pre={wh:'WH',it:'IT',gn:'GN'}[cat]||'GN';let max=0;
  for(const p of Object.values(S.projects)){const m=/^([A-Z]+)-(\d+)$/.exec(p.code||'');if(m&&m[1]===pre)max=Math.max(max,+m[2]);}
  return `${pre}-${String(max+1).padStart(3,'0')}`;
}

/* ================= small renderers ================= */
const codeTag=p=>p?`<span class="code c-${catP(p)}">${esc(p.code||'—')}</span>`:'';
const smp=o=>o&&o.sample?'<span class="smp">範例</span>':'';
const barHTML=(cat,pct,tpos)=>`<div class="bar c-${cat}" role="img" aria-label="完成 ${pct}%${tpos!==null?`，時程已過 ${tpos}%`:''}"><i style="width:${pct}%"></i>${tpos!==null?`<b style="left:${tpos}%" title="依時程，今天應該到達的位置"></b>`:''}</div>`;
// 任務的小進度條（可以放在按鈕裡，所以用 span）
const miniBar=(cat,pct)=>`<span class="tbar c-${cat}" role="img" aria-label="執行進度 ${pct}%"><i style="width:${pct}%"></i></span>`;
const statusPill=p=>{const s=PSTATUS[p.status]||PSTATUS.plan;return `<span class="pill ${s[1]}">${s[0]}</span>`;};
const ckBtn=(id,t)=>`<button type="button" class="ck w-only" data-act="toggle" data-id="${esc(id)}" aria-pressed="${t.status==='done'}" aria-label="${t.status==='done'?'標記為未完成':'標記為完成'}：${esc(t.title)}"></button>`;
function evMeta(e){
  const p=P(e.projectId);const bits=[ETYPE[e.type]?ETYPE[e.type][0]:'其他'];
  if(p)bits.push(esc(p.code));if(e.location)bits.push(esc(e.location));
  return bits.join(' · ');
}
function taskMeta(t){
  const p=P(t.projectId);const bits=[];
  if(p)bits.push(esc(p.code)+' '+esc(p.name));
  if(t.assignee)bits.push(esc(t.assignee));
  bits.push(TLABEL[t.status]||'待辦');
  return bits.join(' · ');
}

function projFolder(p){if(!p)return '';if(p.folder)return String(p.folder);const m=/資料夾：([^\n]+)/.exec(p.desc||'');return m?m[1].trim():'';}
// 系統網址：只接受 http(s)，避免 javascript: 之類的連結
const okUrl=u=>/^https?:\/\/[^\s<>"'`]+$/i.test(String(u||'').trim());
function projUrl(p){
  if(!p)return '';
  if(p.url&&okUrl(p.url))return String(p.url).trim();
  const m=/(?:App|入口網址|網址)：\s*(\S+)/.exec(p.desc||'');
  return m&&okUrl(m[1])?m[1]:'';
}
const isSelf=u=>{try{const x=new URL(u,location.href),q=s=>s.replace(/index\.html$/,'');return x.origin===location.origin&&q(x.pathname)===q(location.pathname);}catch(e){return false;}};
const siteOf=u=>{try{const x=new URL(u),path=x.pathname.replace(/\/$/,'');
  if(x.hostname==='script.google.com')return 'Google Apps Script';
  if(/\.github\.io$/.test(x.hostname))return 'GitHub · '+(path.slice(1)||x.hostname);
  return x.hostname+path;}catch(e){return u;}};
// 說明的第一行（跳過「App：」「資料夾：」這類設定行）
const descLine=p=>{for(const l of String(p.desc||'').split('\n')){const t=l.trim();if(t&&!/^(App|資料夾|入口網址|網址)：/.test(t))return t;}return '';};
const whenTxt=iso=>iso?new Date(iso).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
// 留言清單只顯示還沒完成的；已完成（已上線／已討論）預設收起來，按「顯示已完成的 N 則留言」才列出；已取消一律不顯示
const byNewest=(a,b)=>(b[1].createdAt||'').localeCompare(a[1].createdAt||'');
const liveReqs=pid=>E(S.requests).filter(x=>x[1].projectId===pid&&x[1].status!=='closed'&&x[1].status!=='done').sort(byNewest);
const doneReqsOfProject=pid=>E(S.requests).filter(x=>x[1].projectId===pid&&x[1].status==='done').sort(byNewest);
const doneReqsOfTask=tid=>E(S.requests).filter(x=>x[1].taskId===tid&&x[1].status==='done').sort(byNewest);
const SHOW_DONE=new Set();   // 這次開著網站時，哪些留言區有打開「已完成」（p:專案 id、t:任務 id）
function doneReqsHTML(key,list,showTask){
  if(!list.length)return '';
  const open=SHOW_DONE.has(key);
  return `<button type="button" class="linkbtn rq-done-toggle" data-act="req-done-toggle" data-key="${esc(key)}" aria-expanded="${open}">${open?'收起已完成的留言':`顯示已完成的 ${list.length} 則留言`}</button>${open?`<div class="rq-done-list">${list.map(x=>reqHTML(x,showTask)).join('')}</div>`:''}`;
}
// 留言回覆的 demo 截圖：登入後向雲端讀（reqImg），讀過的留在記憶體
const IMGS={},imgLoading=new Set();
const imgTag=im=>`<button type="button" class="rq-img" data-act="req-img" data-id="${esc(im.id)}" aria-label="放大截圖 ${esc(im.name||'')}"><img data-img="${esc(im.id)}" alt="${esc(im.name||'demo 截圖')}"${IMGS[im.id]?` src="${IMGS[im.id]}"`:''}></button>`;
function loadImgs(){
  document.querySelectorAll('img[data-img]:not([src])').forEach(el=>{
    const id=el.dataset.img;
    if(IMGS[id]){el.src=IMGS[id];return;}
    if(imgLoading.has(id)||!AU||!AU.user())return;
    imgLoading.add(id);
    AU.api('reqImg',{id}).then(j=>{IMGS[id]='data:'+j.mime+';base64,'+j.data;document.querySelectorAll('img[data-img="'+id+'"]').forEach(x=>{x.src=IMGS[id];});})
      .catch(()=>{document.querySelectorAll('img[data-img="'+id+'"]').forEach(x=>{x.alt='截圖讀取失敗，請按右上角同步後再試';});})
      .finally(()=>imgLoading.delete(id));
  });
}
function openImg(id){
  if(!IMGS[id])return;
  M={kind:'img',id,opener:document.activeElement};
  $('#sheet').classList.add('wide');
  $('#sheet').innerHTML=`<h2 id="m-title">demo 截圖</h2><img class="rq-big" src="${IMGS[id]}" alt="demo 截圖"><div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">關閉</button></div>`;
  $('#modal').hidden=false;lockScroll();
}
// 留言是針對哪個任務（任務被改名時用目前的名稱）
const reqTask=r=>r.taskId?((S.tasks[r.taskId]||{}).title||r.taskTitle||'（任務已刪除）'):'';
const taskReqs=tid=>E(S.requests).filter(x=>x[1].taskId===tid&&x[1].status!=='closed'&&x[1].status!=='done').sort(byNewest);
// 委外工程師負責的專案（vendor）：留言由 Claude 整理成「給工程師的討論重點」，不直接修改
const VREQ={open:['待整理','info'],review:['已整理，待你確認','warn'],approved:['待跟工程師討論','ok'],done:['已討論','ok'],closed:['已取消','']};
const isVendorReq=r=>!!(r.vendor||(P(r.projectId)||{}).vendor);
const reqLabel=r=>(isVendorReq(r)?VREQ:REQ)[r.status]||REQ.open;
const imgsHTML=list=>list&&list.length?`<div class="rq-imgs">${list.map(imgTag).join('')}</div>`:'';
// showTask：在專案詳情裡標出「任務：…」；在任務自己的視窗裡不用標
function reqHTML([id,r],showTask){
  const st=reqLabel(r),vend=isVendorReq(r);
  const tk=showTask===true&&r.taskId?`<span class="rq-task">任務：${esc(reqTask(r))}</span>`:'';
  const replies=(r.replies||[]).map(c=>`<div class="rq-reply${c.by==='Claude'?' ai':''}"><div class="rq-who"><b>${esc(c.by||'')}</b> <span class="muted">${whenTxt(c.at)}</span></div>${c.text?`<p>${esc(c.text)}</p>`:''}${imgsHTML(c.images)}</div>`).join('');
  const brief=r.brief?`<div class="rq-brief"><div class="rq-brief-h"><b>給工程師的討論重點</b><span class="muted">Claude 整理 · ${whenTxt(r.briefAt)}</span></div><p>${esc(r.brief)}</p></div>`:'';
  let acts='';
  if(r.status==='review')acts=`<button type="button" class="btn primary" data-act="req-approve" data-id="${esc(id)}">${vend?'確認，列入討論清單':'核准上線'}</button><button type="button" class="btn" data-act="req-revise" data-id="${esc(id)}">還要修改</button>`;
  else if(r.status==='open')acts=`<button type="button" class="btn ghost" data-act="req-cancel" data-id="${esc(id)}">取消留言</button>`;
  else if(vend&&r.status==='approved')acts=`<button type="button" class="btn primary" data-act="req-discussed" data-id="${esc(id)}">已跟工程師討論</button><button type="button" class="btn" data-act="req-revise" data-id="${esc(id)}">還要修改</button>`;
  // 還沒有 Claude 的回覆：顯示等待中（轉送收到後會先回覆「已交給 Claude 的…處理」）
  const rs=r.replies||[],lastBy=rs.length?rs[rs.length-1].by:'';
  let wait='';
  if(r.status==='open'&&lastBy!=='Claude')wait=vend?'等待 Claude 整理成給工程師的討論重點…（通常幾分鐘內）':'等待 Claude 收到…（通常 1 分鐘內會在這裡回覆）';
  else if(r.status==='approved'&&!vend&&lastBy!=='Claude')wait='已核准，等待 Claude 收到後上線…';
  return `<div class="rq"><div class="rq-h"><span class="pill ${st[1]}">${st[0]}</span>${tk}<span class="muted">${esc(r.createdBy||'')} · ${whenTxt(r.createdAt)}</span></div>${r.text?`<p class="rq-t">${esc(r.text)}</p>`:''}${imgsHTML(r.images)}${brief}${replies}${wait?`<p class="muted rq-wait">${wait}</p>`:''}${acts?`<div class="rq-a w-only">${acts}</div>`:''}</div>`;
}

/* ---------- Demo 做好、等你確認（留言狀態 review）：進度條亮紅色提醒 ---------- */
const reviewReqs=list=>list.filter(x=>x[1].status==='review');
const reviewOfTask=tid=>reviewReqs(taskReqs(tid));
const reviewOfProject=pid=>reviewReqs(liveReqs(pid));
const reviewLabel=list=>list.length&&list.every(x=>isVendorReq(x[1]))?`${list.length} 則已整理，待你確認`:`${list.length} 個 Demo 待你確認`;
const alertPill=list=>list.length?`<span class="pill bad blink">${reviewLabel(list)}</span>`:'';

/* ---------- 留言的圖片：選檔或貼上截圖 → 縮小 → 上傳（imgUp）→ 送出時寫進留言 ---------- */
const PEND={},UPING={};   // 留言框 key（p:專案 id、t:任務 id、r:留言 id）→ 已上傳、還沒送出的圖片／上傳中張數
const IMG_LIMIT=4;
const pendOf=k=>PEND[k]||(PEND[k]=[]);
function pendHTML(k){
  const l=pendOf(k),n=UPING[k]||0;
  return l.map(im=>`<span class="pend-img"><img src="${IMGS[im.id]||''}" alt="${esc(im.name)}"><button type="button" data-act="img-remove" data-key="${esc(k)}" data-id="${esc(im.id)}" aria-label="移除圖片 ${esc(im.name)}">✕</button></span>`).join('')+(n?`<span class="pend-up">上傳中 ${n} 張…</span>`:'');
}
function refreshPend(k){document.querySelectorAll('.rq-new').forEach(el=>{if(el.dataset.key===k){const p=el.querySelector('.rq-pend');if(p)p.innerHTML=pendHTML(k);}});}
// 留言框（textarea＋圖片＋送出），任務視窗、專案詳情、還要修改共用
function composerHTML(k,taId,placeholder,sendBtn){
  return `<div class="rq-new w-only" data-key="${esc(k)}"><textarea id="${taId}" maxlength="2000" placeholder="${esc(placeholder)}"></textarea>
    <div class="rq-pend">${pendHTML(k)}</div>
    <div class="rq-tools"><button type="button" class="btn" data-act="img-pick" data-key="${esc(k)}">＋ 加入圖片</button><span class="muted">也可以直接在留言框貼上截圖（Ctrl+V），最多 ${IMG_LIMIT} 張</span><span class="sp"></span>${sendBtn||''}</div></div>`;
}
// 縮小成最長邊 1600px 的 JPEG（手機照片、截圖都在 2MB 以內）
function shrinkImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file),img=new Image();
    img.onload=()=>{
      try{
        let max=1600,q=0.85,out='';
        for(let i=0;i<4;i++){
          const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
          const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*s));c.height=Math.max(1,Math.round(img.naturalHeight*s));
          const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);
          out=c.toDataURL('image/jpeg',q);
          if(out.length<2600000)break;
          max=Math.round(max*0.75);q=0.75;
        }
        URL.revokeObjectURL(url);resolve(out);
      }catch(e){URL.revokeObjectURL(url);reject(e);}
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('讀不到這張圖片'));};
    img.src=url;
  });
}
async function addImages(k,files){
  const list=[...(files||[])].filter(f=>f&&/^image\//.test(f.type));
  if(!list.length)return;
  if(!canEdit()){toast('需要「新增與修改」權限才能加入圖片');return;}
  for(const f of list){
    if(pendOf(k).length+(UPING[k]||0)>=IMG_LIMIT){toast(`一則留言最多 ${IMG_LIMIT} 張圖片`);break;}
    UPING[k]=(UPING[k]||0)+1;refreshPend(k);
    try{
      const url=await shrinkImage(f);
      const name=(f.name&&f.name!=='image.png'?f.name.replace(/\.[^.]+$/,''):'截圖-'+nowHM().replace(':',''))+'.jpg';
      const j=await AU.api('imgUp',{image:{mime:'image/jpeg',name,data:url.split(',')[1]}});
      if(!j||!j.ok||!j.image)throw new Error((j&&j.message)||'上傳失敗');
      IMGS[j.image.id]=url;pendOf(k).push({id:j.image.id,name:j.image.name});
    }catch(e){toast('圖片上傳失敗：'+(e.message||e));}
    UPING[k]=Math.max(0,(UPING[k]||0)-1);refreshPend(k);
  }
}
// 送出時取出這個留言框的圖片；還在上傳就先不送
function takePend(k){
  if(UPING[k]){toast('圖片還在上傳，請稍等一下再送出');return null;}
  const l=pendOf(k).map(im=>({id:im.id,name:im.name}));PEND[k]=[];return l;
}

// 任務視窗下方：這個任務給 Claude 的留言
const taskReqList=tid=>{const l=taskReqs(tid),d=doneReqsOfTask(tid);return (l.length?l.map(x=>reqHTML(x,false)).join(''):`<p class="muted" style="font-size:12.5px">${d.length?'這個任務沒有進行中的留言。':'這個任務還沒有留言。'}</p>`)+doneReqsHTML('t:'+tid,d,false);};
const VENDOR_HINT='這個專案是委外工程師負責：Claude 會把留言和圖片整理成「給工程師的討論重點」（不會直接修改系統），你確認後列入「工程師討論清單」，可以列印或複製給工程師。';
function taskReqSection(tid){
  const t=S.tasks[tid]||{},vend=!!(P(t.projectId)||{}).vendor;
  return `<section class="t-rq" aria-label="這個任務的留言">
    <h3>${vend?'跟委外工程師討論的事項（這個任務）':'給 Claude 的留言（這個任務）'}</h3>
    <p class="muted rq-hint">${vend?VENDOR_HINT:'只針對這個任務。送出後會直接交給 Claude 處理，不用打開專案；Claude 收到後會在這裡回覆，改好會先附 demo 截圖，你按「核准上線」才會上線。'}</p>
    <div id="t-rq-list">${taskReqList(tid)}</div>
    ${composerHTML('t:'+tid,'trq-text',vend?'例如：倉管駕駛艙的出貨數和實際不一樣（附截圖）':'例如：這一頁的表格加上日期篩選',`<button type="button" class="btn primary" data-act="req-send-task" data-id="${esc(tid)}">送出留言</button>`)}
  </section>`;
}

/* ================= views ================= */
function loadingHTML(){
  const st=ST.status();
  const msg=(st.state==='offline'||st.state==='error')&&st.detail?st.detail:'正在讀取雲端的專案、任務與行程…';
  return `<div class="loading">${st.state==='error'||st.state==='offline'?'':'<div class="spin" aria-hidden="true"></div>'}<p>${esc(msg)}</p>${st.state==='error'?'<button type="button" class="btn" data-act="sync">重試</button>':''}</div>`;
}
function statusBanner(){
  const st=ST.status(),b=[];
  if(st.state==='error')b.push(`<div class="banner bad"><p>${esc(st.detail||'無法連線到雲端')}</p><button class="btn" type="button" data-act="sync">重試</button></div>`);
  else if(st.state==='offline')b.push(`<div class="banner warn"><p>${esc(st.detail||'目前離線')}。修改會先存在這台裝置，恢復網路後自動上傳。</p></div>`);
  if(AU&&AU.user()&&!canEdit())b.push('<div class="banner"><p>你目前只能查看資料。需要新增或修改專案、任務、行程的話，請找管理員開權限。</p></div>');
  return b.join('');
}
/* ---------- 入口：所有系統的連結（首頁） ---------- */
function vPortal(){
  const ps=E(S.projects).filter(x=>inCat(catP(x[1]))).sort((a,b)=>(a[1].code||'').localeCompare(b[1].code||''));
  const withUrl=ps.filter(x=>projUrl(x[1])&&!isSelf(projUrl(x[1])));
  const noUrl=ps.filter(x=>!projUrl(x[1]));
  const lcat=l=>CAT[l.category]?l.category:'gn';
  const links=E(S.links).filter(x=>okUrl(x[1].url)&&inCat(lcat(x[1]))).sort((a,b)=>(a[1].title||'').localeCompare(b[1].title||'','zh-Hant'));
  const ext=u=>`href="${esc(u)}" target="_blank" rel="noopener"`;
  const gBtn=name=>{const g=guideFor(name);return g?`<button type="button" class="linkbtn" data-act="g-open" data-id="${esc(g.id)}">操作說明</button>`:'';};
  const goLine=u=>`<span class="pt-go"><span class="pt-site">${esc(siteOf(u))}</span><span class="pt-arrow" aria-hidden="true">開啟 ↗</span></span>`;
  const pTiles=withUrl.map(([id,p])=>{
    const c=catP(p),u=projUrl(p),n=reviewOfProject(id).length,dl=descLine(p);
    return `<article class="ptile c-${c}${n?' has-alert':''}">
      <a class="pt-main" ${ext(u)} aria-label="在新分頁開啟 ${esc(p.code||'')} ${esc(p.name)}">
        <span class="pt-top">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${p.status!=='active'?statusPill(p):''}</span>
        <b class="pt-name">${esc(p.name)}</b>
        ${dl?`<span class="pt-desc">${esc(dl)}</span>`:''}
        ${goLine(u)}
      </a>
      <div class="pt-foot"><button type="button" class="linkbtn" data-act="open-project" data-id="${esc(id)}">專案詳情</button>${gBtn(p.name)}${alertPill(reviewOfProject(id))}</div>
    </article>`;
  }).join('');
  const lTiles=links.map(([id,l])=>{
    const c=lcat(l);
    return `<article class="ptile c-${c}">
      <a class="pt-main" ${ext(l.url)} aria-label="在新分頁開啟 ${esc(l.title)}">
        <span class="pt-top"><span class="tag c-${c}">${CAT[c]}</span><span class="pt-kind">常用連結</span></span>
        <b class="pt-name">${esc(l.title)}</b>
        ${l.note?`<span class="pt-desc">${esc(l.note)}</span>`:''}
        ${goLine(l.url)}
      </a>
      <div class="pt-foot${gBtn(l.title)?'':' w-only'}">${gBtn(l.title)}<button type="button" class="linkbtn w-only" data-act="edit" data-kind="link" data-id="${esc(id)}">編輯連結</button></div>
    </article>`;
  }).join('');
  const sec=(t,sub,body)=>`<section class="psec" aria-label="${t}"><div class="psec-h"><h2>${t}</h2>${sub?`<span class="muted">${sub}</span>`:''}</div>${body}</section>`;
  const head=`<section class="vhead"><div><p class="eyebrow">系統入口</p><h1>所有系統，一鍵進入<small>${withUrl.length+links.length} 個系統</small></h1></div><div class="vtools w-only"><button type="button" class="btn primary" data-act="new" data-kind="link">＋ 新增連結</button></div></section>`;
  let out=head+statusBanner();
  out+=sec('專案系統','在新分頁開啟',withUrl.length?`<div class="ptiles">${pTiles}</div>`:`<div class="panel"><p class="empty">還沒有設定網址的專案。到專案按「編輯專案」填上「系統網址」，就會出現在這裡。</p></div>`);
  out+=sec('常用連結','不是專案、但常用的系統',links.length?`<div class="ptiles">${lTiles}</div>`:`<div class="panel"><p class="empty">還沒有常用連結。${S.canWrite?'按「＋ 新增連結」加入，例如夥伴交接看板、共用試算表。':''}</p></div>`);
  if(noUrl.length)out+=sec('尚未設定網址',`${noUrl.length} 個專案`,`<div class="panel nurl-list">${noUrl.map(([id,p])=>`<div class="nurl"><button type="button" class="amain c-${catP(p)}" data-act="open-project" data-id="${esc(id)}"><b>${esc(p.code||'')} ${esc(p.name)}</b><small>${esc(descLine(p)||'沒有說明')}</small></button><button type="button" class="btn w-only" data-act="edit" data-kind="project" data-id="${esc(id)}">設定網址</button></div>`).join('')}</div>`);
  return out;
}

function vOverview(){
  const t=TODAY(),d=new Date();
  const head=`<section class="vhead"><div><p class="eyebrow">第 ${isoWeek(d)} 週 · ${d.getFullYear()}</p><h1>${d.getMonth()+1}月${d.getDate()}日 星期${WD[d.getDay()]}</h1></div></section>`;
  const total=Object.keys(S.projects).length+Object.keys(S.tasks).length+Object.keys(S.events).length;
  if(!total)return head+statusBanner()+welcomeHTML();
  const projects=E(S.projects).filter(x=>inCat(catP(x[1])));
  const activeP=projects.filter(x=>x[1].status==='active');
  const tasks=E(S.tasks).filter(x=>inCat(catT(x[1])));
  const open=tasks.filter(x=>x[1].status!=='done');
  const overdue=open.filter(x=>x[1].due&&x[1].due<t).sort((a,b)=>a[1].due.localeCompare(b[1].due));
  const wkEnd=addDays(t,6);
  const dueWeek=open.filter(x=>x[1].due&&x[1].due>=t&&x[1].due<=wkEnd);
  const evToday=E(S.events).filter(x=>x[1].date===t&&inCat(catE(x[1]))).sort((a,b)=>(a[1].start||'').localeCompare(b[1].start||''));
  const nowT=nowHM();const nextEv=evToday.find(x=>x[1].start&&x[1].start>=nowT);
  const kpis=`<section class="kpis" aria-label="今日摘要">
    <div class="kpi"><span class="kl">進行中專案</span><b class="kn">${activeP.length}</b><span class="ks">共 ${projects.length} 個專案</span></div>
    <div class="kpi"><span class="kl">未完成任務</span><b class="kn">${open.length}</b><span class="ks">7 天內到期 ${dueWeek.length} 筆</span></div>
    <div class="kpi"><span class="kl">今日行程</span><b class="kn">${evToday.length}</b><span class="ks">${nextEv?`下一個 ${esc(nextEv[1].start)} ${esc(nextEv[1].title)}`:(evToday.length?'今天的行程都已開始':'今天沒有排行程')}</span></div>
    <div class="kpi${overdue.length?' alert':''}"><span class="kl">逾期任務</span><b class="kn">${overdue.length}</b><span class="ks">${overdue.length?'需要優先處理':'目前沒有逾期'}</span></div>
  </section>`;
  const idx=dayIndex();let ag='';
  for(let i=0;i<7;i++){
    const k=addDays(t,i);const it=idx[k];if(!it||(!it.ev.length&&!it.ts.length))continue;
    ag+=`<div class="aday"><h4>${mdw(k)} <span class="${i===0?'now':''}">${rel(k)}</span></h4>`+
      it.ev.map(([id,e])=>`<div class="arow"><span class="atime">${e.start?esc(e.start):'全天'}</span><button type="button" class="amain c-${catE(e)}" data-act="edit" data-kind="event" data-id="${esc(id)}"><b>${esc(e.title)} ${smp(e)}</b><small>${evMeta(e)}</small></button></div>`).join('')+
      it.ts.map(([id,x])=>`<div class="arow"><span class="atime">${ckBtn(id,x)}截止</span><button type="button" class="amain c-${catT(x)}" data-act="edit" data-kind="task" data-id="${esc(id)}"><b class="${x.status==='done'?'done-t':''}">${esc(x.title)} ${smp(x)}</b><small>${taskMeta(x)}</small></button></div>`).join('')+
      `</div>`;
  }
  const agenda=`<section class="panel"><div class="ph"><h3>接下來 7 天</h3><button type="button" class="btn ghost" data-act="nav" data-view="calendar">開啟行事曆 →</button></div>${ag||'<p class="empty">未來 7 天沒有行程或到期任務。</p>'}</section>`;
  const review=open.filter(x=>x[1].status==='review');
  const att=[...overdue,...review.filter(x=>!overdue.includes(x))];
  const attention=`<section class="panel"><div class="ph"><h3>需要注意</h3><span class="muted">逾期 ${overdue.length} · 待驗收 ${review.length}</span></div>${att.length?`<div class="aday">`+att.map(([id,x])=>{const di=dueInfo(x);return `<div class="arow"><span class="atime">${ckBtn(id,x)}</span><button type="button" class="amain c-${catT(x)}" data-act="edit" data-kind="task" data-id="${esc(id)}"><b>${esc(x.title)} ${smp(x)}</b><small>${di?`<span class="due ${di[0]}">${di[1]}</span> · `:''}${taskMeta(x)}</small></button></div>`;}).join('')+`</div>`:'<p class="empty">沒有逾期或等待驗收的任務。</p>'}</section>`;
  const plist=projects.filter(x=>x[1].status!=='done').sort(projSort);
  const projPanel=`<section class="panel"><div class="ph"><h3>專案進度</h3><button type="button" class="btn ghost" data-act="nav" data-view="projects">全部專案 →</button></div>
    ${plist.length?`<div class="plist">${plist.map(projRow).join('')}</div><p class="legend-note"><i></i>直線標記：依照起訖日期，今天應該完成到的位置</p>`:'<p class="empty">沒有進行中的專案。</p>'}</section>`;
  const rqs=E(S.requests).filter(x=>['open','review','approved'].includes(x[1].status)&&inCat(catP(P(x[1].projectId)))).sort((a,b)=>(a[1].status==='review'?0:1)-(b[1].status==='review'?0:1)||(b[1].updatedAt||'').localeCompare(a[1].updatedAt||''));
  const reqPanel=rqs.length?`<section class="panel"><div class="ph"><h3>給 Claude 的留言</h3><span class="muted">待你確認 ${rqs.filter(x=>x[1].status==='review').length}</span></div><div class="plist">${rqs.map(([id,r])=>{const p=P(r.projectId),st=reqLabel(r);return `<button type="button" class="prow" data-act="open-project" data-id="${esc(r.projectId)}"><span class="prow-top">${codeTag(p)}<span class="pill ${st[1]}">${st[0]}</span></span><span class="rq-line">${r.taskId?`〔${esc(reqTask(r))}〕`:''}${esc(r.text)}</span></button>`;}).join('')}</div></section>`:'';
  return head+statusBanner()+kpis+`<div class="ov-grid"><div class="ov-col">${agenda}${attention}</div><div class="ov-col">${reqPanel}${projPanel}</div></div>`;
}
function projSort(a,b){
  const s=(PORDER[a[1].status]??9)-(PORDER[b[1].status]??9);if(s)return s;
  return (a[1].end||'9999').localeCompare(b[1].end||'9999');
}
function projRow([id,p]){
  const g=prog(id),c=catP(p),rv=reviewOfProject(id);
  return `<button type="button" class="prow${rv.length?' has-alert':''}" data-act="open-project" data-id="${esc(id)}">
    <span class="prow-top">${codeTag(p)}<span class="prow-name">${esc(p.name)}</span>${smp(p)}${alertPill(rv)}</span>
    ${barHTML(rv.length?'alert':c,g.pct,g.tpos)}
    <span class="prow-meta"><span class="pct">${g.pct}%</span>${g.total?`<span class="muted">${g.done}/${g.total} 任務</span>`:''}<span class="pill ${g.health[0]}">${g.health[1]}</span><span class="end">${endLabel(p)}</span></span>
  </button>`;
}
function welcomeHTML(){
  return `<section class="panel welcome">
    <h2>從第一個專案開始</h2>
    <p>把手上的工作建成專案，例如「年終盤點」或「WMS 條碼導入」，再拆成任務、排進行事曆。任務完成多少，專案進度就會自動更新。${isAdmin()?'已經有舊資料的話，到「管理」頁匯入 JSON 備份。':''}</p>
    <ol class="steps">
      <li><b>STEP 1</b>建立專案，選倉儲或 IT，設定起訖日期</li>
      <li><b>STEP 2</b>把專案拆成任務，指定負責人與到期日</li>
      <li><b>STEP 3</b>把進貨、出貨、盤點、會議排進行事曆</li>
    </ol>
    <div class="actions w-only">
      <button type="button" class="btn primary" data-act="new" data-kind="project">＋ 新增專案</button>
      <button type="button" class="btn" data-act="new" data-kind="task">＋ 新增任務</button>
      <button type="button" class="btn" data-act="new" data-kind="event">＋ 新增行程</button>
    </div>
  </section>`;
}

function vCalendar(){
  const [y,m]=S.calMonth.split('-').map(Number);
  const first=new Date(y,m-1,1),dim=new Date(y,m,0).getDate();
  const weeks=Math.ceil((first.getDay()+dim)/7);
  const start=new Date(y,m-1,1-first.getDay());
  const idx=dayIndex(),t=TODAY();
  let cells=WD.map((w,i)=>`<div class="wd${i%6===0?' we':''}">${w}</div>`).join('');
  for(let i=0;i<weeks*7;i++){
    const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);const k=ds(d);
    const it=idx[k]||{ev:[],ts:[],ps:[]};
    const chips=[
      ...it.ps.map(([id,p])=>({c:'bad',h:`<span class="chip pend" data-act="open-project" data-id="${esc(id)}">▲ ${esc(p.code||'')} 截止</span>`})),
      ...it.ev.map(([id,e])=>({c:catE(e),h:`<span class="chip c-${catE(e)}" data-act="edit" data-kind="event" data-id="${esc(id)}">${e.start?`<b>${esc(e.start)}</b> `:''}${esc(e.title)}</span>`})),
      ...it.ts.map(([id,x])=>({c:catT(x),h:`<span class="chip tk c-${catT(x)}${x.status==='done'?' done':''}" data-act="edit" data-kind="task" data-id="${esc(id)}">${esc(x.title)}</span>`}))
    ];
    const cls=['cell'];if(d.getMonth()!==m-1)cls.push('out');if(k===t)cls.push('today');if(k===S.selDay)cls.push('sel');if(d.getDay()%6===0)cls.push('we');
    cells+=`<div class="${cls.join(' ')}" data-act="sel-day" data-day="${k}" role="button" tabindex="0" aria-pressed="${k===S.selDay}" aria-label="${d.getMonth()+1}月${d.getDate()}日，${chips.length?chips.length+' 個項目':'沒有項目'}">
      <span class="dn">${d.getDate()}</span>
      <div class="chips">${chips.slice(0,3).map(c=>c.h).join('')}${chips.length>3?`<span class="more">+${chips.length-3} 更多</span>`:''}</div>
      <div class="dots" aria-hidden="true">${chips.slice(0,4).map(c=>c.c==='bad'?'<i style="background:var(--bad)"></i>':`<i class="c-${c.c}"></i>`).join('')}</div>
    </div>`;
  }
  const bar=`<div class="calbar">
    <div class="calnav"><button type="button" class="btn icon" data-act="cal" data-dir="-1" aria-label="上個月">‹</button><h2>${y}年${m}月</h2><button type="button" class="btn icon" data-act="cal" data-dir="1" aria-label="下個月">›</button><button type="button" class="btn" data-act="cal" data-dir="0">今天</button></div>
    <div class="legend"><span class="c-wh"><i></i>倉儲</span><span class="c-it"><i></i>IT</span><span class="c-gn"><i></i>綜合</span><span><i class="dash"></i>任務截止</span><span style="color:var(--bad)">▲ 專案截止</span></div>
  </div>`;
  return `<section class="vhead"><div><p class="eyebrow">行事曆</p><h1>進出貨・盤點・會議・維運</h1></div><div class="vtools w-only"><button type="button" class="btn primary" data-act="new" data-kind="event" data-date="${S.selDay}">＋ 新增行程</button></div></section>
    ${statusBanner()}${bar}
    <div class="cal-layout"><div class="panel calbox"><div class="cal">${cells}</div></div>${dayPanel(idx)}</div>`;
}
function dayPanel(idx){
  const k=S.selDay,it=idx[k]||{ev:[],ts:[],ps:[]};
  const n=it.ev.length+it.ts.length+it.ps.length;
  let body='';
  if(it.ps.length)body+=`<p class="dp-sub">專案截止</p>`+it.ps.map(([id,p])=>`<button type="button" class="dpi c-${catP(p)}" data-act="open-project" data-id="${esc(id)}"><span class="dpi-t">${esc(p.code)}</span><span class="dpi-m"><b>${esc(p.name)}</b><small>${prog(id).pct}% 完成</small></span></button>`).join('');
  if(it.ev.length)body+=`<p class="dp-sub">行程</p>`+it.ev.map(([id,e])=>`<button type="button" class="dpi c-${catE(e)}" data-act="edit" data-kind="event" data-id="${esc(id)}"><span class="dpi-t">${e.start?esc(e.start)+(e.end?'–'+esc(e.end):''):'全天'}</span><span class="dpi-m"><b>${esc(e.title)} ${smp(e)}</b><small>${evMeta(e)}</small></span></button>`).join('');
  if(it.ts.length)body+=`<p class="dp-sub">到期任務</p>`+it.ts.map(([id,x])=>`<div class="dpt">${ckBtn(id,x)}<button type="button" class="amain c-${catT(x)}" data-act="edit" data-kind="task" data-id="${esc(id)}"><b class="${x.status==='done'?'done-t':''}">${esc(x.title)} ${smp(x)}</b><small>${taskMeta(x)}</small></button></div>`).join('');
  return `<aside class="panel daypanel" aria-label="${mdw(k)} 的行程">
    <div class="ph"><h3>${mdw(k)}</h3><span class="muted">${rel(k)} · ${n} 個項目</span></div>
    <div class="dp-list">${body||'<p class="empty">這天沒有行程。</p>'}</div>
    <div class="dp-actions w-only"><button type="button" class="btn primary" data-act="new" data-kind="event" data-date="${k}">＋ 這天的行程</button><button type="button" class="btn" data-act="new" data-kind="task" data-date="${k}">＋ 這天到期的任務</button></div>
  </aside>`;
}

function vProjects(){
  const st=S.projStatus;
  const all=E(S.projects).filter(x=>inCat(catP(x[1])));
  const list=all.filter(x=>st==='all'||x[1].status===st).sort(projSort);
  const cnt=s=>all.filter(x=>x[1].status===s).length;
  const seg=`<div class="seg" role="group" aria-label="專案狀態">${[['all','全部',all.length],['active','進行中',cnt('active')],['plan','規劃中',cnt('plan')],['hold','暫停',cnt('hold')],['done','已完成',cnt('done')]].map(([k,l,n])=>`<button type="button" data-act="proj-status" data-status="${k}" aria-pressed="${st===k}">${l} ${n}</button>`).join('')}</div>`;
  const cards=list.map(([id,p])=>{
    const g=prog(id),c=catP(p),rv=reviewOfProject(id);
    return `<article class="pcard c-${c}${rv.length?' has-alert':''}" data-act="open-project" data-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(p.code)} ${esc(p.name)}，完成 ${g.pct}%${rv.length?'，'+reviewLabel(rv):''}">
      <div class="pc-top">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${smp(p)}${alertPill(rv)}${statusPill(p)}</div>
      <h3>${esc(p.name)}</h3>
      <p class="pc-meta">${p.owner?esc(p.owner)+' · ':''}${fmtD(p.start)} → ${fmtD(p.end)}${p.priority==='high'?' · 高優先':''}</p>
      ${barHTML(rv.length?'alert':c,g.pct,g.tpos)}
      <div class="pc-foot"><span class="pct">${g.pct}%</span><span>${g.total?`${g.done}/${g.total} 任務完成`:'尚無任務'}</span><span class="pill ${g.health[0]}">${g.health[1]}</span><span class="end">${endLabel(p)}</span></div>
    </article>`;
  }).join('');
  return `<section class="vhead"><div><p class="eyebrow">專案</p><h1>專案管理<small>${all.length} 個專案</small></h1></div><div class="vtools">${seg}<button type="button" class="btn primary w-only" data-act="new" data-kind="project">＋ 新增專案</button></div></section>
    ${statusBanner()}${list.length?`<div class="pgrid">${cards}</div>`:`<section class="panel"><p class="empty">${all.length?'這個狀態下沒有專案。':'還沒有專案。按「新增專案」建立第一個，例如「年終盤點」。'}</p></section>`}`;
}

function vBoard(){
  const sel=S.boardProject;
  if(sel!=='all'&&sel!=='none'&&!P(sel))S.boardProject='all';
  const ts=E(S.tasks).filter(([,x])=>inCat(catT(x))&&(S.boardProject==='all'||(S.boardProject==='none'?!P(x.projectId):x.projectId===S.boardProject)));
  const opts=`<option value="all">全部專案</option><option value="none"${S.boardProject==='none'?' selected':''}>未指定專案</option>`+
    E(S.projects).filter(x=>inCat(catP(x[1]))).sort((a,b)=>(a[1].code||'').localeCompare(b[1].code||'')).map(([id,p])=>`<option value="${esc(id)}"${id===S.boardProject?' selected':''}>${esc(p.code)} ${esc(p.name)}</option>`).join('');
  const lanes=TSTATUS.map(([st,label],i)=>{
    let items=ts.filter(x=>(x[1].status||'todo')===st);
    if(st==='done')items.sort((a,b)=>(b[1].doneAt||'').localeCompare(a[1].doneAt||''));
    else items.sort((a,b)=>(a[1].due||'9999').localeCompare(b[1].due||'9999')||(PRANK[a[1].priority]??1)-(PRANK[b[1].priority]??1));
    const total=items.length;
    if(st==='done'&&!S.showAllDone)items=items.slice(0,8);
    const prev=TSTATUS[i-1],next=TSTATUS[i+1];
    const cards=items.map(([id,x])=>{
      const p=P(x.projectId),di=dueInfo(x);
      return `<article class="tcard pr-${x.priority||'mid'}" data-act="edit" data-kind="task" data-id="${esc(id)}" draggable="${S.canWrite}" role="button" tabindex="0">
        <div class="tc-top">${codeTag(p)}${smp(x)}<span class="prio">優先 ${PRIO[x.priority]||'中'}</span></div>
        <p class="tc-title${st==='done'?' done-t':''}">${esc(x.title)}</p>
        ${(rv=>(st!=='done'&&tpct(x)>0)||rv.length?`<div class="tc-prog${rv.length?' alert':''}">${miniBar(rv.length?'alert':catT(x),tpct(x))}<em>${tpct(x)}%</em></div>${rv.length?`<span class="pill bad blink">${reviewLabel(rv)}</span>`:''}`:'')(reviewOfTask(id))}
        <div class="tc-meta">${di?`<span class="due ${di[0]}">${di[1]}</span>`:''}${x.assignee?`<span>${esc(x.assignee)}</span>`:''}</div>
        <div class="tc-move w-only">${prev?`<button type="button" data-act="move" data-id="${esc(id)}" data-to="${prev[0]}" aria-label="移到${prev[1]}">‹ ${prev[1]}</button>`:''}${next?`<button type="button" class="nx" data-act="move" data-id="${esc(id)}" data-to="${next[0]}" aria-label="移到${next[1]}">${next[1]} ›</button>`:''}</div>
      </article>`;
    }).join('');
    return `<section class="lane" data-lane="${st}" aria-label="${label}">
      <div class="lane-h"><span class="lamp ${st}"></span><h3>${label}</h3><span class="n">${total}</span></div>
      ${cards||`<p class="lane-empty">${S.canWrite?'拖曳任務到這裡':'沒有任務'}</p>`}
      ${st==='done'&&total>8?`<button type="button" class="showall" data-act="show-done">${S.showAllDone?'只顯示最近 8 筆':`顯示全部 ${total} 筆`}</button>`:''}
    </section>`;
  }).join('');
  return `<section class="vhead"><div><p class="eyebrow">進度看板</p><h1>任務進度<small>${ts.filter(x=>x[1].status!=='done').length} 筆未完成</small></h1></div>
    <div class="vtools"><label class="muted" for="bp" style="font-size:12.5px">專案</label><select class="sel" id="bp" data-change="board-project">${opts}</select><button type="button" class="btn primary w-only" data-act="new" data-kind="task">＋ 新增任務</button></div></section>
    ${statusBanner()}<div class="lanes-wrap"><div class="lanes">${lanes}</div></div>`;
}

/* ================= 管理（人員與權限、備份）================= */
const U={list:null,admins:[],loading:false,error:''};
async function loadUsers(){
  if(!isAdmin()||U.loading)return;
  U.loading=true;render();
  try{const j=await AU.api('users');U.list=j.users||[];U.admins=j.admins||[];U.error='';}
  catch(e){U.error=e.message;}
  U.loading=false;render();
}
function vUsers(){
  if(!isAdmin())return '<section class="panel"><p class="empty">只有管理員可以看這一頁。</p></section>';
  if(!U.list&&!U.loading&&!U.error)setTimeout(loadUsers,0);
  const when=ms=>ms?new Date(ms).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'還沒登入過';
  let people;
  if(!U.list)people=U.error?`<div class="adm-body"><div class="banner bad"><p>讀不到人員名單：${esc(U.error)}</p><button class="btn" type="button" data-act="reload-users">重試</button></div></div>`:'<p class="empty">正在讀取人員名單…</p>';
  else{
    const admins=U.admins.map(a=>`<div class="urow"><div class="urow-main"><b>${esc(a)}</b><div class="uchips"><span class="uchip perm">管理員：全部權限</span></div></div><span class="muted" style="font-size:12px">要更換管理員，請改雲端後端 Code.gs 的 ADMIN_EMAILS_</span></div>`).join('');
    const rows=U.list.map(u=>`<div class="urow"><div class="urow-main"><b>${esc(u.name||u.email)}</b><span class="hint">${esc(u.email)} · 最後登入 ${esc(when(u.lastLogin))}</span><div class="uchips">${u.enabled?'':'<span class="uchip off">已停用</span>'}${(u.pages||[]).map(p=>`<span class="uchip perm">${esc(PERM_LABEL[p]||p)}</span>`).join('')||'<span class="uchip">只能查看</span>'}</div></div><div class="urow-act"><button class="btn" type="button" data-act="edit-user" data-id="${esc(u.email)}">編輯</button><button class="btn" type="button" data-act="toggle-user" data-id="${esc(u.email)}">${u.enabled?'停用':'啟用'}</button><button class="btn danger" type="button" data-act="delete-user" data-id="${esc(u.email)}">刪除</button></div></div>`).join('');
    people=admins+rows+(U.list.length?'':'<div class="adm-body"><p>還沒有加入任何同事。按「＋ 新增人員」，輸入同事的 Gmail 並勾選權限。</p></div>')+(U.loading?'<p class="empty">更新中…</p>':'');
  }
  const n=c=>Object.keys(S[c]).length;
  return `<section class="vhead"><div><p class="eyebrow">管理</p><h1>人員與資料</h1></div></section>
    <div class="adm">
      <section class="panel"><div class="ph"><h3>人員與權限</h3><button type="button" class="btn primary" data-act="add-user">＋ 新增人員</button></div>
        <div class="adm-body"><p>用 Gmail 加入同事。名單內的人都能查看全部資料；勾「新增與修改」的人才能新增、修改、刪除。</p></div>
        ${people}
      </section>
      <section class="panel"><div class="ph"><h3>備份與還原</h3></div>
        <div class="adm-body">
          <p>目前有 ${n('projects')} 個專案、${n('tasks')} 筆任務、${n('events')} 個行程。雲端每天凌晨 3～4 點會自動備份；需要時也可以自己下載一份。</p>
          <div class="actions"><button type="button" class="btn" data-act="backup">下載 JSON 備份</button><button type="button" class="btn danger" data-act="import">匯入 JSON 備份</button></div>
          <p>匯入會取代雲端上所有人共用的專案、任務與行程，建議先下載目前的備份。</p>
        </div>
      </section>
    </div>`;
}
function permChecks(sel){
  return `<div class="perm-list">${PERMS.map(p=>`<label class="permopt" for="u-p-${p.id}"><input type="checkbox" id="u-p-${p.id}" value="${p.id}"${(sel||[]).includes(p.id)?' checked':''}><span><b>${p.label}</b><small>${p.desc}</small></span></label>`).join('')}</div>`;
}
function openUserForm(u,isEdit){
  u=u||{email:'',name:'',pages:['edit'],enabled:true};
  M={kind:'user',id:isEdit?u.email:null,opener:document.activeElement,user:u};
  $('#sheet').innerHTML=`<form id="m-form" novalidate>
    <h2 id="m-title">${isEdit?'編輯人員':'新增人員'}</h2>
    <div class="fgrid">
      <label class="full">Gmail <span class="req">*</span><input type="email" name="email" id="f-title" value="${esc(u.email)}" ${isEdit?'readonly':''} placeholder="name@gmail.com" autocomplete="off"></label>
      <label class="full">姓名（顯示在更新紀錄）<input name="name" id="u-name" value="${esc(u.name)}" placeholder="例如：王小明" maxlength="30"></label>
      <div class="full">${permChecks(u.pages)}<p class="muted" style="font-size:12px;margin-top:6px">都不勾＝只能查看</p></div>
    </div>
    <p class="ferr" id="ferr" role="alert"></p>
    <div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn primary" id="f-save">儲存</button></div>
  </form>`;
  $('#modal').hidden=false;lockScroll();
  setTimeout(()=>{const f=isEdit?$('#u-name'):$('#f-title');if(f)f.focus();},0);
}
async function submitUser(form){
  const f=new FormData(form);const email=String(f.get('email')||'').trim(),name=String(f.get('name')||'').trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){$('#ferr').textContent='請輸入正確的 Gmail 地址。';return;}
  const pages=PERMS.filter(p=>form.querySelector('#u-p-'+p.id).checked).map(p=>p.id);
  const btn=$('#f-save');btn.disabled=true;btn.textContent='儲存中…';
  const isEdit=!!M.id,enabled=M.user.enabled!==false;
  try{const j=await AU.api('userSave',{email,name,pages,enabled});U.list=j.users||U.list;closeModal();render();toast(isEdit?'已更新':`已加入 ${email}，請他用這個 Gmail 登入`);}
  catch(e){$('#ferr').textContent=e.message;btn.disabled=false;btn.textContent='儲存';}
}
async function userCall(action,payload,okMsg){
  try{const j=await AU.api(action,payload);U.list=j.users||U.list;render();toast(okMsg);}catch(e){toast(e.message);}
}

/* ---------- 備份 ---------- */
function downloadFile(filename,content,mime){
  try{const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('備份已下載');}
  catch(e){toast('下載失敗：'+e.message);}
}
function exportBackup(){
  const strip=kind=>ST.list(kind).map(r=>JSON.parse(JSON.stringify(r)));
  downloadFile(`倉儲IT整合中心_備份_${TODAY()}.json`,JSON.stringify({app:BACKUP_APP,version:1,exportedAt:new Date().toISOString(),exportedBy:myName(),projects:strip('projects'),tasks:strip('tasks'),events:strip('events'),links:strip('links'),requests:strip('requests'),guides:strip('guides')},null,2),'application/json;charset=utf-8');
}
let pendingImport=null;
function readImport(file){
  const r=new FileReader();
  r.onload=()=>{
    let o;try{o=JSON.parse(r.result);}catch(e){toast('這個檔案不是 JSON。');return;}
    const okArr=a=>Array.isArray(a)&&a.every(x=>x&&typeof x==='object'&&x.id!=null);
    if(!o||o.app!==BACKUP_APP||!okArr(o.projects)||!okArr(o.tasks)||!okArr(o.events)){toast('這不是倉儲 IT 整合中心的備份檔。');return;}
    if(o.events.some(e=>!pd(e.date))){toast('備份裡有行程缺少日期，無法匯入。');return;}
    if(o.links!=null&&!okArr(o.links)){toast('備份裡的常用連結格式不對，無法匯入。');return;}
    if(o.requests!=null&&!okArr(o.requests)){toast('備份裡的留言格式不對，無法匯入。');return;}
    if(o.guides!=null&&!okArr(o.guides)){toast('備份裡的操作指南格式不對，無法匯入。');return;}
    pendingImport=o;
    M={kind:'import',id:null,opener:document.activeElement};
    $('#sheet').innerHTML=`<form id="m-form" novalidate>
      <h2 id="m-title">匯入 JSON 備份？</h2>
      <p>將以「${esc(file.name)}」取代雲端上所有人共用的資料：</p>
      <ul><li>專案 ${o.projects.length} 個</li><li>任務 ${o.tasks.length} 筆</li><li>行程 ${o.events.length} 個</li>${o.links?`<li>常用連結 ${o.links.length} 個</li>`:''}${o.requests?`<li>留言與工程師討論 ${o.requests.length} 則</li>`:''}</ul>
      <p class="muted">目前的 ${Object.keys(S.projects).length} 個專案、${Object.keys(S.tasks).length} 筆任務、${Object.keys(S.events).length} 個行程會被取代。建議先下載目前的備份。</p>
      <p class="ferr" id="ferr" role="alert"></p>
      <div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn danger armed" id="f-save">匯入並取代</button></div>
    </form>`;
    $('#modal').hidden=false;lockScroll();
  };
  r.onerror=()=>toast('讀不到這個檔案。');
  r.readAsText(file,'utf-8');
}
function doImport(){
  const o=pendingImport;pendingImport=null;if(!o)return;
  // 舊的備份沒有常用連結：保留目前的連結，不清掉
  const kinds={projects:o.projects,tasks:o.tasks,events:o.events};if(o.links)kinds.links=o.links;if(o.requests)kinds.requests=o.requests;if(o.guides)kinds.guides=o.guides;
  try{ST.replaceKinds(kinds);closeModal();S.openProject=null;toast(`已匯入 ${o.projects.length} 個專案、${o.tasks.length} 筆任務、${o.events.length} 個行程`);}
  catch(e){$('#ferr').textContent='匯入失敗：'+e.message;}
}

/* ================= drawer (project detail) ================= */
function renderDrawer(){
  const el=$('#drawer');const id=S.openProject;const p=P(id);
  if(!p){S.openProject=null;el.hidden=true;el.innerHTML='';lockScroll();return;}
  const keep=el.querySelector('.drawer');const st=keep?keep.scrollTop:0;
  const ta0=el.querySelector('#rq-text');const draft=ta0?{v:ta0.value,f:document.activeElement===ta0,a:ta0.selectionStart,b:ta0.selectionEnd,pid:S.openProject}:null;
  const g=prog(id),c=catP(p);
  const ts=E(S.tasks).filter(x=>x[1].projectId===id).sort((a,b)=>{
    const o={todo:1,doing:0,review:2,done:3};return (o[a[1].status]??1)-(o[b[1].status]??1)||(a[1].due||'9999').localeCompare(b[1].due||'9999');});
  const evs=E(S.events).filter(x=>x[1].projectId===id&&x[1].date>=TODAY()).sort((a,b)=>(a[1].date+(a[1].start||'')).localeCompare(b[1].date+(b[1].start||''))).slice(0,6);
  el.innerHTML=`<div class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title">
    <div class="d-head">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${p.vendor?'<span class="rq-task">委外</span>':''}${statusPill(p)}${smp(p)}<button type="button" class="btn ghost icon" data-act="close-drawer" aria-label="關閉專案詳情">✕</button></div>
    <h2 id="d-title">${esc(p.name)}</h2>
    ${(u=>u&&!isSelf(u)?`<a class="btn primary d-open" href="${esc(u)}" target="_blank" rel="noopener">開啟系統 ↗<span class="d-site">${esc(siteOf(u))}</span></a>`:'')(projUrl(p))}
    <dl class="facts">
      <div><dt>負責人</dt><dd>${esc(p.owner)||'—'}</dd></div>
      <div><dt>優先級</dt><dd>${PRIO[p.priority]||'中'}</dd></div>
      <div><dt>期間</dt><dd>${fmtD(p.start)} → ${fmtD(p.end)}</dd></div>
      <div><dt>截止</dt><dd>${endLabel(p)}</dd></div>
    </dl>
    ${p.desc?`<p class="desc">${esc(p.desc)}</p>`:''}
    <div class="d-prog${reviewOfProject(id).length?' alert':''}">${barHTML(reviewOfProject(id).length?'alert':c,g.pct,g.tpos)}<div class="d-prog-meta"><span>整體進度 <b>${g.pct}%</b></span>${alertPill(reviewOfProject(id))}${g.tpos!==null?`<span>時程已過 ${g.tpos}%</span>`:''}<span class="pill ${g.health[0]}">${g.health[1]}</span>${g.total?'<span>（各任務進度的平均）</span>':'<span>（沒有任務時，以專案設定的進度為準）</span>'}</div></div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>任務<span>${g.done}/${g.total}</span></h3><button type="button" class="btn w-only" data-act="new" data-kind="task" data-project="${esc(id)}">＋ 任務</button></div>
      ${ts.length?ts.map(([tid,x])=>{const di=dueInfo(x),tp=tpct(x);return `<div class="dtask">${ckBtn(tid,x)}<button type="button" class="amain" data-act="edit" data-kind="task" data-id="${esc(tid)}" aria-label="${esc(x.title)}，執行進度 ${tp}%，按一下修改"><b class="${x.status==='done'?'done-t':''}">${esc(x.title)} ${smp(x)}</b><small>${x.assignee?esc(x.assignee)+' · ':''}${di?`<span class="due ${di[0]}">${di[1]}</span>`:'未設到期日'}${(l=>l.length?` · 留言 ${l.length}`:'')(taskReqs(tid))}</small><span class="dt-prog${reviewOfTask(tid).length?' alert':''}">${miniBar(reviewOfTask(tid).length?'alert':c,tp)}<em>${tp}%</em>${alertPill(reviewOfTask(tid))}</span></button><span class="pill ${x.status==='done'?'ok':x.status==='review'?'warn':x.status==='doing'?'info':''}">${TLABEL[x.status]||'待辦'}</span></div>`;}).join(''):'<p class="muted">還沒有任務。把專案拆成幾個具體步驟，每個任務有自己的進度，專案進度會自動平均。</p>'}
    </div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>接下來的行程</h3><button type="button" class="btn w-only" data-act="new" data-kind="event" data-project="${esc(id)}">＋ 行程</button></div>
      ${evs.length?evs.map(([eid,e])=>`<button type="button" class="dpi c-${catE(e)}" data-act="edit" data-kind="event" data-id="${esc(eid)}"><span class="dpi-t">${mdw(e.date)}</span><span class="dpi-m"><b>${esc(e.title)}</b><small>${e.start?esc(e.start)+' · ':''}${evMeta(e)}</small></span></button>`).join(''):'<p class="muted">沒有排定的行程。</p>'}
    </div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>${p.vendor?'跟委外工程師討論的事項':'給 Claude 的留言'}</h3>${p.vendor?`<button type="button" class="btn" data-act="vendor-list" data-id="${esc(id)}">工程師討論清單</button>`:''}</div>
      <p class="muted rq-hint">${p.vendor?VENDOR_HINT+'只針對某個任務（頁面）的話，點上面那個任務，在任務視窗下方留言。':'送出後會直接交給 Claude 處理，不用打開專案。Claude 收到後會在這裡回覆（電腦上的 Claude 要開著）；改好會先附 demo 截圖，你按「核准上線」才會上線。只針對某個任務的話，點上面那個任務，在任務視窗下方留言。'}</p>
      ${liveReqs(id).map(x=>reqHTML(x,true)).join('')}
      ${doneReqsHTML('p:'+id,doneReqsOfProject(id),true)}
      ${composerHTML('p:'+id,'rq-text',p.vendor?'例如：整個入口網站的登入很慢（附截圖）':'例如：首頁的表格加一欄「負責人」',`<button type="button" class="btn primary" data-act="req-send" data-id="${esc(id)}">送出留言</button>`)}
    </div>
    ${p.updatedBy?`<p class="muted" style="font-size:12px">最後更新：${esc(p.updatedBy)}${p.updatedAt?' · '+esc(new Date(p.updatedAt).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}</p>`:''}
    <div class="d-foot w-only"><button type="button" class="btn" data-act="edit" data-kind="project" data-id="${esc(id)}">編輯專案</button></div>
  </div>`;
  el.hidden=false;
  const nd=el.querySelector('.drawer');if(nd)nd.scrollTop=st;
  const ta1=el.querySelector('#rq-text');
  if(ta1&&draft&&draft.pid===id){ta1.value=draft.v;if(draft.f){ta1.focus({preventScroll:true});try{ta1.setSelectionRange(draft.a,draft.b);}catch(e){}}}
  loadImgs();
  lockScroll();
}

/* ================= forms ================= */
let M=null;
function projOptions(sel){
  return `<option value="">（不指定專案）</option>`+E(S.projects).sort((a,b)=>(a[1].code||'').localeCompare(b[1].code||'')).map(([id,p])=>`<option value="${esc(id)}"${id===sel?' selected':''}>${esc(p.code)} ${esc(p.name)}${p.status==='done'?'（已完成）':''}</option>`).join('');
}
const optList=(pairs,sel)=>pairs.map(([v,l])=>`<option value="${v}"${v===sel?' selected':''}>${l}</option>`).join('');
function defaults(kind,o){
  if(kind==='event')return {title:'',type:S.cat==='wh'?'inbound':S.cat==='it'?'it':'meeting',date:o.date||(S.view==='calendar'?S.selDay:TODAY()),start:'09:00',end:'10:00',projectId:o.project||'',location:'',note:''};
  if(kind==='task')return {title:'',projectId:o.project||(S.view==='board'&&P(S.boardProject)?S.boardProject:''),status:'todo',priority:'mid',due:o.date||'',assignee:'',note:'',progress:0};
  if(kind==='link')return {title:'',url:'',category:S.cat==='all'?'gn':S.cat,note:''};
  const cat=S.cat==='all'?'wh':S.cat;
  return {name:'',category:cat,code:nextCode(cat),status:'active',priority:'mid',start:TODAY(),end:'',owner:'',folder:'',url:'',vendor:false,desc:'',progress:0};
}
function formHTML(kind,d,isEdit){
  const ro=!S.canWrite;
  let title,body;
  if(kind==='event'){
    title=isEdit?'編輯行程':'新增行程';
    body=`<label class="full">行程名稱 <span class="req">*</span><input name="title" id="f-title" maxlength="80" value="${esc(d.title)}" placeholder="例如：供應商 A 進貨驗收" required></label>
      <label>類型<select name="type" id="f-type">${optList(Object.entries(ETYPE).map(([k,v])=>[k,v[0]]),d.type)}</select></label>
      <label>日期 <span class="req">*</span><input type="date" name="date" id="f-date" value="${esc(d.date)}" required></label>
      <label>開始時間<input type="time" name="start" id="f-start" value="${esc(d.start)}"></label>
      <label>結束時間<input type="time" name="end" id="f-end" value="${esc(d.end)}"></label>
      <label class="full">關聯專案<select name="projectId" id="f-proj">${projOptions(d.projectId)}</select></label>
      <label class="full">地點／儲位<input name="location" id="f-loc" maxlength="60" value="${esc(d.location)}" placeholder="例如：A 區收貨月台、機房"></label>
      <label class="full">備註<textarea name="note" id="f-note" maxlength="1000">${esc(d.note)}</textarea></label>`;
  }else if(kind==='task'){
    title=isEdit?'編輯任務':'新增任務';
    body=`<label class="full">任務名稱 <span class="req">*</span><input name="title" id="f-title" maxlength="100" value="${esc(d.title)}" placeholder="例如：完成 A 區儲位條碼張貼" required></label>
      <label class="full">所屬專案<select name="projectId" id="f-proj">${projOptions(d.projectId)}</select></label>
      <label>狀態<select name="status" id="f-status">${optList(TSTATUS,d.status||'todo')}</select></label>
      <label>優先級<select name="priority" id="f-prio">${optList([['high','高'],['mid','中'],['low','低']],d.priority||'mid')}</select></label>
      <label>到期日<input type="date" name="due" id="f-due" value="${esc(d.due)}"></label>
      <label>負責人<input name="assignee" id="f-who" maxlength="30" value="${esc(d.assignee)}" placeholder="姓名"></label>
      ${(tp=>`<label class="full">執行進度 <output id="f-tprog-out">${tp}%</output><input type="range" name="progress" id="f-tprog" min="0" max="100" step="5" value="${tp}"><span class="hint">這個任務自己做到幾 %。狀態選「已完成」一律算 100%；專案進度是所有任務進度的平均。</span></label>`)(Math.max(0,Math.min(100,Math.round(+d.progress||0))))}
      <label class="full">備註<textarea name="note" id="f-note" maxlength="1000">${esc(d.note)}</textarea></label>`;
  }else if(kind==='link'){
    title=isEdit?'編輯連結':'新增連結';
    body=`<label class="full">名稱 <span class="req">*</span><input name="title" id="f-title" maxlength="60" value="${esc(d.title)}" placeholder="例如：夥伴交接看板" required></label>
      <label class="full">網址 <span class="req">*</span><input type="url" name="url" id="f-url" maxlength="600" value="${esc(d.url)}" placeholder="https://…" required style="font-family:var(--f-mono)"></label>
      <label>類別<select name="category" id="f-lcat">${optList([['wh','倉儲'],['it','IT'],['gn','綜合']],d.category||'gn')}</select></label>
      <label class="full">說明<textarea name="note" id="f-note" maxlength="300" placeholder="這個系統是做什麼用的">${esc(d.note)}</textarea></label>`;
  }else{
    title=isEdit?'編輯專案':'新增專案';
    body=`<label class="full">專案名稱 <span class="req">*</span><input name="name" id="f-title" maxlength="60" value="${esc(d.name)}" placeholder="例如：2026 年終盤點" required></label>
      <label>類別<select name="category" id="f-cat">${optList([['wh','倉儲'],['it','IT'],['gn','綜合']],d.category||'wh')}</select></label>
      <label>專案代碼<input name="code" id="f-code" maxlength="16" value="${esc(d.code)}" data-auto="${isEdit?'0':'1'}" style="font-family:var(--f-mono)"></label>
      <label>狀態<select name="status" id="f-status">${optList([['plan','規劃中'],['active','進行中'],['hold','暫停'],['done','已完成']],d.status||'active')}</select></label>
      <label>優先級<select name="priority" id="f-prio">${optList([['high','高'],['mid','中'],['low','低']],d.priority||'mid')}</select></label>
      <label>開始日<input type="date" name="start" id="f-start" value="${esc(d.start)}"></label>
      <label>截止日<input type="date" name="end" id="f-end" value="${esc(d.end)}"></label>
      <label class="full">負責人<input name="owner" id="f-owner" maxlength="30" value="${esc(d.owner)}" placeholder="姓名"></label>
      <label class="full">資料夾（Claude 用來對應這個專案）<input name="folder" id="f-folder" maxlength="260" value="${esc(d.folder||projFolder(d))}" placeholder="例如：D:\\AI\\採購工作看板App" style="font-family:var(--f-mono)"></label>
      <label class="full">系統網址（「入口」頁的連結）<input type="url" name="url" id="f-url" maxlength="600" value="${esc(d.url||projUrl(d))}" placeholder="例如：https://cheesedukead4.github.io/cheeseduke-fefo/" style="font-family:var(--f-mono)"></label>
      <label class="full chk"><input type="checkbox" name="vendor" id="f-vendor"${d.vendor?' checked':''}><span>委外工程師負責：留言由 Claude 整理成「給工程師的討論重點」，不直接修改系統</span></label>
      <label class="full">說明<textarea name="desc" id="f-desc" maxlength="2000" placeholder="目標、範圍、注意事項">${esc(d.desc)}</textarea></label>
      <label class="full">手動進度 <output id="f-prog-out">${Math.round(+d.progress||0)}%</output><input type="range" name="progress" id="f-prog" min="0" max="100" step="5" value="${Math.round(+d.progress||0)}"><span class="hint">專案底下有任務時，進度會改用所有任務進度的平均自動計算。</span></label>`;
  }
  const del=isEdit&&!ro?`<button type="button" class="btn danger" data-act="del">刪除</button>`:'';
  const who=isEdit&&d.updatedBy?`<p class="muted" style="font-size:12px;margin-top:8px">最後更新：${esc(d.updatedBy)}${d.updatedAt?' · '+esc(new Date(d.updatedAt).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}</p>`:'';
  return `<form id="m-form" novalidate>
    <h2 id="m-title">${title}${smp(d)}</h2>
    <fieldset style="border:0;padding:0;margin:0"${ro?' disabled':''}><div class="fgrid">${body}</div></fieldset>
    ${who}<p class="ferr" id="ferr" role="alert"></p>
    <div class="m-foot">${del}<span class="sp"></span><button type="button" class="btn" data-act="close-modal">${ro?'關閉':'取消'}</button>${ro?'':'<button type="submit" class="btn primary" id="f-save">儲存</button>'}</div>
  </form>`;
}
function openForm(kind,id,o){
  const coll=COLL[kind];if(!coll)return;
  if(id&&!S[coll][id]){toast('這筆資料已被刪除');return;}
  if(!id&&!S.canWrite)return;
  M={kind,id:id||null,opener:document.activeElement};
  const d=id?Object.assign({},S[coll][id]):defaults(kind,o||{});
  $('#sheet').innerHTML=formHTML(kind,d,!!id)+(kind==='task'&&id?taskReqSection(id):'');
  if(kind==='task'&&id)loadImgs();
  $('#modal').hidden=false;lockScroll();
  setTimeout(()=>{const f=$('#f-title');if(f){f.focus();if(!id)f.select();}},0);
}
function closeModal(){
  const op=M&&M.opener;M=null;pendingImport=null;$('#modal').hidden=true;$('#sheet').innerHTML='';$('#sheet').classList.remove('wide');document.body.classList.remove('print-sheet');lockScroll();
  if(op&&op.isConnected)try{op.focus();}catch(e){}
}
function lockScroll(){document.body.classList.toggle('locked',!$('#modal').hidden||!$('#drawer').hidden);}

async function submitForm(form){
  if(!M)return;
  if(M.kind==='user')return submitUser(form);
  if(M.kind==='import')return doImport();
  if(M.kind==='reqrevise')return submitRevise(form);
  if(M.kind==='guide')return doGuideImport();
  if(!S.canWrite)return;
  const f=new FormData(form);const v=k=>String(f.get(k)||'').trim();
  const kind=M.kind,coll=COLL[kind],prev=M.id?S[coll][M.id]:null;
  let data,err='';
  if(kind==='event'){
    data={title:v('title'),type:ETYPE[v('type')]?v('type'):'other',date:v('date'),start:v('start'),end:v('end'),projectId:v('projectId'),location:v('location'),note:v('note')};
    if(!data.title)err='請填寫行程名稱。';else if(!pd(data.date))err='請選擇行程日期。';else if(data.start&&data.end&&data.end<data.start)err='結束時間不能早於開始時間。';
  }else if(kind==='task'){
    data={title:v('title'),projectId:v('projectId'),status:TLABEL[v('status')]?v('status'):'todo',priority:PRIO[v('priority')]?v('priority'):'mid',due:v('due'),assignee:v('assignee'),note:v('note'),progress:Math.max(0,Math.min(100,Math.round(+v('progress')||0)))};
    if(!data.title)err='請填寫任務名稱。';
    // 有進度就是開始做了：待辦自動改成進行中
    if(data.status==='todo'&&data.progress>0)data.status='doing';
    if(data.status==='done')data.doneAt=(prev&&prev.status==='done'&&prev.doneAt)?prev.doneAt:new Date().toISOString();
  }else if(kind==='link'){
    data={title:v('title'),url:v('url'),category:CAT[v('category')]?v('category'):'gn',note:v('note')};
    if(!data.title)err='請填寫名稱。';else if(!okUrl(data.url))err='請填寫正確的網址（https:// 開頭）。';
  }else{
    data={name:v('name'),category:CAT[v('category')]?v('category'):'gn',code:v('code').toUpperCase(),status:PSTATUS[v('status')]?v('status'):'active',priority:PRIO[v('priority')]?v('priority'):'mid',start:v('start'),end:v('end'),owner:v('owner'),folder:v('folder'),url:v('url'),vendor:f.get('vendor')==='on',desc:v('desc'),progress:Math.max(0,Math.min(100,+v('progress')||0))};
    if(!data.code)data.code=nextCode(data.category);
    const dup=E(S.projects).find(([pid,p])=>pid!==M.id&&(p.code||'').toUpperCase()===data.code);
    if(!data.name)err='請填寫專案名稱。';else if(data.start&&data.end&&data.end<data.start)err='截止日不能早於開始日。';else if(data.url&&!okUrl(data.url))err='系統網址要以 https:// 或 http:// 開頭。';else if(dup)err=`代碼 ${data.code} 已被「${dup[1].name}」使用，請換一個。`;
  }
  if(err){$('#ferr').textContent=err;return;}
  const nowIso=new Date().toISOString();
  data.createdAt=(prev&&prev.createdAt)||nowIso;data.updatedAt=nowIso;
  if(prev&&prev.createdBy)data.createdBy=prev.createdBy;
  const id=M.id||uid(kind[0]);
  const ok=await put(coll,id,data);
  if(ok){closeModal();toast(prev?'已儲存變更':(kind==='event'?'已新增行程':kind==='task'?'已新增任務':kind==='link'?'已新增連結':'已新增專案'));}
}
async function deleteCurrent(){
  if(!M||!M.id)return;
  const {kind,id}=M,coll=COLL[kind];
  if(kind==='project'){
    const tids=E(S.tasks).filter(([,t])=>t.projectId===id).map(([tid])=>tid);
    if(tids.length&&canEdit())ST.removeMany('tasks',tids);
    if(S.openProject===id)S.openProject=null;
  }
  const ok=await drop(coll,id);
  if(ok){closeModal();renderDrawer();toast('已刪除');}
}
function arm(btn,label,fn){
  if(btn.dataset.armed){fn();return;}
  const old=btn.textContent;btn.dataset.armed='1';btn.textContent=label;btn.classList.add('armed');
  setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.textContent=old;btn.classList.remove('armed');}},4000);
}

/* ---------- 給 Claude 的留言 ---------- */
// tid 有值：針對任務的留言（任務視窗裡的留言框）
function sendReq(pid,tid){
  const ta=$(tid?'#trq-text':'#rq-text');const t=(ta&&ta.value||'').trim();
  const k=tid?'t:'+tid:'p:'+pid;
  if(!t&&!pendOf(k).length){toast('請先寫留言內容或加入圖片');if(ta)ta.focus();return;}
  const iso=new Date().toISOString(),task=tid?S.tasks[tid]:null;
  if(tid&&!task){toast('這個任務已被刪除');return;}
  const images=takePend(k);if(!images)return;
  const projectId=pid||(task&&task.projectId)||'',vend=!!(P(projectId)||{}).vendor;
  const rec={projectId,text:t,status:'open',replies:[],createdAt:iso,updatedAt:iso};
  if(images.length)rec.images=images;
  if(vend)rec.vendor=true;
  if(task){
    rec.taskId=tid;rec.taskTitle=task.title;
    const m=/https?:\/\/[^\s<>"']+/.exec(task.note||'');if(m)rec.taskUrl=m[0];   // 頁面網址（Claude 整理討論重點時用）
  }
  put('requests',uid('r'),rec);
  if(ta)ta.value='';refreshPend(k);
  toast(vend?'已送出，Claude 會整理成給工程師的討論重點（幾分鐘內在這裡回覆）':'已送出，Claude 會直接收到並開始處理（約 1 分鐘內在這裡回覆）');
}
function setReq(id,patch,msg){
  const r=S.requests[id];if(!r)return;
  put('requests',id,Object.assign({},r,patch,{updatedAt:new Date().toISOString()}));
  if(msg)toast(msg);
}
function openRevise(id){
  if(!S.requests[id])return;
  M={kind:'reqrevise',id,opener:document.activeElement};
  const vend=isVendorReq(S.requests[id]);
  $('#sheet').innerHTML=`<form id="m-form" novalidate>
    <h2 id="m-title">${vend?'要補充或修改什麼？':'還要修改什麼？'}</h2>
    <p class="muted" style="margin-bottom:10px">原本的留言：${esc(S.requests[id].text||'（只有圖片）')}</p>
    <p style="font-weight:500;margin-bottom:6px">補充說明 <span class="req">*</span></p>
    ${composerHTML('r:'+id,'f-title',vend?'例如：重點裡第 2 點不對，應該是…（可以附圖）':'例如：按鈕再大一點，手機上也要看得到','')}
    <p class="ferr" id="ferr" role="alert"></p>
    <div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn primary" id="f-save">送出</button></div>
  </form>`;
  $('#modal').hidden=false;lockScroll();
  setTimeout(()=>{const f=$('#f-title');if(f)f.focus();},0);
}
function submitRevise(form){
  const r=S.requests[M.id],ta=$('#f-title'),t=String((ta&&ta.value)||'').trim(),k='r:'+M.id;
  if(!t&&!pendOf(k).length){$('#ferr').textContent='請寫要修改的地方，或加入圖片。';return;}
  if(!r){closeModal();return;}
  const images=takePend(k);if(!images)return;
  const reply={id:uid('c'),by:myName(),text:t,at:new Date().toISOString()};if(images.length)reply.images=images;
  const replies=(r.replies||[]).concat([reply]);
  setReq(M.id,{replies,status:'open'},isVendorReq(r)?'已送出，Claude 會照補充更新討論重點':'已送出，Claude 會直接收到並再修改');
  closeModal();
}

/* ---------- 工程師討論清單（委外專案）：依任務（頁面）整理，可以列印或複製 ---------- */
const VL_FILTER={open:['還沒討論',s=>s!=='done'],done:['已討論',s=>s==='done'],all:['全部',()=>true]};
const urlIn=s=>{const m=/https?:\/\/[^\s<>"']+/.exec(s||'');return m?m[0]:'';};
function vlGroups(pid){
  const f=(VL_FILTER[S.vlFilter]||VL_FILTER.open)[1];
  const reqs=E(S.requests).filter(([,r])=>r.projectId===pid&&r.status!=='closed'&&f(r.status));
  const order={approved:0,review:1,open:2,done:3};
  const groups=[];
  const tasks=E(S.tasks).filter(([,t])=>t.projectId===pid).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  for(const [tid,t] of tasks){
    const items=reqs.filter(([,r])=>r.taskId===tid).sort((a,b)=>(order[a[1].status]??9)-(order[b[1].status]??9)||(a[1].createdAt||'').localeCompare(b[1].createdAt||''));
    if(items.length)groups.push({title:t.title,url:urlIn(t.note),pct:tpct(t),items});
  }
  const rest=reqs.filter(([,r])=>!r.taskId||!S.tasks[r.taskId]);
  if(rest.length)groups.push({title:'整個專案／其他',url:'',pct:null,items:rest});
  return groups;
}
function vlBody(pid){
  const gs=vlGroups(pid);
  if(!gs.length)return `<p class="empty">${S.vlFilter==='done'?'還沒有已討論的事項。':'目前沒有要跟工程師討論的事項。在任務視窗下方留言，Claude 整理後會出現在這裡。'}</p>`;
  let n=0;
  return gs.map(g=>`<section class="vl-grp"><h3>${esc(g.title)}${g.pct!==null?`<span class="muted">執行進度 ${g.pct}%</span>`:''}</h3>${g.url?`<p class="vl-url">${esc(g.url)}</p>`:''}
    ${g.items.map(([id,r])=>{n++;const st=reqLabel(r);
      return `<article class="vl-item"><div class="vl-h"><b>${n}.</b><span class="pill ${st[1]}">${st[0]}</span><span class="muted">${esc(r.createdBy||'')} · ${whenTxt(r.createdAt)}</span></div>
        ${r.brief?`<div class="vl-brief">${esc(r.brief)}</div><p class="vl-orig"><span class="muted">原始留言：</span>${esc(r.text||'（只有圖片）')}</p>`:`<div class="vl-brief vl-raw"><span class="muted">（Claude 還沒整理）</span>\n${esc(r.text||'（只有圖片）')}</div>`}
        ${imgsHTML((r.images||[]).concat(...(r.replies||[]).filter(c=>c.by!=='Claude').map(c=>c.images||[])))}
        ${vlActs(id,r)}
      </article>`;}).join('')}</section>`).join('');
}
// 清單上直接確認／標記已討論；「打開留言」回到任務視窗看完整對話
function vlActs(id,r){
  let a='';
  if(r.status==='review')a=`<button type="button" class="btn primary" data-act="req-approve" data-id="${esc(id)}">確認，列入討論清單</button><button type="button" class="btn" data-act="req-revise" data-id="${esc(id)}">還要修改</button>`;
  else if(r.status==='approved')a=`<button type="button" class="btn primary" data-act="req-discussed" data-id="${esc(id)}">已跟工程師討論</button><button type="button" class="btn" data-act="req-revise" data-id="${esc(id)}">補充</button>`;
  else if(r.status==='open')a=`<span class="muted" style="font-size:12.5px">等待 Claude 整理…</span>`;
  const open=r.taskId&&S.tasks[r.taskId]?`<button type="button" class="linkbtn" data-act="edit" data-kind="task" data-id="${esc(r.taskId)}">打開留言</button>`:`<button type="button" class="linkbtn" data-act="open-project" data-id="${esc(r.projectId)}">打開專案</button>`;
  return `<div class="vl-acts no-print w-only">${a}<span class="sp"></span>${open}</div>`;
}
/* ---------- 「工程師討論」分頁：所有委外專案要跟工程師討論的事項 ---------- */
const vendorProjects=()=>E(S.projects).filter(([,p])=>p.vendor).sort((a,b)=>(a[1].code||'').localeCompare(b[1].code||''));
const vendorReqs=()=>E(S.requests).filter(([,r])=>r.status!=='closed'&&isVendorReq(r));
function vVendor(){
  if(!VL_FILTER[S.vlFilter])S.vlFilter='open';
  const vps=vendorProjects(),all=vendorReqs(),n=s=>all.filter(x=>x[1].status===s).length;
  const seg=`<div class="seg" role="group" aria-label="篩選">${Object.entries(VL_FILTER).map(([k,[l]])=>`<button type="button" data-act="vl-filter" data-status="${k}" aria-pressed="${S.vlFilter===k}">${l}</button>`).join('')}</div>`;
  const head=`<section class="vhead"><div><p class="eyebrow">工程師討論</p><h1>要跟委外工程師討論的事項<small>${TODAY().replace(/-/g,'/')}</small></h1></div>
    <div class="vtools no-print">${seg}<button type="button" class="btn" data-act="vl-copy">複製文字</button><button type="button" class="btn" data-act="vl-print">列印／存成 PDF</button></div></section>`;
  if(!vps.length)return head+statusBanner()+`<section class="panel"><p class="empty">還沒有委外工程師負責的專案。到「專案」打開專案，按「編輯專案」勾選「委外工程師負責」，那個專案的留言就會整理到這裡。</p></section>`;
  const sum=`<section class="vv-sum">
    <div class="kpi${n('review')?' alert':''}"><span class="kl">已整理，待你確認</span><b class="kn">${n('review')}</b></div>
    <div class="kpi"><span class="kl">待跟工程師討論</span><b class="kn">${n('approved')}</b></div>
    <div class="kpi"><span class="kl">Claude 整理中</span><b class="kn">${n('open')}</b></div>
    <div class="kpi"><span class="kl">已討論</span><b class="kn">${n('done')}</b></div>
  </section>
  <p class="muted vv-note no-print">怎麼用：在專案的任務視窗下方留言（可以貼截圖）→ Claude 整理成討論重點 →「確認，列入討論清單」→ 跟工程師討論完按「已跟工程師討論」。資料存在整合中心的雲端資料（每天自動備份），圖片存在雲端硬碟「留言截圖」。</p>`;
  const body=vps.map(([pid,p])=>{const u=projUrl(p);
    return `<section class="panel vv-proj"><div class="ph"><h3>${codeTag(p)} ${esc(p.name)}</h3>${u?`<a class="btn ghost no-print" href="${esc(u)}" target="_blank" rel="noopener">開啟系統 ↗</a>`:''}</div><div class="vv-body">${vlBody(pid)}</div></section>`;}).join('');
  return head+statusBanner()+sum+body;
}
function vlText(pid){
  const p=P(pid)||{},gs=vlGroups(pid);let n=0;
  const lines=[`【工程師討論清單】${p.name||''}（${TODAY().replace(/-/g,'/')}，${VL_FILTER[S.vlFilter||'open'][0]}）`];
  for(const g of gs){
    lines.push('',`■ ${g.title}${g.pct!==null?`（執行進度 ${g.pct}%）`:''}${g.url?' '+g.url:''}`);
    for(const [,r] of g.items){
      n++;const imgs=(r.images||[]).length+(r.replies||[]).filter(c=>c.by!=='Claude').reduce((s,c)=>s+(c.images||[]).length,0);
      lines.push(`${n}.〔${reqLabel(r)[0]}〕`,r.brief||r.text||'（只有圖片）');
      if(imgs)lines.push(`（附圖 ${imgs} 張，在倉儲 IT 整合中心看）`);
    }
  }
  return lines.join('\n');
}
function openVendorList(pid){
  const p=P(pid);if(!p)return;
  if(!VL_FILTER[S.vlFilter])S.vlFilter='open';
  M={kind:'vlist',id:pid,opener:document.activeElement};
  $('#sheet').classList.add('wide');document.body.classList.add('print-sheet');
  $('#sheet').innerHTML=`<h2 id="m-title">工程師討論清單</h2>
    <p class="muted vl-sub">${esc(p.code||'')} ${esc(p.name)} · ${TODAY().replace(/-/g,'/')} 整理</p>
    <div class="vl-tools no-print"><div class="seg" role="group" aria-label="篩選">${Object.entries(VL_FILTER).map(([k,[l]])=>`<button type="button" data-act="vl-filter" data-status="${k}" aria-pressed="${S.vlFilter===k}">${l}</button>`).join('')}</div><span class="sp"></span><button type="button" class="btn" data-act="vl-copy">複製文字</button><button type="button" class="btn" data-act="vl-print">列印／存成 PDF</button><button type="button" class="btn" data-act="close-modal">關閉</button></div>
    <div id="vl-body">${vlBody(pid)}</div>`;
  $('#modal').hidden=false;lockScroll();loadImgs();
}
function vlRefresh(){
  if(!M||M.kind!=='vlist')return;
  const b=$('#vl-body');if(b){b.innerHTML=vlBody(M.id);loadImgs();}
  document.querySelectorAll('[data-act=vl-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.status===S.vlFilter)));
}
async function vlCopy(){
  // 專案的討論清單視窗：只複製這個專案；「工程師討論」分頁：所有委外專案
  const txt=M&&M.kind==='vlist'?vlText(M.id):vendorProjects().map(([pid])=>vlText(pid)).join('\n\n');
  if(!txt)return;
  try{await navigator.clipboard.writeText(txt);toast('已複製，可以貼到 LINE 或 Email 給工程師');}
  catch(e){toast('複製失敗，請改用「列印／存成 PDF」');}
}

/* ================= actions ================= */
function setStatus(id,status){
  const t=S.tasks[id];if(!t||!S.canWrite||(t.status||'todo')===status)return;
  const n=Object.assign({},t,{status,updatedAt:new Date().toISOString()});
  if(status==='done')n.doneAt=new Date().toISOString();else delete n.doneAt;
  put('tasks',id,n);
}
function toggleTask(id){const t=S.tasks[id];if(t)setStatus(id,t.status==='done'?'todo':'done');}
/* ================= 操作指南（各系統操作說明書，存在雲端 guides，一章一筆） ================= */
// 管理員按「匯入說明書」：選從 Claude 文件匯出的 Markdown（.md）或直接貼上，每個「## 標題」是一章，整份取代。
// Markdown 只支援說明書用到的格式：### / #### 小標、段落、1. 編號清單、- 項目清單、表格、**粗體**、`程式字`、網址自動變連結。
const guideList=()=>Object.values(S.guides).filter(g=>g&&g.title).sort((a,b)=>(a.order||0)-(b.order||0));
function curGuide(list){list=list||guideList();return list.find(g=>g.id===S.guideCh)||list[0]||null;}
function setGuideCh(id){S.guideCh=id;try{localStorage.setItem(LS_GUIDE,id);}catch(e){}}
// 章的 id 用標題算（重新匯入後，書籤和入口頁的「操作說明」連結還是對得到）
function guideId(title,used){let h=5381;for(const c of title)h=((h*33)^c.codePointAt(0))>>>0;let id='gd'+h.toString(36),n=2;while(used.has(id))id='gd'+h.toString(36)+'-'+(n++);used.add(id);return id;}
function parseGuideMd(text){
  const lines=String(text||'').replace(/^﻿/,'').replace(/\r\n?/g,'\n').split('\n');
  let docTitle='',cur=null;const chs=[];
  for(const ln of lines){
    const h2=/^##\s+(.+?)\s*#*\s*$/.exec(ln);
    if(h2){cur={title:h2[1].trim(),lines:[]};chs.push(cur);continue;}
    const h1=/^#\s+(.+?)\s*#*\s*$/.exec(ln);
    if(h1&&!cur){docTitle=h1[1].trim();continue;}
    if(cur)cur.lines.push(ln);
  }
  return {docTitle,chapters:chs.map(c=>({title:c.title,md:c.lines.join('\n').trim()})).filter(c=>c.title)};
}
const MD_ESC=/\\([!-\/:-@\[-`{-~])/g;
function mdInline(s){
  let t=esc(s);const codes=[];
  t=t.replace(/`([^`]+)`/g,(m,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000';});
  t=t.replace(MD_ESC,'$1');
  t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  t=t.replace(/https?:\/\/[^\s<>"）」，。、；]+/g,u=>{const tail=(/[.,;:!?)]+$/.exec(u)||[''])[0],url=tail?u.slice(0,-tail.length):u;return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;});
  return t.replace(/\u0000(\d+)\u0000/g,(m,i)=>`<code>${codes[+i]}</code>`);
}
const MD_CACHE=new Map();
function mdBlocks(md,pre){
  const key=pre+'\n'+md;if(MD_CACHE.has(key))return MD_CACHE.get(key);
  const L=String(md||'').split('\n'),isRow=l=>/^\s*\|/.test(l),isSep=l=>/^\s*\|?\s*:?-{3,}/.test(l);
  const cells=l=>{let x=l.trim().replace(/\\\|/g,'\u0001');if(x.startsWith('|'))x=x.slice(1);if(x.endsWith('|'))x=x.slice(0,-1);return x.split('|').map(c=>c.replace(/\u0001/g,'|').trim());};
  const OL=/^\d+[.)]\s+/,UL=/^[-*+]\s+/,HD=/^(#{2,6})\s+(.+?)\s*#*\s*$/;
  let i=0,h='',sec=0;
  while(i<L.length){
    const l=L[i];let m;
    if(!l.trim()){i++;continue;}
    if((m=HD.exec(l))){sec++;const lv=m[1].length<=3?3:4;h+=`<h${lv} id="gs-${pre}-${sec}" tabindex="-1">${mdInline(m[2])}</h${lv}>`;i++;continue;}
    if(isRow(l)&&i+1<L.length&&isSep(L[i+1])){
      const head=cells(l),rows=[];i+=2;
      while(i<L.length&&isRow(L[i])){rows.push(cells(L[i]));i++;}
      h+=`<div class="gd-tbl" role="region" aria-label="表格" tabindex="0"><table><thead><tr>${head.map(c=>`<th scope="col">${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if(OL.test(l)||UL.test(l)){
      const ord=OL.test(l),re=ord?OL:UL,start=ord?parseInt(l,10):1,items=[];
      while(i<L.length&&re.test(L[i])){items.push(L[i].replace(re,''));i++;while(i<L.length&&/^\s{2,}\S/.test(L[i])&&!OL.test(L[i].trim())&&!UL.test(L[i].trim())){items[items.length-1]+=' '+L[i].trim();i++;}}
      const tag=ord?'ol':'ul';
      h+=`<${tag}${ord&&start>1?` start="${start}"`:''}>${items.map(x=>`<li>${mdInline(x)}</li>`).join('')}</${tag}>`;
      continue;
    }
    const buf=[];
    while(i<L.length&&L[i].trim()&&!HD.test(L[i])&&!OL.test(L[i])&&!UL.test(L[i])&&!(isRow(L[i])&&i+1<L.length&&isSep(L[i+1]))){buf.push(L[i].trim());i++;}
    if(!buf.length){buf.push(l.trim());i++;}
    const txt=buf.join(' ');
    const cls=/^注意[：:]/.test(txt)?' class="gd-note"':/^\*\*[^*]+\*\*$/.test(txt)?' class="gd-sub"':'';
    h+=`<p${cls}>${mdInline(txt)}</p>`;
  }
  if(MD_CACHE.size>60)MD_CACHE.clear();
  MD_CACHE.set(key,h);return h;
}
// 搜尋：以「小標」為單位；第 0 段是章首（第一個小標之前）
const plainMd=s=>String(s).replace(/^\s*(\d+[.)]|[-*+])\s+/,'').replace(/^\s*\|?\s*:?-{3,}.*$/,'').replace(/\|/g,' ').replace(/\*\*|`/g,'').replace(MD_ESC,'$1').trim();
const SEC_CACHE=new Map();
function guideSections(g){
  const key=g.id+'\n'+g.md;if(SEC_CACHE.has(key))return SEC_CACHE.get(key);
  const out=[{n:0,title:'',text:''}];let sec=0;
  for(const l of String(g.md||'').split('\n')){
    const m=/^#{2,6}\s+(.+?)\s*#*\s*$/.exec(l);
    if(m){sec++;out.push({n:sec,title:plainMd(m[1]),text:''});continue;}
    const t=plainMd(l);if(t)out[out.length-1].text+=t+'\n';
  }
  if(SEC_CACHE.size>60)SEC_CACHE.clear();
  SEC_CACHE.set(key,out);return out;
}
function guideSearch(terms){
  const res=[];
  for(const g of guideList()){
    const gt=g.title.toLowerCase();
    for(const s of guideSections(g)){
      if(!s.n&&!s.text)continue;
      const own=(s.title+'\n'+s.text).toLowerCase();
      // 每個關鍵字要出現在章名或這一段；只靠章名對到的不算（不然整章每一段都會列出來）
      if(terms.every(t=>own.includes(t)||gt.includes(t))&&terms.some(t=>own.includes(t)))res.push({g,s});
    }
  }
  return res;
}
function hl(text,terms){
  if(!terms.length)return esc(text);
  const re=new RegExp('('+terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','gi');
  return String(text).split(re).map((p,i)=>i%2?`<mark>${esc(p)}</mark>`:esc(p)).join('');
}
function snippet(s,terms){
  const t=s.text.replace(/\s+/g,' ').trim();if(!t)return '';
  const low=t.toLowerCase();let at=-1;
  for(const x of terms){const k=low.indexOf(x);if(k>=0&&(at<0||k<at))at=k;}
  if(at<0)at=0;const a=Math.max(0,at-30),b=Math.min(t.length,at+80);
  return (a>0?'…':'')+hl(t.slice(a,b),terms)+(b<t.length?'…':'');
}
function guideResultsHTML(q){
  const terms=q.toLowerCase().split(/\s+/).filter(Boolean),res=guideSearch(terms);
  if(!res.length)return `<section class="panel"><p class="empty">找不到「${esc(q)}」。換個說法試試，例如按鈕上的字或系統名稱。</p></section>`;
  const shown=res.slice(0,60);
  return `<section class="panel gd-res" aria-label="搜尋結果"><div class="ph"><h3>找到 ${res.length} 處${res.length>shown.length?`（列出前 ${shown.length} 處）`:''}</h3><button type="button" class="linkbtn" data-act="g-clear">清除搜尋</button></div>
    <ul>${shown.map(({g,s})=>`<li><button type="button" class="gd-hit" data-act="g-goto" data-id="${esc(g.id)}" data-sec="${s.n}"><span class="gd-hit-t">${hl(g.title,terms)}${s.n?` <span class="gd-hit-sep" aria-hidden="true">›</span> ${hl(s.title,terms)}`:''}</span>${s.text?`<span class="gd-hit-s">${snippet(s,terms)}</span>`:''}</button></li>`).join('')}</ul></section>`;
}
function guideChapterHTML(g,list){
  const i=list?list.findIndex(x=>x.id===g.id):-1,prev=i>0?list[i-1]:null,next=i>=0&&i<list.length-1?list[i+1]:null;
  const back=list&&S.guideLastQ?`<button type="button" class="linkbtn gd-back no-print" data-act="g-back">← 回到「${esc(S.guideLastQ)}」的搜尋結果</button>`:'';
  const pn=list?`<nav class="gd-pn no-print" aria-label="上一章、下一章">${prev?`<button type="button" class="btn ghost" data-act="g-ch" data-id="${esc(prev.id)}"><span aria-hidden="true">←</span> 上一章：${esc(prev.title)}</button>`:'<span></span>'}${next?`<button type="button" class="btn ghost" data-act="g-ch" data-id="${esc(next.id)}">下一章：${esc(next.title)} <span aria-hidden="true">→</span></button>`:''}</nav>`:'';
  return `<article class="panel gd-doc">${back}<h2 class="gd-h" tabindex="-1">${esc(g.title)}</h2><div class="gd-md">${mdBlocks(g.md,(list?'':'p-')+g.id)}</div>${pn}</article>`;
}
function vGuide(){
  const list=guideList(),g=curGuide(list),q=S.guideQ.trim();
  const upd=list.reduce((m,x)=>x.importedAt&&x.importedAt>m?x.importedAt:m,'');
  const docTitle=(list[0]&&list[0].docTitle)||'各系統操作說明書';
  const tools=`<div class="vtools no-print">
    ${list.length?`<input type="search" class="gd-q" id="g-q" data-act="g-q" placeholder="搜尋功能、按鈕名稱…" aria-label="搜尋操作指南" value="${esc(S.guideQ)}" autocomplete="off">
    <button type="button" class="btn" data-act="g-print" data-all="0">列印這一章</button><button type="button" class="btn" data-act="g-print" data-all="1">列印整本</button>`:''}
    ${isAdmin()?`<button type="button" class="btn${list.length?'':' primary'}" data-act="g-import">${list.length?'更新說明書':'匯入說明書'}</button>`:''}</div>`;
  const head=`<section class="vhead"><div><p class="eyebrow">操作指南</p><h1>${esc(docTitle)}${list.length?`<small>${list.length} 章${upd?'・'+esc(new Date(upd).toLocaleDateString('zh-TW'))+' 更新':''}</small>`:''}</h1></div>${tools}</section>`;
  if(!list.length)return head+statusBanner()+`<section class="panel"><p class="empty">還沒有匯入操作說明書。${isAdmin()?'按右上角「匯入說明書」，選擇從 Claude 文件匯出的 Markdown 檔（.md），或直接貼上內容。':'請管理員匯入。'}</p></section>`;
  const toc=`<nav class="panel gd-toc no-print" aria-label="章節"><ol>${list.map((x,i)=>`<li><button type="button" data-act="g-ch" data-id="${esc(x.id)}"${!q&&x.id===g.id?' aria-current="true"':''}><span class="gd-n">${i+1}</span><span>${esc(x.title)}</span></button></li>`).join('')}</ol></nav>`;
  const sel=`<label class="gd-sel no-print"><span>章節</span><select class="sel" id="g-sel">${list.map((x,i)=>`<option value="${esc(x.id)}"${x.id===g.id?' selected':''}>${i+1}. ${esc(x.title)}</option>`).join('')}</select></label>`;
  return head+statusBanner()+`<div class="gd">${toc}<div class="gd-main">${sel}<div id="gd-body">${q?guideResultsHTML(q):guideChapterHTML(g,list)}</div></div></div><div class="gd-print-all"></div>`;
}
// 打字搜尋時只換內容區，搜尋框不重畫（游標不會跳）
function refreshGuideBody(){
  const b=$('#gd-body');if(!b)return;
  const list=guideList(),q=S.guideQ.trim(),g=curGuide(list);
  b.innerHTML=q?guideResultsHTML(q):g?guideChapterHTML(g,list):'';
  document.querySelectorAll('.gd-toc [data-act=g-ch]').forEach(x=>{if(!q&&g&&x.dataset.id===g.id)x.setAttribute('aria-current','true');else x.removeAttribute('aria-current');});
}
function scrollToEl(el){const top=$('.top'),off=(top?top.getBoundingClientRect().height:0)+12;window.scrollTo({top:Math.max(0,el.getBoundingClientRect().top+window.scrollY-off)});}
function openGuideCh(id,sec){
  if(!S.guides[id])return;
  setGuideCh(id);S.guideQ='';
  const fromToc=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.gd-toc,.gd-sel');
  if(S.view!=='guide'){S.view='guide';try{history.replaceState(null,'','#guide');}catch(e){}}
  render();
  const el=sec?document.getElementById(`gs-${id}-${sec}`):$('.gd-doc');
  if(el){scrollToEl(el);if(sec){el.classList.add('gd-flash');setTimeout(()=>el.classList.remove('gd-flash'),1800);}}
  if(!fromToc){const f=sec?el:$('.gd-h');if(f)f.focus({preventScroll:true});}
}
function printGuide(all){
  if(!all&&S.guideQ.trim()){S.guideQ='';render();}
  document.body.classList.add('print-guide');document.body.classList.toggle('print-guide-all',all);
  const b=$('.gd-print-all');if(b)b.innerHTML=all?guideList().map(x=>guideChapterHTML(x,null)).join(''):'';
  setTimeout(()=>window.print(),60);
}
// 入口頁卡片的「操作說明」：用系統名稱對到章名（去掉空白、括號、App／系統／管理等字）
const gnorm=s=>String(s||'').replace(/（[^）]*）|\([^)]*\)/g,'').replace(/\s+/g,'').replace(/app|系統|管理|網頁版/gi,'').toLowerCase();
function guideFor(name){
  const n=gnorm(name);if(n.length<2)return null;
  for(const g of guideList()){
    const alt=/（([^）]+)）/.exec(g.title);
    for(const x of [g.title].concat(alt?[alt[1]]:[])){
      const m=gnorm(x);
      if(m.length>=2&&(m===n||(m.length>=4&&n.includes(m))||(n.length>=4&&m.includes(n))))return g;
    }
  }
  return null;
}
function openGuideImport(){
  if(!isAdmin())return;
  M={kind:'guide',id:null,opener:document.activeElement};
  const has=guideList().length;
  $('#sheet').classList.add('wide');
  $('#sheet').innerHTML=`<form id="m-form" novalidate>
    <h2 id="m-title">${has?'更新操作說明書':'匯入操作說明書'}</h2>
    <p>在 Claude 文件「起士公爵 各系統操作說明書」匯出 Markdown（.md），再按「選擇 .md 檔」；也可以把內容直接貼在下面。每個「## 標題」會變成一章。</p>
    <div class="fgrid">
      <div class="full gd-imp-row"><button type="button" class="btn" data-act="g-file">選擇 .md 檔</button><span class="muted" id="g-fname">還沒選檔案</span></div>
      <label class="full">說明書內容（Markdown）<textarea name="md" id="f-gmd" rows="12" spellcheck="false" placeholder="# 起士公爵 各系統操作說明書&#10;&#10;## 共通操作&#10;…"></textarea></label>
    </div>
    <p class="muted gd-prev" id="g-prev" aria-live="polite">偵測到 0 章</p>
    <p class="muted">${has?`會取代目前的 ${has} 章。`:''}所有登入整合中心的人都看得到；內容存在整合中心的雲端資料，不會放到公開網站。</p>
    <p class="ferr" id="ferr" role="alert"></p>
    <div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn primary" id="f-save">${has?'更新並取代':'匯入'}</button></div>
  </form>`;
  $('#modal').hidden=false;lockScroll();
  setTimeout(()=>{const b=$('#sheet [data-act=g-file]');if(b)b.focus();},0);
}
function readGuideFile(f){
  if(f.size>3000000){toast('檔案太大（3MB 以內）。');return;}
  const r=new FileReader();
  r.onload=()=>{const ta=$('#f-gmd');if(ta){ta.value=String(r.result||'');guidePreview();}const n=$('#g-fname');if(n)n.textContent=f.name;};
  r.onerror=()=>toast('讀不到這個檔案。');
  r.readAsText(f,'utf-8');
}
function guidePreview(){
  const ta=$('#f-gmd'),p=$('#g-prev');if(!ta||!p)return;
  const r=parseGuideMd(ta.value);
  p.textContent=r.chapters.length?`偵測到 ${r.chapters.length} 章：${r.chapters.map(c=>c.title).join('、')}`:'偵測到 0 章（每章要用「## 標題」開頭）';
}
function doGuideImport(){
  if(!isAdmin())return;
  const r=parseGuideMd(($('#f-gmd')||{}).value);
  if(!r.chapters.length){$('#ferr').textContent='找不到「## 標題」，沒辦法分章。請確認貼上的是 Markdown。';return;}
  const at=new Date().toISOString(),by=myName(),used=new Set();
  const recs=r.chapters.map((c,i)=>({id:guideId(c.title,used),order:i+1,title:c.title,md:c.md,docTitle:r.docTitle,importedAt:at,importedBy:by,updatedBy:by}));
  try{
    ST.replaceKinds({guides:recs});
    if(!recs.some(x=>x.id===S.guideCh))setGuideCh(recs[0].id);
    S.guideQ='';S.guideLastQ='';closeModal();
    toast(`已匯入 ${recs.length} 章操作指南`);
    if(S.view!=='guide')go('guide');
  }catch(e){$('#ferr').textContent='匯入失敗：'+e.message;}
}

function go(view){
  if(!VIEWS.includes(view)||(view==='users'&&!isAdmin()))view='portal';
  S.view=view;render();window.scrollTo(0,0);
  try{if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);}catch(e){}
}
function readHash(){const h=(location.hash||'').slice(1);S.view=VIEWS.includes(h)?h:'portal';if(S.view==='users'&&AU&&AU.user()&&!isAdmin())S.view='portal';}
function calNav(dir){
  if(dir===0){S.calMonth=TODAY().slice(0,7);S.selDay=TODAY();}
  else{
    const [y,m]=S.calMonth.split('-').map(Number);const d=new Date(y,m-1+dir,1);
    S.calMonth=ds(d).slice(0,7);
    S.selDay=S.calMonth===TODAY().slice(0,7)?TODAY():ds(d);
  }
  render();
}
function toggleMenu(force){
  const m=$('#add-menu'),b=$('#add-btn');const open=force!==undefined?force:m.hidden;
  m.hidden=!open;b.setAttribute('aria-expanded',String(open));
  if(open){const f=m.querySelector('button');if(f)f.focus();}
}

/* ================= render ================= */
let raf=0;
function schedule(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render();});setTimeout(()=>{if(raf){cancelAnimationFrame(raf);raf=0;render();}},250);}
function focusKey(el){if(!el||!el.dataset||!el.dataset.act)return null;const d=el.dataset;return [d.act,d.id||'',d.to||'',d.day||'',d.dir||'',d.view||'',d.status||''].join('|');}
function render(){
  document.body.classList.toggle('readonly',!S.canWrite);
  document.body.classList.toggle('is-admin',isAdmin());
  if(S.view==='users'&&AU&&AU.user()&&!isAdmin())S.view='portal';
  document.querySelectorAll('.tabs [data-act=nav]').forEach(b=>{if(b.dataset.view===S.view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  document.querySelectorAll('[data-act=cat]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cat===S.cat)));
  const main=$('#main');
  const fk=main.contains(document.activeElement)?focusKey(document.activeElement):null;
  const lw=main.querySelector('.lanes-wrap');const sl=lw?lw.scrollLeft:0;
  S.loaded=!!ST.status().loaded;
  main.innerHTML=S.view==='users'?vUsers():!S.loaded?loadingHTML():({portal:vPortal,overview:vOverview,calendar:vCalendar,projects:vProjects,board:vBoard,vendor:vVendor,guide:vGuide}[S.view]||vPortal)();
  document.body.classList.toggle('print-view',S.view==='vendor');
  const lw2=main.querySelector('.lanes-wrap');if(lw2)lw2.scrollLeft=sl;
  if(fk){for(const el of main.querySelectorAll('[data-act]'))if(focusKey(el)===fk){el.focus({preventScroll:true});if(el.id==='g-q'){const n=el.value.length;try{el.setSelectionRange(n,n);}catch(e){}}break;}}
  const top=$('.top');if(top)document.documentElement.style.setProperty('--top-h',top.offsetHeight+'px');
  renderSync();renderFoot();renderAlert();
  // 任務視窗開著時，留言有新回覆就更新（留言框不動，打到一半的字不會不見）
  if(M&&M.kind==='task'&&M.id){const l=$('#t-rq-list');if(l){l.innerHTML=taskReqList(M.id);loadImgs();}}
  vlRefresh();
  if(S.openProject||!$('#drawer').hidden){
    const dr=$('#drawer');const dfk=dr.contains(document.activeElement)?focusKey(document.activeElement):null;
    renderDrawer();
    if(dfk){for(const el of dr.querySelectorAll('[data-act]'))if(focusKey(el)===dfk){el.focus({preventScroll:true});break;}}
  }
}
function renderSync(){
  const st=ST.status(),el=$('#sync');
  const map={loading:['busy','讀取中…'],syncing:['busy','同步中…'],pending:['busy','等待上傳'],synced:['ok','已同步'],offline:['warn','離線'],error:['bad','連線失敗']};
  const [cls,txt]=map[st.state]||['',st.state];
  el.className='sync '+cls;el.querySelector('span').textContent=txt;
  el.title=(st.detail?st.detail+'。':'')+(st.lastSync?'上次同步 '+new Date(st.lastSync).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})+'。':'')+'按一下立即同步';
}
// Demo 待你確認的數量：「專案」分頁的紅色數字、瀏覽器分頁標題（視窗在背景時也看得到）
const BASE_TITLE=document.title;
function renderAlert(){
  const n=E(S.requests).filter(x=>x[1].status==='review').length,b=$('#nb-review');
  if(b){b.textContent=n;b.hidden=!n;b.setAttribute('aria-label',`${n} 個待你確認`);}
  document.title=n?`(${n}) 待你確認｜${BASE_TITLE}`:BASE_TITLE;
  // 「工程師討論」分頁：有委外專案才顯示；數字＝待你確認＋待跟工程師討論
  const tab=document.querySelector('.tabs [data-view=vendor]'),vb=$('#nb-vendor');
  if(tab)tab.hidden=!vendorProjects().length;
  if(vb){const m=vendorReqs().filter(x=>x[1].status==='review'||x[1].status==='approved').length;vb.textContent=m;vb.hidden=!m;vb.setAttribute('aria-label',`${m} 件要處理`);}
}
function renderFoot(){
  const n=c=>Object.keys(S[c]).length;
  const me=AU&&AU.user()?`<span class="me">登入：<b>${esc(myName())}</b>${canEdit()?'':'（只能查看）'}<button type="button" class="linkbtn" data-act="logout">登出</button></span>`:'';
  $('#foot').innerHTML=`${me}<span>${n('projects')} 個專案 · ${n('tasks')} 筆任務 · ${n('events')} 個行程</span>`;
}
let tt=0;
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>{t.hidden=true;},2800);}

/* ================= events ================= */
document.addEventListener('click',e=>{
  const menu=$('#add-menu');
  if(!menu.hidden&&!e.target.closest('.add'))toggleMenu(false);
  if(e.target.id==='drawer'){S.openProject=null;renderDrawer();return;}
  if(e.target.id==='modal'){closeModal();return;}
  const a=e.target.closest('[data-act]');if(!a)return;
  const d=a.dataset;
  switch(d.act){
    case 'nav':go(d.view);break;
    case 'cat':S.cat=d.cat;savePref();render();break;
    case 'add-menu':toggleMenu();break;
    case 'new':toggleMenu(false);openForm(d.kind,null,{date:d.date,project:d.project});break;
    case 'edit':openForm(d.kind,d.id);break;
    case 'open-project':S.openProject=d.id;renderDrawer();setTimeout(()=>{const b=$('#drawer [data-act=close-drawer]');if(b)b.focus();},0);break;
    case 'close-drawer':S.openProject=null;renderDrawer();break;
    case 'close-modal':closeModal();break;
    case 'toggle':toggleTask(d.id);break;
    case 'move':setStatus(d.id,d.to);break;
    case 'cal':calNav(+d.dir);break;
    case 'sel-day':S.selDay=d.day;if(d.day.slice(0,7)!==S.calMonth)S.calMonth=d.day.slice(0,7);render();break;
    case 'proj-status':S.projStatus=d.status;render();break;
    case 'show-done':S.showAllDone=!S.showAllDone;render();break;
    case 'del':{
      let label='再按一次確認刪除';
      if(M&&M.kind==='project'){const n=Object.values(S.tasks).filter(t=>t.projectId===M.id).length;if(n)label=`再按一次：連同 ${n} 筆任務一起刪除`;}
      arm(a,label,deleteCurrent);break;}
    case 'sync':ST.syncNow();break;
    case 'logout':AU.logout();break;
    case 'add-user':openUserForm(null,false);break;
    case 'reload-users':U.error='';loadUsers();break;
    case 'edit-user':{const u=(U.list||[]).find(x=>x.email===d.id);if(u)openUserForm(Object.assign({},u),true);break;}
    case 'toggle-user':{const u=(U.list||[]).find(x=>x.email===d.id);if(u)userCall('userSave',{email:u.email,name:u.name,pages:u.pages,enabled:!u.enabled},u.enabled?`已停用 ${u.email}`:`已啟用 ${u.email}`);break;}
    case 'delete-user':arm(a,'再按一次確認刪除',()=>userCall('userDelete',{email:d.id},`已刪除 ${d.id}`));break;
    case 'backup':exportBackup();break;
    case 'req-send':sendReq(d.id);break;
    case 'req-send-task':{const t=S.tasks[d.id];if(t)sendReq(t.projectId,d.id);else toast('這個任務已被刪除');break;}
    case 'req-approve':{const r=S.requests[d.id];setReq(d.id,{status:'approved'},r&&isVendorReq(r)?'已列入「工程師討論清單」':'已核准，Claude 會直接收到並上線');break;}
    case 'req-discussed':setReq(d.id,{status:'done'},'已標記為「已跟工程師討論」');break;
    case 'req-done-toggle':if(SHOW_DONE.has(d.key))SHOW_DONE.delete(d.key);else SHOW_DONE.add(d.key);render();break;
    case 'vendor-list':openVendorList(d.id);break;
    case 'vl-filter':S.vlFilter=d.status;if(M&&M.kind==='vlist')vlRefresh();else render();break;
    case 'vl-copy':vlCopy();break;
    case 'vl-print':window.print();break;
    case 'img-pick':{const f=$('#imgFile');f.dataset.key=d.key;f.value='';f.click();break;}
    case 'img-remove':PEND[d.key]=pendOf(d.key).filter(im=>im.id!==d.id);refreshPend(d.key);break;
    case 'req-cancel':arm(a,'再按一次確認取消',()=>setReq(d.id,{status:'closed'},'已取消這則留言'));break;
    case 'req-revise':openRevise(d.id);break;
    case 'req-img':openImg(d.id);break;
    case 'import':{const f=$('#importFile');f.value='';f.click();break;}
    case 'g-ch':S.guideLastQ='';openGuideCh(d.id);break;
    case 'g-open':S.guideLastQ='';openGuideCh(d.id);break;
    case 'g-goto':S.guideLastQ=S.guideQ.trim();openGuideCh(d.id,+d.sec||0);break;
    case 'g-back':S.guideQ=S.guideLastQ;S.guideLastQ='';render();setTimeout(()=>{const q=$('#g-q');if(q){q.focus();const n=q.value.length;try{q.setSelectionRange(n,n);}catch(e){}}},0);break;
    case 'g-clear':S.guideQ='';S.guideLastQ='';render();setTimeout(()=>{const q=$('#g-q');if(q)q.focus();},0);break;
    case 'g-import':openGuideImport();break;
    case 'g-file':{const f=$('#guideFile');f.value='';f.click();break;}
    case 'g-print':printGuide(d.all==='1');break;
  }
});
$('#sync').addEventListener('click',()=>ST.syncNow());
$('#importFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readImport(f);});
$('#imgFile').addEventListener('change',e=>{const k=e.target.dataset.key;if(k)addImages(k,e.target.files);});
$('#guideFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readGuideFile(f);});
window.addEventListener('afterprint',()=>{document.body.classList.remove('print-guide','print-guide-all');const b=$('.gd-print-all');if(b)b.innerHTML='';});
// 在留言框貼上截圖（Ctrl+V）：有圖片就上傳，純文字照常貼上
document.addEventListener('paste',e=>{
  const box=e.target&&e.target.closest&&e.target.closest('.rq-new');if(!box)return;
  const files=[...((e.clipboardData&&e.clipboardData.files)||[])].filter(f=>/^image\//.test(f.type));
  if(!files.length)return;
  e.preventDefault();addImages(box.dataset.key,files);
});
document.addEventListener('submit',e=>{if(e.target&&e.target.id==='m-form'){e.preventDefault();submitForm(e.target);}});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.change==='board-project'){S.boardProject=t.value;render();return;}
  if(t.id==='g-sel'){S.guideLastQ='';openGuideCh(t.value);return;}
  if(t.id==='f-cat'){const c=$('#f-code');if(c&&c.dataset.auto==='1')c.value=nextCode(t.value);}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='f-code')t.dataset.auto='0';
  if(t.id==='f-prog'){const o=$('#f-prog-out');if(o)o.textContent=t.value+'%';}
  if(t.id==='f-tprog'){const o=$('#f-tprog-out');if(o)o.textContent=t.value+'%';}
  if(t.id==='g-q'){S.guideQ=t.value;S.guideLastQ='';refreshGuideBody();}
  if(t.id==='f-gmd')guidePreview();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(!$('#modal').hidden){closeModal();return;}
    if(!$('#add-menu').hidden){toggleMenu(false);$('#add-btn').focus();return;}
    if(S.openProject){S.openProject=null;renderDrawer();return;}
    return;
  }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[role=button][data-act]')){e.preventDefault();e.target.click();}
});
window.addEventListener('hashchange',()=>{readHash();render();});

let dragId=null;
const elOf=t=>t&&t.nodeType===1?t:(t&&t.parentElement);
document.addEventListener('dragstart',e=>{
  const c=elOf(e.target)&&elOf(e.target).closest('.tcard');if(!c||!S.canWrite)return;
  dragId=c.dataset.id;try{e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';}catch(x){}
  c.classList.add('dragging');
});
document.addEventListener('dragend',()=>{dragId=null;document.querySelectorAll('.dragging,.lane.over').forEach(x=>x.classList.remove('dragging','over'));});
document.addEventListener('dragover',e=>{
  const l=elOf(e.target)&&elOf(e.target).closest('.lane');if(!l||!dragId)return;
  e.preventDefault();try{e.dataTransfer.dropEffect='move';}catch(x){}
  document.querySelectorAll('.lane.over').forEach(x=>{if(x!==l)x.classList.remove('over');});l.classList.add('over');
});
document.addEventListener('drop',e=>{
  const l=elOf(e.target)&&elOf(e.target).closest('.lane');if(!l||!dragId)return;
  e.preventDefault();const id=dragId;dragId=null;l.classList.remove('over');setStatus(id,l.dataset.lane);
});

/* ================= 啟動 ================= */
ST.on(type=>{
  if(type==='change'){pullFromStore();schedule();}
  else if(type==='status'){renderSync();const l=!!ST.status().loaded;if(l!==S.loaded||ST.status().state==='error'||ST.status().state==='offline')schedule();}
  else if(type==='conflict')toast('有同事同時修改了同一筆資料，已自動合併；同一個欄位以你的修改為準。');
});
AU.on(()=>{U.list=null;schedule();});
readHash();pullFromStore();render();
AU.ready.then(()=>{pullFromStore();render();});
if('serviceWorker' in navigator&&location.protocol==='https:'){
  window.addEventListener('load',()=>{navigator.serviceWorker.register('service-worker.js').catch(()=>{});});
}
// 跨日（App 開著過午夜）時，「今天」跟著更新
let lastDay=TODAY();
setInterval(()=>{const d=TODAY();if(d!==lastDay){lastDay=d;schedule();}},60000);
})();
