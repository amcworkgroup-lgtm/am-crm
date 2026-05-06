

let TOKEN=localStorage.getItem('crm_token')||'';
let TAB='repairs';
let repairs=[],stats={},masters=[],clients=[],expenses=[],cash={rows:[]},financeData=null;
let settings={};
let filterStatus='',filterMaster='',searchQ='',sortField='',compactMode=false,finTab='overview',finFrom='',finTo='',finMaster='',finMethod='',finPayStatus='';
let dateFrom='',dateTo='';
let actId='',editId=null,detailId=null;

const STATUSES=['На діагностиці','В ремонті','Готово','Видано'];
const PAYS=['Не оплачено','Частково','Оплачено'];
const SB={'На діагностиці':'diag','В ремонті':'work','Готово':'ready','Видано':'issued'};
const PB={'Не оплачено':'unpaid','Частково':'partial','Оплачено':'paid'};

// ── API ──
async function api(method,url,body){
  const o={method,headers:{'x-auth-token':TOKEN}};
  if(body){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body);}
  const r=await fetch(url,o);
  if(r.status===401){doLogout();return null;}
  return r.json();
}
async function apiForm(url,fd){
  const r=await fetch(url,{method:'POST',headers:{'x-auth-token':TOKEN},body:fd});
  return r.json();
}

// ── AUTH ──
async function doLogin(){
  const pwd=document.getElementById('pwd').value;
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});
  const d=await r.json();
  if(!r.ok){document.getElementById('lerr').textContent=d.error;return;}
  TOKEN=d.token;localStorage.setItem('crm_token',TOKEN);
  document.getElementById('login-screen').style.display='none';
  const app=document.getElementById('app');app.style.display='flex';app.style.flexDirection='column';
  loadAll();
}
async function doLogout(){
  await api('POST','/api/logout');
  TOKEN='';localStorage.removeItem('crm_token');location.reload();
}

// ── LOAD ──
async function loadAll(){
  await Promise.all([loadRepairs(),loadStats(),loadMasters(),loadSettings()]);
  render();
}
async function loadRepairs(){
  let u='/api/repairs?';
  if(filterStatus && filterStatus!=='__overdue')u+='status='+encodeURIComponent(filterStatus)+'&';
  if(filterStatus==='__overdue')u+='overdue=1&';
  if(filterMaster)u+='master='+encodeURIComponent(filterMaster)+'&';
  if(searchQ)u+='search='+encodeURIComponent(searchQ)+'&';
  if(dateFrom)u+='date_from='+dateFrom+'&';
  if(dateTo)u+='date_to='+dateTo+'&';
  if(sortField)u+='sort='+sortField;
  repairs=await api('GET',u)||[];
}
async function loadStats(){stats=await api('GET','/api/stats')||{};}
async function loadMasters(){masters=await api('GET','/api/masters')||[];}
async function loadSettings(){settings=await api('GET','/api/settings')||{};applyAccent();}
async function loadClients(q=''){clients=await api('GET','/api/clients?search='+encodeURIComponent(q))||[];}
async function loadExpenses(){expenses=await api('GET','/api/expenses?'+(dateFrom?'date_from='+dateFrom+'&':'')+(dateTo?'date_to='+dateTo:''))||[];}
async function loadCash(){cash=await api('GET','/api/cash?'+(dateFrom?'date_from='+dateFrom+'&':'')+(dateTo?'date_to='+dateTo:''))||{rows:[]};}
async function loadFinance(){
  const q=new URLSearchParams();
  if(finFrom)q.set('date_from',finFrom);
  if(finTo)q.set('date_to',finTo);
  if(finMaster)q.set('master',finMaster);
  if(finMethod)q.set('method',finMethod);
  if(finPayStatus)q.set('pay_status',finPayStatus);
  financeData=await api('GET','/api/finance?'+q.toString())||null;
}

// ── NAV ──
function go(tab){
  TAB=tab;
  document.querySelectorAll('.tnav-b').forEach((b,i)=>b.classList.toggle('on',['repairs','reminders','clients','finance','act','stats','settings'][i]===tab));
  if(tab==='clients') loadClients().then(render);
  else if(tab==='finance') Promise.all([loadFinance(),loadExpenses(),loadCash(),loadStats()]).then(render).then(initCharts);
  else render();
}

function render(){
  const m=document.getElementById('main');
  if(TAB==='repairs')       m.innerHTML=renderRepairs();
  else if(TAB==='reminders')m.innerHTML=renderReminders();
  else if(TAB==='clients')  m.innerHTML=renderClients();
  else if(TAB==='finance')  {m.innerHTML=renderFinance();setTimeout(initCharts,50);}
  else if(TAB==='act')      m.innerHTML=renderAct();
  else if(TAB==='stats')    {m.innerHTML=renderStatsTab();setTimeout(initStatsCharts,50);}
  else                      m.innerHTML=renderSettings();
  updateOverduePill();
}

function updateOverduePill(){
  const el=document.getElementById('overdue-pill');
  if(stats.overdue>0){el.textContent='⚠ '+stats.overdue;el.style.display='inline';}
  else el.style.display='none';
}

