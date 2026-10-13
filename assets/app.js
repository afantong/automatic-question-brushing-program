/* 浏览器里导入的题库存在 localStorage 的这个键下（加载器和页面逻辑都要用，所以放函数外面） */
var BANK_STORE = 'mayuan.bank.v1';

function bootQuiz(){
  "use strict";

  var ICON = {
    check:'<path d="M20 6 9 17l-5-5"/>',
    x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    okCircle:'<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    badCircle:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    star:'<path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z"/>',
    search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>'
  };
  function ic(name,cls){
    return '<svg class="ic '+(cls||'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICON[name]+'</svg>';
  }

  var BANK = window.MAYUAN_QUESTION_BANK;
  if(!BANK || !BANK.chapters || !BANK.chapters.length){
    document.getElementById('qcard').innerHTML =
      '<div class="ws-none">'+ic('info')+'<b>题库未加载</b><span>请确认 data/question-bank.js 或 data/demo-bank.js 存在。</span></div>';
    return;
  }

  var CHAPTERS = BANK.chapters;
  var ALL = [];
  var BY_ID = {};
  CHAPTERS.forEach(function(ch){
    ch.questions.forEach(function(q){
      q.chapterKey = ch.key; q.chapterName = ch.name; q.chapterTitle = ch.subtitle;
      ALL.push(q); BY_ID[q.id] = q;
    });
  });
  var TOTAL = ALL.length;

  var TYPE_LABEL = {single:'单选题', multi:'多选题', judge:'判断题'};
  var LETTERS = ['A','B','C','D','E','F','G','H'];
  var STORE = 'mayuan.review.v1';

  /* ---------------- state ---------------- */
  var state = {
    mode:'quiz', chapter:'intro', query:'', sheetOpen:true,
    answers:{}, results:{}, bookmarks:{}, wrongs:{}, pos:{},
    examCfg:{scope:'all', quotas:{single:35, multi:15, judge:5}},
    exam:null
  };
  function newExamState(){
    return {active:false, submitted:false, ids:[], picks:{}, flagged:{}, elapsed:0,
            scope:'all', quotas:{single:0, multi:0, judge:0}, short:{}, filter:'all'};
  }
  state.exam = newExamState();
  try{
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
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
      if(saved.mode==='study'||saved.mode==='wrong'||saved.mode==='quiz'||saved.mode==='exam') state.mode = saved.mode;
      if(state.mode === 'exam' && !state.exam.active) state.mode = 'quiz';
      if(BY_ID[saved.chapter] || CHAPTERS.some(function(c){return c.key===saved.chapter;})) state.chapter = saved.chapter;
      if(typeof saved.sheetOpen === 'boolean') state.sheetOpen = saved.sheetOpen;
    }
  }catch(e){}
  if(!chapterOf(state.chapter)) state.chapter = CHAPTERS[0].key;

  function save(){
    try{ localStorage.setItem(STORE, JSON.stringify({
      answers:state.answers, results:state.results, bookmarks:state.bookmarks, wrongs:state.wrongs,
      pos:state.pos, mode:state.mode, chapter:state.chapter, sheetOpen:state.sheetOpen,
      examCfg:state.examCfg, exam:state.exam
    })); }catch(e){}
  }

  /* ---------------- helpers ---------------- */
  function el(id){ return document.getElementById(id); }
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
  function scopeKey(){ return state.mode === 'wrong' ? 'wrong' : (state.mode === 'exam' ? 'exam' : state.chapter); }
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
    el('o-done').textContent = t.done + ' / ' + t.total;
    el('o-bar').style.width = (t.total ? t.done / t.total * 100 : 0) + '%';
    el('o-ok').textContent = t.ok;
    el('o-bad').textContent = t.bad;
    var badge = el('wrong-badge');
    badge.textContent = t.bad;
    badge.hidden = t.bad === 0;
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
      var active = state.mode !== 'wrong' && state.chapter === ch.key;
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

  function syncSidebar(){
    var exam = state.mode === 'exam';
    el('exam-panel').hidden = !exam;
    el('chapter-panel').hidden = exam;
    el('overall-panel').hidden = exam;
    el('searchbox').hidden = exam;
  }

  function renderWorkspace(){
    syncSidebar();
    if(state.mode === 'exam') return renderExam();

    var qs = currentList();
    var key = scopeKey();
    var idx = state.pos[key] || 0;
    if(idx > qs.length - 1) idx = Math.max(0, qs.length - 1);
    state.pos[key] = idx;

    var card = el('qcard');
    var ch = chapterOf(state.chapter);

    el('ws-tag').textContent = state.mode === 'wrong' ? '错题本' : (ch ? ch.name : '');
    el('ws-tag').className = 'tag' + (state.mode === 'wrong' ? ' grey' : '');
    el('ws-title').textContent = state.mode === 'wrong' ? '错题巩固与重练' : (ch ? (ch.subtitle || ch.name) : '');
    el('ws-count').innerHTML = qs.length ? '题目 <b>' + (idx + 1) + '</b> / ' + qs.length : '题目 <b>0</b>';
    el('ws-timer').hidden = true;
    el('exam-summary').hidden = true;
    el('btn-exam-submit').hidden = true;
    el('sheet').hidden = false;

    if(!qs.length){
      var emptyHtml;
      if(state.mode === 'wrong'){
        emptyHtml = '<b>错题本是空的</b><span>做错的题目会自动收进来，答对后自动移出。</span>';
      }else if(state.query){
        emptyHtml = '<b>没有匹配的题目</b><span>换个关键词试试。</span>';
      }else{
        emptyHtml = '<b>本章暂无题目</b><span>当前章节还没有录入题目。</span>';
      }
      card.innerHTML = '<div class="ws-none">' + ic(state.mode === 'wrong' ? 'okCircle' : 'search') + emptyHtml + '</div>';
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
      '<span class="q-meta">' + esc(state.mode === 'wrong' ? q.chapterName : (ch ? ch.name : '')) +
      ' · 原卷第 ' + q.num + ' 题</span>' +
      '<button type="button" class="star' + (state.bookmarks[q.id] ? ' on' : '') + '" id="btn-star" title="收藏本题">' +
      ic('star') + (state.bookmarks[q.id] ? '已收藏' : '收藏') + '</button>' +
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
    state.query = ''; el('search').value = ''; el('searchbox').classList.remove('has-value');
    if(mode === 'wrong') state.pos.wrong = 0;
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

  /* ---------------- 题库：导入 / 导出 / 清除 ---------------- */
  function renderBankPanel(){
    var src = window.MAYUAN_BANK_SOURCE || 'demo';
    var label = src === 'imported' ? '本地导入题库'
              : (src === 'file' ? '项目题库文件' : '示例题库');
    el('bank-name').textContent = label + ' · ' + TOTAL + ' 题';
    el('btn-clear-bank').hidden = src !== 'imported';
    el('bank-note').hidden = src !== 'demo';
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
    var bank = window.MAYUAN_QUESTION_BANK;
    var text = JSON.stringify(bank, null, 2) + '\n';
    var title = (bank.meta && bank.meta.title) ? bank.meta.title : '题库';
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
    body.innerHTML =
      '<div class="imp-field"><label for="imp-title">标题</label>' +
      '<input class="inp" id="imp-title" value="' + esc(bank.meta.title) + '"></div>' +
      '<div class="imp-big">共 ' + bank.meta.total + ' 题 · ' + bank.chapters.length + ' 个章节</div>' +
      '<div class="imp-list">' + rows + '</div>' + problems + hintHTML() +
      '<div class="bank-tip">导入后题库保存在这台设备的浏览器里，不上传、也不影响别人。</div>';
    foot.innerHTML =
      '<button class="btn btn-soft" type="button" id="imp-cancel">取消</button>' +
      '<button class="btn btn-primary" type="button" id="imp-ok">导入并开始使用</button>';
    el('imp-cancel').addEventListener('click', closeImport);
    el('imp-ok').addEventListener('click', function(){
      var t = el('imp-title').value.trim();
      if(t) bank.meta.title = t;
      try{
        localStorage.setItem(BANK_STORE, JSON.stringify(bank));
      }catch(e){
        toast('浏览器存不下这么大的题库，建议少导几章', 'warn');
        return;
      }
      location.reload();
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
  el('btn-clear-bank').addEventListener('click', function(){
    if(!window.confirm('清除浏览器里导入的题库？之后会回到项目自带的题库。')) return;
    try{ localStorage.removeItem(BANK_STORE); }catch(e){}
    location.reload();
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
  renderBankPanel();
  var meta = BANK.meta || {};
  if(meta.title){
    document.title = meta.title + (meta.subtitle ? ' · ' + meta.subtitle : '');
    var bt = el('brand-title');
    var bs = el('brand-sub');
    if(bt) bt.textContent = meta.title;
    if(bs) bs.textContent = meta.subtitle || '章节刷题 + 模拟考试';
  }
  el('s-total').textContent = TOTAL;
  renderModes();
  renderStats();
  renderExamPanel();
  renderChapters();
  renderWorkspace();
  save();
}

/*
 * 题库来源优先级：
 *   1. 浏览器里导入的题库（存在 localStorage，见上面「题库」面板）
 *   2. data/question-bank.js（由 tools/build_bank.py 生成，属个人内容，不进仓库）
 *   3. data/demo-bank.js（仓库自带的示例题库）
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
  function importedBank(){
    var raw = null;
    try{ raw = localStorage.getItem(BANK_STORE); }catch(e){ return null; }
    if(!raw) return null;
    try{
      var b = JSON.parse(raw);
      if(b && b.chapters && b.chapters.length) return b;
    }catch(e){}
    try{ localStorage.removeItem(BANK_STORE); }catch(e){}
    return null;
  }
  var mine = importedBank();
  if(mine){
    window.MAYUAN_QUESTION_BANK = mine;
    window.MAYUAN_BANK_SOURCE = 'imported';
    bootQuiz();
    return;
  }
  load('data/question-bank.js').then(function(ok){
    if(ok && window.MAYUAN_QUESTION_BANK){
      window.MAYUAN_BANK_SOURCE = 'file';
      return;
    }
    return load('data/demo-bank.js').then(function(){
      window.MAYUAN_BANK_SOURCE = 'demo';
    });
  }).then(function(){
    bootQuiz();
  });
})();
