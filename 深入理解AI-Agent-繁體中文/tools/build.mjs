#!/usr/bin/env node
// 由 src/*.md 產生「大字寬鬆版」HTML 與 A4 PDF。
//
// 排版目標：解決原版 PDF「單頁塞太多、字太小」的問題 ——
//   · 正文 14pt、行高 1.9，每行約 35 個中文字，每頁約 27 行
//   · 標題不落單（break-after: avoid）、表格列不跨頁、圖片整塊不切開
//   · 每章獨立成檔，章首另起新頁並附本章目錄
//   · 頁尾有「章名 · 頁碼」

import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import { chromium } from 'playwright';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const HTML_DIR = path.join(ROOT, 'html');
const PDF_DIR = path.join(ROOT, 'pdf');

const BOOK_TITLE = '深入理解 AI Agent：設計原理與工程實踐';

// 檔案 → 顯示標題。chapterNo 有值的才做 x.y 小節編號。
const CHAPTERS = [
  { file: 'guide.zhtw.md', out: '00-導讀', label: '導讀' },
  { file: 'introduction.zhtw.md', out: '01-引言', label: '引言' },
  { file: 'chapter1.zhtw.md', out: '02-第一章', label: '第一章', chapterNo: 1 },
  { file: 'chapter2.zhtw.md', out: '03-第二章', label: '第二章', chapterNo: 2 },
  { file: 'chapter3.zhtw.md', out: '04-第三章', label: '第三章', chapterNo: 3 },
  { file: 'chapter4.zhtw.md', out: '05-第四章', label: '第四章', chapterNo: 4 },
  { file: 'chapter5.zhtw.md', out: '06-第五章', label: '第五章', chapterNo: 5 },
  { file: 'chapter6.zhtw.md', out: '07-第六章', label: '第六章', chapterNo: 6 },
  { file: 'chapter7.zhtw.md', out: '08-第七章', label: '第七章', chapterNo: 7 },
  { file: 'chapter8.zhtw.md', out: '09-第八章', label: '第八章', chapterNo: 8 },
  { file: 'chapter9.zhtw.md', out: '10-第九章', label: '第九章', chapterNo: 9 },
  { file: 'chapter10.zhtw.md', out: '11-第十章', label: '第十章', chapterNo: 10 },
  { file: 'afterword.zhtw.md', out: '12-後記', label: '後記' },
  { file: 'reference-answers.zhtw.md', out: '13-習題參考答案', label: '習題參考答案' },
];