// ── STATUS / PAY BADGE ──
function statusBadge(r){
  return`<select class="badge ${SB[r.status]||'issued'} status-sel" onchange="quickStatus('${r.id}',this.value)" onclick="event.stopPropagation()">
    ${STATUSES.map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${s}</option>`).join('')}
  </select>`;
}
function payBadge(r){
  return`<select class="badge ${PB[r.pay_status]||'unpaid'} status-sel" onchange="quickPay('${r.id}',this.value)" onclick="event.stopPropagation()">
    ${PAYS.map(s=>`<option value="${s}" ${r.pay_status===s?'selected':''}>${s}</option>`).join('')}
  </select>`;
}
async function quickStatus(id,status){
  await api('PATCH','/api/repairs/'+id+'/status',{status});
  const r=repairs.find(x=>x.id===id);if(r)r.status=status;
  await loadStats();render();
}
async function quickPay(id,pay){
  await api('PATCH','/api/repairs/'+id+'/pay',{pay_status:pay});
  const r=repairs.find(x=>x.id===id);if(r)r.pay_status=pay;
  render();
}

// ════════════════════════════════
// REPAIRS TAB
// ════════════════════════════════
function renderRepairs(){
  const today=new Date().toISOString().slice(0,10);
  const masterOpts=masters.map(m=>`<option value="${m.name}" ${filterMaster===m.name?'selected':''}>${m.name}</option>`).join('');

  // DESKTOP TABLE ROWS
  const tableRows=repairs.length?repairs.map(r=>{
    const ov=r.date_plan&&r.date_plan<today&&!['Готово','Видано'].includes(r.status);
    return`<tr class="${ov?'overdue-row':''} ${compactMode?'compact-row':''}" onclick="openDetail('${r.id}')" style="cursor:pointer">
      <td class="tid">${r.id}</td>
      <td>${r.date_in||'—'}</td>
      <td><div class="tc">${r.client}</div><div class="tp">${r.phone}</div></td>
      <td>${r.type} ${r.model}</td>
      <td onclick="event.stopPropagation()">${statusBadge(r)}</td>
      <td>${r.master||'—'}${ov?'<span class="overdue-dot"></span>':''}</td>
      <td style="font-family:var(--mono)" ondblclick="editPrice(event,'${r.id}',${r.price||0})" title="Двічі клікніть для редагування">${r.price?(+r.price).toLocaleString()+' ₴':'—'}</td>
      <td onclick="event.stopPropagation()">${payBadge(r)}</td>
      <td><div class="tact" onclick="event.stopPropagation()">
        <button class="btn sm" onclick="openEdit('${r.id}')">Ред.</button>
        <button class="btn sm amber" onclick="printAct('${r.id}')">🖨</button>
        <button class="btn sm red" onclick="delRepair('${r.id}')">✕</button>
      </div></td>
    </tr>`;
  }).join(''):`<tr><td colspan="9"><div style="text-align:center;padding:40px;color:var(--text3)">Ремонтів не знайдено</div></td></tr>`;

  // MOBILE CARDS
  const mobileCards=repairs.length?repairs.map(r=>{
    const ov=r.date_plan&&r.date_plan<today&&!['Готово','Видано'].includes(r.status);
    return`<div class="rep-card${ov?' overdue-row':''}" onclick="openDetail('${r.id}')">
      <div class="rep-card-top">
        <div>
          <div class="rep-card-id">${r.id} · ${r.date_in||'—'}</div>
          <div class="rep-card-name">${r.client}</div>
          <div class="rep-card-phone">${r.phone}</div>
          <div class="rep-card-device">${r.type} ${r.model}${r.master?' · '+r.master:''}</div>
        </div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:5px;align-items:flex-end">
          <span class="badge ${SB[r.status]||'issued'}">${r.status}</span>
          <span class="badge ${PB[r.pay_status]||'unpaid'}">${r.pay_status}</span>
          ${r.price?`<span style="font-family:var(--mono);font-size:13px;font-weight:500">${(+r.price).toLocaleString()} ₴</span>`:''}
        </div>
      </div>
      <div class="rep-card-actions" onclick="event.stopPropagation()">
        <button class="btn sm" style="flex:1" onclick="openEdit('${r.id}')">Редагувати</button>
        <button class="btn sm amber" onclick="printAct('${r.id}')">🖨 Акт</button>
        <button class="btn sm tg" onclick="openTg('${r.phone}')">TG</button>
        <button class="btn sm red" onclick="delRepair('${r.id}')">✕</button>
      </div>
    </div>`;
  }).join(''):`<div style="text-align:center;padding:40px;color:var(--text3)">Ремонтів не знайдено</div>`;

  return`
  <div class="stats-grid" style="grid-template-columns:repeat(6,1fr);max-width:800px">
    <div class="sc c-blue ${filterStatus===''?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='';reloadRep()"><span class="sc-icon">🔧</span><div class="sc-l">Активні</div><div class="sc-v blue">${stats.active||0}</div></div>
    <div class="sc c-red ${filterStatus==='__overdue'?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='__overdue';reloadRep()"><span class="sc-icon">⚠️</span><div class="sc-l">Прострочено</div><div class="sc-v red">${stats.overdue||0}</div></div>
    <div class="sc c-blue ${filterStatus==='На діагностиці'?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='На діагностиці';reloadRep()"><span class="sc-icon">🔍</span><div class="sc-l">Діагностика</div><div class="sc-v blue">${repairs.filter(r=>r.status==='На діагностиці').length}</div></div>
    <div class="sc c-amber ${filterStatus==='В ремонті'?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='В ремонті';reloadRep()"><span class="sc-icon">⚙️</span><div class="sc-l">В ремонті</div><div class="sc-v amber">${repairs.filter(r=>r.status==='В ремонті').length}</div></div>
    <div class="sc c-green ${filterStatus==='Готово'?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='Готово';reloadRep()"><span class="sc-icon">✅</span><div class="sc-l">Готово</div><div class="sc-v green">${repairs.filter(r=>r.status==='Готово').length}</div></div>
    <div class="sc ${filterStatus==='Видано'?'sc-on':''}" style="cursor:pointer" onclick="filterStatus='Видано';reloadRep()"><span class="sc-icon">📦</span><div class="sc-l">Видано</div><div class="sc-v">${repairs.filter(r=>r.status==='Видано').length}</div></div>
  </div>
  <div class="toolbar">
    <input class="inp" style="width:180px" placeholder="Пошук..." value="${searchQ}" oninput="searchQ=this.value;reloadRep()"/>
    <select class="sel" onchange="filterStatus=this.value;reloadRep()">
      <option value="">Всі статуси</option>
      ${STATUSES.map(s=>`<option value="${s}" ${filterStatus===s?'selected':''}>${s}</option>`).join('')}
    </select>
    <select class="sel" onchange="filterMaster=this.value;reloadRep()">
      <option value="">Всі майстри</option>${masterOpts}
    </select>
    <input class="inp" type="date" value="${dateFrom}" onchange="dateFrom=this.value;reloadRep()" title="Від"/>
    <input class="inp" type="date" value="${dateTo}" onchange="dateTo=this.value;reloadRep()" title="До"/>
    <button class="btn" onclick="clearFilters()">Скинути</button>
    <button class="btn ${compactMode?'blue':''}" onclick="compactMode=!compactMode;render()" title="Компактний вид">⊟</button>
    <button class="btn blue" onclick="openNew()">+ Новий</button>
    <a href="/api/export/repairs" style="text-decoration:none"><button class="btn green">↓ CSV</button></a>
  </div>
  <div class="desktop-table twrap">
    <table>
      <thead><tr>
        <th onclick="setSort('id')" style="cursor:pointer;user-select:none">ID ${sortField==='id'?'↓':''}</th>
        <th onclick="setSort('date')" style="cursor:pointer;user-select:none">Дата ${sortField==='date'?'↓':'↕'}</th>
        <th onclick="setSort('client')" style="cursor:pointer;user-select:none">Клієнт ${sortField==='client'?'↓':''}</th>
        <th>Пристрій</th><th>Статус</th>
        <th>Майстер</th>
        <th onclick="setSort('price')" style="cursor:pointer;user-select:none">Ціна ${sortField==='price'?'↓':'↕'}</th>
        <th>Оплата</th><th></th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
  <div class="mobile-cards">${mobileCards}</div>
  <div id="modal-r"></div>`;
}

function setSort(f){sortField=sortField===f?'':f;reloadRep();}

function editPrice(e, id, currentPrice){
  e.stopPropagation();
  const td = e.currentTarget;
  const orig = td.innerHTML;
  td.innerHTML = `<input class="inp" type="number" value="${currentPrice||''}" style="width:90px;padding:3px 6px;font-size:12px" 
    onblur="savePriceInline(this,'${id}')" 
    onkeydown="if(event.key==='Enter'){this.blur()}else if(event.key==='Escape'){this.closest('td').innerHTML='${orig.replace(/'/g,"\'")}';}" />`;
  const inp = td.querySelector('input');
  inp.focus();inp.select();
}
async function savePriceInline(inp, id){
  const val = parseFloat(inp.value)||0;
  await api('PATCH','/api/repairs/'+id+'/price',{price:val});
  const r=repairs.find(x=>x.id===id);if(r)r.price=val;
  render();
}
function clearFilters(){filterStatus='';filterMaster='';searchQ='';dateFrom='';dateTo='';sortField='';reloadRep();}
async function reloadRep(){await loadRepairs();await loadStats();render();}

