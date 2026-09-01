const state={questions:[],progress:new Map(),active:[],index:0,answered:new Map()};
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];

function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2200)}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Błąd połączenia');return response.json()}
function record(nr){return state.progress.get(nr)||{question_nr:nr,mastered:0,correct_count:0,wrong_count:0}}
function isMastered(q){return Boolean(record(q.nr).mastered)}
function scoreFor(q){const p=record(q.nr),correct=p.correct_count||0,wrong=p.wrong_count||0,attempts=correct+wrong;return{correct,wrong,attempts,percent:attempts?Math.round(correct/attempts*100):null}}

async function loadApp(){
  try{
    const [questionData,progressData]=await Promise.all([api('/api/questions'),api('/api/progress')]);
    state.questions=questionData.questions;progressData.progress.forEach(p=>state.progress.set(p.question_nr,p));
    const sections=[...new Set(state.questions.map(q=>q.dzial))];
    for(const select of [$('#quizSection'),$('#tableSection'),$('#statsSection')])sections.forEach(s=>select.add(new Option(s,s)));
    $('#syncState').textContent=`Konto: ${progressData.user}`;$('#syncState').classList.add('ok');$('#authView').classList.add('hidden');$('#appShell').classList.remove('hidden');renderStats();renderTable();renderStatistics();
  }catch(error){$('#syncState').textContent='Brak połączenia z bazą';$('#syncState').classList.add('error');toast(error.message)}
}

async function init(){
  try{
    const session=await api('/api/auth/session');
    if(session.authenticated)await loadApp();
  }catch(error){showAuthError(error.message)}
}

function showAuthError(message){const error=$('#authError');error.textContent=message;error.classList.remove('hidden')}
function clearAuthError(){$('#authError').classList.add('hidden')}
async function authenticate(mode){
  clearAuthError();const username=$('#authUsername').value.trim(),pin=$('#authPin').value.trim();
  if(!/^[A-Za-z0-9_-]{3,24}$/.test(username)||!/^\d{6}$/.test(pin))return showAuthError('Login musi mieć 3–24 znaki, a PIN dokładnie 6 cyfr.');
  const buttons=$$('#authForm button');buttons.forEach(button=>button.disabled=true);
  try{await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify({username,pin})});await loadApp();}
  catch(error){showAuthError(error.message)}finally{buttons.forEach(button=>button.disabled=false)}
}
$('#authForm').addEventListener('submit',event=>{event.preventDefault();authenticate('login')});
$('#registerButton').addEventListener('click',()=>authenticate('register'));
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});}finally{location.reload()}});

function renderStats(){
  const rows=state.questions.map(q=>record(q.nr));const mastered=state.questions.filter(isMastered).length;
  const correct=rows.reduce((s,p)=>s+(p.correct_count||0),0);const wrong=rows.reduce((s,p)=>s+(p.wrong_count||0),0);const total=correct+wrong;
  $('#statMastered').textContent=`${mastered}/${state.questions.length}`;$('#statLearning').textContent=state.questions.length-mastered;
  $('#statAccuracy').textContent=total?`${Math.round(correct/total*100)}%`:'—';$('#statAnswered').textContent=total;
}

$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{const view=tab.dataset.view;$$('.tab').forEach(x=>x.classList.toggle('active',x===tab));$('#quizView').classList.toggle('hidden',view!=='quiz');$('#tableView').classList.toggle('hidden',view!=='table');$('#statisticsView').classList.toggle('hidden',view!=='statistics');if(view==='table')renderTable();if(view==='statistics')renderStatistics()}));

function quizPool(){
  const section=$('#quizSection').value,mode=$('#quizMode').value;let pool=state.questions.filter(q=>section==='all'||q.dzial===section);
  if(mode==='learning')pool=pool.filter(q=>!isMastered(q));
  if(mode==='mastered')pool=pool.filter(isMastered);
  if(mode==='errors')pool=pool.filter(q=>(record(q.nr).wrong_count||0)>0).sort((a,b)=>(record(b.nr).wrong_count||0)-(record(a.nr).wrong_count||0));
  if(mode==='lowAttempts')pool=pool.filter(q=>scoreFor(q).attempts<3).sort((a,b)=>scoreFor(a).attempts-scoreFor(b).attempts||a.nr-b.nr);
  if(mode==='lowScore')pool=pool.filter(q=>scoreFor(q).attempts>0&&scoreFor(q).percent<70).sort((a,b)=>scoreFor(a).percent-scoreFor(b).percent||scoreFor(a).attempts-scoreFor(b).attempts);
  return pool;
}
function start(shuffle){state.active=quizPool();if(!state.active.length)return toast('Brak pytań dla wybranego zakresu.');if(shuffle)state.active.sort(()=>Math.random()-.5);state.index=0;state.answered.clear();$('#emptyQuiz').classList.add('hidden');$('#questionCard').classList.remove('hidden');showQuestion()}
$('#startRandom').addEventListener('click',()=>start(true));$('#startSequential').addEventListener('click',()=>start(false));

