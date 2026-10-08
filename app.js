/* NEXUS JEE — app.js
   Dashboard core logic. Ab sab kuch real data par chalta hai (store.js -> localStorage):
   greeting (time + name), exam countdown, tasks (add/tick/delete + persist),
   focus timer (end-timestamp based, session save, beep + notification),
   study hours / streak / chart sessions se, XP aur level.
   UI, CSS aur animations bilkul original jaisi. */
var $=function(s){return document.querySelector(s)},$$=function(s){return [].slice.call(document.querySelectorAll(s))};
$('#dt').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',day:'numeric',month:'long'}).toUpperCase();

/* ---------- helpers ---------- */
function dkey(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
function dayPart(){var h=new Date().getHours();return h<12?'morning':h<17?'afternoon':'evening'}
function sum(a){return a.reduce(function(x,y){return x+y},0)}
function addXP(n){if(!n)return;Store.set('xp',Math.max(0,(Store.get('xp',0)||0)+n))}
window.addXP=addXP; /* pages (mistakes.js) XP awards ke liye */

/* ---------- chart (sessions se) ---------- */
var cur='2W',P=[],CW=800,drawn=false,SER=[];
var N={'1W':7,'2W':14,'1M':30};
function dayHours(k){var m=0;Store.get('sessions',[]).forEach(function(x){if(x.date===k)m+=+x.minutes||0});return +(m/60).toFixed(1)}
function chartSeries(){var n=N[cur]||14,out=[],i,d;for(i=n-1;i>=0;i--){d=new Date();d.setDate(d.getDate()-i);out.push(dayHours(dkey(d)))}return out}
function build(){
  var d=SER=chartSeries(),W=CW=$('#cw').clientWidth||800,H=230,pd=14,mx=Math.max.apply(null,d)*1.2||1;
  $('#sv').setAttribute('viewBox','0 0 '+W+' '+H);
  P=d.map(function(v,i){return [pd+i*(W-2*pd)/(d.length-1),H-pd-(v/mx)*(H-2*pd)]});
  var s='M'+P[0][0]+','+P[0][1];for(var i=1;i<P.length;i++){var a=P[i-1],b=P[i],m=(a[0]+b[0])/2;s+=' C'+m+','+a[1]+' '+m+','+b[1]+' '+b[0]+','+b[1]}
  var ln=$('#ln'),ar=$('#ar'),g='';for(var k=0;k<4;k++){var y=pd+k*(H-2*pd)/3;g+='<line x1="0" x2="'+W+'" y1="'+y+'" y2="'+y+'"/>'}
  $('#gr').innerHTML=g;ln.setAttribute('d',s);ar.setAttribute('d',s+' L'+P[P.length-1][0]+','+H+' L'+P[0][0]+','+H+' Z');
  var L=ln.getTotalLength();ln.style.transition='none';ln.style.strokeDasharray=L;ln.style.strokeDashoffset=L;ar.style.transition='none';ar.style.opacity=0;$('#dot').style.opacity=0;
  $('#vl').setAttribute('y1',0);$('#vl').setAttribute('y2',H);rd(P.length-1,true);
  if(!drawn)return;void ln.getBoundingClientRect();ln.style.transition='stroke-dashoffset 1.8s var(--e)';ln.style.strokeDashoffset=0;ar.style.transition='opacity 1.3s ease .8s';ar.style.opacity=1;
  setTimeout(function(){$('#dot').style.transition='opacity .5s';$('#dot').style.opacity=1},1500);
}
function rd(i,tot){var d=SER;$('#rdn').textContent=tot?sum(d).toFixed(1):d[i].toFixed(1);$('#rdl').textContent=tot?'hours total':'hours that day';$('#dot').setAttribute('cx',P[i][0]);$('#dot').setAttribute('cy',P[i][1]);$('#vl').setAttribute('x1',P[i][0]);$('#vl').setAttribute('x2',P[i][0])}
$('#cw').addEventListener('mousemove',function(e){var r=this.getBoundingClientRect(),n=P.length,i=Math.max(0,Math.min(n-1,Math.round((e.clientX-r.left-14)/((CW-28)/(n-1)))));rd(i,false);$('#vl').setAttribute('opacity',1);$('#dot').style.opacity=1});
$('#cw').addEventListener('mouseleave',function(){$('#vl').setAttribute('opacity',0);rd(P.length-1,true)});
$$('#seg button').forEach(function(b){b.onclick=function(){$$('#seg button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');cur=b.textContent;drawn=true;build()}});
var sd=$('#sd');for(var k=0;k<7;k++){var q=document.createElement('i');q.style.setProperty('--k',k);sd.appendChild(q)}

/* ---------- reveal / play (original) ---------- */
function count(el){var to=parseFloat(el.dataset.n),dec=+el.dataset.d||0;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){el.textContent=to.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g,dec?'':',');return}
  var t0=null;(function f(t){if(t0===null)t0=t;var p=Math.max(0,Math.min((t-t0)/1500,1)),e=1-Math.pow(1-p,4);el.textContent=(to*e).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g,dec?'':',');if(p<1)requestAnimationFrame(f)})(performance.now())}