// ════════════════════════════════
// DETAIL MODAL
// ════════════════════════════════
async function openDetail(id){
  detailId=id;
  const r=repairs.find(x=>x.id===id);
  const comments=await api('GET','/api/repairs/'+id+'/comments')||[];
  const photos=JSON.parse(r.photos||'[]');
  const today=new Date().toISOString().slice(0,10);
  const ov=r.date_plan&&r.date_plan<today&&!['Готово','Видано'].includes(r.status);

  const phHtml=photos.map(p=>`<img src="${p}" class="photo-thumb" onclick="window.open('${p}','_blank')">`).join('')
    +`<label class="photo-add" title="Додати фото">+<input type="file" accept="image/*" multiple style="display:none" onchange="uploadPhotos('${id}',this)"/></label>`;

  const cHtml=comments.length?comments.map(c=>`
    <div class="comment">
      <div class="cm-meta">
        <span>${c.author} · ${c.created_at.slice(0,16)}</span>
        <button class="btn xs red" onclick="delComment(${c.id})">✕</button>
      </div>
      <div class="cm-text">${c.text}</div>
    </div>`).join(''):`<div style="color:var(--text3);font-size:12px;padding:6px 0">Коментарів немає</div>`;

  // Шаблони повідомлень з налаштувань
  function fillTpl(tpl, data){
    return (tpl||'').replace(/\{(\w+)\}/g, (_, k) => data[k] || settings[k] || '');
  }
  const tplData = {
    client: r.client, type: r.type, model: r.model, id: r.id,
    price: r.price?(+r.price).toLocaleString()+' ₴':'—',
    phone: settings.shop_phone||'', days: '7',
    shop_name: settings.shop_name||'AM Store',
  };
  const tplReady   = fillTpl(settings.msg_ready,   tplData);
  const tplDiag    = fillTpl(settings.msg_accept,  tplData);
  const tplDebt    = fillTpl(settings.msg_debt,    tplData);
  const tplReady7  = fillTpl(settings.msg_overdue, tplData);

  const html=`<div class="modal-ov" onclick="if(event.target===this)closeModal()">
    <div class="modal wide" style="padding:0;overflow:hidden">

      <!-- ШАПКА -->
      <div style="padding:14px 18px 0;border-bottom:1px solid var(--border);cursor:move" id="modal-drag-handle">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:16px;font-weight:800">${r.type} ${r.model}</span>
            <span class="mid" style="font-size:12px">${r.id}</span>
            ${ov?`<span style="background:var(--rdim);color:var(--red);font-size:11px;padding:2px 8px;border-radius:20px">⚠ Прострочено</span>`:''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm tg" onclick="openTg('${r.phone}')">✈ Telegram</button>
            <button class="btn sm amber" onclick="closeModal();printAct('${id}')">🖨 Акт</button>
            <button class="btn sm blue" onclick="closeModal();openEdit('${id}')">✏ Редагувати</button>
            <button class="btn sm" onclick="closeModal()">✕</button>
          </div>
        </div>

        <!-- ВКЛАДКИ -->
        <div style="display:flex;gap:0" id="rep-tabs">
          <button class="rep-tab on" onclick="switchRepTab('info')">📋 Інфо</button>
          <button class="rep-tab" onclick="switchRepTab('msgs')">💬 Повідомлення</button>
        </div>
      </div>

      <!-- ВКЛАДКА: ІНФО -->
      <div id="reptab-info" style="padding:14px 18px">
        <div class="det-grid" style="margin-bottom:12px">
          <div>
            <div class="det-label">Пристрій</div>
            <div style="font-size:14px;font-weight:600">${r.type} ${r.model}</div>
            ${r.serial?`<div style="font-size:11px;color:var(--text2);font-family:var(--mono)">${r.serial}</div>`:''}
            <div style="margin-top:4px;font-size:12px;color:var(--text2)">${r.problem||'—'}</div>
          </div>
          <div>
            <div class="det-label">Клієнт</div>
            <div style="font-weight:600">${r.client}</div>
            <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${r.phone}</div>
          </div>
          <div>
            <div class="det-label">Деталі</div>
            <div style="font-size:12px;line-height:1.8">
              Майстер: <b>${r.master||'—'}</b><br>
              Прийнято: <b>${r.date_in||'—'}</b>${r.date_plan?` · Планово: <b style="color:${ov?'var(--red)':'var(--amber)'}">${r.date_plan}</b>`:''}<br>
              Ціна: <b style="color:var(--green)">${r.price?(+r.price).toLocaleString()+' ₴':'—'}</b> · ${r.pay_status}
            </div>
            ${r.internal_notes?`<div style="margin-top:4px;color:var(--amber);font-size:11px">📋 ${r.internal_notes}</div>`:''}
          </div>
          <div>
            <div class="det-label">Фото пристрою</div>
            <div class="photo-row" id="photos-wrap">${phHtml}</div>
          </div>
        </div>
      </div>

      <!-- ВКЛАДКА: ПОВІДОМЛЕННЯ -->
      <div id="reptab-msgs" style="padding:14px 18px;display:none">
        <div class="tpl-list">
          ${[
            {title:'Готово до видачі',text:tplReady,icon:'✅'},
            {title:'Прийнято в ремонт',text:tplDiag,icon:'🔧'},
            {title:'Нагадування про оплату',text:tplDebt,icon:'💳'},
            {title:'Не забрав 7+ днів',text:tplReady7,icon:'⏰'},
          ].map(t=>`
          <div class="tpl-item">
            <div class="tpl-title">${t.icon} ${t.title}</div>
            <div class="tpl-text">${t.text}</div>
            <div class="tpl-actions">
              <button class="btn sm blue" onclick="copyText(\`${t.text.replace(/`/g,'\\`')}\`)">Копіювати</button>
              <button class="btn sm tg" onclick="sendTg('${r.phone}',\`${t.text.replace(/`/g,'\\`')}\`)">✈ Відкрити в Telegram</button>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <!-- КОМЕНТАРІ — завжди внизу -->
      <div style="padding:0 18px 16px;border-top:1px solid var(--border);margin-top:2px">
        <div class="section-title" style="margin-top:14px">Коментарі майстра (внутрішні)</div>
        <div id="comments-list">${cHtml}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input class="inp" id="new-comment" style="flex:1" placeholder="Додати коментар... (Ctrl+Enter)" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){document.getElementById('add-comment-btn').click()}"/>
          <button class="btn blue" id="add-comment-btn" onclick="addComment('${id}')">Додати</button>
        </div>
      </div>

    </div>
  </div>`;
  document.getElementById('modal-r').innerHTML=html;
  const mEl=document.querySelector('#modal-r .modal');
  if(mEl) makeDraggable(mEl);
}

// ── DRAGGABLE MODAL ──
function makeDraggable(modalEl){
  const handle = modalEl.querySelector('#modal-drag-handle');
  if(!handle) return;
  let isDragging=false, startX=0, startY=0, startLeft=0, startTop=0;
  // Switch modal from flex-center to absolute positioning
  const ov = modalEl.closest('.modal-ov');
  handle.addEventListener('mousedown', e=>{
    if(e.target.closest('button,input,select')) return;
    isDragging=true;
    const rect = modalEl.getBoundingClientRect();
    // First drag: convert from flow to fixed position
    if(!modalEl.style.left){
      modalEl.style.position='fixed';
      modalEl.style.top=rect.top+'px';
      modalEl.style.left=rect.left+'px';
      modalEl.style.margin='0';
      modalEl.style.width=rect.width+'px';
      if(ov){ ov.style.pointerEvents='none'; ov.style.background='transparent'; ov.style.backdropFilter='none'; }
    }
    startX=e.clientX; startY=e.clientY;
    startLeft=parseInt(modalEl.style.left)||rect.left;
    startTop=parseInt(modalEl.style.top)||rect.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(!isDragging) return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    const newTop=Math.max(10, startTop+dy);
    const newLeft=Math.max(10, Math.min(window.innerWidth-200, startLeft+dx));
    modalEl.style.top=newTop+'px';
    modalEl.style.left=newLeft+'px';
  });
  document.addEventListener('mouseup', ()=>{ isDragging=false; });
}

function switchRepTab(tab){
  ['info','msgs'].forEach(t=>{
    const el=document.getElementById('reptab-'+t);
    if(el) el.style.display=t===tab?'block':'none';
  });
  document.querySelectorAll('.rep-tab').forEach((b,i)=>{
    b.classList.toggle('on',['info','msgs'][i]===tab);
  });
}
// ── TELEGRAM + PHONE ──
function openTg(phone){
  const cleaned=phone.replace(/\D/g,'').replace(/^380/,'38').replace(/^0/,'380');
  window.open('https://t.me/+'+cleaned,'_blank');
}
function sendTg(phone,text){
  const cleaned=phone.replace(/\D/g,'').replace(/^380/,'38').replace(/^0/,'380');
  window.open('https://t.me/+'+cleaned,'_blank');
  setTimeout(()=>copyText(text),300);
}
function callPhone(phone){window.location.href='tel:'+phone;}
function copyText(text){
  navigator.clipboard.writeText(text).then(()=>{
    const el=document.createElement('div');
    el.textContent='✓ Скопійовано!';
    el.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;z-index:9999;font-family:var(--font)';
    document.body.appendChild(el);setTimeout(()=>el.remove(),2000);
  });
}

// ── PHOTOS ──
async function uploadPhotos(id,input){
  const fd=new FormData();
  Array.from(input.files).forEach(f=>fd.append('photos',f));
  const res=await apiForm('/api/repairs/'+id+'/photos',fd);
  if(res&&res.photos){const r=repairs.find(x=>x.id===id);if(r)r.photos=JSON.stringify(res.photos);}
  openDetail(id);
}

// ── COMMENTS ──
async function addComment(id){
  const el=document.getElementById('new-comment');
  if(!el||!el.value.trim())return;
  await api('POST','/api/repairs/'+id+'/comments',{text:el.value.trim(),author:'Майстер'});
  openDetail(id);
}
async function delComment(id){
  await api('DELETE','/api/comments/'+id);
  if(detailId)openDetail(detailId);
}

// ── EDIT/NEW ──
function openNew(){editId=null;showModal({date_in:new Date().toISOString().slice(0,10),status:'На діагностиці',pay_status:'Не оплачено'});}
function openEdit(id){editId=id;showModal(repairs.find(x=>x.id===id));}
function showModal(d){
  const mOpts=masters.map(m=>`<option ${d.master===m.name?'selected':''}>${m.name}</option>`).join('');
  const html=`<div class="modal-ov" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h3>${editId?'Редагування':'Новий ремонт'} ${editId?`<span class="mid">${editId}</span>`:''}</h3>
      <div class="fg">
        <div class="frow"><label>Дата прийому</label><input class="inp" type="date" id="f-date_in" value="${d.date_in||''}"/></div>
        <div class="frow"><label>Планова дата</label><input class="inp" type="date" id="f-date_plan" value="${d.date_plan||''}"/></div>
        <div class="frow"><label>ПІБ клієнта</label><input class="inp" id="f-client" value="${d.client||''}"/></div>
        <div class="frow"><label>Телефон</label><input class="inp" id="f-phone" value="${d.phone||''}"/></div>
        <div class="frow"><label>Тип пристрою</label>
          <select class="sel" id="f-type">${['iPhone','Samsung','iPad','MacBook','Ноутбук','Планшет','Watch','AirPods','Інше'].map(t=>`<option ${d.type===t?'selected':''}>${t}</option>`).join('')}</select>
        </div>
        <div class="frow"><label>Модель</label><input class="inp" id="f-model" value="${d.model||''}"/></div>
        <div class="frow"><label>IMEI / Серійний</label><input class="inp" id="f-serial" value="${d.serial||''}"/></div>
        <div class="frow"><label>Колір</label><input class="inp" id="f-color" value="${d.color||''}"/></div>
        <div class="frow"><label>Пароль пристрою</label><input class="inp" id="f-password" value="${d.password||''}"/></div>
        <div class="frow"><label>Комплектація</label><input class="inp" id="f-kit" value="${d.kit||''}"/></div>
        <div class="frow full"><label>Опис несправності</label><textarea class="area" id="f-problem">${d.problem||''}</textarea></div>
        <div class="frow"><label>Зовнішній стан</label>
          <select class="sel" id="f-condition">${['','Новий','Добрий','Задовільний','Поганий'].map(s=>`<option ${d.condition===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="frow"><label>Статус</label>
          <select class="sel" id="f-status">${STATUSES.map(s=>`<option ${d.status===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="frow"><label>Майстер</label><select class="sel" id="f-master"><option value="">—</option>${mOpts}</select></div>
        <div class="frow"><label>Дата видачі</label><input class="inp" type="date" id="f-date_out" value="${d.date_out||''}"/></div>
        <div class="frow"><label>Собівартість (₴)</label><input class="inp" type="number" id="f-cost" value="${d.cost||''}"/></div>
        <div class="frow"><label>Ціна клієнту (₴)</label><input class="inp" type="number" id="f-price" value="${d.price||''}"/></div>
        <div class="frow"><label>Статус оплати</label>
          <select class="sel" id="f-pay_status">${PAYS.map(s=>`<option ${d.pay_status===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="frow"><label>Спосіб оплати</label>
          <select class="sel" id="f-pay_method">${['','Готівка','Картка','Переказ'].map(x=>`<option ${d.pay_method===x?'selected':''}>${x}</option>`).join('')}</select>
        </div>
        <div class="frow full"><label>Нотатки майстра (внутрішні)</label><textarea class="area" id="f-internal_notes" style="min-height:44px">${d.internal_notes||''}</textarea></div>
        <div class="frow full"><label>Нотатки (публічні)</label><textarea class="area" id="f-notes" style="min-height:44px">${d.notes||''}</textarea></div>
      </div>
      <div class="mfoot">
        <button class="btn" onclick="closeModal()">Скасувати</button>
        <button class="btn blue" onclick="saveRepair()">Зберегти</button>
      </div>
    </div>
  </div>`;
  const mr=document.getElementById('modal-r');if(mr)mr.innerHTML=html;
}
function closeModal(){const m=document.getElementById('modal-r');if(m)m.innerHTML='';}
const gv=id=>{const e=document.getElementById(id);return e?e.value:'';};
async function saveRepair(){
  const body={date_in:gv('f-date_in'),date_plan:gv('f-date_plan'),date_out:gv('f-date_out'),client:gv('f-client'),phone:gv('f-phone'),type:gv('f-type'),model:gv('f-model'),serial:gv('f-serial'),color:gv('f-color'),password:gv('f-password'),kit:gv('f-kit'),problem:gv('f-problem'),condition:gv('f-condition'),status:gv('f-status'),master:gv('f-master'),cost:parseFloat(gv('f-cost'))||0,price:parseFloat(gv('f-price'))||0,pay_status:gv('f-pay_status'),pay_method:gv('f-pay_method'),notes:gv('f-notes'),internal_notes:gv('f-internal_notes')};
  if(editId)await api('PUT','/api/repairs/'+editId,body);
  else await api('POST','/api/repairs',body);
  closeModal();await loadAll();render();
}
async function delRepair(id){
  if(!confirm('Видалити ремонт '+id+'?'))return;
  await api('DELETE','/api/repairs/'+id);await loadAll();render();
}

// ════════════════════════════════
// REMINDERS TAB
// ════════════════════════════════
function renderReminders(){
  const today=new Date();
  // Не забрали 7+ днів після "Готово"
  const forgotten=repairs.filter(r=>{
    if(r.status!=='Готово')return false;
    // шукаємо дату останньої зміни — беремо date_plan або date_in як орієнтир
    // В реальності треба дату зміни на "Готово", але наближаємо через date_in
    const base=r.date_plan||r.date_in;
    if(!base)return false;
    const diff=Math.floor((today-new Date(base))/(1000*60*60*24));
    return diff>=7;
  });

  // Прострочені (планова дата минула, не готово)
  const overdue=repairs.filter(r=>{
    if(['Готово','Видано'].includes(r.status))return false;
    if(!r.date_plan)return false;
    return r.date_plan<today.toISOString().slice(0,10);
  });

  const forgottenHtml=forgotten.length?forgotten.map(r=>{
    const base=r.date_plan||r.date_in;
    const diff=Math.floor((today-new Date(base))/(1000*60*60*24));
    const tpl=`Нагадуємо! Ваш ${r.type} ${r.model} (замовлення ${r.id}) очікує вас вже ${diff} днів. Будь ласка, заберіть пристрій. AM Store, тел. 073 477 30 90`;
    return`<div class="reminder-card">
      <div class="reminder-head">
        <div>
          <div style="font-weight:600">${r.client}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${r.phone}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${r.type} ${r.model} · ${r.id}</div>
        </div>
        <div style="text-align:right">
          <div class="reminder-days">Очікує ${diff} днів</div>
          ${r.price?`<div style="font-family:var(--mono);font-weight:500;margin-top:4px">${(+r.price).toLocaleString()} ₴</div>`:''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm blue" onclick="copyText(\`${tpl.replace(/`/g,'\\`')}\`)">Копіювати повідомлення</button>
        <button class="btn sm tg" onclick="sendTg('${r.phone}',\`${tpl.replace(/`/g,'\\`')}\`)">✈ Написати в Telegram</button>
        <button class="btn sm" onclick="callPhone('${r.phone}')">📞 Дзвонити</button>
        <button class="btn sm green" onclick="quickStatus('${r.id}','Видано')">Позначити "Видано"</button>
      </div>
    </div>`;
  }).join(''):`<div style="text-align:center;padding:32px;color:var(--text3)">Всі клієнти забрали свої пристрої ✓</div>`;

  const overdueHtml=overdue.length?overdue.map(r=>{
    const diff=Math.floor((today-new Date(r.date_plan))/(1000*60*60*24));
    const tpl=`Вітаємо! Ваш ${r.type} ${r.model} (замовлення ${r.id}) ще в ремонті. Просимо вибачення за затримку — повідомимо як тільки буде готовий. AM Store`;
    return`<div class="reminder-card" style="border-left-color:var(--red)">
      <div class="reminder-head">
        <div>
          <div style="font-weight:600">${r.client}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${r.phone}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">${r.type} ${r.model} · Майстер: ${r.master||'—'}</div>
        </div>
        <div style="text-align:right">
          <div style="color:var(--red);font-size:11px;font-weight:500">Прострочено ${diff} дн.</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">Планово: ${r.date_plan}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm blue" onclick="copyText(\`${tpl.replace(/`/g,'\\`')}\`)">Копіювати повідомлення</button>
        <button class="btn sm tg" onclick="sendTg('${r.phone}',\`${tpl.replace(/`/g,'\\`')}\`)">✈ Telegram</button>
        <button class="btn sm" onclick="callPhone('${r.phone}')">📞 Дзвонити</button>
      </div>
    </div>`;
  }).join(''):`<div style="text-align:center;padding:32px;color:var(--text3)">Прострочених немає ✓</div>`;

  return`
  <div style="margin-bottom:24px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div class="section-title" style="margin:0">Не забрали пристрій 7+ днів після "Готово"</div>
      <span style="background:var(--adim);color:var(--amber);font-size:11px;padding:2px 8px;border-radius:20px">${forgotten.length}</span>
    </div>
    ${forgottenHtml}
  </div>
  <div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div class="section-title" style="margin:0">Прострочені ремонти</div>
      <span style="background:var(--rdim);color:var(--red);font-size:11px;padding:2px 8px;border-radius:20px">${overdue.length}</span>
    </div>
    ${overdueHtml}
  </div>`;
}

