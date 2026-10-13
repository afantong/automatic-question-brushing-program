# -*- coding: utf-8 -*-
"""
把 Word 题目文档转成题库数据文件（默认 data/question-bank.js）。

只用 Python 3 标准库，不需要装任何第三方包。

用法：
    python tools/build_bank.py
    python tools/build_bank.py -i "D:\\我的题库" --title "我的题库"
    python tools/build_bank.py -o data/question-bank.js

文档命名决定它进哪一章（脚本自动认，加章节不用改代码）：
    绪论题目.docx / 导论题目.docx  ->  intro
    第一章题目.docx                ->  ch1
    第二章题目.docx                ->  ch2   …依此类推到第八章

文档排版（每道题三行，题号行和「答案：」是解析的锚点）：
    1、题干……（ ）
    A、 选项一 B、 选项二 C、 选项三 D、 选项四
    答案：C

判断题不用写选项，直接写 `答案：正确`；多选题写 `答案：AC`。

可选：在题目目录放一个 chapters.json，自定义章节显示名和副标题，例如
    {
      "ch1": { "name": "第一章", "subtitle": "世界的物质性及发展规律" }
    }
没提供时，章节名从文件名推出来，副标题取文档首行。
"""

import argparse
import html
import io
import json
import os
import re
import sys
import time
import zipfile

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(APP_DIR)
DEFAULT_DOCX_DIR = os.path.join(ROOT, '题目文档')
DEFAULT_OUT = os.path.join(APP_DIR, 'data', 'question-bank.js')
DEFAULT_TITLE = '我的题库'
DEFAULT_SUBTITLE = '本地题库'

CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8}

QSTART = re.compile(r'^\s*(\d{1,3})\s*[、．.]\s*(.*)$')
ANSWER = re.compile(r'^\s*答案\s*[：:]\s*(.*)$')
OPTSPLIT = re.compile(r'([A-D])\s*[、．.]\s*')

# Word 里常会混进不可见的私有区字符（复制粘贴的残留），直接丢掉
PUA_RE = re.compile(r'[\ue000-\uf8ff]')

FIXES = []
FIXED = {}


def load_fixes(docx_dir):
    """可选的 fixes.txt：一行一条「错=对」，用来修原稿里的笔误。"""
    path = os.path.join(docx_dir, 'fixes.txt')
    if not os.path.exists(path):
        return []
    fixes = []
    with io.open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            bad, _, good = line.partition('=')
            if bad.strip():
                fixes.append((bad.strip(), good.strip()))
    return fixes


def clean(text):
    for bad, good in FIXES:
        if bad in text:
            FIXED[bad] = FIXED.get(bad, 0) + text.count(bad)
            text = text.replace(bad, good)
    return PUA_RE.sub('', text)


def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    xml = xml.replace('</w:p>', '\n').replace('<w:tab/>', '\t')
    xml = re.sub(r'<[^>]+>', '', xml)
    return html.unescape(xml)


def split_paragraphs(text):
    lines = [clean(l).strip() for l in text.split('\n')]
    return [l for l in lines if l]


def parse_docx(path):
    """把文档拆成 [{num, body, answer_raw}]，body 里含题干和选项。"""
    items, cur = [], None
    for line in split_paragraphs(docx_text(path)):
        m = ANSWER.match(line)
        if m:
            if cur is not None:
                cur['answer_raw'] = m.group(1).strip()
                items.append(cur)
                cur = None
            continue
        m = QSTART.match(line)
        if m:
            if cur is not None:
                items.append(cur)
            cur = {'num': int(m.group(1)), 'body': m.group(2).strip()}
            continue
        if cur is not None:
            cur['body'] += '\n' + line
    if cur is not None:
        items.append(cur)
    return items


def doc_title_of(path):
    """文档首行通常是「课程名-第X章」，取分隔符前面那段当副标题。"""
    for line in split_paragraphs(docx_text(path)):
        if ANSWER.match(line) or QSTART.match(line):
            return ''
        if len(line) <= 40:
            return line.split('-')[0].strip()
        return ''
    return ''


def normalize_answer(raw):
    compact = raw.replace(' ', '').replace('\u3000', '')
    if compact in ('正确', '对', '是', 'T'):
        return 'judge', ['A']
    if compact in ('错误', '错', '否', 'F'):
        return 'judge', ['B']
    letters = sorted({c for c in compact.upper() if c in 'ABCD'})
    if not letters:
        raise ValueError('无法识别答案：%r' % raw)
    return ('multi' if len(letters) > 1 else 'single'), letters


def convert(key, items):
    out = []
    for item in items:
        parts = OPTSPLIT.split(item['body'])
        stem = parts[0].strip()
        pairs = [(parts[i], parts[i + 1].strip()) for i in range(1, len(parts), 2)]
        type_, answer = normalize_answer(item.get('answer_raw', ''))
        if type_ == 'judge':
            out.append({'id': '%s-%d' % (key, item['num']), 'num': item['num'], 'type': 'judge',
                        'stem': stem, 'options': ['正确', '错误'], 'answer': answer})
            continue
        letters = [p[0] for p in pairs]
        expect = [chr(65 + i) for i in range(len(letters))]
        if letters != expect:
            raise ValueError('第 %d 题选项序号异常：%s（检查文档排版）' % (item['num'], letters))
        for a in answer:
            if a not in letters:
                raise ValueError('第 %d 题答案 %s 超出选项范围 %s' % (item['num'], answer, letters))
        out.append({'id': '%s-%d' % (key, item['num']), 'num': item['num'], 'type': type_,
                    'stem': stem, 'options': [p[1] for p in pairs], 'answer': answer})
    return out