function reveal(el){el.classList.add('in');
  $$('[data-n]').filter(function(n){return el.contains(n)}).forEach(function(n){setTimeout(function(){count(n)},350)});
  if(el.contains($('#sd')))setTimeout(function(){sd.classList.add('go')},100);
  [].forEach.call(el.querySelectorAll('[data-w]'),function(u){u.style.width=u.dataset.w+'%'});
  if(el.contains($('#mr')))mission();if(el.contains($('#cw'))){drawn=true;build()}if(el.contains($('#tr')))timerUI();
}
var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){io.unobserve(en.target);reveal(en.target)}})},{threshold:.12});
function play(){$$('.r').forEach(function(e,i){io.unobserve(e);e.classList.remove('in');e.style.setProperty('--i',i%7)});
  $$('[data-w]').forEach(function(u){u.style.width='0'});$('#xp').style.width='0';$('#mr').style.strokeDashoffset=326.7;sd.classList.remove('go');drawn=false;
  void document.body.offsetWidth;$$('.r').forEach(function(e){io.observe(e)});setTimeout(function(){syncXP()},100)}

/* ---------- premium tilt + cursor spotlight (delegated; transform/opacity only) ---------- */
window.NexusTilt=(function(){
  var ok=!!window.matchMedia&&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches&&
    window.matchMedia('(pointer: fine)').matches;
  if(!ok)return{enabled:false};
  var prev=null;
  document.addEventListener('mousemove',function(e){
    var t=(e.target&&e.target.closest)?e.target.closest('[data-tilt],[data-spot]'):null;
    if(prev&&prev!==t){prev.style.removeProperty('--rx');prev.style.removeProperty('--ry');prev=null}
    if(!t)return;
    var r=t.getBoundingClientRect();
    if(r.width<1||r.height<1)return;
    if(t.hasAttribute('data-tilt')){
      t.style.setProperty('--ry',(((e.clientX-r.left)/r.width-.5)*7).toFixed(2)+'deg');
      t.style.setProperty('--rx',((.5-(e.clientY-r.top)/r.height)*7).toFixed(2)+'deg');
    }
    if(t.hasAttribute('data-spot')){
      t.style.setProperty('--mx',(e.clientX-r.left)+'px');
      t.style.setProperty('--my',(e.clientY-r.top)+'px');
    }
    prev=t;
  },{passive:true});
  return{enabled:true};
})();

