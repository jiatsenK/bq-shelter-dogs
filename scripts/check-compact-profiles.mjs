// #248：本機演練。用 repo 裡的 JSON、dogs/*.md 和 R2 清單暫存檔（.migration-private/，不提交）匯入一份
// 記憶體裡的 D1，跑兩次確認重跑一致，再印出比對報告。不連線正式 D1、R2 或試算表。
// 本機演練工具，所以借用測試的 fakeD1（真的 SQLite）。執行：node scripts/check-compact-profiles.mjs <R2清單.json>
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fakeD1 } from '../worker/test/fakes.mjs';
import { migrateCompactDatabase } from './migrate-compact-db.mjs';
import { importCompactDogs, compareCompactDogs } from './import-compact-dogs.mjs';
import { importCompactProfiles, compareCompactProfiles, readCompactProfiles } from './import-compact-profiles.mjs';
import { parseFrontmatterBody, markdownToText } from './sync-sheet.mjs';

const ROOT = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

// 狗卡：frontmatter 的 id 要跟檔名一樣才算（README、_範本 不算）；介紹跟同步寫進 dogs.json 的一樣轉成純文字
export async function readCardSources(dir = new URL('dogs/', ROOT)) {
  const intros = {}, names = {};
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.md')).sort()) {
    const number = file.slice(0, -3), raw = await readFile(new URL(file, dir), 'utf8');
    const head = raw.replace(/^﻿/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
    if ((head.match(/^id:\s*(\S+)\s*$/m) || [])[1] !== number) continue;
    intros[number] = markdownToText(parseFrontmatterBody(raw));
    const name = (head.match(/^name:\s*(.+?)\s*$/m) || [])[1];
    if (name) names[number] = name;
  }
  return { intros, names };
}

export async function readCompactSources(photosPath) {
  if (!photosPath) throw new Error('請提供 R2 清單暫存檔，不能拿缺少來源當空資料');
  const { intros, names } = await readCardSources();
  return {
    dogs: await json('data/dogs.json'),
    profiles: { walks: await json('data/walks.json'), rest: await json('data/rest.json'), intros, names, photos: JSON.parse(await readFile(photosPath, 'utf8')).objects },
  };
}

export async function checkCompactProfiles({ dogs, profiles }) {
  const db = fakeD1();
  try {
    await migrateCompactDatabase(db);
    await importCompactDogs(db, dogs);
    const first = await importCompactProfiles(db, profiles), second = await importCompactProfiles(db, profiles);
    const counts = {};
    for (const t of ['v3_dogs', 'v3_dog_numbers', 'v3_walks', 'v3_intros', 'v3_rest', 'v3_photos']) counts[t] = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n');
    const dogsReport = await compareCompactDogs(db, dogs), report = await compareCompactProfiles(db, profiles);
    // 網站現在讀的是 dogs.json 的 intro（同步從狗卡整理的），D1 讀回的介紹要跟它一樣
    const intros = (await readCompactProfiles(db)).intros;
    const siteIntros = dogs.dogs.filter(d => d.id && d.intro).map(d => ({ kind: 'site-intro', key: d.id, field: 'intro', expected: d.intro, actual: intros[d.id] ?? null })).filter(d => d.expected !== d.actual);
    return {
      sourceWalkRecords: profiles.walks.walks.length, imported: { ...second, newDogs: first.newDogs.length }, counts,
      replayIdentical: JSON.stringify({ ...first, newDogs: [] }) === JSON.stringify(second),
      foreignKeyErrors: (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      equal: dogsReport.equal && report.equal && !siteIntros.length, differences: [...dogsReport.differences, ...report.differences, ...siteIntros],
    };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkCompactProfiles(await readCompactSources(process.argv[2])), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
