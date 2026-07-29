#!/usr/bin/env node
// 檢查產出的 PDF：統計頁數，並找出真正的空白頁。
// 分頁規則（break-inside / break-before）設錯時最常見的症狀就是多出空白頁，
// 所以每次調完排版都值得跑一次。

import fs from 'node:fs';
import path from 'node:path';

const PDF = path.join(import.meta.dirname, '..', 'pdf');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

let total = 0;
const blanks = [];

for (const file of fs.readdirSync(PDF).filter((f) => f.endsWith('.pdf')).sort()) {
  const data = new Uint8Array(fs.readFileSync(path.join(PDF, file)));
  const doc = await pdfjs.getDocument({ data }).promise;
  total += doc.numPages;

  let empty = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = (await page.getTextContent()).items.map((x) => x.str).join('').trim();
    const ops = await page.getOperatorList();
    // 沒有文字、繪圖指令也極少（扣掉頁尾）才算真的空白頁。
    // 只有插圖的頁面文字很少但繪圖指令很多，不會被誤判。
    if (text.length < 25 && ops.fnArray.length < 30) {
      empty += 1;
      blanks.push(`${file} 第 ${i} 頁`);
    }
  }
  console.log(`${file.padEnd(28)} ${String(doc.numPages).padStart(4)} 頁   空白 ${empty}`);
}

console.log(`\n總頁數 ${total}`);
console.log(blanks.length ? `空白頁：${blanks.join('、')}` : '無空白頁');
if (blanks.length) process.exitCode = 1;