/* ---------- store -> UI sync ---------- */
function todays(){var k=dkey(new Date()),pl=window.NexusPlanner;return Store.get('tasks',[]).filter(function(t){return pl?pl.occursOn(t,k):(t.date||t.day)===k})}
function activeDays(){var a={};Store.get('sessions',[]).forEach(function(x){a[x.date]=1});Store.get('tasks',[]).forEach(function(x){if(x.done&&x.doneAt)a[dkey(new Date(x.doneAt))]=1;if(x.dones)Object.keys(x.dones).forEach(function(k){a[k]=1})});return a}
function syncExam(){var parts=(Store.get('examDate','2027-01-22')||'').split('-');if(parts.length!==3)return;
  var ex=new Date(+parts[0],+parts[1]-1,+parts[2]),t=new Date();t.setHours(0,0,0,0);
  var d=Math.ceil((ex-t)/864e5);if(!(d>0))d=0;var el=$('#dys');el.dataset.n=d;el.textContent=d;
  $('#examLbl').textContent='days to JEE Main '+parts[0]}
function syncStreak(){var act=activeDays(),s=0,d=new Date();if(!act[dkey(d)])d.setDate(d.getDate()-1);
  while(act[dkey(d)]){s++;d.setDate(d.getDate()-1)}
  var el=$('#stn');el.dataset.n=s;el.textContent=s;
  for(var k=0;k<7;k++){var dd=new Date();dd.setDate(dd.getDate()-(6-k));var q=sd.children[k];if(q)q.classList.toggle('f',!!act[dkey(dd)])}}
function syncHours(){var all=Store.get('sessions',[]),mins=0,week=0,t=new Date();t.setHours(0,0,0,0);
  all.forEach(function(x){mins+=+x.minutes||0;var p=String(x.date).split('-'),d=new Date(+p[0],+p[1]-1,+p[2]),diff=(t-d)/864e5;if(diff>=0&&diff<7)week+=+x.minutes||0});
  var el=$('#hrn');el.dataset.n=+(mins/60).toFixed(1);el.textContent=(mins/60).toFixed(1);
  $('#hrSmall').textContent=(week/60).toFixed(1)+'h this week'}
function syncSessions(){var all=Store.get('sessions',[]),el=$('#scn');el.dataset.n=all.length;el.textContent=all.length;
  $('#scSmall').textContent=all.length?all.length+' completed':'no sessions yet'}
function syncMistakes(){var ms=Store.get('mistakes',[]),t=dkey(new Date()),n=ms.filter(function(m){return !m.mastered&&(!m.nextReview||m.nextReview<=t)}).length,el=$('#mkn');el.dataset.n=n;el.textContent=n;
  var s=$('#mkSmall');s.classList.toggle('w',n>0);s.textContent=n>0?'needs attention':'all clear';
  var pq=$('#pqMk');if(pq)pq.textContent=n?n+' questions to review':'nothing to review yet'}
function syncTestStats(){var st=(window.NexusTests&&window.NexusTests.stats)?window.NexusTests.stats():{att:0,mistakes:0,acc:null};
  var qs=(st.att||0)+(st.mistakes||0),qe=$('#qsn');
  qe.dataset.n=qs;qe.textContent=qs;
  $('#qsSmall').textContent=qs?(st.att+' in tests · '+st.mistakes+' in mistake book'):'no tests logged yet';
  var ae=$('#acn'),as=$('#acSmall');
  if(st.acc===null||isNaN(st.acc)){ae.dataset.n=0;ae.textContent='0';as.textContent='no data yet';as.classList.remove('w')}
  else{var a=Math.round(st.acc);ae.dataset.n=a;ae.textContent=a;var w=(st.wrong==null?(st.att||0)-(st.cor||0)+(st.mistakes||0):st.wrong);as.textContent=w>0?w+' wrong answer'+(w>1?'s':''):'all correct';as.classList.toggle('w',w>0)}}
function syncSyllabus(){var s=Store.get('syllabus',{})||{};
  $$('.sb [data-sub]').forEach(function(el){var v=Math.max(0,Math.min(100,Math.round(+s[el.dataset.sub]||0)));
    if(el.classList.contains('num')){el.dataset.n=v;el.textContent=v}else{el.dataset.w=v;el.style.width=v+'%'}})}
function syncXP(){var xp=Math.max(0,Store.get('xp',0)||0),lvl=Math.floor(xp/1000)+1;
  $('#lvl').textContent='Level '+lvl;$('#xptxt').textContent='\u00b7 '+(xp%1000)+' / 1000 XP';$('#xp').style.width=((xp%1000)/10)+'%'}
