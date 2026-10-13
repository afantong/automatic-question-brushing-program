# -*- coding: utf-8 -*-
"""
由 Word 题目文档生成题库数据：data/question-bank.js

用法（只需要本机装了 Python 3，不用装任何第三方库）：
    python tools/build_bank.py                     # 读 ../马原题/，写 data/question-bank.js
    python tools/build_bank.py -i D:\\我的题库       # 指定题目目录
    python tools/build_bank.py --title 我的题库 --subtitle 期末冲刺

改题流程：
    1. 把题目文档放进 ../马原题/，文件名写成《绪论题目.docx》《第一章题目.docx》
       《第二章题目.docx》……脚本会自动认章节，不用改代码；
    2. 文档内部保持 "N、题干 / A、选项 / 答案：X" 的排版格式；
    3. 运行本脚本，题库自动重建；
    4. 刷新 index.html 即可看到新题。

没放文档的章节会保留一道占位小题，先撑着章节目录。
生成的 data/question-bank.js 属于个人题库内容，默认不提交到 git。
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

HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(APP_DIR)
DOCX_DIR = os.path.join(ROOT, '马原题')
OUT = os.path.join(APP_DIR, 'data', 'question-bank.js')

# 题库标题，会显示在页面左上角；换学科就改这两行，或用 --title / --subtitle 覆盖
TITLE = '马克思主义基本原理概论'
SUBTITLE = '期末复习自测'

CHAPTER_META = [
    ('intro', '导论', '马克思主义是关于无产阶级和人类解放的科学'),
    ('ch1', '第一章', '世界的物质性及发展规律'),
    ('ch2', '第二章', '实践与认识及其发展规律'),
    ('ch3', '第三章', '人类社会及其发展规律'),
    ('ch4', '第四章', '资本主义的本质及规律'),
    ('ch5', '第五章', '资本主义的发展及其趋势'),
    ('ch6', '第六章', '社会主义的发展及其规律'),
    ('ch7', '第七章', '共产主义崇高理想及其最终实现'),
]

# 自动认题：绪论/导论题目.docx → intro，第X章题目.docx → chX
CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8}


def chapter_key_of(filename):
    name = filename.replace(' ', '').replace('　', '')
    if name.startswith('绪论') or name.startswith('导论'):
        return 'intro'
    m = re.match(r'^第([一二三四五六七八])章', name)
    if m:
        return 'ch%d' % CN_NUM[m.group(1)]
    return None


def scan_sources(docx_dir):
    """扫描 马原题/ 目录，按文件名自动配到各个章节。"""
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

# 尚未录入的章节：占位小题，按同样格式补进 data/question-bank.js 即可
PLACEHOLDERS = {
    'ch3': [('single', '社会存在是指：', ['社会的精神生活过程', '社会的物质生活条件的总和', '各种社会关系的总和', '生产力与生产关系的统称'], ['B'])],
    'ch4': [('single', '商品二因素是指：', ['使用价值与价值', '具体劳动与抽象劳动', '交换价值与价格', '私人劳动与社会劳动'], ['A'])],
    'ch5': [('single', '垄断资本主义阶段占统治地位的资本是：', ['工业资本', '银行资本', '金融资本', '商业资本'], ['C'])],
    'ch6': [('single', '科学社会主义诞生的标志是：', ['《共产党宣言》的发表', '第一国际的成立', '十月革命的胜利', '巴黎公社建立'], ['A'])],
    'ch7': [('single', '共产主义社会的根本特征是：', ['生产力高度发达', '各尽所能，按需分配', '实现人的自由而全面的发展', '消灭私有制'], ['C'])],
}

# Word 里常会混进不可见的私有区字符（复制粘贴的残留），直接丢掉
PUA_RE = re.compile(r'[\ue000-\uf8ff]')

# docx 原稿里的笔误，构建时兜底修正；能改 Word 原文当然更彻底
TYPO_FIXES = [
    ('意识决物质', '意识决定物质'),
]

FIXED = {}


def clean(text):
    for bad, good in TYPO_FIXES:
        if bad in text:
            FIXED[bad] = FIXED.get(bad, 0) + text.count(bad)
            text = text.replace(bad, good)
    return PUA_RE.sub('', text)

QSTART = re.compile(r'^\s*(\d{1,3})\s*[、．.]\s*(.*)$')
ANSWER = re.compile(r'^\s*答案\s*[：:]\s*(.*)$')
OPTSPLIT = re.compile(r'([A-D])\s*[、．.]\s*')


def docx_text(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    xml = xml.replace('</w:p>', '\n').replace('<w:tab/>', '\t')
    xml = re.sub(r'<[^>]+>', '', xml)
    return html.unescape(xml)


def parse_docx(path):
    lines = [l.strip() for l in docx_text(path).split('\n')]
    lines = [l for l in lines if l]
    items, cur = [], None
    for line in lines:
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


def normalize(raw):
    compact = raw.replace(' ', '').replace('\u3000', '')
    if compact in ('正确', '对', '是', 'T'):
        return 'judge', ['A']
    if compact in ('错误', '错', '否', 'F'):
        return 'judge', ['B']
    letters = sorted({c for c in compact.upper() if c in 'ABCD'})
    if not letters:
        raise ValueError('无法识别答案：%r' % raw)
    return ('multi' if len(letters) > 1 else 'single'), letters


def build_chapter(key, num, type_, stem, options, answer):
    return {'id': '%s-%d' % (key, num), 'num': num, 'type': type_,
            'stem': stem, 'options': options, 'answer': answer}


def convert(key, raw_items):
    out = []
    for item in raw_items:
        parts = OPTSPLIT.split(clean(item['body']))
        stem = parts[0].strip()
        pairs = [(parts[i], parts[i + 1].strip()) for i in range(1, len(parts), 2)]
        type_, answer = normalize(item.get('answer_raw', ''))
        if type_ == 'judge':
            out.append(build_chapter(key, item['num'], 'judge', stem, ['正确', '错误'], answer))
            continue
        letters = [p[0] for p in pairs]
        expect = [chr(65 + i) for i in range(len(letters))]
        if letters != expect:
            raise ValueError('%s 第 %d 题选项序号异常：%s（请检查 docx 排版）' % (key, item['num'], letters))
        for a in answer:
            if a not in letters:
                raise ValueError('%s 第 %d 题答案 %s 超出选项范围 %s' % (key, item['num'], answer, letters))
        out.append(build_chapter(key, item['num'], type_, stem, [p[1] for p in pairs], answer))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='把 Word 题目文档转成 data/question-bank.js',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='例：python tools/build_bank.py -i D:\\我的题库 -o data/question-bank.js')
    ap.add_argument('-i', '--input', default=DOCX_DIR, help='题目文档所在目录（默认 %s）' % DOCX_DIR)
    ap.add_argument('-o', '--output', default=OUT, help='输出的题库文件（默认 %s）' % OUT)
    ap.add_argument('--title', default=TITLE, help='题库标题（页面左上角显示）')
    ap.add_argument('--subtitle', default=SUBTITLE, help='题库副标题')
    args = ap.parse_args(argv)

    docx_dir = os.path.abspath(args.input)
    out_file = os.path.abspath(args.output)
    if not os.path.isdir(docx_dir):
        print('找不到题目目录：%s' % docx_dir, file=sys.stderr)
        print('把 Word 题目文档放进这个目录再运行；也可以用 -i 指定别的目录，例如：', file=sys.stderr)
        print('    python tools/build_bank.py -i "D:\\我的题库"', file=sys.stderr)
        return 1

    by_key = {}
    source_counts = {}
    gaps = {}
    sources = scan_sources(docx_dir)
    if not sources:
        print('%s 里没有认得出的题目文档。' % docx_dir, file=sys.stderr)
        print('文件按《绪论题目.docx》《第一章题目.docx》《第二章题目.docx》这样命名即可。', file=sys.stderr)
        return 1
    for key in [k for k, _, _ in CHAPTER_META if k in sources]:
        filename = sources[key]
        path = os.path.join(docx_dir, filename)
        items = convert(key, parse_docx(path))
        if not items:
            print('未从 %s 解析到题目，请检查文档排版' % filename, file=sys.stderr)
            return 1
        by_key[key] = items
        source_counts[key] = (filename, len(items))
        print('解析 %-16s → %-5s %3d 题' % (filename, key, len(items)))
        nums = [it['num'] for it in items]
        miss = [n for n in range(1, max(nums) + 1) if n not in nums]
        if miss:
            gaps[key] = (filename, miss)

    chapters = []
    for key, name, subtitle in CHAPTER_META:
        if key in by_key:
            questions, real = by_key[key], True
        else:
            questions = [build_chapter(key, i, t, s, o, a)
                         for i, (t, s, o, a) in enumerate(PLACEHOLDERS.get(key, []), start=1)]
            real = False
        if not questions:
            continue
        chapters.append({'key': key, 'name': name, 'subtitle': subtitle,
                         'source': real, 'questions': questions})

    total = sum(len(c['questions']) for c in chapters)

    header = [
        '/*',
        ' * %s · %s（题库数据文件）' % (args.title, args.subtitle),
        ' *',
        ' * 本文件由 tools/build_bank.py 依据 %s/*.docx 自动生成，请勿手工大改；' % os.path.basename(docx_dir),
        ' * 如需增删题目，优先改 Word 文档后重新运行脚本，或直接在下方 questions 中追加。',
        ' *',
        ' * 数据来源：',
    ]
    for key, name, _ in CHAPTER_META:
        if key in source_counts:
            f, n = source_counts[key]
            header.append(' *   %-4s —— 《%s》（%d 题）' % (name, f, n))
    header += [
        ' *',
        ' * 字段说明：',
        ' *   id      题目唯一编号',
        ' *   num     原卷题号（与 docx 一致，便于对照）',
        ' *   type    single 单选 | multi 多选 | judge 判断',
        ' *   stem    题干',
        ' *   options 选项文本数组（判断题固定为 正确 / 错误）',
        ' *   answer  正确选项字母数组，如 ["A"] / ["A","C"]',
        ' */',
    ]

    payload = {
        'meta': {'title': args.title, 'subtitle': args.subtitle,
                 'version': '1.0', 'updated': time.strftime('%Y-%m-%d'), 'total': total},
        'chapters': chapters,
    }

    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    text = '\n'.join(header) + '\nwindow.MAYUAN_QUESTION_BANK = %s;\n' % json.dumps(
        payload, ensure_ascii=False, indent=2)
    with io.open(out_file, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('已生成 %s（合计 %d 题）' % (out_file, total))
    if FIXED:
        for bad, times in FIXED.items():
            print('  · 修正原稿笔误 %d 处：%s' % (times, bad))
    for key, (filename, miss) in gaps.items():
        print('  ! %s 的题号有缺口：%s（%s 里缺这些题，核对一下）'
              % (key, '、'.join(str(n) for n in miss), filename))
    pending = [name for key, name, _ in CHAPTER_META if key not in by_key]
    if pending:
        print('  · 尚无题目、保留占位小题的章节：%s' % '、'.join(pending))
    return 0


if __name__ == '__main__':
    sys.exit(main())
