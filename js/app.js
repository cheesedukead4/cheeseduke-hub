/*
 * 倉儲 IT 整合中心｜全部畫面
 * ---------------------------------------------------------------
 * 頁面：入口（首頁）、總覽、行事曆、專案、進度看板、管理（人員與權限、備份，只有管理員）。網址 #portal #overview #calendar #projects #board #users。
 * 資料（WIStore，見 cloud-store.js），每一筆都有 id：
 *   projects  { id, code, name, category: wh|it|gn, status: plan|active|hold|done, priority: high|mid|low,
 *               start, end (YYYY-MM-DD), owner, folder, url (系統網址，入口頁用), desc, progress (0-100，沒有任務時才用), createdAt, updatedAt, updatedBy }
 *             沒填 url 時，用說明裡的「App：網址」或「入口網址：網址」。
 *   links     入口頁的常用連結（不是專案的系統，例如夥伴交接看板）{ id, title, url, category: wh|it|gn, note }
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
const VIEWS=['portal','overview','calendar','projects','board','users'];
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
  projects:{},tasks:{},events:{},requests:{},links:{},
  view:'portal',cat:'all',
  calMonth:TODAY().slice(0,7),selDay:TODAY(),
  boardProject:'all',projStatus:'all',showAllDone:false,
  openProject:null,loaded:false
};
Object.defineProperty(S,'canWrite',{get:canEdit});
try{const p=JSON.parse(localStorage.getItem(LS_PREF)||'{}');if(['all','wh','it'].includes(p.cat))S.cat=p.cat;}catch(e){}
const savePref=()=>{try{localStorage.setItem(LS_PREF,JSON.stringify({cat:S.cat}));}catch(e){}};

const P=id=>id?S.projects[id]:null;
const catP=p=>p&&CAT[p.category]?p.category:'gn';
const catT=t=>{const p=P(t.projectId);return p?catP(p):'gn';};
const catE=e=>{const p=P(e.projectId);return p?catP(p):(ETYPE[e.type]?ETYPE[e.type][1]:'gn');};
const inCat=c=>S.cat==='all'||S.cat===c;

function pullFromStore(){
  const m=kind=>{const o={};for(const r of ST.list(kind))if(r&&r.id!=null)o[r.id]=r;return o;};
  S.projects=m('projects');S.tasks=m('tasks');S.events=m('events');S.requests=m('requests');S.links=m('links');
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
const liveReqs=pid=>E(S.requests).filter(x=>x[1].projectId===pid&&x[1].status!=='closed').sort((a,b)=>(b[1].createdAt||'').localeCompare(a[1].createdAt||''));
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
const taskReqs=tid=>E(S.requests).filter(x=>x[1].taskId===tid&&x[1].status!=='closed').sort((a,b)=>(b[1].createdAt||'').localeCompare(a[1].createdAt||''));
// showTask：在專案詳情裡標出「任務：…」；在任務自己的視窗裡不用標
function reqHTML([id,r],showTask){
  const st=REQ[r.status]||REQ.open;
  const tk=showTask===true&&r.taskId?`<span class="rq-task">任務：${esc(reqTask(r))}</span>`:'';
  const replies=(r.replies||[]).map(c=>`<div class="rq-reply${c.by==='Claude'?' ai':''}"><div class="rq-who"><b>${esc(c.by||'')}</b> <span class="muted">${whenTxt(c.at)}</span></div>${c.text?`<p>${esc(c.text)}</p>`:''}${c.images&&c.images.length?`<div class="rq-imgs">${c.images.map(imgTag).join('')}</div>`:''}</div>`).join('');
  const acts=r.status==='review'?`<button type="button" class="btn primary" data-act="req-approve" data-id="${esc(id)}">核准上線</button><button type="button" class="btn" data-act="req-revise" data-id="${esc(id)}">還要修改</button>`
    :r.status==='open'?`<button type="button" class="btn ghost" data-act="req-cancel" data-id="${esc(id)}">取消留言</button>`:'';
  // 還沒有 Claude 的回覆：顯示等待中（轉送收到後會先回覆「已交給 Claude 的…處理」）
  const rs=r.replies||[],lastBy=rs.length?rs[rs.length-1].by:'';
  const wait=(r.status==='open'||r.status==='approved')&&lastBy!=='Claude'?`<p class="muted rq-wait">${r.status==='approved'?'已核准，等待 Claude 收到後上線…':'等待 Claude 收到…（通常 1 分鐘內會在這裡回覆）'}</p>`:'';
  return `<div class="rq"><div class="rq-h"><span class="pill ${st[1]}">${st[0]}</span>${tk}<span class="muted">${esc(r.createdBy||'')} · ${whenTxt(r.createdAt)}</span></div><p class="rq-t">${esc(r.text)}</p>${replies}${wait}${acts?`<div class="rq-a w-only">${acts}</div>`:''}</div>`;
}
// 任務視窗下方：這個任務給 Claude 的留言
const taskReqList=tid=>{const l=taskReqs(tid);return l.length?l.map(x=>reqHTML(x,false)).join(''):'<p class="muted" style="font-size:12.5px">這個任務還沒有留言。</p>';};
function taskReqSection(tid){
  return `<section class="t-rq" aria-label="這個任務給 Claude 的留言">
    <h3>給 Claude 的留言（這個任務）</h3>
    <p class="muted rq-hint">只針對這個任務。送出後會直接交給 Claude 處理，不用打開專案；Claude 收到後會在這裡回覆，改好會先附 demo 截圖，你按「核准上線」才會上線。</p>
    <div id="t-rq-list">${taskReqList(tid)}</div>
    <div class="rq-new w-only"><textarea id="trq-text" maxlength="2000" placeholder="例如：這一頁的表格加上日期篩選"></textarea><button type="button" class="btn primary" data-act="req-send-task" data-id="${esc(tid)}">送出留言</button></div>
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
  const goLine=u=>`<span class="pt-go"><span class="pt-site">${esc(siteOf(u))}</span><span class="pt-arrow" aria-hidden="true">開啟 ↗</span></span>`;
  const pTiles=withUrl.map(([id,p])=>{
    const c=catP(p),u=projUrl(p),n=liveReqs(id).filter(x=>x[1].status==='review').length,dl=descLine(p);
    return `<article class="ptile c-${c}">
      <a class="pt-main" ${ext(u)} aria-label="在新分頁開啟 ${esc(p.code||'')} ${esc(p.name)}">
        <span class="pt-top">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${p.status!=='active'?statusPill(p):''}</span>
        <b class="pt-name">${esc(p.name)}</b>
        ${dl?`<span class="pt-desc">${esc(dl)}</span>`:''}
        ${goLine(u)}
      </a>
      <div class="pt-foot"><button type="button" class="linkbtn" data-act="open-project" data-id="${esc(id)}">專案詳情</button>${n?`<span class="pill warn">${n} 則留言待你確認</span>`:''}</div>
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
      <div class="pt-foot w-only"><button type="button" class="linkbtn" data-act="edit" data-kind="link" data-id="${esc(id)}">編輯連結</button></div>
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
  const reqPanel=rqs.length?`<section class="panel"><div class="ph"><h3>給 Claude 的留言</h3><span class="muted">待你確認 ${rqs.filter(x=>x[1].status==='review').length}</span></div><div class="plist">${rqs.map(([id,r])=>{const p=P(r.projectId),st=REQ[r.status]||REQ.open;return `<button type="button" class="prow" data-act="open-project" data-id="${esc(r.projectId)}"><span class="prow-top">${codeTag(p)}<span class="pill ${st[1]}">${st[0]}</span></span><span class="rq-line">${r.taskId?`〔${esc(reqTask(r))}〕`:''}${esc(r.text)}</span></button>`;}).join('')}</div></section>`:'';
  return head+statusBanner()+kpis+`<div class="ov-grid"><div class="ov-col">${agenda}${attention}</div><div class="ov-col">${reqPanel}${projPanel}</div></div>`;
}
function projSort(a,b){
  const s=(PORDER[a[1].status]??9)-(PORDER[b[1].status]??9);if(s)return s;
  return (a[1].end||'9999').localeCompare(b[1].end||'9999');
}
function projRow([id,p]){
  const g=prog(id),c=catP(p);
  return `<button type="button" class="prow" data-act="open-project" data-id="${esc(id)}">
    <span class="prow-top">${codeTag(p)}<span class="prow-name">${esc(p.name)}</span>${smp(p)}</span>
    ${barHTML(c,g.pct,g.tpos)}
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
    const g=prog(id),c=catP(p);
    return `<article class="pcard c-${c}" data-act="open-project" data-id="${esc(id)}" role="button" tabindex="0" aria-label="${esc(p.code)} ${esc(p.name)}，完成 ${g.pct}%">
      <div class="pc-top">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${smp(p)}${(n=>n?`<span class="pill warn">${n} 則留言待你確認</span>`:'')(liveReqs(id).filter(x=>x[1].status==='review').length)}${statusPill(p)}</div>
      <h3>${esc(p.name)}</h3>
      <p class="pc-meta">${p.owner?esc(p.owner)+' · ':''}${fmtD(p.start)} → ${fmtD(p.end)}${p.priority==='high'?' · 高優先':''}</p>
      ${barHTML(c,g.pct,g.tpos)}
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
        ${st!=='done'&&tpct(x)>0?`<div class="tc-prog">${miniBar(catT(x),tpct(x))}<em>${tpct(x)}%</em></div>`:''}
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
  downloadFile(`倉儲IT整合中心_備份_${TODAY()}.json`,JSON.stringify({app:BACKUP_APP,version:1,exportedAt:new Date().toISOString(),exportedBy:myName(),projects:strip('projects'),tasks:strip('tasks'),events:strip('events'),links:strip('links')},null,2),'application/json;charset=utf-8');
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
    pendingImport=o;
    M={kind:'import',id:null,opener:document.activeElement};
    $('#sheet').innerHTML=`<form id="m-form" novalidate>
      <h2 id="m-title">匯入 JSON 備份？</h2>
      <p>將以「${esc(file.name)}」取代雲端上所有人共用的資料：</p>
      <ul><li>專案 ${o.projects.length} 個</li><li>任務 ${o.tasks.length} 筆</li><li>行程 ${o.events.length} 個</li>${o.links?`<li>常用連結 ${o.links.length} 個</li>`:''}</ul>
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
  const kinds={projects:o.projects,tasks:o.tasks,events:o.events};if(o.links)kinds.links=o.links;
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
    <div class="d-head">${codeTag(p)}<span class="tag c-${c}">${CAT[c]}</span>${statusPill(p)}${smp(p)}<button type="button" class="btn ghost icon" data-act="close-drawer" aria-label="關閉專案詳情">✕</button></div>
    <h2 id="d-title">${esc(p.name)}</h2>
    ${(u=>u&&!isSelf(u)?`<a class="btn primary d-open" href="${esc(u)}" target="_blank" rel="noopener">開啟系統 ↗<span class="d-site">${esc(siteOf(u))}</span></a>`:'')(projUrl(p))}
    <dl class="facts">
      <div><dt>負責人</dt><dd>${esc(p.owner)||'—'}</dd></div>
      <div><dt>優先級</dt><dd>${PRIO[p.priority]||'中'}</dd></div>
      <div><dt>期間</dt><dd>${fmtD(p.start)} → ${fmtD(p.end)}</dd></div>
      <div><dt>截止</dt><dd>${endLabel(p)}</dd></div>
    </dl>
    ${p.desc?`<p class="desc">${esc(p.desc)}</p>`:''}
    <div class="d-prog">${barHTML(c,g.pct,g.tpos)}<div class="d-prog-meta"><span>整體進度 <b>${g.pct}%</b></span>${g.tpos!==null?`<span>時程已過 ${g.tpos}%</span>`:''}<span class="pill ${g.health[0]}">${g.health[1]}</span>${g.total?'<span>（各任務進度的平均）</span>':'<span>（沒有任務時，以專案設定的進度為準）</span>'}</div></div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>任務<span>${g.done}/${g.total}</span></h3><button type="button" class="btn w-only" data-act="new" data-kind="task" data-project="${esc(id)}">＋ 任務</button></div>
      ${ts.length?ts.map(([tid,x])=>{const di=dueInfo(x),tp=tpct(x);return `<div class="dtask">${ckBtn(tid,x)}<button type="button" class="amain" data-act="edit" data-kind="task" data-id="${esc(tid)}" aria-label="${esc(x.title)}，執行進度 ${tp}%，按一下修改"><b class="${x.status==='done'?'done-t':''}">${esc(x.title)} ${smp(x)}</b><small>${x.assignee?esc(x.assignee)+' · ':''}${di?`<span class="due ${di[0]}">${di[1]}</span>`:'未設到期日'}${(l=>l.length?` · <span class="${l.some(q=>q[1].status==='review')?'due warn':''}">留言 ${l.length}${l.some(q=>q[1].status==='review')?'（待你確認）':''}</span>`:'')(taskReqs(tid))}</small><span class="dt-prog">${miniBar(c,tp)}<em>${tp}%</em></span></button><span class="pill ${x.status==='done'?'ok':x.status==='review'?'warn':x.status==='doing'?'info':''}">${TLABEL[x.status]||'待辦'}</span></div>`;}).join(''):'<p class="muted">還沒有任務。把專案拆成幾個具體步驟，每個任務有自己的進度，專案進度會自動平均。</p>'}
    </div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>接下來的行程</h3><button type="button" class="btn w-only" data-act="new" data-kind="event" data-project="${esc(id)}">＋ 行程</button></div>
      ${evs.length?evs.map(([eid,e])=>`<button type="button" class="dpi c-${catE(e)}" data-act="edit" data-kind="event" data-id="${esc(eid)}"><span class="dpi-t">${mdw(e.date)}</span><span class="dpi-m"><b>${esc(e.title)}</b><small>${e.start?esc(e.start)+' · ':''}${evMeta(e)}</small></span></button>`).join(''):'<p class="muted">沒有排定的行程。</p>'}
    </div>
    <div class="d-sec">
      <div class="d-sec-h"><h3>給 Claude 的留言</h3></div>
      <p class="muted rq-hint">送出後會直接交給 Claude 處理，不用打開專案。Claude 收到後會在這裡回覆（電腦上的 Claude 要開著）；改好會先附 demo 截圖，你按「核准上線」才會上線。只針對某個任務的話，點上面那個任務，在任務視窗下方留言。</p>
      ${liveReqs(id).map(x=>reqHTML(x,true)).join('')}
      <div class="rq-new w-only"><textarea id="rq-text" maxlength="2000" placeholder="例如：首頁的表格加一欄「負責人」"></textarea><button type="button" class="btn primary" data-act="req-send" data-id="${esc(id)}">送出留言</button></div>
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
  return {name:'',category:cat,code:nextCode(cat),status:'active',priority:'mid',start:TODAY(),end:'',owner:'',folder:'',url:'',desc:'',progress:0};
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
  const op=M&&M.opener;M=null;pendingImport=null;$('#modal').hidden=true;$('#sheet').innerHTML='';$('#sheet').classList.remove('wide');lockScroll();
  if(op&&op.isConnected)try{op.focus();}catch(e){}
}
function lockScroll(){document.body.classList.toggle('locked',!$('#modal').hidden||!$('#drawer').hidden);}

async function submitForm(form){
  if(!M)return;
  if(M.kind==='user')return submitUser(form);
  if(M.kind==='import')return doImport();
  if(M.kind==='reqrevise')return submitRevise(form);
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
    data={name:v('name'),category:CAT[v('category')]?v('category'):'gn',code:v('code').toUpperCase(),status:PSTATUS[v('status')]?v('status'):'active',priority:PRIO[v('priority')]?v('priority'):'mid',start:v('start'),end:v('end'),owner:v('owner'),folder:v('folder'),url:v('url'),desc:v('desc'),progress:Math.max(0,Math.min(100,+v('progress')||0))};
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
  if(!t){toast('請先寫留言內容');if(ta)ta.focus();return;}
  const iso=new Date().toISOString(),task=tid?S.tasks[tid]:null;
  if(tid&&!task){toast('這個任務已被刪除');return;}
  const rec={projectId:pid||(task&&task.projectId)||'',text:t,status:'open',replies:[],createdAt:iso,updatedAt:iso};
  if(task){rec.taskId=tid;rec.taskTitle=task.title;}
  put('requests',uid('r'),rec);
  if(ta)ta.value='';
  toast('已送出，Claude 會直接收到並開始處理（約 1 分鐘內在這裡回覆）');
}
function setReq(id,patch,msg){
  const r=S.requests[id];if(!r)return;
  put('requests',id,Object.assign({},r,patch,{updatedAt:new Date().toISOString()}));
  if(msg)toast(msg);
}
function openRevise(id){
  if(!S.requests[id])return;
  M={kind:'reqrevise',id,opener:document.activeElement};
  $('#sheet').innerHTML=`<form id="m-form" novalidate>
    <h2 id="m-title">還要修改什麼？</h2>
    <p class="muted" style="margin-bottom:10px">原本的留言：${esc(S.requests[id].text)}</p>
    <div class="fgrid"><label class="full">補充說明 <span class="req">*</span><textarea name="text" id="f-title" maxlength="2000" placeholder="例如：按鈕再大一點，手機上也要看得到"></textarea></label></div>
    <p class="ferr" id="ferr" role="alert"></p>
    <div class="m-foot"><span class="sp"></span><button type="button" class="btn" data-act="close-modal">取消</button><button type="submit" class="btn primary" id="f-save">送出</button></div>
  </form>`;
  $('#modal').hidden=false;lockScroll();
  setTimeout(()=>{const f=$('#f-title');if(f)f.focus();},0);
}
function submitRevise(form){
  const r=S.requests[M.id];const t=String(new FormData(form).get('text')||'').trim();
  if(!t){$('#ferr').textContent='請寫要修改的地方。';return;}
  if(!r){closeModal();return;}
  const replies=(r.replies||[]).concat([{id:uid('c'),by:myName(),text:t,at:new Date().toISOString()}]);
  setReq(M.id,{replies,status:'open'},'已送出，Claude 會直接收到並再修改');
  closeModal();
}

/* ================= actions ================= */
function setStatus(id,status){
  const t=S.tasks[id];if(!t||!S.canWrite||(t.status||'todo')===status)return;
  const n=Object.assign({},t,{status,updatedAt:new Date().toISOString()});
  if(status==='done')n.doneAt=new Date().toISOString();else delete n.doneAt;
  put('tasks',id,n);
}
function toggleTask(id){const t=S.tasks[id];if(t)setStatus(id,t.status==='done'?'todo':'done');}
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
  main.innerHTML=S.view==='users'?vUsers():!S.loaded?loadingHTML():({portal:vPortal,overview:vOverview,calendar:vCalendar,projects:vProjects,board:vBoard}[S.view]||vPortal)();
  const lw2=main.querySelector('.lanes-wrap');if(lw2)lw2.scrollLeft=sl;
  if(fk){for(const el of main.querySelectorAll('[data-act]'))if(focusKey(el)===fk){el.focus({preventScroll:true});break;}}
  renderSync();renderFoot();
  // 任務視窗開著時，留言有新回覆就更新（留言框不動，打到一半的字不會不見）
  if(M&&M.kind==='task'&&M.id){const l=$('#t-rq-list');if(l){l.innerHTML=taskReqList(M.id);loadImgs();}}
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
    case 'req-approve':setReq(d.id,{status:'approved'},'已核准，Claude 會直接收到並上線');break;
    case 'req-cancel':arm(a,'再按一次確認取消',()=>setReq(d.id,{status:'closed'},'已取消這則留言'));break;
    case 'req-revise':openRevise(d.id);break;
    case 'req-img':openImg(d.id);break;
    case 'import':{const f=$('#importFile');f.value='';f.click();break;}
  }
});
$('#sync').addEventListener('click',()=>ST.syncNow());
$('#importFile').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)readImport(f);});
document.addEventListener('submit',e=>{if(e.target&&e.target.id==='m-form'){e.preventDefault();submitForm(e.target);}});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.change==='board-project'){S.boardProject=t.value;render();return;}
  if(t.id==='f-cat'){const c=$('#f-code');if(c&&c.dataset.auto==='1')c.value=nextCode(t.value);}
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='f-code')t.dataset.auto='0';
  if(t.id==='f-prog'){const o=$('#f-prog-out');if(o)o.textContent=t.value+'%';}
  if(t.id==='f-tprog'){const o=$('#f-tprog-out');if(o)o.textContent=t.value+'%';}
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
