/* 存储键统一放函数外面，加载器和页面逻辑都要用 */
var BANK_STORE = 'mayuan.bank.v1';        // 旧版单题库（迁移后会删除）
var SUBJECT_STORE = 'mayuan.subjects.v1'; // 用户自建的学科列表
var ACTIVE_STORE = 'mayuan.active.v1';    // 当前选中的学科 id
var STORE = 'mayuan.review.v1';           // 各学科的做题进度

function bootQuiz(subjects, activeId){
  "use strict";

  var ICON = {
    check:'<path d="M20 6 9 17l-5-5"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    okCircle:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    badCircle:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    star:'<path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>',
    trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
  };
  function ic(name,cls){
    return '<svg class="ic '+(cls||'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICON[name]+'</svg>';
  }

  var SUBJECTS = subjects || [];
  function findSubject(id){
    for(var i=0;i<SUBJECTS.length;i++) if(SUBJECTS[i].id === id) return SUBJECTS[i];
    return null;
  }

  if(!SUBJECTS.length){
    document.getElementById('qcard').innerHTML =
      '<div class="ws-none">'+ic('info')+'<b>题库未加载</b><span>请确认 data/question-bank.js 或 data/demo-bank.js 存在且格式正确。</span></div>';
    return;
  }

  var currentSubject = findSubject(activeId) || SUBJECTS[0];
  var BANK = currentSubject;

  var CHAPTERS = [], ALL = [], BY_ID = {}, TOTAL = 0;

  function rebuildIndexes(){
    CHAPTERS = BANK.chapters || [];
    ALL = [];
    BY_ID = {};
    CHAPTERS.forEach(function(ch){
      ch.questions = ch.questions || [];
      ch.questions.forEach(function(q){
        q.chapterKey = ch.key; q.chapterName = ch.name; q.chapterTitle = ch.subtitle;
        ALL.push(q); BY_ID[q.id] = q;
      });
    });
    TOTAL = ALL.length;
  }
  rebuildIndexes();

  var TYPE_LABEL = {single:'单选题', multi:'多选题', judge:'判断题'};
  var LETTERS = ['A','B','C','D','E','F','G','H'];

  /* ---------------- state ---------------- */
  function newExamState(){
    return {active:false, submitted:false, ids:[], picks:{}, flagged:{}, elapsed:0,
            scope:'all', quotas:{single:0, multi:0, judge:0}, short:{}, filter:'all'};
  }
  function makeState(){
    var s = {
      mode:'home', practiceMode:'quiz', chapter:'intro', query:'', sheetOpen:true,
      answers:{}, results:{}, bookmarks:{}, wrongs:{}, pos:{},
      examCfg:{scope:'all', quotas:{single:35, multi:15, judge:5}},
      exam:null
    };
    s.exam = newExamState();
    return s;
  }
  function readProgressStore(){
    try{
      var raw = JSON.parse(localStorage.getItem(STORE) || 'null');
      if(raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    }catch(e){}
    return {};
  }
  var progressStore = readProgressStore();
  var state = makeState();
  function hydrateState(){
    var saved = progressStore[currentSubject.id];
    if(saved && typeof saved === 'object'){
      state.answers   = saved.answers   || {};
      state.results   = saved.results   || {};
      state.bookmarks = saved.bookmarks || {};
      state.wrongs    = saved.wrongs    || {};
      if(!saved.wrongs){
        for(var wid in state.results) if(state.results[wid] === 'wrong') state.wrongs[wid] = true;
      }
      state.pos       = saved.pos       || {};
      if(saved.examCfg && saved.examCfg.quotas) state.examCfg = saved.examCfg;
      if(saved.exam && saved.exam.active){
        state.exam = saved.exam;
        state.exam.filter = state.exam.filter || 'all';
      }
      var MODES = ['home','quiz','study','wrong','bookmark','exam','bank'];
      if(saved.mode && MODES.indexOf(saved.mode) >= 0) state.mode = saved.mode;
      if(saved.mode === 'quiz' || saved.mode === 'study') state.practiceMode = saved.mode;
      if(state.mode === 'exam' && !state.exam.active) state.mode = 'home';
      if(BY_ID[saved.chapter] || CHAPTERS.some(function(c){return c.key===saved.chapter;})) state.chapter = saved.chapter;
      if(typeof saved.sheetOpen === 'boolean') state.sheetOpen = saved.sheetOpen;
    }
    if(!chapterOf(state.chapter)) state.chapter = CHAPTERS[0] ? CHAPTERS[0].key : '';
  }
  hydrateState();

  function save(){
    try{
      progressStore[currentSubject.id] = {
        answers:state.answers, results:state.results, bookmarks:state.bookmarks, wrongs:state.wrongs,
        pos:state.pos, mode:state.mode, practiceMode:state.practiceMode, chapter:state.chapter, sheetOpen:state.sheetOpen,
        examCfg:state.examCfg, exam:state.exam
      };
      localStorage.setItem(STORE, JSON.stringify(progressStore));
    }catch(e){}
  }

  /* ---------------- helpers ---------------- */
  function el(id){ return document.getElementById(id); }
  function setText(id, v){ var n = el(id); if(n) n.textContent = v; }
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function sameSet(a,b){
    if(a.length !== b.length) return false;
    for(var i=0;i<a.length;i++) if(b.indexOf(a[i]) < 0) return false;
    return true;
  }
  function chapterOf(key){ for(var i=0;i<CHAPTERS.length;i++) if(CHAPTERS[i].key===key) return CHAPTERS[i]; return null; }
  function scopeKey(){
    if(state.mode === 'wrong') return 'wrong';
    if(state.mode === 'bookmark') return 'bookmark';
    if(state.mode === 'exam') return 'exam';
    return state.chapter;
  }
  function matchQuery(q){
    if(!state.query) return true;
    var t = state.query.toLowerCase();
    if(q.stem.toLowerCase().indexOf(t) >= 0) return true;
    for(var i=0;i<q.options.length;i++) if(q.options[i].toLowerCase().indexOf(t) >= 0) return true;
    return false;
  }
  function list(){
    var out;
    if(state.mode === 'wrong'){
      out = ALL.filter(function(q){ return !!state.wrongs[q.id]; });
    }else if(state.mode === 'bookmark'){
      out = ALL.filter(function(q){ return !!state.bookmarks[q.id]; });
    }else{
      var ch = chapterOf(state.chapter);
      out = ch ? ch.questions.slice() : [];
    }
    if(state.query) out = out.filter(matchQuery);
    return out;
  }
  function choiceLabel(q, arr){
    if(!arr.length) return '未选';
    if(q.type === 'judge') return arr.indexOf('A') >= 0 ? '正确' : '错误';
    return arr.join('');
  }
  function correctText(q){
    if(q.type === 'judge') return q.answer.indexOf('A') >= 0 ? '正确' : '错误';
    return q.answer.map(function(L,i){
      var idx = L.charCodeAt(0) - 65;
      var txt = q.options[idx] == null ? '' : q.options[idx];
      return (i ? '；' : '') + L + '. ' + txt;
    }).join('');
  }
  function answerDetail(q){
    if(q.type === 'judge') return '<b>' + (q.answer.indexOf('A') >= 0 ? '正确' : '错误') + '</b>';
    return '<b>' + q.answer.join('') + '</b>　' + esc(correctText(q));
  }

  /* ---------------- mock exam: paper building ---------------- */
  var EXAM_ORDER = ['single', 'multi', 'judge'];

  function examPool(scope){
    if(scope === 'all') return ALL.slice();
    var ch = chapterOf(scope);
    return ch ? ch.questions.slice() : [];
  }
  function scopeName(scope){
    if(scope === 'all') return '全部章节';
    var ch = chapterOf(scope);
    return ch ? ch.name : '全部章节';
  }
  function poolCounts(scope){
    var c = {single:0, multi:0, judge:0};
    examPool(scope).forEach(function(q){ if(c[q.type] != null) c[q.type]++; });
    return c;
  }
  function shuffle(a){
    for(var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function quotaOf(q, t){ return Math.max(0, parseInt(q[t], 10) || 0); }
  function quotaTotal(q){ return EXAM_ORDER.reduce(function(s,t){ return s + quotaOf(q,t); }, 0); }
  function buildPaper(scope, quotas){
    var groups = {single:[], multi:[], judge:[]};
    examPool(scope).forEach(function(q){ if(groups[q.type]) groups[q.type].push(q); });
    var ids = [], short = {};
    EXAM_ORDER.forEach(function(t){
      var want = quotaOf(quotas, t), avail = groups[t].length, take = Math.min(want, avail);
      if(take < want) short[t] = {want:want, avail:avail};
      shuffle(groups[t]).slice(0, take).forEach(function(q){ ids.push(q.id); });
    });
    return {ids:ids, short:short};
  }
  function examQuestions(){
    if(!state.exam || !state.exam.active) return [];
    var qs = state.exam.ids.map(function(id){ return BY_ID[id]; }).filter(Boolean);
    if(state.exam.submitted && state.exam.filter === 'wrong') qs = qs.filter(examWrong);
    return qs;
  }
  function examWrong(q){
    return !sameSet(state.exam.picks[q.id] || [], q.answer);
  }
  function examAnswered(q){ return (state.exam.picks[q.id] || []).length > 0; }
  function currentList(){ return state.mode === 'exam' ? examQuestions() : list(); }
  function examScore(){
    var total = 0, ok = 0, blank = 0;
    var byType = {single:{ok:0,n:0}, multi:{ok:0,n:0}, judge:{ok:0,n:0}};
    state.exam.ids.forEach(function(id){
      var q = BY_ID[id]; if(!q) return;
      total++; byType[q.type].n++;
      if(!examAnswered(q)) blank++;
      if(!examWrong(q)){ ok++; byType[q.type].ok++; }
    });
    return {total:total, ok:ok, blank:blank, byType:byType};
  }
  function fmtTime(sec){
    sec = Math.max(0, sec | 0);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var pad = function(n){ return (n < 10 ? '0' : '') + n; };
    return (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
  }

  var toastTimer = null;
  function toast(msg, kind){
    var t = el('toast');
    t.className = 'toast show' + (kind === 'warn' ? ' warn' : '');
    t.innerHTML = ic(kind === 'warn' ? 'badCircle' : 'okCircle') + '<span>' + esc(msg) + '</span>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.className = 'toast'; }, 2200);
  }

  /* ---------------- header + sidebar ---------------- */
  function totals(){
    var done = 0, ok = 0;
    ALL.forEach(function(q){
      var r = state.results[q.id];
      if(r){ done++; if(r === 'correct') ok++; }
    });
    return {done:done, ok:ok, bad:Object.keys(state.wrongs).length, total:TOTAL};
  }
  function renderStats(){
    var t = totals();
    el('s-total').textContent = t.total;
    el('s-done').textContent = t.done;
    el('s-acc').textContent = t.done ? Math.round(t.ok / t.done * 100) + '%' : '0%';
    el('s-wrong').textContent = t.bad;
    var pct = t.total ? Math.round(t.done / t.total * 100) : 0;
    setText('h-total', t.total);
    setText('h-done', t.done);
    setText('h-acc', t.done ? Math.round(t.ok / t.done * 100) + '%' : '0%');
    setText('h-wrong', t.bad);
    var ring = el('hero-ring');
    if(ring) ring.style.setProperty('--p', pct + '%');
    setText('h-progress', pct + '%');
    var wb = el('wrong-badge');
    wb.textContent = t.bad;
    wb.hidden = t.bad === 0;
    var bm = Object.keys(state.bookmarks).length;
    var bb = el('bookmark-badge');
    bb.textContent = bm;
    bb.hidden = bm === 0;
  }
  function renderChapters(){
    var host = el('chapter-list');
    host.innerHTML = '';
    CHAPTERS.forEach(function(ch){
      var done = 0, ok = 0;
      ch.questions.forEach(function(q){
        var r = state.results[q.id];
        if(r){ done++; if(r === 'correct') ok++; }
      });
      var pct = ch.questions.length ? done / ch.questions.length * 100 : 0;
      var active = (state.mode === 'quiz' || state.mode === 'study') && state.chapter === ch.key;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chap' + (active ? ' active' : '');
      b.innerHTML =
        '<span class="chap-top"><span class="chap-name">' + esc(ch.name) + '</span>' +
        '<span class="chap-count">' + done + '/' + ch.questions.length + '</span></span>' +
        (ch.subtitle ? '<span class="chap-sub">' + esc(ch.subtitle) + '</span>' : '') +
        '<span class="chap-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
        '<span class="chap-acc">' + (done ? '正确率 <b>' + Math.round(ok / done * 100) + '%</b>' : '尚未开始') + '</span>';
      b.addEventListener('click', function(){ selectChapter(ch.key); });
      host.appendChild(b);
    });
  }
  function renderModes(){
    var btns = el('mode-seg').querySelectorAll('button');
    for(var i=0;i<btns.length;i++){
      btns[i].setAttribute('aria-selected', btns[i].dataset.mode === state.mode ? 'true' : 'false');
    }
  }
  function renderNav(){
    var cur = (state.mode === 'quiz' || state.mode === 'study') ? 'practice' : state.mode;
    var btns = el('main-nav').querySelectorAll('button[data-nav]');
    for(var i=0;i<btns.length;i++){
      if(btns[i].dataset.nav === cur) btns[i].setAttribute('data-active','');
      else btns[i].removeAttribute('data-active');
    }
  }
  function renderHome(){
    var t = totals();
    var bm = Object.keys(state.bookmarks).length;
    setText('h-chapters', CHAPTERS.length + ' 章');
    setText('h-wrong-count', t.bad + ' 题');
    setText('h-bookmark-count', bm + ' 题');
    setText('h-bank-name', currentSubject.name || '示例题库');
    var meta = BANK.meta || {};
    setText('hero-kicker', '题库刷题系统');
    setText('hero-title', currentSubject.name || meta.title || '题库刷题系统');
    setText('hero-sub', meta.subtitle || '章节练习 + 模拟考试');
  }

  /* ---------------- question card ---------------- */
  function optionHTML(q, letter, idx, o){
    var cls = 'opt', mark = '';
    var isRight = q.answer.indexOf(letter) >= 0;
    if(o.reveal){
      cls += ' lock';
      if(isRight){ cls += ' ok'; mark = '<span class="mark">' + ic('check') + '正确答案</span>'; }
      else if(o.showPick && o.chosen){ cls += ' bad'; mark = '<span class="mark">' + ic('x') + '我的选择</span>'; }
    }else if(o.chosen){
      cls += ' sel' + (o.locked ? ' lock' : '');
    }
    var keyTxt = q.type === 'judge' ? (idx === 0 ? '✓' : '✗') : letter;
    return '<button type="button" class="' + cls + '" data-opt="' + letter + '">' +
      '<span class="key">' + keyTxt + '</span>' +
      '<span class="txt">' + esc(q.options[idx]) + '</span>' + mark + '</button>';
  }
  function optionsHTML(q, chosenArr, o){
    var out = '';
    for(var i=0;i<q.options.length;i++){
      var letter = LETTERS[i];
      out += optionHTML(q, letter, i, {
        chosen: chosenArr.indexOf(letter) >= 0,
        reveal: o.reveal, showPick: o.showPick, locked: o.locked
      });
    }
    return out;
  }

  function syncLayout(){
    var m = state.mode;
    el('view-home').hidden = m !== 'home';
    el('view-bank').hidden = m !== 'bank';
    el('view-practice').hidden = (m === 'home' || m === 'bank');
    if(m === 'home' || m === 'bank') return;
    var exam = m === 'exam';
    var listMode = (m === 'quiz' || m === 'study');
    el('tool-panel').hidden = !listMode;
    el('exam-panel').hidden = !exam;
    el('chapter-panel').hidden = exam || !listMode || !CHAPTERS.length;
    var sidebar = document.querySelector('.sidebar');
    if(sidebar) sidebar.hidden = !(listMode || exam);
    el('view-practice').classList.toggle('solo', !(listMode || exam));
  }

  function renderWorkspace(){
    syncLayout();
    renderNav();
    if(state.mode === 'home'){ renderHome(); return; }
    if(state.mode === 'bank'){ renderBankPanel(); return; }
    if(state.mode === 'exam') return renderExam();

    var qs = currentList();
    var key = scopeKey();
    var idx = state.pos[key] || 0;
    if(idx > qs.length - 1) idx = Math.max(0, qs.length - 1);
    state.pos[key] = idx;

    var card = el('qcard');
    var ch = chapterOf(state.chapter);

    if(!TOTAL){
      el('ws-tag').textContent = '空题库';
      el('ws-tag').className = 'tag grey';
      el('ws-title').textContent = '还没有题目';
      el('ws-count').innerHTML = '共 <b>0</b> 题';
      el('ws-timer').hidden = true;
      el('exam-summary').hidden = true;
      el('btn-exam-submit').hidden = true;
      el('sheet').hidden = true;
      el('btn-submit').hidden = true;
      el('btn-prev').disabled = true;
      el('btn-next').disabled = true;
      el('foot-hint').textContent = '';
      card.innerHTML = '<div class="ws-none">' + ic('file') + '<b>题库是空的</b>' +
        '<span>导入一个 Word 文档或文本文件就能开始。</span>' +
        '<button class="btn btn-primary" type="button" id="btn-import-empty">导入题库文件</button></div>';
      var emptyBtn = el('btn-import-empty');
      if(emptyBtn) emptyBtn.addEventListener('click', function(){ el('bank-file').click(); });
      return;
    }

    var isWrong = state.mode === 'wrong';
    var isBookmark = state.mode === 'bookmark';
    el('ws-tag').textContent = isWrong ? '错题本' : (isBookmark ? '收藏本' : (ch ? ch.name : ''));
    el('ws-tag').className = 'tag' + ((isWrong || isBookmark) ? ' grey' : '');
    el('ws-title').textContent = isWrong ? '错题巩固与重练' : (isBookmark ? '收藏题目集中刷' : (ch ? (ch.subtitle || ch.name) : ''));
    el('ws-count').innerHTML = qs.length ? '题目 <b>' + (idx + 1) + '</b> / ' + qs.length : '题目 <b>0</b>';
    el('ws-timer').hidden = true;
    el('exam-summary').hidden = true;
    el('btn-exam-submit').hidden = true;
    el('sheet').hidden = false;

    if(!qs.length){
      var emptyHtml;
      if(state.mode === 'wrong'){
        emptyHtml = '<b>错题本是空的</b><span>做错的题目会自动收进来，答对后自动移出。</span>';
      }else if(state.mode === 'bookmark'){
        emptyHtml = '<b>收藏本是空的</b><span>在题目卡片上点「收藏」，就会收进来。</span>';
      }else if(state.query){
        emptyHtml = '<b>没有匹配的题目</b><span>换个关键词试试。</span>';
      }else{
        emptyHtml = '<b>本章暂无题目</b><span>当前章节还没有录入题目。</span>';
      }
      var emptyIc = state.mode === 'wrong' ? 'okCircle' : (state.mode === 'bookmark' ? 'star' : 'search');
      card.innerHTML = '<div class="ws-none">' + ic(emptyIc) + emptyHtml + '</div>';
      el('btn-prev').disabled = true;
      el('btn-next').disabled = true;
      el('btn-submit').hidden = true;
      el('foot-hint').textContent = '';
      renderSheet(qs, idx);
      return;
    }

    var q = qs[idx];
    var submitted = !!state.results[q.id];
    var study = state.mode === 'study';
    var userAns = state.answers[q.id] || [];
    var isRight = sameSet(userAns, q.answer);

    var html = '<div class="qcard">';
    html += '<div class="qtop">' +
      '<span class="badge ' + q.type + '">' + TYPE_LABEL[q.type] + '</span>' +
      '<span class="q-meta">' + esc((state.mode === 'wrong' || state.mode === 'bookmark') ? q.chapterName : (ch ? ch.name : '')) +
      ' · 原卷第 ' + q.num + ' 题</span>' +
      '<button type="button" class="star' + (state.bookmarks[q.id] ? ' on' : '') + '" id="btn-star" title="收藏本题">' +
      ic('star') + (state.bookmarks[q.id] ? '已收藏' : '收藏') + '</button>' +
      (currentSubject.source === 'imported'
        ? '<button type="button" class="star danger" id="btn-del-q" title="删除这道题">' + ic('trash') + '删除</button>'
        : '') +
      '</div>';
    html += '<h2 class="stem">' + esc(q.stem) + '</h2>';
    html += '<div class="opts">' + optionsHTML(q, userAns, {
      reveal: study || submitted, showPick: submitted && !study, locked: submitted || study
    }) + '</div>';

    if(study){
      html += '<div class="fb info"><div class="fb-h">' + ic('info') + '参考答案</div>' +
        '<div class="ans">' + answerDetail(q) + '</div></div>';
    }else if(submitted){
      if(isRight){
        html += '<div class="fb ok"><div class="fb-h">' + ic('okCircle') + '回答正确</div>' +
          '<div class="ans">正确答案：' + answerDetail(q) + '</div>' +
          '<div class="fb-foot"><button type="button" class="btn btn-soft" id="btn-redo">重做本题</button></div></div>';
      }else{
        html += '<div class="fb bad"><div class="fb-h">' + ic('badCircle') + '回答错误</div>' +
          '<div class="ans">你的选择：<b>' + esc(choiceLabel(q, userAns)) + '</b><br>' +
          '正确答案：' + answerDetail(q) + '</div>' +
          '<div class="fb-foot"><button type="button" class="btn btn-soft" id="btn-redo">重做本题</button></div></div>';
      }
    }
    html += '</div>';
    card.innerHTML = html;

    var optBtns = card.querySelectorAll('.opt');
    for(var k=0;k<optBtns.length;k++){
      (function(btn){
        btn.addEventListener('click', function(){ pick(q, btn.dataset.opt); });
      })(optBtns[k]);
    }
    var star = el('btn-star');
    if(star) star.addEventListener('click', function(){ toggleBookmark(q); });
    var delQ = el('btn-del-q');
    if(delQ) delQ.addEventListener('click', function(){ deleteQuestion(q); });
    var redo = el('btn-redo');
    if(redo) redo.addEventListener('click', function(){ redoQuestion(q); });

    var canSubmit = !study && !submitted;
    var btnSubmit = el('btn-submit');
    btnSubmit.hidden = !canSubmit;
    btnSubmit.disabled = userAns.length === 0;

    el('btn-prev').disabled = idx === 0;
    el('btn-next').disabled = idx === qs.length - 1;
    el('foot-hint').textContent = study ? '背题模式：答案已直接显示' :
      (submitted ? '本题已完成' : (q.type === 'multi' ? '多选题：选出所有正确选项' : '选择答案后提交'));

    renderSheet(qs, idx);
  }

  /* ---------------- mock exam ---------------- */
  function updateTimers(){
    if(!state.exam || !state.exam.active) return;
    var txt = fmtTime(state.exam.elapsed);
    var a = el('ws-timer'), b = el('exam-panel-timer');
    if(a) a.innerHTML = '用时 <b>' + txt + '</b>';
    if(b) b.textContent = txt;
  }

  function shortNote(cfg, counts){
    var out = [];
    EXAM_ORDER.forEach(function(t){
      var want = quotaOf(cfg.quotas, t);
      if(want > counts[t]) out.push(TYPE_LABEL[t] + '只够 ' + counts[t] + ' 题');
    });
    return out.join('，');
  }

  function refreshExamSetup(){
    if(state.mode !== 'exam' || state.exam.active) return;
    var cfg = state.examCfg, cnt = poolCounts(cfg.scope);
    var avail = el('exam-avail');
    if(avail){
      var note = shortNote(cfg, cnt);
      avail.innerHTML = '可用题目：<b>单选 ' + cnt.single + '</b> · <b>多选 ' + cnt.multi + '</b> · <b>判断 ' + cnt.judge + '</b>' +
        (note ? '<br><span class="miss">' + note + '，不足部分按实际题量出</span>' : '');
    }
    var num = el('exam-total-num');
    if(num){
      var t = 0;
      EXAM_ORDER.forEach(function(k){ t += Math.min(quotaOf(cfg.quotas, k), cnt[k]); });
      num.textContent = t + ' 题';
    }
  }

  function renderExamPanel(){
    var host = el('exam-panel');
    if(state.mode !== 'exam'){ host.hidden = true; return; }
    host.hidden = false;

    if(!state.exam.active){
      var cfg = state.examCfg;
      var opts = ['all'].concat(CHAPTERS.map(function(c){ return c.key; })).map(function(k){
        return '<option value="' + k + '"' + (cfg.scope === k ? ' selected' : '') + '>' +
          esc(scopeName(k)) + '（' + examPool(k).length + ' 题）</option>';
      }).join('');
      host.innerHTML =
        '<h2 class="panel-h"><span>模拟考试</span>' +
        ic('file') + '</h2>' +
        '<div class="exam-box">' +
          '<div class="exam-line" style="display:block">' +
            '<label for="exam-scope" style="display:block;margin-bottom:5px">出题范围</label>' +
            '<select class="inp" id="exam-scope">' + opts + '</select>' +
          '</div>' +
          EXAM_ORDER.map(function(t){
            return '<div class="exam-line"><label for="qty-' + t + '">' + TYPE_LABEL[t] + '</label>' +
              '<span class="qty">' +
              '<button type="button" data-act="dec" data-type="' + t + '" aria-label="减少">−</button>' +
              '<input type="number" min="0" max="300" step="1" id="qty-' + t + '" data-qty="' + t + '" value="' + quotaOf(cfg.quotas, t) + '">' +
              '<button type="button" data-act="inc" data-type="' + t + '" aria-label="增加">+</button>' +
              '</span></div>';
          }).join('') +
          '<div class="exam-avail" id="exam-avail"></div>' +
          '<div class="exam-total"><span>本卷题量</span><b id="exam-total-num"></b></div>' +
          '<div class="exam-actions"><button class="btn btn-primary" type="button" data-act="start">开始模拟考试</button></div>' +
        '</div>';
      refreshExamSetup();
      return;
    }

    var s = examScore();
    var answered = s.total - s.blank;
    var pct = s.total ? Math.round(answered / s.total * 100) : 0;
    var rate = s.total ? Math.round(s.ok / s.total * 100) : 0;
    host.innerHTML =
      '<h2 class="panel-h"><span>' + (state.exam.submitted ? '本卷概况' : '考试进行中') + '</span></h2>' +
      '<div class="exam-box">' +
        '<div class="overall-row"><span>出题范围</span><b style="font-size:14px">' + esc(scopeName(state.exam.scope)) + '</b></div>' +
        (state.exam.submitted ? '<div class="overall-row"><span>得分</span><b>' + rate + ' 分</b></div>' : '') +
        '<div class="overall-row"><span>已作答</span><b>' + answered + ' / ' + s.total + '</b></div>' +
        '<div class="overall-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="mini">' +
          '<div><span>未作答</span><b>' + s.blank + '</b></div>' +
          '<div><span>用时</span><b id="exam-panel-timer">' + fmtTime(state.exam.elapsed) + '</b></div>' +
        '</div>' +
        '<div class="exam-actions">' +
          (state.exam.submitted
            ? '<button class="btn btn-primary" type="button" data-act="again">再考一次</button>' +
              '<button class="btn btn-soft" type="button" data-act="exit">结束模拟考试</button>'
            : '<button class="btn btn-primary" type="button" data-act="submit">交卷并查看成绩</button>' +
              '<button class="btn btn-soft" type="button" data-act="exit">放弃本次考试</button>') +
        '</div>' +
      '</div>';
  }

  function summaryHTML(){
    var s = examScore();
    var rate = s.total ? Math.round(s.ok / s.total * 100) : 0;
    var cells = EXAM_ORDER.map(function(t){
      var b = s.byType[t];
      return '<div class="stat-cell"><span>' + TYPE_LABEL[t] + '</span><b>' + b.ok + ' / ' + b.n + '</b></div>';
    }).join('');
    var shortText = EXAM_ORDER.filter(function(t){ return state.exam.short && state.exam.short[t]; })
      .map(function(t){
        return TYPE_LABEL[t] + '不足 ' + state.exam.short[t].want + ' 题，已全部出题（' + state.exam.short[t].avail + ' 题）';
      }).join('；');
    return '<div class="summary">' +
      '<div class="summary-h"><span class="score">' + rate + '</span><span class="unit">分</span>' +
      '<span class="summary-sub">正确 ' + s.ok + ' / ' + s.total + ' · 未作答 ' + s.blank + ' · 用时 ' + fmtTime(state.exam.elapsed) + '</span></div>' +
      (shortText ? '<div class="summary-sub" style="margin:8px 0 0">' + esc(shortText) + '</div>' : '') +
      '<div class="summary-grid">' + cells + '</div>' +
      '<div class="summary-actions">' +
        '<button class="btn btn-soft" type="button" data-act="filter">' + (state.exam.filter === 'wrong' ? '查看全部' : '只看错题') + '</button>' +
        '<button class="btn btn-soft" type="button" data-act="again">再考一次</button>' +
        '<button class="btn btn-primary" type="button" data-act="exit">结束模拟考试</button>' +
      '</div></div>';
  }

  function renderExam(){
    var card = el('qcard');

    if(!state.exam.active){
      el('ws-tag').textContent = '模拟考试';
      el('ws-tag').className = 'tag';
      el('ws-title').textContent = '按题型组卷，交卷后统一判分';
      el('ws-count').innerHTML = '本卷 <b>0</b> 题';
      el('ws-timer').hidden = true;
      el('exam-summary').hidden = true;
      el('sheet').hidden = true;
      card.innerHTML = '<div class="ws-none">' + ic('info') +
        '<b>先在左侧设置出题范围与各题型数量</b>' +
        '<span>支持全部章节或单章组卷；某题型题目不足时，按实际题量出题。</span></div>';
      el('btn-prev').disabled = true;
      el('btn-next').disabled = true;
      el('btn-submit').hidden = true;
      el('btn-exam-submit').hidden = true;
      el('foot-hint').textContent = '';
      return;
    }

    if(!TOTAL){
      el('ws-tag').textContent = '模拟考试';
      el('ws-tag').className = 'tag';
      el('ws-title').textContent = '还没有题目';
      el('ws-count').innerHTML = '共 <b>0</b> 题';
      el('ws-timer').hidden = true;
      el('exam-summary').hidden = true;
      el('sheet').hidden = true;
      el('btn-submit').hidden = true;
      el('btn-exam-submit').hidden = true;
      el('btn-prev').disabled = true;
      el('btn-next').disabled = true;
      el('foot-hint').textContent = '';
      card.innerHTML = '<div class="ws-none">' + ic('file') + '<b>题库是空的</b>' +
        '<span>先在左侧「题库」里导入题目，再来组卷。</span></div>';
      return;
    }

    var sub = state.exam.submitted;
    var qs = examQuestions();
    var idx = state.pos.exam || 0;
    if(idx > qs.length - 1) idx = Math.max(0, qs.length - 1);
    state.pos.exam = idx;

    el('ws-tag').textContent = '模拟考试';
    el('ws-tag').className = 'tag' + (sub ? ' grey' : '');
    el('ws-title').textContent = scopeName(state.exam.scope) + (sub ? ' · 试卷解析' : ' · 模拟卷');
    el('ws-count').innerHTML = '第 <b>' + (qs.length ? idx + 1 : 0) + '</b> / ' + qs.length + ' 题';
    el('ws-timer').hidden = sub;
    if(!sub) updateTimers();

    var sum = el('exam-summary');
    sum.hidden = !sub;
    sum.innerHTML = sub ? summaryHTML() : '';

    if(!qs.length){
      card.innerHTML = '<div class="ws-none">' + ic('okCircle') + '<b>本卷没有错题</b><span>全部答对，可以结束这次模拟考试了。</span></div>';
      el('btn-prev').disabled = true;
      el('btn-next').disabled = true;
      el('btn-submit').hidden = true;
      el('btn-exam-submit').hidden = true;
      el('foot-hint').textContent = '';
      renderSheet(qs, idx);
      return;
    }

    var q = qs[idx];
    var picks = state.exam.picks[q.id] || [];
    var html = '<div class="qcard">';
    html += '<div class="qtop">' +
      '<span class="badge ' + q.type + '">' + TYPE_LABEL[q.type] + '</span>' +
      '<span class="q-meta">' + esc(q.chapterName) + ' · 原卷第 ' + q.num + ' 题</span>' +
      '<button type="button" class="star' + (state.exam.flagged[q.id] ? ' on' : '') + '" id="btn-flag" title="标记本题">' +
      ic('star') + (state.exam.flagged[q.id] ? '已标记' : '标记') + '</button>' +
      '</div>';
    html += '<h2 class="stem">' + esc(q.stem) + '</h2>';
    html += '<div class="opts">' + optionsHTML(q, picks, {reveal:sub, showPick:sub, locked:sub}) + '</div>';
    if(sub){
      if(examWrong(q)){
        html += '<div class="fb bad"><div class="fb-h">' + ic('badCircle') + '本题答错</div>' +
          '<div class="ans">你的选择：<b>' + esc(picks.length ? choiceLabel(q, picks) : '未作答') + '</b><br>' +
          '正确答案：' + answerDetail(q) + '</div></div>';
      }else{
        html += '<div class="fb ok"><div class="fb-h">' + ic('okCircle') + '本题答对</div>' +
          '<div class="ans">正确答案：' + answerDetail(q) + '</div></div>';
      }
    }
    html += '</div>';
    card.innerHTML = html;

    var optBtns = card.querySelectorAll('.opt');
    for(var k=0;k<optBtns.length;k++){
      (function(btn){
        btn.addEventListener('click', function(){ pick(q, btn.dataset.opt); });
      })(optBtns[k]);
    }
    var flag = el('btn-flag');
    if(flag) flag.addEventListener('click', function(){ toggleFlag(q); });

    el('btn-prev').disabled = idx === 0;
    el('btn-next').disabled = idx === qs.length - 1;
    el('btn-submit').hidden = true;
    el('btn-exam-submit').hidden = sub;
    el('foot-hint').textContent = sub ? (state.exam.filter === 'wrong' ? '只看错题' : '试卷解析')
      : (q.type === 'multi' ? '多选题：选出所有正确选项' : '交卷后统一判分');

    renderSheet(qs, idx);
  }

  function renderSheet(qs, idx){
    var grid = el('sheet-grid');
    grid.innerHTML = '';
    var sheet = el('sheet');
    sheet.dataset.open = state.sheetOpen ? 'true' : 'false';
    sheet.hidden = false;
    var exam = state.mode === 'exam';
    var sub = exam && state.exam.submitted;

    el('sheet-legend').innerHTML = exam
      ? (sub ? '<span class="l-ok"><i></i>答对</span><span class="l-bad"><i></i>答错</span>'
             : '<span class="l-ans"><i></i>已作答</span>') + '<span class="l-new"><i></i>未作答</span>'
      : '<span class="l-ok"><i></i>已答对</span><span class="l-bad"><i></i>已答错</span><span class="l-new"><i></i>未作答</span>';

    for(var i=0;i<qs.length;i++){
      (function(i){
        var q = qs[i];
        var cls = 'cell', flagged = false, tip;
        if(exam){
          if(sub){ cls += examWrong(q) ? ' wrong' : ' done'; tip = examWrong(q) ? '答错' : '答对'; }
          else { if(examAnswered(q)) cls += ' ans'; tip = examAnswered(q) ? '已作答' : '未作答'; }
          flagged = !!state.exam.flagged[q.id];
        }else{
          var r = state.results[q.id];
          if(r === 'correct') cls += ' done';
          else if(r === 'wrong') cls += ' wrong';
          tip = r === 'correct' ? '已答对' : (r === 'wrong' ? '已答错' : '未作答');
          flagged = !!state.bookmarks[q.id];
        }
        if(i === idx) cls += ' cur';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = q.num;
        b.title = q.chapterName + ' 第 ' + q.num + ' 题 · ' + tip + (flagged ? ' · 已标记' : '');
        if(flagged){
          var d = document.createElement('span');
          d.className = 'dot';
          b.appendChild(d);
        }
        b.addEventListener('click', function(){ go(i); });
        grid.appendChild(b);
      })(i);
    }
  }

  /* ---------------- actions ---------------- */
  function pick(q, letter){
    if(state.mode === 'study') return;
    var exam = state.mode === 'exam';
    if(exam && state.exam.submitted) return;
    if(!exam && state.results[q.id]) return;
    var map = exam ? state.exam.picks : state.answers;
    var cur = (map[q.id] || []).slice();
    if(q.type === 'multi'){
      var at = cur.indexOf(letter);
      if(at >= 0) cur.splice(at, 1); else cur.push(letter);
      cur.sort();
    }else{
      cur = [letter];
    }
    map[q.id] = cur;
    save();
    if(exam) renderExamPanel();
    renderWorkspace();
  }

  function submit(){
    if(state.mode === 'exam') return;
    var qs = currentList();
    var q = qs[state.pos[scopeKey()] || 0];
    if(!q || state.results[q.id]) return;
    var ans = state.answers[q.id] || [];
    if(!ans.length){ toast('请先选择答案', 'warn'); return; }
    var right = sameSet(ans, q.answer);
    state.results[q.id] = right ? 'correct' : 'wrong';
    if(right) delete state.wrongs[q.id];
    else state.wrongs[q.id] = true;
    save();
    renderStats(); renderChapters(); renderWorkspace();
    toast(right ? '回答正确' : '回答错误，已加入错题本', right ? 'ok' : 'warn');
  }

  function redoQuestion(q){
    delete state.answers[q.id];
    delete state.results[q.id];
    save();
    renderStats(); renderChapters(); renderWorkspace();
    toast('已重置本题，可以重新作答');
  }

  function toggleBookmark(q){
    if(state.bookmarks[q.id]) delete state.bookmarks[q.id];
    else state.bookmarks[q.id] = true;
    save();
    renderStats();
    renderWorkspace();
  }

  function toggleFlag(q){
    if(state.exam.flagged[q.id]) delete state.exam.flagged[q.id];
    else state.exam.flagged[q.id] = true;
    save();
    renderWorkspace();
  }

  function go(i){
    var qs = currentList();
    if(!qs.length) return;
    i = Math.max(0, Math.min(qs.length - 1, i));
    state.pos[scopeKey()] = i;
    save();
    renderWorkspace();
    var card = el('qcard');
    if(card && card.getBoundingClientRect().top < 0){
      window.scrollTo({top: card.offsetTop - 90, behavior:'smooth'});
    }
  }
  function step(d){ go((state.pos[scopeKey()] || 0) + d); }

  function selectChapter(key){
    if(state.mode === 'exam' && state.exam.active){
      toast('模拟考试进行中，请先交卷或结束考试', 'warn');
      return;
    }
    state.chapter = key;
    if(state.mode === 'wrong') state.mode = 'quiz';
    state.query = ''; el('search').value = ''; el('searchbox').classList.remove('has-value');
    save(); renderModes(); renderChapters(); renderWorkspace();
    if(window.innerWidth < 1024){
      var ws = document.querySelector('.workspace');
      if(ws) window.scrollTo({top: ws.offsetTop - 84, behavior:'smooth'});
    }
  }
  function setMode(mode){
    if(state.mode === mode) return;
    if(state.mode === 'exam' && state.exam.active && !state.exam.submitted){
      if(!window.confirm('模拟考试尚未交卷，离开后本次作答将作废，确定离开？')) return;
      state.exam = newExamState();
    }
    state.mode = mode;
    if(mode === 'quiz' || mode === 'study') state.practiceMode = mode;
    state.query = ''; el('search').value = ''; el('searchbox').classList.remove('has-value');
    if(mode === 'wrong') state.pos.wrong = 0;
    if(mode === 'bookmark') state.pos.bookmark = 0;
    save(); renderModes(); renderExamPanel(); renderChapters(); renderWorkspace();
  }

  /* ---------------- mock exam actions ---------------- */
  function startExam(){
    var paper = buildPaper(state.examCfg.scope, state.examCfg.quotas);
    if(!paper.ids.length){ toast('该范围内没有可用题目', 'warn'); return; }
    state.exam = newExamState();
    state.exam.active = true;
    state.exam.scope = state.examCfg.scope;
    state.exam.quotas = {
      single: quotaOf(state.examCfg.quotas, 'single'),
      multi: quotaOf(state.examCfg.quotas, 'multi'),
      judge: quotaOf(state.examCfg.quotas, 'judge')
    };
    state.exam.ids = paper.ids;
    state.exam.short = paper.short;
    state.pos.exam = 0;
    save();
    renderModes(); renderExamPanel(); renderWorkspace();
    toast('模拟考试开始，共 ' + paper.ids.length + ' 题');
  }

  function submitExam(){
    if(!state.exam.active || state.exam.submitted) return;
    var s = examScore();
    if(!window.confirm(s.blank ? ('还有 ' + s.blank + ' 题未作答，确定交卷？') : '确定交卷？')) return;
    state.exam.submitted = true;
    state.exam.filter = 'all';
    state.exam.ids.forEach(function(id){
      var q = BY_ID[id];
      if(!q) return;
      if(examWrong(q)) state.wrongs[id] = true;
      else delete state.wrongs[id];
    });
    state.pos.exam = 0;
    save();
    renderStats(); renderChapters(); renderExamPanel(); renderWorkspace();
    toast('已交卷，得分 ' + (s.total ? Math.round(s.ok / s.total * 100) : 0) + ' 分');
  }

  function exitExam(){
    if(state.exam.active && !state.exam.submitted && !window.confirm('放弃本次考试？已作答内容将清空。')) return;
    state.exam = newExamState();
    state.mode = 'quiz';
    save();
    renderModes(); renderExamPanel(); renderChapters(); renderWorkspace();
  }

  /* ---------------- events ---------------- */
  el('mode-seg').addEventListener('click', function(e){
    var b = e.target.closest('button[data-mode]');
    if(b) setMode(b.dataset.mode);
  });
  document.addEventListener('click', function(e){
    var n = e.target.closest('[data-nav]');
    if(!n) return;
    var nav = n.dataset.nav;
    if(nav === 'home') setMode('home');
    else if(nav === 'practice') setMode(state.practiceMode || 'quiz');
    else if(nav === 'wrong') setMode('wrong');
    else if(nav === 'bookmark') setMode('bookmark');
    else if(nav === 'exam') setMode('exam');
    else if(nav === 'bank') setMode('bank');
  });
  el('btn-theme').addEventListener('click', function(){
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try{ localStorage.setItem('mayuan.theme.v1', next); }catch(e){}
  });
  el('btn-prev').addEventListener('click', function(){ step(-1); });
  el('btn-next').addEventListener('click', function(){ step(1); });
  el('btn-submit').addEventListener('click', submit);
  el('btn-exam-submit').addEventListener('click', submitExam);

  el('exam-panel').addEventListener('click', function(e){
    var t = e.target.closest('[data-act]');
    if(!t) return;
    var act = t.dataset.act;
    if(act === 'start' || act === 'again') startExam();
    else if(act === 'submit') submitExam();
    else if(act === 'exit') exitExam();
    else if(act === 'inc' || act === 'dec'){
      var type = t.dataset.type;
      var next = quotaOf(state.examCfg.quotas, type) + (act === 'inc' ? 1 : -1);
      state.examCfg.quotas[type] = Math.max(0, Math.min(300, next));
      var box = el('qty-' + type);
      if(box) box.value = state.examCfg.quotas[type];
      save(); refreshExamSetup();
    }
  });
  el('exam-panel').addEventListener('input', function(e){
    if(e.target.id === 'exam-scope'){
      state.examCfg.scope = e.target.value;
      save(); refreshExamSetup();
    }else if(e.target.dataset && e.target.dataset.qty){
      var t = e.target.dataset.qty;
      state.examCfg.quotas[t] = Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 0));
      save(); refreshExamSetup();
    }
  });
  el('exam-summary').addEventListener('click', function(e){
    var t = e.target.closest('[data-act]');
    if(!t) return;
    if(t.dataset.act === 'again') startExam();
    else if(t.dataset.act === 'exit') exitExam();
    else if(t.dataset.act === 'filter'){
      state.exam.filter = state.exam.filter === 'wrong' ? 'all' : 'wrong';
      state.pos.exam = 0;
      save(); renderExamPanel(); renderWorkspace();
    }
  });

  setInterval(function(){
    if(state.mode !== 'exam' || !state.exam.active || state.exam.submitted) return;
    state.exam.elapsed++;
    updateTimers();
    if(state.exam.elapsed % 5 === 0) save();
  }, 1000);

  // 离开页面/刷新前把模考用时落盘，否则刷新后计时会归零
  function flushExam(){
    if(state.mode === 'exam' && state.exam.active && !state.exam.submitted) save();
  }
  window.addEventListener('beforeunload', flushExam);
  window.addEventListener('pagehide', flushExam);

  el('sheet-toggle').addEventListener('click', function(){
    state.sheetOpen = !state.sheetOpen; save();
    el('sheet').dataset.open = state.sheetOpen ? 'true' : 'false';
  });
  el('sheet-toggle').addEventListener('keydown', function(e){
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); this.click(); }
  });

  var search = el('search');
  search.addEventListener('input', function(){
    state.query = search.value.trim();
    el('searchbox').classList.toggle('has-value', !!search.value);
    state.pos[scopeKey()] = 0;
    renderWorkspace();
  });
  el('search-clear').addEventListener('click', function(){
    search.value = ''; state.query = '';
    el('searchbox').classList.remove('has-value');
    search.focus(); state.pos[scopeKey()] = 0; renderWorkspace();
  });

  el('btn-reset').addEventListener('click', function(){
    if(!window.confirm('确定要清空全部作答记录和收藏吗？此操作不可撤销。')) return;
    state.answers = {}; state.results = {}; state.bookmarks = {}; state.wrongs = {}; state.pos = {};
    state.exam = newExamState();
    save(); renderStats(); renderChapters(); renderExamPanel(); renderWorkspace();
    toast('已重置全部进度');
  });

  document.addEventListener('keydown', function(e){
    if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if(state.mode === 'home' || state.mode === 'bank') return;
    var qs = currentList();
    var q = qs[state.pos[scopeKey()] || 0];
    if(!q) return;
    var k = e.key;
    if(k === 'ArrowLeft'){ e.preventDefault(); step(-1); return; }
    if(k === 'ArrowRight'){ e.preventDefault(); step(1); return; }
    if(k === 'Enter'){
      e.preventDefault();
      if(state.mode === 'exam'){ step(1); return; }
      if(!el('btn-submit').hidden) submit(); else step(1);
      return;
    }
    if(state.mode === 'study') return;
    if(state.mode === 'exam' && state.exam.submitted) return;
    var letter = null;
    if(/^[1-8]$/.test(k)) letter = LETTERS[parseInt(k,10) - 1];
    else if(/^[a-hA-H]$/.test(k)) letter = k.toUpperCase();
    if(letter && q.options[letter.charCodeAt(0) - 65] != null){
      e.preventDefault(); pick(q, letter);
    }
  });

  function storageAvailable(){
    try{
      localStorage.setItem('__probe__', '1');
      localStorage.removeItem('__probe__');
      return true;
    }catch(e){
      return false;
    }
  }

  /* ---------------- 学科（多题库） ---------------- */
  function userSubjects(){ return SUBJECTS.filter(function(s){ return s.source === 'imported'; }); }
  function persistSubjects(){
    try{ localStorage.setItem(SUBJECT_STORE, JSON.stringify({list: userSubjects()})); return true; }
    catch(e){ toast('浏览器存不下这么大的题库', 'warn'); return false; }
  }
  function persistActive(id){
    try{ localStorage.setItem(ACTIVE_STORE, id); }catch(e){}
  }
  function genId(){ return 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function renderSubjectSelect(){
    var sel = el('subject-select');
    if(!sel) return;
    sel.innerHTML = SUBJECTS.map(function(s){
      var tag = s.source === 'demo' ? '（示例）' : (s.source === 'file' ? '（项目）' : '');
      return '<option value="' + esc(s.id) + '">' + esc(s.name + tag) + '</option>';
    }).join('');
    sel.value = currentSubject.id;
  }

  function renderAll(){
    renderSubjectSelect();
    var meta = BANK.meta || {};
    var title = currentSubject.name || meta.title;
    if(title){
      document.title = title + (meta.subtitle ? ' · ' + meta.subtitle : '');
      var bt = el('brand-title'), bs = el('brand-sub');
      if(bt) bt.textContent = title;
      if(bs) bs.textContent = meta.subtitle || '章节刷题 + 模拟考试';
    }
    renderModes();
    renderStats();
    renderExamPanel();
    renderChapters();
    renderWorkspace();
  }

  function activateSubject(id){
    var target = findSubject(id);
    if(!target) return;
    if(currentSubject && currentSubject.id === id) return;
    if(currentSubject) save();
    currentSubject = target;
    BANK = currentSubject;
    rebuildIndexes();
    state = makeState();
    hydrateState();
    var srch = el('search'); if(srch) srch.value = '';
    var sb = el('searchbox'); if(sb) sb.classList.remove('has-value');
    persistActive(id);
    renderAll();
    save();
  }

  function refreshCurrentSubject(){
    rebuildIndexes();
    pruneState();
    renderAll();
    save();
  }

  function mergeChapters(target, incoming){
    var used = {};
    target.chapters.forEach(function(ch){ used[ch.key] = true; });
    incoming.forEach(function(ch){
      var baseKey = ch.key || 'imported';
      var baseName = ch.name || '导入的题库';
      var key = baseKey, name = baseName, n = 2;
      while(used[key]){ key = baseKey + '-' + n; name = baseName + '(' + n + ')'; n++; }
      used[key] = true;
      target.chapters.push({
        key: key, name: name, subtitle: ch.subtitle, source: true,
        questions: (ch.questions || []).map(function(q){
          return { id: key + '-' + (q.num != null ? q.num : 0), num: q.num, type: q.type,
                   stem: q.stem, options: q.options, answer: q.answer };
        })
      });
    });
  }

  function renameSubject(id){
    var s = findSubject(id);
    if(!s || s.source !== 'imported') return;
    var name = (window.prompt('给这个学科起个新名字：', s.name) || '').trim();
    if(!name || name === s.name) return;
    s.name = name;
    if(s.meta) s.meta.title = name;
    s.updatedAt = Date.now();
    persistSubjects();
    if(s.id === currentSubject.id) renderAll(); else { renderBankPanel(); renderSubjectSelect(); }
  }

  function deleteSubject(id){
    var s = findSubject(id);
    if(!s || s.source !== 'imported') return;
    if(!window.confirm('删除学科「' + s.name + '」？\n该学科的全部题目和做题记录会一起删除，且无法恢复。')) return;
    SUBJECTS = SUBJECTS.filter(function(x){ return x.id !== id; });
    persistSubjects();
    delete progressStore[id];
    try{ localStorage.setItem(STORE, JSON.stringify(progressStore)); }catch(e){}
    if(currentSubject.id === id){
      currentSubject = null;
      activateSubject(SUBJECTS[0].id);
    }else{
      renderBankPanel(); renderSubjectSelect();
    }
  }

  /* ---------------- 题库：导入 / 导出 / 清除 ---------------- */
  function renderBankPanel(){
    var s = currentSubject;
    el('bank-name').textContent = s.name + ' · ' + TOTAL + ' 题';
    el('bank-note').hidden = s.source !== 'demo';
    var editable = s.source === 'imported';
    el('btn-clear-questions').hidden = !editable;

    var host = el('subject-list');
    host.innerHTML = SUBJECTS.map(function(sub){
      var total = sub.chapters.reduce(function(n,c){ return n + (c.questions ? c.questions.length : 0); }, 0);
      var tag = sub.source === 'demo' ? '示例' : (sub.source === 'file' ? '项目' : '我的');
      return '<div class="subj' + (sub.id === s.id ? ' active' : '') + '" data-subj="' + esc(sub.id) + '" title="点击切换到这个学科">' +
        '<span class="subj-name">' + esc(sub.name) + '</span>' +
        '<span class="subj-meta">' + tag + ' · ' + total + ' 题</span>' +
        (sub.source === 'imported'
          ? '<button type="button" class="subj-btn" data-act="rename" data-subj="' + esc(sub.id) + '">重命名</button>' +
            '<button type="button" class="subj-btn danger" data-act="delete" data-subj="' + esc(sub.id) + '">删除</button>'
          : '') +
        '</div>';
    }).join('');

    var chHost = el('bank-chapters');
    if(!CHAPTERS.length){
      chHost.innerHTML = '<div class="bank-empty">还没有章节，先导入题库文件。</div>';
    }else{
      chHost.innerHTML = CHAPTERS.map(function(ch){
        return '<div class="bank-chap"><span class="nm">' + esc(ch.name) + '</span>' +
          '<span class="ct">' + ch.questions.length + ' 题</span>' +
          (editable ? '<button type="button" class="del" data-del-chapter="' + esc(ch.key) + '">删除</button>' : '') +
          '</div>';
      }).join('');
    }
  }

  /* ---------------- 题库的增删改（只作用于用户自建的学科） ---------------- */

  /* 题库变了之后，把指向已消失题目的记录一并清掉，免得错题本统计出幽灵数据 */
  function pruneState(){
    ['answers', 'results', 'bookmarks', 'wrongs'].forEach(function(k){
      Object.keys(state[k]).forEach(function(id){ if(!BY_ID[id]) delete state[k][id]; });
    });
    Object.keys(state.pos).forEach(function(k){
      if(k !== 'wrong' && k !== 'exam' && !chapterOf(k)) delete state.pos[k];
    });
    if(!chapterOf(state.chapter)) state.chapter = CHAPTERS[0] ? CHAPTERS[0].key : '';
    if(state.exam && state.exam.active){
      state.exam.ids = state.exam.ids.filter(function(id){ return !!BY_ID[id]; });
      Object.keys(state.exam.picks).forEach(function(id){ if(!BY_ID[id]) delete state.exam.picks[id]; });
      Object.keys(state.exam.flagged).forEach(function(id){ if(!BY_ID[id]) delete state.exam.flagged[id]; });
      if(!state.exam.ids.length) state.exam = newExamState();
    }
  }

  function afterBankChange(){
    rebuildIndexes();
    pruneState();
    save();
    renderStats();
    renderBankPanel();
    renderChapters();
    renderWorkspace();
  }

  function deleteQuestion(q){
    if(currentSubject.source !== 'imported') return;
    if(!window.confirm('删除这道题？\n只改浏览器里的学科，不动你的 Word 文件。')) return;
    CHAPTERS.forEach(function(ch){
      var ids = ch.questions.map(function(x){ return x.id; });
      var i = ids.indexOf(q.id);
      if(i >= 0) ch.questions.splice(i, 1);
    });
    persistSubjects();
    afterBankChange();
    toast('已删除这道题');
  }

  function deleteChapter(key){
    if(currentSubject.source !== 'imported') return;
    var ch = chapterOf(key);
    if(!ch) return;
    if(!window.confirm('删除整章「' + ch.name + '」（' + ch.questions.length + ' 题）？\n只改浏览器里的学科，不动你的 Word 文件。')) return;
    BANK.chapters = CHAPTERS.filter(function(c){ return c.key !== key; });
    persistSubjects();
    afterBankChange();
    toast('已删除章节「' + ch.name + '」');
  }

  function clearAllQuestions(){
    if(currentSubject.source !== 'imported') return;
    if(!TOTAL){ toast('这个学科已经是空的', 'warn'); return; }
    if(!window.confirm('清空「' + currentSubject.name + '」的全部 ' + TOTAL + ' 道题？\n清空后可以重新导入。')) return;
    BANK.chapters = [];
    persistSubjects();
    afterBankChange();
    toast('已清空题目，点「导入题库文件」重新导入');
  }

  /* 一键回到"刚打开网页"的初始状态：清掉本机存的所有学科和全部做题记录 */
  function wipeLocalData(){
    if(!window.confirm('清空这台设备上保存的全部内容：所有学科、做题记录、错题本、收藏。\n' +
                       '你的 Word 文档和项目里的题库文件不受影响。\n\n确定清空？')) return;
    try{
      localStorage.removeItem(BANK_STORE);
      localStorage.removeItem(SUBJECT_STORE);
      localStorage.removeItem(ACTIVE_STORE);
      localStorage.removeItem(STORE);
    }catch(e){}
    location.reload();
  }

  function hintHTML(){
    return '<details class="imp-hint"><summary>Word 文档要写成什么格式？</summary>' +
      '每道题三行，题号行和「答案：」是解析的锚点：<br>' +
      '<code>1、题干……（ ）</code><br>' +
      '<code>A、 选项一 B、 选项二 C、 选项三 D、 选项四</code><br>' +
      '<code>答案：C</code><br>' +
      '多选题写 <code>答案：AC</code>；判断题不用写选项，直接写 <code>答案：正确</code> 或 <code>答案：错误</code>。<br>' +
      '文件名带第几章会自动分章，比如 <code>第二章题目.docx</code>。可以一次选多个文件，整门课一次导进来。' +
      '</details>';
  }

  function closeImport(){
    el('import-modal').hidden = true;
    el('import-body').innerHTML = '';
    el('import-foot').innerHTML = '';
  }

  function exportBank(){
    var bank = { meta: BANK.meta || {}, chapters: BANK.chapters || [] };
    var text = JSON.stringify(bank, null, 2) + '\n';
    var title = currentSubject.name || '题库';
    var url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
    var a = document.createElement('a');
    a.href = url;
    a.download = title + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    toast('已导出备份文件 ' + title + '.json');
  }

  function showImportResult(res){
    var bank = res.bank;
    var body = el('import-body'), foot = el('import-foot');
    var rows = bank.chapters.map(function(ch){
      var c = {single:0, multi:0, judge:0};
      ch.questions.forEach(function(q){ if(c[q.type] != null) c[q.type]++; });
      return '<div class="imp-row"><b>' + esc(ch.name) + '</b><span>' +
        ch.questions.length + ' 题 · 单 ' + c.single + ' 多 ' + c.multi + ' 判 ' + c.judge + '</span></div>';
    }).join('');
    var problems = (res.problems && res.problems.length)
      ? '<div class="imp-problems">有 ' + res.problems.length + ' 处需要注意：<ul>' +
        res.problems.slice(0, 12).map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') +
        (res.problems.length > 12 ? '<li>……还有 ' + (res.problems.length - 12) + ' 处</li>' : '') +
        '</ul></div>'
      : '';
    var targets = userSubjects().map(function(s){
      return '<option value="' + esc(s.id) + '">追加到「' + esc(s.name) + '」</option>';
    }).join('');
    body.innerHTML =
      '<div class="imp-field"><label for="imp-target">导入到</label>' +
      '<select class="inp" id="imp-target"><option value="__new__">新建学科</option>' + targets + '</select></div>' +
      '<div class="imp-field" id="imp-name-row"><label for="imp-name">学科名</label>' +
      '<input class="inp" id="imp-name" value="' + esc(bank.meta.title) + '"></div>' +
      '<div class="imp-big">共 ' + bank.meta.total + ' 题 · ' + bank.chapters.length + ' 个章节</div>' +
      '<div class="imp-list">' + rows + '</div>' + problems + hintHTML() +
      '<div class="bank-tip">导入后保存在这台设备的浏览器里，不上传、也不影响别人。</div>';
    var targetSel = el('imp-target');
    var nameRow = el('imp-name-row');
    function syncNameRow(){ nameRow.style.display = (targetSel.value === '__new__') ? '' : 'none'; }
    targetSel.addEventListener('change', syncNameRow);
    syncNameRow();
    foot.innerHTML =
      '<button class="btn btn-soft" type="button" id="imp-cancel">取消</button>' +
      '<button class="btn btn-primary" type="button" id="imp-ok">导入并开始使用</button>';
    el('imp-cancel').addEventListener('click', closeImport);
    el('imp-ok').addEventListener('click', function(){
      var targetId = targetSel.value;
      if(targetId === '__new__'){
        var name = (el('imp-name').value.trim()) || bank.meta.title || '我的题库';
        var sub = { id: genId(), name: name, source: 'imported', meta: bank.meta || {}, chapters: bank.chapters, updatedAt: Date.now() };
        if(sub.meta) sub.meta.title = name;
        SUBJECTS.push(sub);
        if(!persistSubjects()){ SUBJECTS.pop(); return; }
        closeImport();
        activateSubject(sub.id);
      }else{
        var target = findSubject(targetId);
        if(!target){ toast('目标学科不存在', 'warn'); return; }
        mergeChapters(target, bank.chapters);
        target.updatedAt = Date.now();
        if(!persistSubjects()) return;
        closeImport();
        if(targetId === currentSubject.id) refreshCurrentSubject();
        else activateSubject(targetId);
      }
      toast('已导入');
    });
  }

  function openImportModal(files){
    var body = el('import-body'), foot = el('import-foot');
    el('import-modal').hidden = false;
    body.innerHTML = '<div class="imp-big">正在解析 ' + files.length + ' 个文件……</div>';
    foot.innerHTML = '';
    if(!window.MayuanImporter){
      body.innerHTML = '<div class="imp-problems">解析模块没加载成功，刷新页面再试一次。</div>';
      return;
    }
    window.MayuanImporter.parseFiles(files).then(showImportResult).catch(function(err){
      body.innerHTML = '<div class="imp-problems">解析失败：' + esc(err && err.message ? err.message : String(err)) + '</div>' + hintHTML();
      foot.innerHTML = '<button class="btn btn-soft" type="button" id="imp-again">重新选择文件</button>';
      el('imp-again').addEventListener('click', function(){
        closeImport();
        el('bank-file').click();
      });
    });
  }

  var bankFile = el('bank-file');
  el('btn-import').addEventListener('click', function(){
    bankFile.value = '';
    bankFile.click();
  });
  bankFile.addEventListener('change', function(){
    if(bankFile.files && bankFile.files.length) openImportModal(bankFile.files);
  });
  el('btn-export').addEventListener('click', exportBank);
  el('btn-clear-questions').addEventListener('click', clearAllQuestions);
  el('btn-wipe').addEventListener('click', wipeLocalData);
  el('subject-select').addEventListener('change', function(){
    activateSubject(el('subject-select').value);
  });
  el('subject-list').addEventListener('click', function(e){
    var row = e.target.closest('[data-subj]');
    if(!row) return;
    var act = e.target.closest('[data-act]');
    if(act){
      if(act.dataset.act === 'rename') renameSubject(act.dataset.subj);
      else if(act.dataset.act === 'delete') deleteSubject(act.dataset.subj);
      return;
    }
    activateSubject(row.dataset.subj);
  });
  el('bank-chapters').addEventListener('click', function(e){
    var b = e.target.closest('[data-del-chapter]');
    if(b) deleteChapter(b.dataset.delChapter);
  });
  el('import-close').addEventListener('click', closeImport);
  el('import-modal').addEventListener('click', function(e){
    if(e.target === el('import-modal')) closeImport();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !el('import-modal').hidden) closeImport();
  });

  /* ---------------- boot ---------------- */
  if(!storageAvailable()) el('storage-warn').hidden = false;
  renderAll();
  save();
}

/*
 * 学科来源：
 *   1. 用户自建的学科（存 localStorage，见「题库」面板）
 *   2. data/question-bank.js（由 tools/build_bank.py 生成，属个人内容，不进仓库）
 *   3. data/demo-bank.js（仓库自带的示例题库）
 * 系统学科（question-bank.js / demo-bank.js）只读；用户学科可编辑、可多次导入追加章节。
 */
(function(){
  function load(src){
    return new Promise(function(done){
      var s = document.createElement('script');
      s.src = src;
      s.onload = function(){ done(true); };
      s.onerror = function(){ done(false); };
      document.head.appendChild(s);
    });
  }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }

  function loadUserSubjects(){
    var raw = lsGet(SUBJECT_STORE);
    if(!raw) return [];
    try{
      var o = JSON.parse(raw);
      var list = (o && Array.isArray(o.list)) ? o.list : null;
      if(list){
        return list.filter(function(s){
          return s && s.id && s.source === 'imported' && Array.isArray(s.chapters);
        });
      }
    }catch(e){}
    return [];
  }

  /* 旧版只存一个题库（mayuan.bank.v1），升级时把它迁成一个学科，进度也一并搬过去 */
  function migrateLegacy(userSubjects){
    var legacyBank = null;
    var rawBank = lsGet(BANK_STORE);
    if(rawBank){
      try{ var b = JSON.parse(rawBank); if(b && Array.isArray(b.chapters)) legacyBank = b; }catch(e){}
    }
    var legacyProgress = null;
    var rawReview = lsGet(STORE);
    if(rawReview){
      try{
        var r = JSON.parse(rawReview);
        if(r && typeof r === 'object' && !Array.isArray(r) && r.answers) legacyProgress = r;
      }catch(e){}
    }
    if(legacyBank){
      userSubjects.push({
        id: 'u-legacy', name: (legacyBank.meta && legacyBank.meta.title) || '我的题库',
        source: 'imported', meta: legacyBank.meta || {}, chapters: legacyBank.chapters, updatedAt: Date.now()
      });
      lsDel(BANK_STORE);
    }
    if(legacyProgress){
      if(legacyBank){
        try{ var store = {}; store['u-legacy'] = legacyProgress; lsSet(STORE, JSON.stringify(store)); }
        catch(e){}
      }else{
        lsSet(STORE, '{}');
      }
    }
  }

  function systemSubject(id, name, source, bank){
    return { id: id, name: name, source: source, meta: bank.meta || {}, chapters: bank.chapters || [], updatedAt: 0 };
  }

  var userSubjects = loadUserSubjects();
  migrateLegacy(userSubjects);

  load('data/question-bank.js').then(function(okFile){
    var systemSubjects = [];
    if(okFile && window.MAYUAN_QUESTION_BANK && Array.isArray(window.MAYUAN_QUESTION_BANK.chapters)){
      var fb = window.MAYUAN_QUESTION_BANK;
      systemSubjects.push(systemSubject('file', (fb.meta && fb.meta.title) || '项目题库', 'file', fb));
    }
    return load('data/demo-bank.js').then(function(okDemo){
      if(okDemo && window.MAYUAN_QUESTION_BANK && Array.isArray(window.MAYUAN_QUESTION_BANK.chapters)){
        systemSubjects.push(systemSubject('demo', '示例题库', 'demo', window.MAYUAN_QUESTION_BANK));
      }
      var subjects = systemSubjects.concat(userSubjects);
      if(!subjects.length){
        document.getElementById('qcard').innerHTML =
          '<div class="ws-none"><b>题库未加载</b><span>请确认 data/question-bank.js 或 data/demo-bank.js 存在且格式正确。</span></div>';
        return;
      }
      var activeId = lsGet(ACTIVE_STORE);
      var active = null;
      if(activeId){
        for(var i=0;i<subjects.length;i++) if(subjects[i].id === activeId) active = subjects[i];
      }
      if(!active) active = userSubjects[0] || systemSubjects.filter(function(s){ return s.id === 'demo'; })[0] || subjects[0];
      bootQuiz(subjects, active.id);
    });
  });
})();