// ════════════════════════════════
// CLIENTS TAB
// ════════════════════════════════
function renderClients(){
  const rows=clients.length?clients.map(c=>`
    <div class="client-card" onclick="openClientDetail('${encodeURIComponent(c.phone)}','${c.client.replace(/'/g,"\\'")}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <div style="font-weight:600;font-size:14px">${c.client}</div>
          <div style="font-family:var(--mono);font-size:12px;color:var(--text2)">${c.phone}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${c.debt>0?`<span class="badge unpaid">${(+c.debt).toLocaleString()} ₴ борг</span>`:''}
          <button class="btn sm tg" onclick="event.stopPropagation();openTg('${c.phone}')">✈ TG</button>
          <button class="btn sm" onclick="event.stopPropagation();callPhone('${c.phone}')">📞</button>
        </div>
      </div>
      <div class="client-meta">
        <span>Ремонтів: <b style="color:var(--text)">${c.total}</b></span>
        <span>Сума: <b style="color:var(--green)">${(+c.total_price).toLocaleString()} ₴</b></span>
        <span>Останній: <b style="color:var(--text)">${c.last_visit||'—'}</b></span>
      </div>
    </div>`).join(''):`<div style="text-align:center;padding:40px;color:var(--text3)">Клієнтів не знайдено</div>`;

  return`
  <div class="toolbar">
    <input class="inp" style="width:260px" placeholder="Пошук клієнта або телефону..." oninput="loadClients(this.value).then(render)"/>
  </div>
  <div>${rows}</div>
  <div id="modal-r"></div>`;
}

async function openClientDetail(phone,name){
  const ph=decodeURIComponent(phone);
  const history=await api('GET','/api/clients/'+encodeURIComponent(ph)+'/repairs')||[];
  const total=history.reduce((s,r)=>s+(r.price||0),0);
  const rows=history.map(r=>`<tr>
    <td class="tid">${r.id}</td><td>${r.date_in}</td>
    <td>${r.type} ${r.model}</td>
    <td><span class="badge ${SB[r.status]||'issued'}">${r.status}</span></td>
    <td style="font-family:var(--mono)">${r.price?(+r.price).toLocaleString()+' ₴':'—'}</td>
    <td><span class="badge ${PB[r.pay_status]||'unpaid'}">${r.pay_status}</span></td>
  </tr>`).join('');
  const html=`<div class="modal-ov" onclick="if(event.target===this)closeModalC()">
    <div class="modal wide">
      <h3>${name}</h3>
      <div style="font-family:var(--mono);color:var(--text2);margin-bottom:12px;display:flex;align-items:center;gap:10px">
        ${ph}
        <button class="btn sm tg" onclick="openTg('${ph}')">✈ Telegram</button>
        <button class="btn sm" onclick="callPhone('${ph}')">📞 Дзвонити</button>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <div class="sc"><div class="sc-l">Ремонтів</div><div class="sc-v blue">${history.length}</div></div>
        <div class="sc"><div class="sc-l">Загальна сума</div><div class="sc-v green">${total.toLocaleString()} ₴</div></div>
      </div>
      <div class="twrap"><table><thead><tr><th>ID</th><th>Дата</th><th>Пристрій</th><th>Статус</th><th>Ціна</th><th>Оплата</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="mfoot"><button class="btn" onclick="closeModalC()">Закрити</button></div>
    </div>
  </div>`;
  const mr=document.getElementById('modal-r');if(mr)mr.innerHTML=html;
}
function closeModalC(){const m=document.getElementById('modal-r');if(m)m.innerHTML='';}