const CSS = `
@page {
  size: A4;
  margin: 20mm 18mm 18mm 18mm;
}

* { box-sizing: border-box; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  font-family: "Noto Serif CJK TC", "Noto Sans CJK TC", "WenQuanYi Zen Hei", serif;
  /* 正文放大到 14pt —— 原版約 10.5pt，這是「字太小」的主因 */
  font-size: 14pt;
  line-height: 1.9;
  letter-spacing: 0.02em;
  color: #1b1b1b;
  margin: 0;
  /* 刻意不用 justify：本書中英夾雜，長英文詞無法斷行時
     justify 會把中文字距拉得很開（「所 有 事 情 的 集 合」），反而更難讀 */
  text-align: left;
}

p { margin: 0 0 0.95em 0; orphans: 3; widows: 3; }

/* ---------- 標題 ---------- */
h1, h2, h3, h4, h5 {
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  line-height: 1.45;
  break-after: avoid-page;
  page-break-after: avoid;
  text-align: left;
  letter-spacing: 0.01em;
}

h1 {
  font-size: 27pt;
  color: #14496e;
  margin: 0 0 6mm 0;
  padding-bottom: 4mm;
  border-bottom: 2.5pt solid #14496e;
}
h2 {
  font-size: 19pt;
  color: #14496e;
  margin: 11mm 0 4mm 0;
  padding-left: 4mm;
  border-left: 5pt solid #2b7cb0;
}
h3 { font-size: 16pt; color: #21506e; margin: 8mm 0 3mm 0; }
h4 { font-size: 14.5pt; color: #2c4a5e; margin: 6mm 0 2.5mm 0; }
h5 { font-size: 14pt; color: #3b3b3b; margin: 5mm 0 2mm 0; }

/* ---------- 章首目錄 ---------- */
.chapter-toc {
  background: #f4f7fa;
  border: 0.8pt solid #c9d8e4;
  border-radius: 3mm;
  padding: 5mm 7mm;
  margin: 0 0 9mm 0;
  font-size: 12pt;
  line-height: 1.75;
  break-inside: avoid-page;
  break-after: page;
}
.chapter-toc-title {
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  font-weight: bold;
  font-size: 13.5pt;
  color: #14496e;
  margin-bottom: 3mm;
}
.chapter-toc ol { margin: 0; padding-left: 6mm; }
.chapter-toc ol ol { padding-left: 5mm; font-size: 11.5pt; color: #45596a; }
.chapter-toc li { margin: 0.6mm 0; }

/* ---------- 清單 ---------- */
ul, ol { margin: 0 0 0.95em 0; padding-left: 7.5mm; }
li { margin: 0.9mm 0; }
li > p { margin-bottom: 0.4em; }

/* ---------- 引用 ---------- */
blockquote {
  margin: 5mm 0;
  padding: 3.5mm 6mm;
  background: #f6f8f4;
  border-left: 4.5pt solid #6d9e5e;
  color: #2c3a26;
  font-size: 13pt;
  break-inside: avoid-page;
}
blockquote p:last-child { margin-bottom: 0; }

/* ---------- 表格 ---------- */
.table-wrap { margin: 5mm 0; }
table {
  width: 100%;
  border-collapse: collapse;
  /* 表格比正文稍小，但仍維持 11.5pt 可讀下限 */
  font-size: 11.5pt;
  line-height: 1.65;
}
th, td {
  border: 0.7pt solid #b8c6d1;
  padding: 2.2mm 3mm;
  vertical-align: top;
  text-align: left;
}
th {
  background: #e7eef4;
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  font-weight: bold;
  color: #14496e;
}
tr { break-inside: avoid-page; page-break-inside: avoid; }
thead { display: table-header-group; }
tbody tr:nth-child(even) { background: #fafcfd; }

/* ---------- 程式碼 ---------- */
code {
  font-family: "WenQuanYi Zen Hei Mono", "DejaVu Sans Mono", monospace;
  font-size: 0.87em;
  background: #f0f2f4;
  padding: 0.3mm 1.2mm;
  border-radius: 1mm;
}
pre {
  background: #f7f8fa;
  border: 0.7pt solid #d3dae0;
  border-radius: 2mm;
  padding: 3.5mm 4.5mm;
  margin: 5mm 0;
  font-size: 10.5pt;
  line-height: 1.6;
  /* 長行折行，避免右側被裁掉 */
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
pre code { background: none; padding: 0; font-size: 1em; }
/* 短程式碼區塊不切頁；超過 25 行的允許跨頁，否則會擠出空白頁 */
pre.keep-together { break-inside: avoid-page; page-break-inside: avoid; }

/* ---------- 圖 ---------- */
figure {
  margin: 7mm 0;
  text-align: center;
  break-inside: avoid-page;
  page-break-inside: avoid;
}
figure img {
  max-width: 100%;
  /* 留住頁面高度，圖片不會獨佔整頁又切一半 */
  max-height: 185mm;
  height: auto;
}
figcaption {
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  font-size: 11.5pt;
  color: #4a5a67;
  margin-top: 2.5mm;
  line-height: 1.6;
  text-align: center;
}

hr { border: none; border-top: 0.8pt solid #ccd6de; margin: 8mm 0; }

a { color: #14496e; text-decoration: none; word-break: break-all; }

/* Noto Sans CJK TC 有真正的 Bold 字面，靠字重就足以強調，
   顏色只再壓深一點，不另外換色，避免整頁到處都是藍字 */
strong {
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  font-weight: 700;
  color: #10283a;
}

/* ---------- 註腳 ---------- */
.footnotes {
  margin-top: 12mm;
  padding-top: 5mm;
  border-top: 1pt solid #ccd6de;
  font-size: 11.5pt;
  line-height: 1.7;
  color: #3d4a55;
  break-before: page;
}
.footnotes::before {
  content: "註釋";
  display: block;
  font-family: "Noto Sans CJK TC", "WenQuanYi Zen Hei", sans-serif;
  font-size: 15pt;
  font-weight: 700;
  color: #14496e;
  margin-bottom: 4mm;
}
.footnotes hr { display: none; }
.footnotes ol { padding-left: 8mm; }
.footnotes li { margin: 2mm 0; break-inside: avoid-page; }
.footnote-ref a {
  font-size: 0.75em;
  vertical-align: super;
  color: #2b7cb0;
  font-weight: 700;
  text-decoration: none;
}
.footnote-backref { display: none; }

/* ---------- 封面 ---------- */
.cover { break-after: page; text-align: center; padding-top: 55mm; }
.cover .book { font-size: 30pt; font-weight: bold; color: #14496e; line-height: 1.5; }
.cover .part { font-size: 21pt; color: #2b7cb0; margin-top: 14mm; }
.cover .meta { font-size: 12.5pt; color: #5b6b78; margin-top: 22mm; line-height: 2; }
`;

// ---------------------------------------------------------------- markdown

// 全書共 191 處註腳引用，必須啟用 footnote 外掛，否則會印出 [^xxx] 原始標記
const md = new MarkdownIt({ html: true, linkify: false, breaks: false }).use(footnotePlugin);

// 圖片改成 <figure> + <figcaption>（alt 文字就是圖說）
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const caption = token.content || '';
  const src = token.attrGet('src') || '';
  // html/ 與 images/ 同層，需往上一層取圖
  if (src.startsWith('images/')) token.attrSet('src', '../' + src);
  token.attrSet('alt', caption);
  const img = self.renderToken(tokens, idx, options);
  return `<figure>${img}${caption ? `<figcaption>${md.utils.escapeHtml(caption)}</figcaption>` : ''}</figure>`;
};

