#!/usr/bin/env node
// 繁體中文用字校正
//
// 上游 book-zhtw/ 的譯稿整體品質良好，但仍留下少量「簡繁一對多」的漏轉字。
// 這些字在繁體中同樣存在，因此不能整批轉換 —— 例如「里程碑」「新德里」的
// 「里」是對的，只有當「里」當方位助詞（…裡）時才需要改成「裡」。
//
// 下面每條規則都限定在特定詞彙／語境，避免誤傷正確的用字。

import fs from 'node:fs';
import path from 'node:path';

const RULES = [
  // 方位助詞「里」→「裡」。固有詞（里程碑、公里、新德里…）已由 KEEP 保護。
  { name: '里→裡（方位助詞）', re: /里(?=加|到|長|常|根本|的規律|，|。|、|？|！|」)/g, to: '裡' },

  // 佔用／佔比：表「占據」義時，台灣用字為「佔」。
  { name: '占用→佔用', re: /占用/g, to: '佔用' },
  { name: '占比→佔比', re: /占比/g, to: '佔比' },

  // 採用／採取／採樣：動詞「採」不可作「采」。
  { name: '采用→採用', re: /采用/g, to: '採用' },
  { name: '采取→採取', re: /采取/g, to: '採取' },
  { name: '采樣→採樣', re: /采樣/g, to: '採樣' },
  { name: '采集→採集', re: /采集/g, to: '採集' },

  // 團夥／合夥：台灣用「夥」。
  { name: '團伙→團夥', re: /團伙/g, to: '團夥' },
  { name: '合伙→合夥', re: /合伙(?!計)/g, to: '合夥' },
];

// 這些詞含目標字但用法正確，先保護起來、替換完再還原。
const KEEP = [
  '里程碑', '公里', '英里', '海里', '新德里', '阿里', '里斯本', '萬里',
  '拜占庭', '占卜',
  '上游', '下游', '游泳', '游標', '游走',
  '批准', '准則', '准許',
  '干預', '干擾', '若干', '相干', '干涉', '干係',
  '划算', '划船',
];

// 哨兵用可列印字元，原文不會出現，方便除錯。
const OPEN = '⟦';
const CLOSE = '⟧';

function fixText(text, stats) {
  const stash = [];
  let t = text;

  if (t.includes(OPEN) || t.includes(CLOSE)) throw new Error('原文已含哨兵字元，請換一組');

  // 保護正確用詞
  for (const word of KEEP) {
    if (!t.includes(word)) continue;
    t = t.split(word).join(OPEN + (stash.push(word) - 1) + CLOSE);
  }

  for (const rule of RULES) {
    t = t.replace(rule.re, () => {
      stats[rule.name] = (stats[rule.name] || 0) + 1;
      return rule.to;
    });
  }

  // 還原被保護的詞
  t = t.replace(new RegExp(OPEN + '(\\d+)' + CLOSE, 'g'), (_, i) => stash[Number(i)]);

  if (t.includes(OPEN) || t.includes(CLOSE)) throw new Error('哨兵字元未完全還原');
  return t;
}

const srcDir = process.argv[2] || path.join(import.meta.dirname, '..', 'src');
const stats = {};
let changedFiles = 0;

// 導讀本身會引用「占用→佔用」這類修正前後的字樣，不能再套規則。
const SKIP = new Set(['guide.zhtw.md']);

for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.md') && !SKIP.has(f)).sort()) {
  const full = path.join(srcDir, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = fixText(before, stats);
  if (after !== before) {
    fs.writeFileSync(full, after);
    changedFiles += 1;
    console.log(`   已修正 ${file}`);
  }
}

console.log(`\n共修改 ${changedFiles} 個檔案：`);
for (const [name, n] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}　${n} 處`);
}
if (!Object.keys(stats).length) console.log('  （無需修正）');