// ════════════════════════════════
// FINANCE TAB
// ════════════════════════════════
function renderFinance(){
  const f = financeData || {kpi:{},payments:[],expenses:[],cashRows:[],daily:[],byMaster:[],methodTotals:{},cashLogTotals:{},statusTotals:{}};
  const k = f.kpi || {};
  const payments = f.payments || [];
  const exp = f.expenses || [];
  const cashRows = f.cashRows || [];
  const daily = f.daily || [];
  const byMaster = f.byMaster || [];
  const methodTotals = f.methodTotals || {};
  const cashLogTotals = f.cashLogTotals || {};
  const statusTotals = f.statusTotals || {};

  const money = v => (Math.round(+v||0)).toLocaleString('uk-UA') + ' ₴';
  const payBadge = st => st==='Оплачено' ? 'paid' : (st==='Частково' ? 'partial' : 'unpaid');
  const methodBadge = m => m==='Готівка' ? 'ready' : (m==='Картка' ? 'diag' : (m==='Переказ'?'partial':'issued'));
  const cashWarn = (+k.noMethod||0)>0 ? `<div class="fin-alert">⚠️ Є оплачені ремонти без методу оплати: ${money(k.noMethod)}. Щоб готівка/безготівка рахувались точно — вкажіть метод у ремонті.</div>` : '';

  const filterPanel = `<div class="fin-filter-panel">
    <div class="frow"><label>Дата від</label><input class="inp" type="date" value="${finFrom}" onchange="finFrom=this.value;loadFinance().then(render).then(initCharts)"/></div>
    <div class="frow"><label>Дата до</label><input class="inp" type="date" value="${finTo}" onchange="finTo=this.value;loadFinance().then(render).then(initCharts)"/></div>
    <div class="frow"><label>Майстер</label><select class="sel" onchange="finMaster=this.value;loadFinance().then(render).then(initCharts)">
      <option value="">Всі майстри</option>${masters.map(m=>`<option ${finMaster===m.name?'selected':''}>${m.name}</option>`).join('')}
    </select></div>
    <div class="frow"><label>Метод</label><select class="sel" onchange="finMethod=this.value;loadFinance().then(render).then(initCharts)">
      <option value="">Всі методи</option>${['Готівка','Картка','Переказ'].map(x=>`<option ${finMethod===x?'selected':''}>${x}</option>`).join('')}
    </select></div>
    <div class="frow"><label>Оплата</label><select class="sel" onchange="finPayStatus=this.value;loadFinance().then(render).then(initCharts)">
      <option value="">Всі статуси</option>${['Оплачено','Частково','Не оплачено'].map(x=>`<option ${finPayStatus===x?'selected':''}>${x}</option>`).join('')}
    </select></div>
    <div class="frow" style="justify-content:flex-end"><button class="btn" onclick="finFrom='';finTo='';finMaster='';finMethod='';finPayStatus='';loadFinance().then(render).then(initCharts)">Скинути</button></div>
  </div>`;

  const kpis = `<div class="cash-cards finance-kpi">
    <div class="cash-card f-green"><div class="cash-lbl">Виручка</div><div class="cash-val green">${money(k.revenue)}</div><div class="fin-hint">Оплачені ремонти</div></div>
    <div class="cash-card f-amber"><div class="cash-lbl">Собівартість</div><div class="cash-val amber">${money(k.cost)}</div><div class="fin-hint">Запчастини/собівартість</div></div>
    <div class="cash-card f-red"><div class="cash-lbl">Витрати</div><div class="cash-val red">${money(k.expenses)}</div><div class="fin-hint">Окремі витрати</div></div>
    <div class="cash-card f-orange"><div class="cash-lbl">Чистий прибуток</div><div class="cash-val ${(+k.profit||0)>=0?'green':'red'}">${money(k.profit)}</div><div class="fin-hint">Виручка - собівартість - витрати</div></div>
    <div class="cash-card f-blue"><div class="cash-lbl">Готівка</div><div class="cash-val blue">${money(k.cash)}</div><div class="fin-hint">По оплатах ремонтів</div></div>
    <div class="cash-card f-purple"><div class="cash-lbl">Безготівка</div><div class="cash-val purple">${money(k.cashless)}</div><div class="fin-hint">Картка + переказ</div></div>
  </div>`;

  const tabs = `<div style="display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px;overflow:auto">
    <button class="rep-tab ${finTab==='overview'?'on':''}" onclick="finTab='overview';render();setTimeout(initCharts,50)">📊 Огляд</button>
    <button class="rep-tab ${finTab==='history'?'on':''}" onclick="finTab='history';render();setTimeout(initCharts,50)">💳 Платежі</button>
    <button class="rep-tab ${finTab==='expenses'?'on':''}" onclick="finTab='expenses';render();setTimeout(initCharts,50)">💸 Витрати</button>
    <button class="rep-tab ${finTab==='cash'?'on':''}" onclick="finTab='cash';render();setTimeout(initCharts,50)">🏦 Каса</button>
  </div>`;

  const paymentRows = payments.length ? payments.map(p=>`<tr>
    <td>${p.date_in||'—'}</td><td><b>${p.client||'—'}</b><div class="tp">${p.phone||''}</div></td>
    <td>${p.type||''} ${p.model||''}<div class="tp">${p.id}</div></td><td>${p.master||'—'}</td>
    <td><span class="badge ${methodBadge(p.pay_method)}">${p.pay_method||'Не вказано'}</span></td>
    <td style="font-family:var(--mono);font-weight:700">${money(p.price)}</td>
    <td><span class="badge ${payBadge(p.pay_status)}">${p.pay_status||'—'}</span></td>
  </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">Платежів немає за цими фільтрами</td></tr>`;

  const expRows = exp.length ? exp.map(e=>`<tr>
    <td>${e.date}</td><td>${e.category}</td><td>${e.description||'—'}</td>
    <td style="font-family:var(--mono);color:var(--red);font-weight:700">−${money(e.amount)}</td>
    <td>${e.repair_id||'—'}</td><td><button class="btn xs red" onclick="delExpense(${e.id})">✕</button></td>
  </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text3)">Витрат немає</td></tr>`;

  const cashTableRows = cashRows.length ? cashRows.map(c=>`<tr>
    <td>${c.date}</td><td style="color:${c.type==='in'?'var(--green)':'var(--red)'};font-weight:800">${c.type==='in'?'+':'−'}</td>
    <td style="font-family:var(--mono);color:${c.type==='in'?'var(--green)':'var(--red)'};font-weight:700">${money(c.amount)}</td>
    <td><span class="badge ${methodBadge(c.method)}">${c.method||'—'}</span></td><td>${c.description||'—'}</td>
  </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3)">Рухів коштів немає</td></tr>`;

  const masterRows = byMaster.length ? byMaster.map(m=>`<tr><td>${m.master||'—'}</td><td>${m.count}</td><td>${money(m.revenue)}</td><td style="color:${m.profit>=0?'var(--green)':'var(--red)'};font-family:var(--mono);font-weight:700">${money(m.profit)}</td></tr>`).join('') : `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text3)">Немає даних</td></tr>`;

  const cashSummary = `<div class="fin-mini-grid">
    <div class="fin-mini"><div class="l">Готівка</div><div class="v" style="color:var(--blue)">${money(k.cash)}</div></div>
    <div class="fin-mini"><div class="l">Картка</div><div class="v" style="color:var(--purple)">${money(k.card)}</div></div>
    <div class="fin-mini"><div class="l">Переказ</div><div class="v" style="color:var(--amber)">${money(k.transfer)}</div></div>
    <div class="fin-mini"><div class="l">Борги</div><div class="v" style="color:var(--red)">${money(k.debt)}</div></div>
  </div>`;

  window._financeCharts = {
    dailyLabels: daily.map(x=>x.date),
    revenue: daily.map(x=>+x.revenue||0),
    profit: daily.map(x=>+x.profit||0),
    expenses: daily.map(x=>+x.expenses||0),
    methodLabels: ['Готівка','Картка','Переказ','Не вказано'].filter(x=>(methodTotals[x]||0)>0),
    methodData: ['Готівка','Картка','Переказ','Не вказано'].filter(x=>(methodTotals[x]||0)>0).map(x=>methodTotals[x]||0)
  };

  let tabContent='';
  if(finTab==='overview') tabContent = `${filterPanel}${cashWarn}${kpis}${cashSummary}
    <div class="fin-grid">
      <div class="fin-block"><h4>Виручка / прибуток по днях</h4><div class="chart-wrap"><canvas id="chart-fin-daily"></canvas></div></div>
      <div class="fin-block"><h4>Методи оплати</h4><div class="chart-wrap"><canvas id="chart-fin-methods"></canvas></div></div>
    </div>
    <div class="fin-block"><h4>По майстрах</h4><div class="twrap" style="margin:0"><table style="min-width:0"><thead><tr><th>Майстер</th><th>Ремонтів</th><th>Виручка</th><th>Прибуток</th></tr></thead><tbody>${masterRows}</tbody></table></div></div>`;
  else if(finTab==='history') tabContent = `${filterPanel}${cashWarn}${kpis}<div class="fin-block"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h4 style="margin:0">Платежі</h4><button class="btn sm" onclick="exportFinancePayments()">CSV</button></div><div class="twrap"><table style="min-width:760px"><thead><tr><th>Дата</th><th>Клієнт</th><th>Пристрій</th><th>Майстер</th><th>Метод</th><th>Сума</th><th>Статус</th></tr></thead><tbody>${paymentRows}</tbody></table></div></div>`;
  else if(finTab==='expenses') tabContent = `${filterPanel}<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div class="section-title" style="margin:0">Витрати</div><button class="btn sm blue" onclick="openAddExpense()">+ Витрата</button></div><div class="twrap"><table style="min-width:680px"><thead><tr><th>Дата</th><th>Категорія</th><th>Опис</th><th>Сума</th><th>Ремонт</th><th></th></tr></thead><tbody>${expRows}</tbody></table></div>`;
  else if(finTab==='cash') tabContent = `${filterPanel}${cashSummary}<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><div class="section-title" style="margin:0">Рух коштів</div><button class="btn sm blue" onclick="openAddCash()">+ Запис</button></div><div class="twrap"><table style="min-width:620px"><thead><tr><th>Дата</th><th>+/−</th><th>Сума</th><th>Метод</th><th>Опис</th></tr></thead><tbody>${cashTableRows}</tbody></table></div>`;
  return `${tabs}${tabContent}<div id="modal-f"></div>`;
}

function exportFinancePayments(){
  const f=financeData||{payments:[]};
  const rows=[['Дата','Клієнт','Телефон','Пристрій','Майстер','Метод','Сума','Статус']].concat((f.payments||[]).map(p=>[p.date_in,p.client,p.phone,`${p.type||''} ${p.model||''}`,p.master,p.pay_method,p.price,p.pay_status]));
  const csv=rows.map(r=>r.map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));a.download='finance_payments.csv';a.click();
}

function initCharts(){
  const d=window._financeCharts;
  if(!d || typeof Chart==='undefined') return;
  const tickColor=getComputedStyle(document.documentElement).getPropertyValue('--text2').trim()||'#8b9ab5';
  const gridColor=getComputedStyle(document.documentElement).getPropertyValue('--border').trim()||'#2a3348';
  const c1=document.getElementById('chart-fin-daily');
  if(c1){
    if(window._finDailyChart)window._finDailyChart.destroy();
    window._finDailyChart=new Chart(c1,{type:'bar',data:{labels:d.dailyLabels,datasets:[
      {label:'Виручка',data:d.revenue,backgroundColor:'rgba(59,130,246,.45)',borderColor:'#3b82f6',borderWidth:1},
      {label:'Прибуток',data:d.profit,type:'line',borderColor:'#22c55e',backgroundColor:'transparent',borderWidth:2,tension:.35},
      {label:'Витрати',data:d.expenses,type:'line',borderColor:'#ef4444',backgroundColor:'transparent',borderWidth:2,tension:.35}
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:tickColor,font:{size:11}}}},scales:{x:{ticks:{color:tickColor,maxRotation:45},grid:{color:gridColor}},y:{ticks:{color:tickColor,callback:v=>v.toLocaleString()+' ₴'},grid:{color:gridColor}}}}});
  }
  const c2=document.getElementById('chart-fin-methods');
  if(c2){
    if(window._finMethodsChart)window._finMethodsChart.destroy();
    window._finMethodsChart=new Chart(c2,{type:'doughnut',data:{labels:d.methodLabels,datasets:[{data:d.methodData,backgroundColor:['#a78bfa','#3b82f6','#f59e0b','#22c55e'],borderWidth:2,borderColor:getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim()}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{labels:{color:tickColor,font:{size:11}}}}}});
  }
}

