/*
 * 浏览器内题库导入：在本地解析 Word / 文本 / 之前导出的题库文件。
 *
 * 不依赖后端，也不依赖任何第三方库：
 *   docx 本质是个 zip，这里手工读中央目录 + 用浏览器自带的 DecompressionStream 解压，
 *   再用 DOMParser 读 word/document.xml 的段落。
 *
 * 对外接口：window.MayuanImporter.parseFiles(FileList) -> Promise<bank>
 */
(function(){
  'use strict';

  var PUA = /[\ue000-\uf8ff]/g;
  var QSTART = /^\s*(\d{1,3})\s*[、．.]\s*(.*)$/;
  var ANSWER = /^\s*答案\s*[：:]\s*(.*)$/;
  var OPTSPLIT = /([A-D])\s*[、．.]\s*/;
  var CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8};
  var DEFAULT_TITLE = '我的题库';

  function clean(s){ return String(s).replace(PUA, ''); }

  /* ---------------- zip ---------------- */

  function findEOCD(bytes){
    var start = bytes.length - 22;
    var end = Math.max(0, bytes.length - 66000);
    for (var i = start; i >= end; i--){
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function zipEntries(buf){
    var view = new DataView(buf);
    var bytes = new Uint8Array(buf);
    var eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('不是有效的 Office 文件（没找到 zip 结构）');
    var count = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var entries = {};
    for (var i = 0; i < count; i++){
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      var method = view.getUint16(offset + 10, true);
      var compSize = view.getUint32(offset + 20, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localOff = view.getUint32(offset + 42, true);
      var name = new TextDecoder('utf-8').decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      var dataStart = localOff + 30 + view.getUint16(localOff + 26, true) + view.getUint16(localOff + 28, true);
      entries[name] = {method: method, data: bytes.subarray(dataStart, dataStart + compSize)};
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function inflateRaw(bytes){
    if (typeof DecompressionStream !== 'function'){
      throw new Error('当前浏览器太旧，不支持本地解压。请用新版 Chrome / Edge / Safari 打开。');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }

  function docxText(buf){
    var entry = zipEntries(buf)['word/document.xml'];
    if (!entry) throw new Error('这个 Word 文件里没找到正文');
    var raw = entry.method === 0
      ? Promise.resolve(entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength))
      : inflateRaw(entry.data);
    return raw.then(function(ab){
      var doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(ab), 'application/xml');
      var paras = doc.getElementsByTagName('w:p');
      var lines = [];
      for (var i = 0; i < paras.length; i++){
        var runs = paras[i].getElementsByTagName('w:t');
        var s = '';
        for (var j = 0; j < runs.length; j++) s += runs[j].textContent;
        lines.push(s);
      }
      return lines.join('\n');
    });
  }

  /* ---------------- 文本 → 题目 ---------------- */

  function parseText(text){
    var lines = String(text).replace(/^\ufeff/, '').split(/\r?\n/);
    var items = [], cur = null, docTitle = '';
    for (var i = 0; i < lines.length; i++){
      var line = clean(lines[i]).trim();
      if (!line) continue;
      var ma = ANSWER.exec(line);
      if (ma){
        if (cur){ cur.answer = ma[1].trim(); items.push(cur); cur = null; }
        continue;
      }
      var mq = QSTART.exec(line);
      if (mq){
        if (cur) items.push(cur);
        cur = {num: parseInt(mq[1], 10), body: mq[2].trim()};
        continue;
      }
      if (cur) cur.body += '\n' + line;
      else if (!docTitle && line.length <= 40) docTitle = line;
    }
    if (cur) items.push(cur);
    return {items: items, docTitle: docTitle};
  }

  function normalizeAnswer(raw){
    var r = String(raw).replace(/[\s\u3000]/g, '');
    if (r === '正确' || r === '对' || r === '是' || r === 'T') return {type: 'judge', answer: ['A']};
    if (r === '错误' || r === '错' || r === '否' || r === 'F') return {type: 'judge', answer: ['B']};
    var letters = [];
    for (var i = 0; i < r.length; i++){
      var c = r.charAt(i).toUpperCase();
      if (c >= 'A' && c <= 'D' && letters.indexOf(c) < 0) letters.push(c);
    }
    letters.sort();
    if (!letters.length) return null;
    return {type: letters.length > 1 ? 'multi' : 'single', answer: letters};
  }

  function toQuestions(key, items, problems){
    var out = [];
    for (var i = 0; i < items.length; i++){
      var it = items[i];
      if (!it.answer){
        problems.push('第 ' + it.num + ' 题没有答案行，已跳过');
        continue;
      }
      var norm = normalizeAnswer(it.answer);
      if (!norm){
        problems.push('第 ' + it.num + ' 题的答案「' + it.answer + '」看不懂，已跳过');
        continue;
      }
      var parts = it.body.split(OPTSPLIT);
      var stem = parts[0].trim();
      var letters = [], texts = [];
      for (var k = 1; k + 1 < parts.length; k += 2){
        letters.push(parts[k]);
        texts.push(parts[k + 1].trim());
      }
      if (norm.type === 'judge'){
        out.push({id: key + '-' + it.num, num: it.num, type: 'judge', stem: stem, options: ['正确', '错误'], answer: norm.answer});
        continue;
      }
      var expect = '';
      for (var j = 0; j < letters.length; j++) expect += String.fromCharCode(65 + j);
      if (letters.join('') !== expect){
        problems.push('第 ' + it.num + ' 题的选项编号不连续（读到 ' + (letters.join('') || '无') + '），已跳过');
        continue;
      }
      var ok = true;
      for (var a = 0; a < norm.answer.length; a++){
        if (letters.indexOf(norm.answer[a]) < 0) ok = false;
      }
      if (!ok){
        problems.push('第 ' + it.num + ' 题的答案超出选项范围，已跳过');
        continue;
      }
      out.push({id: key + '-' + it.num, num: it.num, type: norm.type, stem: stem, options: texts, answer: norm.answer});
    }
    return out;
  }

  /* ---------------- 文件 → 章节 ---------------- */

  function baseName(name){ return String(name).replace(/\.[^.]+$/, ''); }

  function chapterKeyOf(name){
    var flat = baseName(name).replace(/[\s\u3000]/g, '');
    if (/^(绪论|导论)/.test(flat)) return 'intro';
    var m = /^第([一二三四五六七八])章/.exec(flat);
    return m ? 'ch' + CN_NUM[m[1]] : '';
  }

  function chapterNameOf(name){
    var flat = baseName(name).replace(/[\s\u3000]/g, '');
    var m = /^(第[一二三四五六七八]章|绪论|导论)/.exec(flat);
    return m ? m[1] : (flat.slice(0, 16) || '导入的题库');
  }

  /* 文档首行通常是「课程名-第X章」，取分隔符前面那段当课程名 */
  function courseOf(docTitle, fallbackName){
    if (docTitle){
      var head = String(docTitle).split(/[-—－_]/)[0].trim();
      if (head) return head;
    }
    return fallbackName ? ('来自 ' + fallbackName) : '';
  }

  function bankFromText(text){
    var s = String(text).replace(/^\ufeff/, '');
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    var obj;
    try { obj = JSON.parse(s.slice(i, j + 1)); } catch (e){ return null; }
    return (obj && obj.chapters && obj.chapters.length) ? obj : null;
  }

  function readFile(file){
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'docx'){
      return file.arrayBuffer().then(function(buf){
        return docxText(buf).then(function(text){ return {text: text}; });
      });
    }
    return file.text().then(function(text){
      var bank = bankFromText(text);
      if (bank) return {bank: bank};
      return {text: text};
    });
  }

  function parseFiles(files){
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return Promise.reject(new Error('没有选择文件'));
    var chapters = [], problems = [], used = {}, docTitle = '';

    return list.reduce(function(chain, file){
      return chain.then(function(){
        return readFile(file).then(function(res){
          if (res.bank){
            res.bank.chapters.forEach(function(ch){
              var key = ch.key || 'imported';
              while (used[key]) key += '-2';
              used[key] = true;
              chapters.push({
                key: key,
                name: ch.name || '导入的题库',
                subtitle: ch.subtitle || ('来自 ' + file.name),
                source: true,
                questions: (ch.questions || []).map(function(q, i){
                  return {
                    id: key + '-' + (q.num != null ? q.num : i + 1),
                    num: q.num != null ? q.num : i + 1,
                    type: q.type === 'multi' ? 'multi' : (q.type === 'judge' ? 'judge' : 'single'),
                    stem: q.stem || '',
                    options: q.options || [],
                    answer: q.answer || []
                  };
                })
              });
              if (ch.subtitle || ch.name) docTitle = docTitle || '';
            });
            return;
          }
          var parsed = parseText(res.text);
          if (!parsed.items.length){
            problems.push(file.name + '：没读到题目，检查一下排版格式');
            return;
          }
          var key = chapterKeyOf(file.name) || 'imported';
          while (used[key]) key += '-2';
          used[key] = true;
          var questions = toQuestions(key, parsed.items, problems);
          if (!questions.length){
            problems.push(file.name + '：题目都解析失败了');
            return;
          }
          chapters.push({
            key: key,
            name: chapterNameOf(file.name),
            subtitle: courseOf(parsed.docTitle, file.name),
            source: true,
            questions: questions
          });
          if (!docTitle && parsed.docTitle) docTitle = courseOf(parsed.docTitle, '');
        });
      });
    }, Promise.resolve()).then(function(){
      if (!chapters.length) throw new Error(problems[0] || '没解析出任何题目');
      var total = chapters.reduce(function(n, ch){ return n + ch.questions.length; }, 0);
      var title = docTitle && docTitle.length <= 24 ? docTitle : DEFAULT_TITLE;
      return {
        bank: {
          meta: {
            title: title,
            subtitle: '本地导入题库',
            version: '1.0',
            updated: new Date().toISOString().slice(0, 10),
            total: total
          },
          chapters: chapters
        },
        problems: problems
      };
    });
  }

  window.MayuanImporter = {
    parseFiles: parseFiles,
    parseText: parseText,
    docxText: docxText
  };
})();