// 表格外包一層，方便控制邊界
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => '</table></div>';

// 超過 25 行的程式碼區塊允許跨頁
const defaultFence = md.renderer.rules.fence.bind(md.renderer);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const html = defaultFence(tokens, idx, options, env, self);
  const lines = tokens[idx].content.split('\n').length;
  return lines <= 25 ? html.replace('<pre>', '<pre class="keep-together">') : html;
};

const slug = (s, seen) => {
  let base = s.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'sec';
  let id = base, n = 2;
  while (seen.has(id)) id = `${base}-${n++}`;
  seen.add(id);
  return id;
};

/** 加上 heading id、章節編號，並收集目錄 */
function annotate(tokens, chapterNo) {
  const seen = new Set();
  const toc = [];
  let h2 = 0, h3 = 0;

  tokens.forEach((tok, i) => {
    if (tok.type !== 'heading_open') return;
    const inline = tokens[i + 1];

    let prefix = '';
    if (chapterNo) {
      if (tok.tag === 'h2') { h2 += 1; h3 = 0; prefix = `${chapterNo}.${h2}　`; }
      else if (tok.tag === 'h3' && h2) { h3 += 1; prefix = `${chapterNo}.${h2}.${h3}　`; }
    }
    if (prefix) {
      // 在 inline 子節點最前面插一個純文字 token，保留原有的粗體／行內碼等結構
      const Token = inline.constructor;
      const numberToken = new Token('text', '', 0);
      numberToken.content = prefix;
      inline.children.unshift(numberToken);
      inline.content = prefix + inline.content;
    }
    const text = inline.content;

    const id = slug(text, seen);
    tok.attrSet('id', id);
    if (tok.tag === 'h2' || tok.tag === 'h3') toc.push({ level: tok.tag, text, id });
  });

  return toc;
}

function tocHtml(toc) {
  if (toc.length < 3) return '';
  let out = '<div class="chapter-toc"><div class="chapter-toc-title">本章目錄</div><ol>';
  let inSub = false;
  for (const item of toc) {
    if (item.level === 'h2') {
      if (inSub) { out += '</ol>'; inSub = false; }
      out += `<li>${md.utils.escapeHtml(item.text)}`;
    } else {
      if (!inSub) { out += '<ol>'; inSub = true; }
      out += `<li>${md.utils.escapeHtml(item.text)}</li>`;
    }
  }
  if (inSub) out += '</ol>';
  out += '</li></ol></div>';
  return out;
}

function page({ title, cover, body }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${md.utils.escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
${cover}
${body}
</body>
</html>`;
}

// ---------------------------------------------------------------- build

fs.mkdirSync(HTML_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

const built = [];

for (const ch of CHAPTERS) {
  const full = path.join(SRC, ch.file);
  if (!fs.existsSync(full)) { console.warn(`跳過（找不到）：${ch.file}`); continue; }

  const source = fs.readFileSync(full, 'utf8');
  const tokens = md.parse(source, {});
  const toc = annotate(tokens, ch.chapterNo);

  // 取出 h1 當章名，並從正文移除（改由封面呈現）
  let heading = ch.label;
  const h1 = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  if (h1 !== -1) {
    heading = tokens[h1 + 1].content;
    tokens.splice(h1, 3);
  }

  const cover = `<div class="cover">
  <div class="book">${md.utils.escapeHtml(BOOK_TITLE)}</div>
  <div class="part">${md.utils.escapeHtml(ch.label)}　${md.utils.escapeHtml(heading)}</div>
  <div class="meta">李博杰 著　·　繁體中文版<br>大字寬鬆排版　正文 14pt／行高 1.9</div>
</div>`;

  const html = page({
    title: `${ch.label}　${heading}`,
    cover,
    body: tocHtml(toc) + md.renderer.render(tokens, md.options, {}),
  });

  const htmlPath = path.join(HTML_DIR, `${ch.out}.html`);
  fs.writeFileSync(htmlPath, html);
  built.push({ ...ch, heading, htmlPath, pdfPath: path.join(PDF_DIR, `${ch.out}.pdf`), toc });
  console.log(`HTML  ${ch.out}.html  （${toc.length} 個小節）`);
}

// ---------------------------------------------------------------- PDF

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext();

for (const b of built) {
  const p = await ctx.newPage();
  await p.goto('file://' + b.htmlPath, { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({
    path: b.pdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-size:8.5pt;color:#7a8794;
        font-family:'WenQuanYi Zen Hei',sans-serif;padding:0 18mm;
        display:flex;justify-content:space-between;">
        <span>${b.label}　${b.heading.replace(/[<>&]/g, '')}</span>
        <span class="pageNumber"></span></div>`,
    margin: { top: '20mm', bottom: '18mm', left: '18mm', right: '18mm' },
  });
  await p.close();
  const kb = Math.round(fs.statSync(b.pdfPath).size / 1024);
  console.log(`PDF   ${path.basename(b.pdfPath)}  ${kb} KB`);
}

await browser.close();
console.log(`\n完成：${built.length} 章，輸出於 html/ 與 pdf/`);