function openAddExpense(){
  document.getElementById('modal-f').innerHTML=`<div class="modal-ov" onclick="if(event.target===this)closeModalF()">
    <div class="modal sm"><h3>Нова витрата</h3>
      <div class="fg" style="grid-template-columns:1fr">
        <div class="frow"><label>Дата</label><input class="inp" type="date" id="ex-date" value="${new Date().toISOString().slice(0,10)}"/></div>
        <div class="frow"><label>Категорія</label><select class="sel" id="ex-cat">${['Запчастини','Інструменти','Оренда','Реклама','Зарплата','Інше'].map(c=>`<option>${c}</option>`).join('')}</select></div>
        <div class="frow"><label>Опис</label><input class="inp" id="ex-desc" placeholder="Екран iPhone 14..."/></div>
        <div class="frow"><label>Сума (₴)</label><input class="inp" type="number" id="ex-amount"/></div>
        <div class="frow"><label>Ремонт (ID, необов.)</label><input class="inp" id="ex-rid"/></div>
      </div>
      <div class="mfoot"><button class="btn" onclick="closeModalF()">Скасувати</button><button class="btn blue" onclick="saveExpense()">Зберегти</button></div>
    </div></div>`;
}
async function saveExpense(){
  await api('POST','/api/expenses',{date:gv('ex-date'),category:gv('ex-cat'),description:gv('ex-desc'),amount:parseFloat(gv('ex-amount'))||0,repair_id:gv('ex-rid')||null});
  closeModalF();await loadExpenses();await loadFinance();await loadStats();render();setTimeout(initCharts,50);
}
async function delExpense(id){await api('DELETE','/api/expenses/'+id);await loadExpenses();await loadFinance();await loadStats();render();setTimeout(initCharts,50);}

function openAddCash(){
  document.getElementById('modal-f').innerHTML=`<div class="modal-ov" onclick="if(event.target===this)closeModalF()">
    <div class="modal sm"><h3>Рух коштів</h3>
      <div class="fg" style="grid-template-columns:1fr">
        <div class="frow"><label>Дата</label><input class="inp" type="date" id="cs-date" value="${new Date().toISOString().slice(0,10)}"/></div>
        <div class="frow"><label>Тип</label><select class="sel" id="cs-type"><option value="in">Надходження (+)</option><option value="out">Витрата (−)</option></select></div>
        <div class="frow"><label>Сума (₴)</label><input class="inp" type="number" id="cs-amount"/></div>
        <div class="frow"><label>Метод</label><select class="sel" id="cs-method"><option>Готівка</option><option>Картка</option><option>Переказ</option></select></div>
        <div class="frow"><label>Опис</label><input class="inp" id="cs-desc" placeholder="Оплата за ремонт R04821..."/></div>
        <div class="frow"><label>Ремонт (ID, необов.)</label><input class="inp" id="cs-rid"/></div>
      </div>
      <div class="mfoot"><button class="btn" onclick="closeModalF()">Скасувати</button><button class="btn blue" onclick="saveCash()">Зберегти</button></div>
    </div></div>`;
}
async function saveCash(){
  await api('POST','/api/cash',{date:gv('cs-date'),type:gv('cs-type'),amount:parseFloat(gv('cs-amount'))||0,method:gv('cs-method'),description:gv('cs-desc'),repair_id:gv('cs-rid')||null});
  closeModalF();await loadCash();await loadFinance();await loadStats();render();setTimeout(initCharts,50);
}
function closeModalF(){const m=document.getElementById('modal-f');if(m)m.innerHTML='';}

// ════════════════════════════════
// STATS TAB
// ════════════════════════════════
let statsPeriod = 6; // місяців

