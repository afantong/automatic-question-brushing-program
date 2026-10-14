/*
 * 示例题库（仓库自带）
 *
 * 只为让你 clone 下来就能直接跑起来看效果。
 * 你自己的题目不要写在这里：把 Word 放进一个目录（默认 ../题目文档/），运行 tools/build_bank.py，
 * 会生成 data/question-bank.js（那个文件已被 .gitignore 忽略，不会上传）。
 *
 * 字段说明见 docs/question-format.md
 */
window.MAYUAN_QUESTION_BANK = {
  "meta": {
    "title": "自动刷题程序",
    "subtitle": "示例题库 · 章节刷题 + 模拟考试",
    "version": "1.0",
    "updated": "2026-10-13",
    "total": 12
  },
  "chapters": [
    {
      "key": "demo1",
      "name": "示例第一章",
      "subtitle": "单选 / 多选 / 判断三种题型都在",
      "source": false,
      "questions": [
        {
          "id": "demo1-1",
          "num": 1,
          "type": "single",
          "stem": "一年通常有多少个月？",
          "options": ["10 个月", "11 个月", "12 个月", "13 个月"],
          "answer": ["C"]
        },
        {
          "id": "demo1-2",
          "num": 2,
          "type": "single",
          "stem": "水的化学式是：",
          "options": ["CO2", "H2O", "O2", "NaCl"],
          "answer": ["B"]
        },
        {
          "id": "demo1-3",
          "num": 3,
          "type": "single",
          "stem": "下列哪个是搜索引擎？",
          "options": ["Photoshop", "Chrome 浏览器", "Google", "Excel"],
          "answer": ["C"]
        },
        {
          "id": "demo1-4",
          "num": 4,
          "type": "multi",
          "stem": "下列属于水果的有：",
          "options": ["苹果", "香蕉", "胡萝卜", "葡萄"],
          "answer": ["A", "B", "D"]
        },
        {
          "id": "demo1-5",
          "num": 5,
          "type": "multi",
          "stem": "下列属于编程语言的有：",
          "options": ["Python", "Java", "Photoshop", "Go"],
          "answer": ["A", "B", "D"]
        },
        {
          "id": "demo1-6",
          "num": 6,
          "type": "judge",
          "stem": "光在真空中的传播速度约为每秒 30 万公里。",
          "options": ["正确", "错误"],
          "answer": ["A"]
        },
        {
          "id": "demo1-7",
          "num": 7,
          "type": "judge",
          "stem": "太阳是一颗行星。",
          "options": ["正确", "错误"],
          "answer": ["B"]
        }
      ]
    },
    {
      "key": "demo2",
      "name": "示例第二章",
      "subtitle": "多放几道，方便试模拟考试",
      "source": false,
      "questions": [
        {
          "id": "demo2-1",
          "num": 1,
          "type": "single",
          "stem": "HTML 是什么的缩写？",
          "options": ["超文本标记语言", "高级文本语言", "超链接语言", "主页语言"],
          "answer": ["A"]
        },
        {
          "id": "demo2-2",
          "num": 2,
          "type": "single",
          "stem": "一年四季中，第二个季节是：",
          "options": ["春", "夏", "秋", "冬"],
          "answer": ["B"]
        },
        {
          "id": "demo2-3",
          "num": 3,
          "type": "multi",
          "stem": "下列属于中国古代四大发明的有：",
          "options": ["造纸术", "印刷术", "指南针", "火药"],
          "answer": ["A", "B", "C", "D"]
        },
        {
          "id": "demo2-4",
          "num": 4,
          "type": "multi",
          "stem": "下列关于水的说法，正确的有：",
          "options": ["标准大气压下 0°C 结冰", "水是人体主要成分", "水由氢和氧组成", "水可以燃烧"],
          "answer": ["A", "B", "C"]
        },
        {
          "id": "demo2-5",
          "num": 5,
          "type": "judge",
          "stem": "中国的首都是北京。",
          "options": ["正确", "错误"],
          "answer": ["A"]
        }
      ]
    }
  ]
};
