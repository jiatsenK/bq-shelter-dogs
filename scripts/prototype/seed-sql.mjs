// #301 原型：用正式網站公開的 /api 資料（dogs.json、walks.json、departures.json）產生預覽 D1 的初始 SQL（建表＋資料）。
// 跑法：node scripts/prototype/seed-sql.mjs <資料夾> > seed.sql
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildSyncSql } from '../sync-compact-d1.mjs';

const dir = pathToFileURL(`${process.argv[2].replace(/[\/]?$/, '/')}`);
const json = async p => JSON.parse(await readFile(new URL(p, dir), 'utf8'));
const dogs = await json('dogs.json');
dogs.dogs = dogs.dogs.map(({ intro, ...d }) => ({ ...d, intro: '' }));
const { ok, photoVersions, groupColumns: cols, ...payload } = dogs;
process.stdout.write(await buildSyncSql({}, {
  dogs: payload, walks: await json('walks.json'), departures: (await json('departures.json')).departures,
  groupColumns: cols.map(c => c.names), groupLabels: cols.map(c => c.label),
}));