function renderStatsTab(){
  const now = new Date();
  const months = [];
  for(let i=statsPeriod-1;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    months.push(d.toISOString().slice(0,7));
  }
  const inPeriod = r => months.includes((r.date_in||'').slice(0,7));
  const filtered = repairs.filter(inPeriod);

  // ── Зведені числа ──
  const totalRep = filtered.length;
  const revenue  = filtered.reduce((s,r)=>s+(r.price||0),0);
  const cost     = filtered.reduce((s,r)=>s+(r.cost||0),0);
  const profit   = revenue - cost;
  const avgPrice = totalRep ? Math.round(revenue/totalRep) : 0;
  const paidCount= filtered.filter(r=>r.pay_status==='Оплачено').length;
  const paidPct  = totalRep ? Math.round(paidCount/totalRep*100) : 0;

  // ── По місяцях ──
  const byMonth = months.map(m=>{
    const mr = repairs.filter(r=>(r.date_in||'').startsWith(m));
    return {
      m, count:mr.length,
      revenue:mr.reduce((s,r)=>s+(r.price||0),0),
      profit:mr.reduce((s,r)=>s+(r.price||0)-(r.cost||0),0),
    };
  });

  // ── По типах ──
  const typeMap={};
  filtered.forEach(r=>{
    const t=r.type||'Інше';
    typeMap[t]=(typeMap[t]||0)+1;
  });
  const types=Object.entries(typeMap).sort((a,b)=>b[1]-a[1]).slice(0,7);
  const typeTotal=types.reduce((s,[,n])=>s+n,0);

  // ── По майстрах ──
  const masterMap={};
  filtered.forEach(r=>{
    const m=r.master||'Без майстра';
    if(!masterMap[m]) masterMap[m]={count:0,revenue:0,profit:0};
    masterMap[m].count++;
    masterMap[m].revenue+=(r.price||0);
    masterMap[m].profit+=(r.price||0)-(r.cost||0);
  });
  const masterRows=Object.entries(masterMap).sort((a,b)=>b[1].profit-a[1].profit);

  // ── По статусах ──
  const statusMap={};
  repairs.forEach(r=>{ statusMap[r.status]=(statusMap[r.status]||0)+1; });

  const periodBtns = [
    {v:1,l:'Місяць'},{v:3,l:'3 міс.'},{v:6,l:'6 міс.'},{v:12,l:'Рік'}
  ].map(b=>`<button class="btn${statsPeriod===b.v?' orange':''}" onclick="statsPeriod=${b.v};go('stats')" style="padding:5px 12px;font-size:12px">${b.l}</button>`).join('');

  const COLORS=['#f97316','#3b82f6','#22c55e','#a78bfa','#f59e0b','#06b6d4','#ec4899'];

  const typeDonut = types.map(([t,n],i)=>{
    const pct=Math.round(n/typeTotal*100);
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <div style="width:10px;height:10px;border-radius:50%;background:${COLORS[i%COLORS.length]};flex-shrink:0"></div>
      <div style="flex:1;font-size:12px">${t}</div>
      <div style="font-weight:700;font-size:12px;font-family:var(--mono)">${n}</div>
      <div style="font-size:11px;color:var(--text2);width:32px;text-align:right">${pct}%</div>
      <div style="width:80px;background:var(--bg3);border-radius:4px;height:6px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${COLORS[i%COLORS.length]};border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');

  const masterCards = masterRows.map(([name,d],i)=>`
    <div style="background:var(--bg3);border-radius:var(--r);padding:12px 14px;display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;border-radius:50%;background:${COLORS[i%COLORS.length]}22;border:2px solid ${COLORS[i%COLORS.length]};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${COLORS[i%COLORS.length]}">${name[0]}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:13px">${name}</div>
        <div style="font-size:11px;color:var(--text2)">${d.count} рем. · виручка ${d.revenue.toLocaleString()} ₴</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:15px;font-family:var(--mono);color:${d.profit>=0?'var(--green)':'var(--red)'}">${d.profit.toLocaleString()} ₴</div>
        <div style="font-size:10px;color:var(--text2)">прибуток</div>
      </div>
    </div>`).join('');

  const statusColors={'На діагностиці':'var(--blue)','В ремонті':'var(--amber)','Готово':'var(--green)','Видано':'var(--text2)'};
  const statusCards = Object.entries(statusMap).map(([s,n])=>`
    <div style="background:var(--bg3);border-radius:var(--r);padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;font-weight:500">${s}</span>
      <span style="font-size:18px;font-weight:700;font-family:var(--mono);color:${statusColors[s]||'var(--text)'}">${n}</span>
    </div>`).join('');

  return`
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div style="font-size:16px;font-weight:700">📊 Статистика</div>
    <div style="display:flex;gap:6px">${periodBtns}</div>
  </div>

  <!-- KPI картки -->
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px">
    <div class="sc c-blue"><span class="sc-icon">🔧</span><div class="sc-l">Ремонтів</div><div class="sc-v blue">${totalRep}</div></div>
    <div class="sc c-green"><span class="sc-icon">📈</span><div class="sc-l">Виручка</div><div class="sc-v green" style="font-size:15px">${revenue.toLocaleString()} ₴</div></div>
    <div class="sc c-orange"><span class="sc-icon">💰</span><div class="sc-l">Прибуток</div><div class="sc-v orange" style="font-size:15px">${profit.toLocaleString()} ₴</div></div>
    <div class="sc c-purple"><span class="sc-icon">💎</span><div class="sc-l">Середній чек</div><div class="sc-v purple" style="font-size:15px">${avgPrice.toLocaleString()} ₴</div></div>
    <div class="sc c-amber"><span class="sc-icon">✅</span><div class="sc-l">Оплачено</div><div class="sc-v amber">${paidPct}%</div></div>
    <div class="sc c-red"><span class="sc-icon">⚠️</span><div class="sc-l">Прострочено</div><div class="sc-v red">${stats.overdue||0}</div></div>
  </div>

  <!-- Графік і типи -->
  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px;margin-bottom:14px">
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Динаміка по місяцях</div>
      <div style="position:relative;height:200px"><canvas id="stats-chart-monthly"></canvas></div>
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Популярні пристрої</div>
      <div style="position:relative;height:160px;margin-bottom:12px"><canvas id="stats-chart-types"></canvas></div>
      <div>${typeDonut}</div>
    </div>
  </div>

  <!-- Майстри і статуси -->
  <div style="display:grid;grid-template-columns:3fr 2fr;gap:14px">
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Рейтинг майстрів</div>
      <div style="display:flex;flex-direction:column;gap:8px">${masterCards||'<div style="color:var(--text3);text-align:center;padding:20px">Немає даних</div>'}</div>
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px">Статуси зараз</div>
      <div style="display:flex;flex-direction:column;gap:7px">${statusCards||'<div style="color:var(--text3);text-align:center;padding:20px">Немає даних</div>'}</div>
      <div style="position:relative;height:160px;margin-top:14px"><canvas id="stats-chart-status"></canvas></div>
    </div>
  </div>`;
  // Store data in global for charts
  window._statsData = {byMonth, types, statusMap, COLORS};
  return html;
}

function initStatsCharts(){
  const d = window._statsData;
  if(!d || typeof Chart==='undefined') return;

  // Місячний
  const ctx1 = document.getElementById('stats-chart-monthly');
  if(ctx1){
    if(ctx1._chart) ctx1._chart.destroy();
    ctx1._chart = new Chart(ctx1,{
      type:'bar',
      data:{
        labels:d.byMonth.map(m=>m.m),
        datasets:[
          {label:'Виручка',data:d.byMonth.map(m=>m.revenue),backgroundColor:'rgba(59,130,246,.5)',borderColor:'#3b82f6',borderWidth:1},
          {label:'Прибуток',data:d.byMonth.map(m=>m.profit),backgroundColor:'rgba(34,197,94,.5)',borderColor:'#22c55e',borderWidth:1},
          {label:'Ремонтів',data:d.byMonth.map(m=>m.count),type:'line',borderColor:'#f97316',backgroundColor:'transparent',borderWidth:2,yAxisID:'y2',tension:.4,pointRadius:4},
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:'var(--text2)',font:{size:10}}}},
        scales:{
          x:{ticks:{color:'var(--text2)',font:{size:10}}},
          y:{ticks:{color:'var(--text2)',font:{size:10},callback:v=>v.toLocaleString()+' ₴'}},
          y2:{position:'right',ticks:{color:'#f97316',font:{size:10}},grid:{drawOnChartArea:false}}
        }
      }
    });
  }

  // Типи пристроїв (donut)
  const ctx2 = document.getElementById('stats-chart-types');
  if(ctx2 && d.types.length){
    if(ctx2._chart) ctx2._chart.destroy();
    ctx2._chart = new Chart(ctx2,{
      type:'doughnut',
      data:{
        labels:d.types.map(([t])=>t),
        datasets:[{data:d.types.map(([,n])=>n),backgroundColor:d.COLORS,borderWidth:2,borderColor:'var(--bg2)'}]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        cutout:'65%'
      }
    });
  }

  // Статуси (pie)
  const ctx3 = document.getElementById('stats-chart-status');
  if(ctx3){
    const entries = Object.entries(d.statusMap);
    const SC = {'На діагностиці':'#3b82f6','В ремонті':'#f59e0b','Готово':'#22c55e','Видано':'#6b7280'};
    if(ctx3._chart) ctx3._chart.destroy();
    ctx3._chart = new Chart(ctx3,{
      type:'doughnut',
      data:{
        labels:entries.map(([s])=>s),
        datasets:[{data:entries.map(([,n])=>n),backgroundColor:entries.map(([s])=>SC[s]||'#888'),borderWidth:2,borderColor:'var(--bg2)'}]
      },
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:'bottom',labels:{color:'var(--text2)',font:{size:10},boxWidth:10}}},
        cutout:'55%'
      }
    });
  }
}

// ════════════════════════════════
// ACT TAB
// ════════════════════════════════
function renderAct(){
  const opts=repairs.map(r=>`<option value="${r.id}" ${actId===r.id?'selected':''}>${r.id} — ${r.client} · ${r.type} ${r.model}</option>`).join('');
  const r=actId?repairs.find(x=>x.id===actId):null;
  const preview=r?`
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:12px;font-size:13px;line-height:2">
      <div style="text-align:center;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">АКТ ПРИЙОМУ НА РЕМОНТ № ${r.id}</div>
      <div><b>${r.client}</b> · ${r.phone}</div>
      <div>${r.type} ${r.model}${r.serial?' · '+r.serial:''}</div>
      <div style="color:var(--text2)">${r.problem||'—'}</div>
      <div>Ціна: <b style="color:var(--green)">${r.price?(+r.price).toLocaleString()+' ₴':'—'}</b> · ${r.pay_status}</div>
    </div>
    <button class="btn blue" onclick="printAct('${r.id}')">🖨 Відкрити бланк для друку</button>`
    :`<div style="text-align:center;padding:40px;color:var(--text3)">Оберіть ремонт зі списку</div>`;

  return`<div style="max-width:600px">
    <div style="margin-bottom:14px">
      <label style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Оберіть ремонт</label>
      <select class="sel" style="width:100%" onchange="actId=this.value;render()"><option value="">— оберіть —</option>${opts}</select>
    </div>
    ${preview}
  </div>`;
}

function printAct(id){
  const r=repairs.find(x=>x.id===id);if(!r)return;
  const p=new URLSearchParams({id:r.id,date:r.date_in||'',client:r.client||'',phone:r.phone||'',type:r.type||'',model:r.model||'',serial:r.serial||'',kit:r.kit||'',problem:r.problem||'',password:r.password||'',notes:r.notes||'',condition:r.condition||'',color:r.color||'',print:'1'});
  window.open('/act-print.html?'+p.toString(),'_blank');
}

// ════════════════════════════════
// SETTINGS TAB
// ════════════════════════════════
function applyAccent(){
  const color = settings.accent_color || '#e8580a';
  document.documentElement.style.setProperty('--orange', color);
  document.documentElement.style.setProperty('--orange-dark', color);
  const el = document.getElementById('shop-name-label');
  if(el && settings.shop_name) el.textContent = settings.shop_name;
}

const ACCENT_COLORS = [
  {name:'Оранжевий',val:'#e8580a'},
  {name:'Синій',val:'#2563eb'},
  {name:'Зелений',val:'#1a9e5a'},
  {name:'Фіолетовий',val:'#7c3aed'},
  {name:'Рожевий',val:'#db2777'},
  {name:'Бірюзовий',val:'#0891b2'},
];