function showQuestion(){
  const q=state.active[state.index],chosen=state.answered.get(q.nr),score=scoreFor(q);$('#questionSection').textContent=q.dzial;$('#questionNumber').textContent=`Nr ${q.nr} · ${state.index+1}/${state.active.length}`;$('#questionScore').innerHTML=`<span>Próby <b>${score.attempts}</b></span><span>Poprawne <b>${score.correct}</b></span><span>Wynik <b class="${score.percent===null?'':score.percent>=70?'score-pass':'score-fail'}">${score.percent===null?'—':score.percent+'%'}</b></span>`;$('#progressFill').style.width=`${(state.index+1)/state.active.length*100}%`;$('#questionText').textContent=q.pytanie;
  $('#answers').innerHTML=['A','B','C'].map(letter=>`<button class="answer ${chosen&&letter===q.poprawna?'correct':''} ${chosen===letter&&letter!==q.poprawna?'wrong':''}" data-answer="${letter}" ${chosen?'disabled':''}><b>${letter}.</b><span>${escapeHtml(q[letter.toLowerCase()])}</span></button>`).join('');
  $$('.answer').forEach(btn=>btn.addEventListener('click',()=>answer(q,btn.dataset.answer)));const fb=$('#feedback');fb.className='feedback hidden';if(chosen)showFeedback(q,chosen);
  updateMasterButton(q);$('#prevQuestion').disabled=state.index===0;$('#nextQuestion').textContent=state.index===state.active.length-1?'Zakończ':'Dalej';
}
function showFeedback(q,answer){const ok=answer===q.poprawna,fb=$('#feedback');fb.className=`feedback ${ok?'ok':'bad'}`;fb.textContent=ok?'✓ Poprawna odpowiedź':`✕ Poprawna odpowiedź: ${q.poprawna}. ${q[q.poprawna.toLowerCase()]}`}
async function answer(q,answer){state.answered.set(q.nr,answer);showQuestion();try{const result=await api('/api/answer',{method:'POST',body:JSON.stringify({questionNr:q.nr,answer})});const p=record(q.nr);p.correct_count=(p.correct_count||0)+(result.correct?1:0);p.wrong_count=(p.wrong_count||0)+(result.correct?0:1);p.last_answer=answer;state.progress.set(q.nr,p);renderStats();showQuestion()}catch(error){toast(error.message)}}
$('#prevQuestion').addEventListener('click',()=>{if(state.index>0){state.index--;showQuestion()}});$('#nextQuestion').addEventListener('click',()=>{if(state.index<state.active.length-1){state.index++;showQuestion()}else{$('#questionCard').classList.add('hidden');$('#emptyQuiz').classList.remove('hidden');$('#emptyQuiz h2').textContent=`Sesja zakończona · ${state.answered.size} odpowiedzi`;$('#emptyQuiz p').textContent='Wyniki zostały zapisane w bazie D1.'}});

function updateMasterButton(q){const on=isMastered(q),button=$('#masterCurrent');button.classList.toggle('on',on);button.textContent=on?'✓ Opanowane':'Oznacz jako opanowane';button.onclick=()=>setMastered(q,!on)}
function explanationPrompt(q){return `Proszę wyjaśnij poniższe pytanie egzaminacyjne SRC prostym i precyzyjnym językiem.\n\nPytanie nr ${q.nr} (${q.dzial}):\n${q.pytanie}\n\nA. ${q.a}\nB. ${q.b}\nC. ${q.c}\n\nWedług klucza poprawna odpowiedź to: ${q.poprawna}. ${q[q.poprawna.toLowerCase()]}\n\nWyjaśnij:\n1. dlaczego ta odpowiedź jest prawidłowa,\n2. dlaczego pozostałe odpowiedzi są błędne,\n3. jaką zasadę lub skojarzenie warto zapamiętać na egzamin.\n\nJeśli podejrzewasz, że wskazany klucz jest błędny lub nieaktualny, zaznacz to wyraźnie.`}
async function copyCurrentQuestion(){
  const q=state.active[state.index];if(!q)return;
  const text=explanationPrompt(q);
  try{
    await navigator.clipboard.writeText(text);
  }catch{
    const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
  }
  toast(`Skopiowano pytanie nr ${q.nr} z odpowiedziami`);
}
$('#copyQuestion').addEventListener('click',copyCurrentQuestion);
async function setMastered(q,mastered){const previous=isMastered(q),p=record(q.nr);p.mastered=mastered?1:0;p.initial=false;state.progress.set(q.nr,p);renderStats();renderTable();if(state.active[state.index]?.nr===q.nr)updateMasterButton(q);try{await api('/api/progress',{method:'POST',body:JSON.stringify({questionNr:q.nr,mastered})});toast(mastered?'Oznaczono jako opanowane':'Przeniesiono do nauki')}catch(error){p.mastered=previous?1:0;renderStats();renderTable();toast(`Nie zapisano: ${error.message}`)}}