function syncTasks(){var list=todays(),tk=dkey(new Date()),pl=window.NexusPlanner,tl=$('#tl'),rows=$$('#tl .tk'),dirty=rows.length!==list.length,i;
  for(i=0;i<rows.length&&!dirty;i++)if(rows[i].dataset.id!==String(list[i].id))dirty=true;
  if(dirty){tl.innerHTML='';list.forEach(function(t){var dn=pl?pl.isDoneOn(t,tk):!!t.done;
    var d=document.createElement('div');d.className='tk'+(dn?' d':'');d.dataset.id=t.id;
    d.innerHTML='<i></i><span></span><em></em><b class="del" title="Delete task">&times;</b>';
    d.querySelector('span').textContent=t.title||t.text;tl.appendChild(d)})}
  else rows.forEach(function(r,i){var dn=pl?pl.isDoneOn(list[i],tk):!!list[i].done;
    r.classList.toggle('d',dn);var em=r.querySelector('em');if(em)em.textContent=dn?'done':''})}
function mission(){var tk=dkey(new Date()),pl=window.NexusPlanner,t=todays(),d=t.filter(function(x){return pl?pl.isDoneOn(x,tk):x.done}).length;$('#mt').textContent=d+'/'+t.length;
  $('#mr').style.strokeDashoffset=326.7*(1-(t.length?d/t.length:0));
  $('#mp').textContent=t.length===0?'Add a task below to start your mission.':(d===t.length?'Mission complete. Streak protected.':'Finish your '+t.length+' blocks to protect the streak.')}

/* ---------- tasks: add / tick / delete ---------- */
$('#tl').addEventListener('click',function(e){var row=e.target.closest('.tk');if(!row)return;
  var tasks=Store.get('tasks',[]),id=row.dataset.id,i=-1,j;
  for(j=0;j<tasks.length;j++)if(String(tasks[j].id)===id)i=j;if(i<0)return;
  if(e.target.closest('.del')){if(window.NexusPlanner)NexusPlanner.deleteTask(id);else{tasks.splice(i,1);Store.set('tasks',tasks)}return}
  if(window.NexusPlanner){var nd=NexusPlanner.toggleDone(id,dkey(new Date()));addXP(nd?10:-10);return}
  var t=tasks[i];t.done=!t.done;t.doneAt=t.done?Date.now():null;Store.set('tasks',tasks);addXP(t.done?10:-10)});
$('#ad').addEventListener('keydown',function(e){if(e.key==='Enter'&&this.value.trim()){
  if(window.NexusPlanner){NexusPlanner.addTask({title:this.value.trim(),date:dkey(new Date())});this.value='';return}
  var tasks=Store.get('tasks',[]);
  tasks.push({id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:this.value.trim(),done:false,day:dkey(new Date()),doneAt:null});
  Store.set('tasks',tasks);this.value=''}});

/* store subscribers: data badlo -> UI khud update */
Store.subscribe('tasks',function(){syncTasks();syncStreak();syncXP();mission()});
Store.subscribe('sessions',function(){syncHours();syncSessions();syncStreak();SER=chartSeries();if(drawn)build()});
Store.subscribe('xp',function(){syncXP()});
Store.subscribe('mistakes',function(){syncMistakes();syncTestStats()});
Store.subscribe('tests',function(){syncTestStats()});
Store.subscribe('syllabus',function(){syncSyllabus()});
Store.subscribe('examDate',function(){syncExam()});
Store.subscribe('name',function(){if(pageFromHash()==='dashboard')setGreeting()});