function renderSettings(){
  const s = settings;
  const mList=masters.map(m=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--bg3);border-radius:var(--r);margin-bottom:6px">
      <div>
        <span style="font-weight:600">${m.name}</span>
        <span style="color:var(--text2);font-size:12px;margin-left:8px">ставка: ${m.rate||s.master_rate||40}%</span>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn xs" onclick="editMasterRate(${m.id},'${m.name}',${m.rate||s.master_rate||40})">%</button>
        <button class="btn xs red" onclick="delMaster(${m.id})">✕</button>
      </div>
    </div>`).join('');

  const accentBtns = ACCENT_COLORS.map(c=>`
    <button onclick="pickAccent('${c.val}')" title="${c.name}"
      style="width:32px;height:32px;border-radius:50%;background:${c.val};border:3px solid ${(s.accent_color||'#e8580a')===c.val?'var(--text)':'transparent'};cursor:pointer;transition:border .15s"></button>
  `).join('');

  return`<div style="max-width:560px;display:flex;flex-direction:column;gap:14px">

    <!-- МАГАЗИН -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px">🏪 Інформація про сервісний центр</h4>
      <div class="fg" style="gap:10px">
        <div class="frow"><label>Назва</label><input class="inp" id="s-shop_name" value="${s.shop_name||''}" placeholder="AM Store"/></div>
        <div class="frow"><label>Телефон</label><input class="inp" id="s-shop_phone" value="${s.shop_phone||''}" placeholder="073 477 30 90"/></div>
        <div class="frow full"><label>Адреса</label><input class="inp" id="s-shop_address" value="${s.shop_address||''}" placeholder="Черкаси, ТРЦ Хрещатик"/></div>
        <div class="frow"><label>Telegram</label><input class="inp" id="s-shop_telegram" value="${s.shop_telegram||''}" placeholder="@amadze"/></div>
        <div class="frow"><label>Гарантія (днів)</label><input class="inp" type="number" id="s-warranty_days" value="${s.warranty_days||30}"/></div>
      </div>
      <button class="btn orange" style="margin-top:12px" onclick="saveSettings(['shop_name','shop_phone','shop_address','shop_telegram','warranty_days'])">Зберегти</button>
    </div>

    <!-- МАЙСТРИ -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px">👷 Майстри</h4>
      <div style="font-size:11px;color:var(--text2);margin-bottom:12px">Ставка за замовчуванням: <input class="inp" type="number" id="s-master_rate" value="${s.master_rate||40}" style="width:60px;display:inline;padding:3px 8px;margin:0 4px"/> %
        <button class="btn xs" onclick="saveSettings(['master_rate'])">Зберегти</button>
      </div>
      <div>${mList||'<div style="color:var(--text3);font-size:13px;padding:8px 0">Немає майстрів</div>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input class="inp" id="new-master" style="flex:1" placeholder="Ім'я майстра..." onkeydown="if(event.key==='Enter')addMaster()"/>
        <button class="btn blue" onclick="addMaster()">Додати</button>
      </div>
    </div>

    <!-- ШАБЛОНИ -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px">📋 Шаблони повідомлень</h4>
      <div style="font-size:11px;color:var(--text2);margin-bottom:12px">Змінні: <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{client}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{type}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{model}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{id}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{price}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{phone}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{days}</code> <code style="background:var(--bg3);padding:1px 5px;border-radius:3px">{shop_name}</code></div>
      <div class="fg" style="grid-template-columns:1fr;gap:10px">
        <div class="frow"><label>✅ Готово до видачі</label><textarea class="area" id="s-msg_ready" style="min-height:60px">${s.msg_ready||''}</textarea></div>
        <div class="frow"><label>🔧 Прийнято в ремонт</label><textarea class="area" id="s-msg_accept" style="min-height:60px">${s.msg_accept||''}</textarea></div>
        <div class="frow"><label>💳 Нагадування про оплату</label><textarea class="area" id="s-msg_debt" style="min-height:60px">${s.msg_debt||''}</textarea></div>
        <div class="frow"><label>⏰ Не забрав 7+ днів</label><textarea class="area" id="s-msg_overdue" style="min-height:60px">${s.msg_overdue||''}</textarea></div>
      </div>
      <button class="btn orange" style="margin-top:12px" onclick="saveSettings(['msg_ready','msg_accept','msg_debt','msg_overdue'])">Зберегти шаблони</button>
    </div>

    <!-- КОЛІР АКЦЕНТУ -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">🎨 Колір акценту</h4>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        ${accentBtns}
        <div style="display:flex;align-items:center;gap:8px;margin-left:8px">
          <input type="color" id="s-accent_color" value="${s.accent_color||'#e8580a'}" style="width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;padding:0"/>
          <span style="font-size:12px;color:var(--text2)">Свій колір</span>
          <button class="btn xs" onclick="pickAccent(document.getElementById('s-accent_color').value)">OK</button>
        </div>
      </div>
    </div>

    <!-- ПАРОЛЬ -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">🔒 Змінити пароль</h4>
      <div class="fg" style="gap:10px">
        <div class="frow"><label>Поточний пароль</label><input class="inp" type="password" id="pw-current"/></div>
        <div class="frow"><label>Новий пароль</label><input class="inp" type="password" id="pw-new"/></div>
        <div class="frow"><label>Повторити</label><input class="inp" type="password" id="pw-confirm"/></div>
      </div>
      <button class="btn orange" style="margin-top:12px" onclick="changePassword()">Змінити пароль</button>
      <div id="pw-msg" style="font-size:12px;margin-top:8px"></div>
    </div>

    <!-- БЕКАП І ЕКСПОРТ -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px">
      <h4 style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">💾 Дані</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a href="/api/backup" style="text-decoration:none"><button class="btn blue">⬇ Резервна копія БД</button></a>
        <a href="/api/export/repairs" style="text-decoration:none"><button class="btn green">⬇ Ремонти (CSV)</button></a>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:8px">Рекомендуємо робити копію щотижня</div>
    </div>

  </div>`;
}

async function saveSettings(keys){
  const body={};
  keys.forEach(k=>{
    const el=document.getElementById('s-'+k);
    if(el) body[k]=el.value;
  });
  await api('PUT','/api/settings',body);
  Object.assign(settings,body);
  applyAccent();
  showToast('✓ Збережено!');
  render();
}

async function pickAccent(color){
  settings.accent_color=color;
  await api('PUT','/api/settings',{accent_color:color});
  applyAccent();
  render();
}

async function changePassword(){
  const cur=document.getElementById('pw-current').value;
  const nw=document.getElementById('pw-new').value;
  const conf=document.getElementById('pw-confirm').value;
  const msg=document.getElementById('pw-msg');
  if(!cur||!nw) return msg.textContent='Заповніть всі поля';
  if(nw!==conf) return msg.textContent='Паролі не співпадають';
  if(nw.length<6) return msg.textContent='Мінімум 6 символів';
  const r=await api('POST','/api/change-password',{current:cur,newPass:nw});
  if(r&&r.ok){msg.style.color='var(--green)';msg.textContent='✓ Пароль змінено!';}
  else{msg.style.color='var(--red)';msg.textContent=r?.error||'Помилка';}
}

function editMasterRate(id,name,rate){
  const nr=prompt(`Ставка для ${name} (%):`,rate);
  if(nr===null)return;
  api('PUT','/api/settings',{[`master_rate_${id}`]:nr}).then(()=>{
    Object.assign(settings,{[`master_rate_${id}`]:nr});
    render();
  });
}

function showToast(text){
  const el=document.createElement('div');
  el.className='toast';el.textContent=text;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),2200);
}

async function addMaster(){
  const el=document.getElementById('new-master');
  if(!el||!el.value.trim())return;
  await api('POST','/api/masters',{name:el.value.trim()});
  await loadMasters();render();
}
async function delMaster(id){
  if(!confirm('Видалити майстра?'))return;
  await api('DELETE','/api/masters/'+id);await loadMasters();render();
}

// ── THEME ──
function toggleTheme(){
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const next=isDark?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  localStorage.setItem('crm_theme',next);
  document.getElementById('theme-btn').textContent=next==='dark'?'☀️':'🌙';
}
function initTheme(){
  const saved=localStorage.getItem('crm_theme')||'light';
  document.documentElement.setAttribute('data-theme',saved);
  const btn=document.getElementById('theme-btn');
  if(btn)btn.textContent=saved==='dark'?'☀️':'🌙';
}

// ── STATS ICONS ──
const STAT_ICONS={active:'🔧',overdue:'⚠️',revenue:'📈',profit:'💰',debt:'💳',cash:'🏦'};

// ── DEVICE TYPE ROW CLASS ──
function deviceClass(type){
  if(!type)return '';
  const t=type.toLowerCase();
  if(t.includes('iphone'))return 'type-iphone';
  if(t.includes('samsung'))return 'type-samsung';
  if(t.includes('ipad'))return 'type-ipad';
  if(t.includes('mac'))return 'type-mac';
  return 'type-other';
}

// ── OVERRIDE toast ──
function copyText(text){
  navigator.clipboard.writeText(text).then(()=>{
    const el=document.createElement('div');
    el.className='toast';
    el.textContent='✓ Скопійовано!';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(),2200);
  });
}

// ── BOOT (override) ──
window.onload=()=>{
  initTheme();
  if(TOKEN){
    document.getElementById('login-screen').style.display='none';
    const app=document.getElementById('app');app.style.display='flex';app.style.flexDirection='column';
    loadAll();
  }
};