def chapter_key_of(filename):
    """绪论/导论题目.docx -> intro，第X章题目.docx -> chX，认不出返回空。"""
    name = filename.replace(' ', '').replace('\u3000', '')
    if name.startswith('绪论') or name.startswith('导论'):
        return 'intro'
    m = re.match(r'^第([一二三四五六七八])章', name)
    return 'ch%d' % CN_NUM[m.group(1)] if m else ''


def default_chapter_name(key, filename):
    if key == 'intro':
        return '导论'
    stem = filename.replace(' ', '').replace('\u3000', '')
    m = re.match(r'^(第[一二三四五六七八]章)', stem)
    return m.group(1) if m else (filename.rsplit('.', 1)[0][:16] or '题库')


def chapter_order(key):
    if key == 'intro':
        return 0
    m = re.match(r'^ch(\d+)$', key)
    return int(m.group(1)) if m else 99


def load_chapter_meta(docx_dir):
    """可选的 chapters.json，用来指定章节显示名和副标题。"""
    path = os.path.join(docx_dir, 'chapters.json')
    if not os.path.exists(path):
        return {}
    try:
        with io.open(path, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print('  ! chapters.json 读不了，已忽略：%s' % e, file=sys.stderr)
        return {}


def scan_sources(docx_dir):
    found = {}
    for filename in sorted(os.listdir(docx_dir)):
        if filename.startswith('~$') or not filename.lower().endswith('.docx'):
            continue
        key = chapter_key_of(filename)
        if not key:
            print('  ! 忽略（认不出是第几章）：%s' % filename)
            continue
        if key in found:
            print('  ! %s 匹配到多个文件，用 %s，忽略 %s' % (key, found[key], filename))
            continue
        found[key] = filename
    return found


def main(argv=None):
    global FIXES
    ap = argparse.ArgumentParser(
        description='把 Word 题目文档转成题库数据文件',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='例：python tools/build_bank.py -i "D:\\我的题库" --title "我的题库"')
    ap.add_argument('-i', '--input', default=DEFAULT_DOCX_DIR, help='题目文档所在目录（默认 %s）' % DEFAULT_DOCX_DIR)
    ap.add_argument('-o', '--output', default=DEFAULT_OUT, help='输出的题库文件（默认 %s）' % DEFAULT_OUT)
    ap.add_argument('--title', default=DEFAULT_TITLE, help='题库标题，显示在页面左上角')
    ap.add_argument('--subtitle', default=DEFAULT_SUBTITLE, help='题库副标题')
    args = ap.parse_args(argv)

    docx_dir = os.path.abspath(args.input)
    out_file = os.path.abspath(args.output)
    if not os.path.isdir(docx_dir):
        print('找不到题目目录：%s' % docx_dir, file=sys.stderr)
        print('把 Word 题目文档放进这个目录再运行，或者用 -i 指定别的目录，例如：', file=sys.stderr)
        print('    python tools/build_bank.py -i "D:\\我的题库"', file=sys.stderr)
        return 1

    sources = scan_sources(docx_dir)
    if not sources:
        print('%s 里没有认得出的题目文档。' % docx_dir, file=sys.stderr)
        print('文件按《绪论题目.docx》《第一章题目.docx》《第二章题目.docx》这样命名即可。', file=sys.stderr)
        return 1

    FIXES = load_fixes(docx_dir)
    meta = load_chapter_meta(docx_dir)
    chapters, gaps, total = [], {}, 0
    for key in sorted(sources, key=chapter_order):
        filename = sources[key]
        path = os.path.join(docx_dir, filename)
        try:
            questions = convert(key, parse_docx(path))
        except ValueError as e:
            print('%s 第 %s 题解析失败：%s' % (filename, '', e), file=sys.stderr)
            return 1
        if not questions:
            print('未从 %s 解析到题目，请检查文档排版' % filename, file=sys.stderr)
            return 1
        info = meta.get(key) or {}
        nums = [q['num'] for q in questions]
        miss = [n for n in range(1, max(nums) + 1) if n not in nums]
        if miss:
            gaps[key] = (filename, miss)
        counts = {'single': 0, 'multi': 0, 'judge': 0}
        for q in questions:
            counts[q['type']] += 1
        total += len(questions)
        print('解析 %-18s -> %-5s %3d 题（单选 %d 多选 %d 判断 %d）'
              % (filename, key, len(questions), counts['single'], counts['multi'], counts['judge']))
        chapters.append({
            'key': key,
            'name': info.get('name') or default_chapter_name(key, filename),
            'subtitle': info.get('subtitle') or doc_title_of(path),
            'source': True,
            'questions': questions,
        })

    header = [
        '/*',
        ' * %s · %s（题库数据文件）' % (args.title, args.subtitle),
        ' *',
        ' * 本文件由 tools/build_bank.py 依据 %s/*.docx 自动生成，请勿手工大改；'
        % os.path.basename(docx_dir),
        ' * 字段说明见 docs/question-format.md。',
        ' */',
    ]
    payload = {
        'meta': {'title': args.title, 'subtitle': args.subtitle,
                 'version': '1.0', 'updated': time.strftime('%Y-%m-%d'), 'total': total},
        'chapters': chapters,
    }

    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with io.open(out_file, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(header) + '\nwindow.MAYUAN_QUESTION_BANK = %s;\n'
                % json.dumps(payload, ensure_ascii=False, indent=2))

    print('已生成 %s（合计 %d 题，%d 个章节）' % (out_file, total, len(chapters)))
    for bad, times in FIXED.items():
        print('  · 修正原稿笔误 %d 处：%s' % (times, bad))
    for key, (filename, miss) in gaps.items():
        print('  ! %s 的题号有缺口：%s（%s 里缺这些题，核对一下）'
              % (key, '、'.join(str(n) for n in miss), filename))
    return 0


if __name__ == '__main__':
    sys.exit(main())