/* ---------- focus timer (end-timestamp based) ---------- */
var C=552.9,tot=1500,left=1500,endAt=0,iv=null,running=false,AC=null,shown=null;
function fmt(s){return ('0'+Math.floor(s/60)).slice(-2)+':'+('0'+s%60).slice(-2)}
function timerUI(){$('#tt').textContent=fmt(left);$('#tr').style.transition='stroke-dashoffset 1s linear';$('#tr').style.strokeDashoffset=C*(1-left/tot)}
function stop(){running=false;clearInterval(iv);iv=null;$('#ts').textContent='Start'}
function tick(){left=Math.max(0,Math.ceil((endAt-Date.now())/1000));if(left!==shown){shown=left;timerUI()}if(left<=0)finish()}
function finish(){stop();left=0;shown=null;timerUI();$('#tt').textContent='Done';
  var m=Math.round(tot/60);
  Store.set('sessions',Store.get('sessions',[]).concat([{date:dkey(new Date()),minutes:m,at:Date.now()}]));
  addXP(Math.round(m/25*20));beep();notifyDone(m)}
function start(){if(running){stop();return}if(left<=0)left=tot;
  try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume()}catch(e){}
  try{if(window.Notification&&Notification.permission==='default')Notification.requestPermission()}catch(e){}
  running=true;endAt=Date.now()+left*1000;shown=null;$('#ts').textContent='Pause';iv=setInterval(tick,250)}
function beep(){try{if(!AC)return;var t=AC.currentTime;[0,.22,.44].forEach(function(dt){
  var o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=880;o.connect(g);g.connect(AC.destination);
  g.gain.setValueAtTime(.0001,t+dt);g.gain.exponentialRampToValueAtTime(.3,t+dt+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dt+.2);
  o.start(t+dt);o.stop(t+dt+.22)})}catch(e){}}
function notifyDone(m){try{if(window.Notification&&Notification.permission==='granted')
  new Notification('NEXUS JEE \u2014 Focus session complete',{body:m+' min logged. +'+Math.round(m/25*20)+' XP earned.'})}catch(e){}}
function checkTimer(){if(running){left=Math.max(0,Math.ceil((endAt-Date.now())/1000));if(left<=0)finish();else{shown=null;timerUI()}}}
document.addEventListener('visibilitychange',checkTimer);addEventListener('focus',checkTimer);
$('#ts').onclick=start;$('#tx').onclick=function(){stop();left=tot;shown=null;timerUI()};
$$('#pre button').forEach(function(b){b.onclick=function(){$$('#pre button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');stop();tot=left=b.dataset.m*60;shown=null;timerUI()}});
$('#go').onclick=function(){function go(){$('#tt').scrollIntoView({behavior:'smooth',block:'center'});if(!running)setTimeout(start,500)}
  if(pageFromHash()!=='dashboard'){location.hash='dashboard';setTimeout(go,120)}else go()};
/* header ka Export button bhi wahi JSON backup deta hai (Settings page ke export se) */
var exp=$('#exp');if(exp)exp.onclick=function(){if(window.NexusSettings)NexusSettings.exportJSON();else location.hash='settings'};

/* ---------- hash router ----------
   Desktop sidebar (#nav), mobile bottom tabbar (#tabbar) aur "More" sheet
   (#more-sheet) — teeno ek hi PAGES map se chalti hain, isliye active state
   hamesha sync rehti hai. Sidebar ka pill sirf sidebar ke liye hai. */