function aggregateQuestions(questions){
  const scores=questions.map(scoreFor),attempts=scores.reduce((sum,s)=>sum+s.attempts,0),correct=scores.reduce((sum,s)=>sum+s.correct,0),wrong=attempts-correct;
  return{questions:questions.length,attempted:scores.filter(s=>s.attempts>0).length,attempts,correct,wrong,accuracy:attempts?Math.round(correct/attempts*100):null,mastered:questions.filter(isMastered).length,consolidated:scores.filter(s=>s.attempts>=3&&s.percent>=70).length};
}
function renderStatistics(){
  if(!state.questions.length)return;
  const sections=[...new Set(state.questions.map(q=>q.dzial))];
  $('#sectionStats').innerHTML=sections.map(section=>{const data=aggregateQuestions(state.questions.filter(q=>q.dzial===section));return `<article class="section-stat panel"><div><span class="badge">${escapeHtml(section)}</span><strong>${data.accuracy===null?'—':data.accuracy+'%'}</strong><small>skuteczność</small></div><dl><div><dt>Pytania</dt><dd>${data.questions}</dd></div><div><dt>Odpytane</dt><dd>${data.attempted}/${data.questions}</dd></div><div><dt>Wszystkie próby</dt><dd>${data.attempts}</dd></div><div><dt>Poprawne</dt><dd>${data.correct}</dd></div><div><dt>Opanowane ręcznie</dt><dd>${data.mastered}</dd></div><div><dt>Utrwalone wynikiem</dt><dd>${data.consolidated}</dd></div></dl></article>`}).join('');

  const term=$('#statsSearch').value.trim().toLocaleLowerCase('pl'),section=$('#statsSection').value,sort=$('#statsSort').value;
  let rows=state.questions.filter(q=>(section==='all'||q.dzial===section)&&(!term||String(q.nr)===term||q.pytanie.toLocaleLowerCase('pl').includes(term)));
  const percentValue=q=>scoreFor(q).percent??101;
  if(sort==='weakest')rows.sort((a,b)=>percentValue(a)-percentValue(b)||scoreFor(a).attempts-scoreFor(b).attempts||a.nr-b.nr);
  if(sort==='fewest')rows.sort((a,b)=>scoreFor(a).attempts-scoreFor(b).attempts||percentValue(a)-percentValue(b)||a.nr-b.nr);
  if(sort==='most')rows.sort((a,b)=>scoreFor(b).attempts-scoreFor(a).attempts||a.nr-b.nr);
  if(sort==='number')rows.sort((a,b)=>a.nr-b.nr);
  $('#statsCount').textContent=`${rows.length} pytań`;
  $('#statsQuestionRows').innerHTML=rows.map(q=>{const score=scoreFor(q),consolidated=score.attempts>=3&&score.percent>=70;return `<tr><td>${q.nr}</td><td>${escapeHtml(q.dzial)}</td><td>${escapeHtml(q.pytanie)}</td><td>${score.attempts}</td><td class="score-pass">${score.correct}</td><td class="${score.wrong?'score-fail':''}">${score.wrong}</td><td><b class="${score.percent===null?'':score.percent>=70?'score-pass':'score-fail'}">${score.percent===null?'—':score.percent+'%'}</b></td><td><span class="stats-status ${consolidated?'good':''}">${consolidated?'Utrwalone':isMastered(q)?'Opanowane ręcznie':'Do nauki'}</span></td></tr>`}).join('');
}

function renderTable(){
  const term=$('#tableSearch').value.trim().toLocaleLowerCase('pl'),section=$('#tableSection').value,status=$('#tableStatus').value;
  const rows=state.questions.filter(q=>(section==='all'||q.dzial===section)&&(status==='all'||(status==='mastered'&&isMastered(q))||(status==='learning'&&!isMastered(q)))&&(!term||String(q.nr)===term||q.pytanie.toLocaleLowerCase('pl').includes(term)));
  $('#tableCount').textContent=`${rows.length} z ${state.questions.length}`;$('#questionRows').innerHTML=rows.map(q=>{const p=record(q.nr),on=isMastered(q),score=scoreFor(q);return `<tr><td>${q.nr}</td><td>${escapeHtml(q.dzial)}</td><td>${escapeHtml(q.pytanie)}</td><td class="answer-cell"><b>${q.poprawna}.</b> ${escapeHtml(q[q.poprawna.toLowerCase()])}</td><td class="mini-stats"><b class="${score.percent===null?'':score.percent>=70?'score-pass':'score-fail'}">${score.percent===null?'—':score.percent+'%'}</b><br>${score.correct}/${score.attempts} poprawnych<br><span>✓ ${score.correct} &nbsp; ✕ ${score.wrong}</span></td><td><button class="status-toggle ${on?'on':''}" data-nr="${q.nr}">${on?'✓ Opanowane':'Do nauki'}</button></td></tr>`}).join('');
  $$('.status-toggle').forEach(button=>button.addEventListener('click',()=>{const q=state.questions.find(x=>x.nr===Number(button.dataset.nr));setMastered(q,!isMastered(q))}));
}
['#tableSearch','#tableSection','#tableStatus'].forEach(id=>$(id).addEventListener(id==='#tableSearch'?'input':'change',renderTable));
['#statsSearch','#statsSection','#statsSort'].forEach(id=>$(id).addEventListener(id==='#statsSearch'?'input':'change',renderStatistics));
function escapeHtml(value){return String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
init();