var nb=$$('#nav button, #tabbar button[data-page], #more-sheet button[data-page]'),PAGES={};
nb.forEach(function(b){if(!PAGES[b.dataset.page])PAGES[b.dataset.page]=b});
var MAIN_TABS=['dashboard','syllabus','planner','tests'];
function mv(b){var p=$('#pill');if(p&&b)p.style.transform='translateY('+(b.offsetTop||0)+'px)'}
/* "More" tab active dikhta hai jab sheet khuli ho ya page kisi main tab me na ho */
function syncMoreActive(){
  var m=$('#more-btn');if(!m)return;
  var s=$('#more-sheet'),open=s?(s.className||'').indexOf('open')>-1:false;
  m.classList.toggle('on',open||MAIN_TABS.indexOf(pageFromHash())<0);
}
function openMore(){
  var s=$('#more-sheet'),b=$('#more-backdrop'),m=$('#more-btn');
  if(s)s.className='open';if(b)b.className='open';
  if(m)m.setAttribute('aria-expanded','true');
  syncMoreActive();
}
function closeMore(){
  var s=$('#more-sheet'),b=$('#more-backdrop'),m=$('#more-btn');
  if(s)s.className='';if(b)b.className='';
  if(m)m.setAttribute('aria-expanded','false');
  syncMoreActive();
}
function pageFromHash(){var h=(location.hash||'').replace(/^#/,'');return PAGES[h]?h:'dashboard'}
function setGreeting(){$('#ttl').innerHTML='Good '+dayPart()+', <em></em>';var em=$('#ttl').querySelector('em');if(em)em.textContent=Store.get('name','Ashvin')}
function route(page,first){
  if(!PAGES[page])page='dashboard';
  nb.forEach(function(x){x.classList.toggle('on',x.dataset.page===page)});mv(PAGES[page]);
  if(page==='dashboard')setGreeting();
  else{var m=(window.NexusPages||{})[page];$('#ttl').textContent=(m&&m.title)||page}
  showPageMain(page);
  $('.grid').style.display=page==='dashboard'?'':'none';
  var mod=(window.NexusPages||{})[page];if(mod&&mod.render)mod.render(page);
  var pl=document.getElementById('pl');if(pl)pl.style.display=page==='planner'?'':'none';
  var sx=document.getElementById('sx');if(sx)sx.style.display=page==='syllabus'?'':'none';
  var cl=document.getElementById('cl');if(cl)cl.style.display=page==='calendar'?'':'none';
  var mk=document.getElementById('mk');if(mk)mk.style.display=page==='mistakes'?'':'none';
  var ts=document.getElementById('tst');if(ts)ts.style.display=page==='tests'?'':'none';
  var st=document.getElementById('st');if(st)st.style.display=page==='settings'?'':'none';
  var an=document.getElementById('an');if(an)an.style.display=page==='analytics'||page==='an'?'':'none';
  closeMore();
  play();
  if(!first)scrollTo({top:0});
}
nb.forEach(function(b){b.onclick=function(){var p=b.dataset.page;if(pageFromHash()===p){route(p)}else{location.hash=p}}});
addEventListener('hashchange',function(){route(pageFromHash())});
addEventListener('resize',function(){mv($('#nav button.on'));syncMoreActive();if(drawn&&Math.abs($('#cw').clientWidth-CW)>4)build()});  var GRID_PAGES={dashboard:'#grid',analytics:'#an',an:'#an'};
  function showPageMain(p){var id=GRID_PAGES[p];if(!id)return;var el=$(id);if(!el)return;['#grid','#an'].forEach(function(s){var x=$(s);if(x)x.style.display=s===id?'':'none'})}
  var mbtn=$('#more-btn'),mx=$('#more-x'),mbd=$('#more-backdrop');
if(mbtn)mbtn.onclick=openMore;
if(mx)mx.onclick=closeMore;
if(mbd)mbd.onclick=closeMore;
addEventListener('keydown',function(e){if(e.key==='Escape')closeMore()});
/* OAuth callback guard: Supabase se wapas aate waqt URL me session ya error
   hota hai — implicit flow me fragment (#access_token=…), PKCE me query
   (?code=…) aur fail hone par #error=… Ye kabhi bhi koi app page nahi hota,
   isliye router use '#dashboard' se overwrite na kare — warna supabase.js
   usse padhne se pehle hi tokens mit jaate hain aur session ban hi nahi
   paati. Normal URLs par niche wala behavior bilkul pehle jaisa hai. */
function isSupaAuthReturn(){
  return /(^|[#&?])(access_token|refresh_token|provider_token|code|error|error_code|error_description)=/.test(location.hash+location.search)
}
if(!isSupaAuthReturn()){try{history.replaceState(null,'','#'+pageFromHash())}catch(e){}}

/* ---------- init ---------- */
function syncAll(){syncExam();syncStreak();syncHours();syncSessions();syncMistakes();syncTestStats();syncSyllabus();syncTasks();syncXP()}
syncAll();route(pageFromHash(),true);build();
