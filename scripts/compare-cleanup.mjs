// #252 唯讀比對：來源是明確指定的 Git 提交與 D1 SELECT 快照，不依賴工作區 data/、dogs/。
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseFrontmatterSex, parseFrontmatterFormerIds, parseFrontmatterBody, markdownToText } from './sync-sheet.mjs';
import { readDepartures } from '../worker/src/compact.js';

export const TABLES = ['v3_dogs', 'v3_dog_numbers', 'v3_sheet_main', 'v3_sheet_former_numbers', 'v3_intros', 'v3_rest', 'v3_walks', 'v3_departures', 'v3_departure_items'];

export function readGitSource(ref) {
  if (!ref) throw new Error('請指定刪除前 Git 提交');
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  const show = path => execFileSync('git', ['show', `${sha}:${path}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', sha, 'dogs'], { encoding: 'utf8' }).trim().split('\n');
  const cards = files.filter(p => /^dogs\/\d[0-9A-Za-z]*\.md$/.test(p)).map(path => {
    const raw = show(path);
    return { id: path.slice(5, -3), sex: parseFrontmatterSex(raw), formerIds: parseFrontmatterFormerIds(raw), intro: markdownToText(parseFrontmatterBody(raw)) };
  });
  return { ref: sha, cards, dogs: JSON.parse(show('data/dogs.json')), rest: JSON.parse(show('data/rest.json')), walks: JSON.parse(show('data/walks.json')), departures: JSON.parse(show('data/departures.json')).departures };
}

// 只提供 SELECT 給既有讀回介面；快照必須完整，不把缺表當空資料。
export function snapshotDb(raw) {
  if (!Array.isArray(raw) || raw.length !== TABLES.length || raw.some(r => r.success !== true || !Array.isArray(r.results) || r.meta?.rows_written > 0 || (typeof r.meta?.rows_read === 'number' && r.meta.rows_read !== r.results.length))) throw new Error('D1 快照缺表、截斷或查詢失敗');
  const tables = Object.fromEntries(TABLES.map((t, i) => [t, raw[i].results]));
  return {
    prepare(sql) {
      const table = sql.match(/^SELECT \* FROM (v3_\w+)$/)?.[1];
      const departures = sql.startsWith('SELECT number, kind, value FROM v3_departure_items');
      if (!table && !departures) throw new Error(`非預期唯讀查詢：${sql}`);
      return { all: async () => ({ results: departures ? [...tables.v3_departure_items].sort((a,b) => a.number.localeCompare(b.number) || a.kind.localeCompare(b.kind) || a.position-b.position) : tables[table] }) };
    },
    batch(statements) { return Promise.all(statements.map(s => s.all())); },
  };
}

export async function compareCleanup(db, source) {
  const rows = async t => (await db.prepare(`SELECT * FROM ${t}`).all()).results;
  const [dogs, numbers, main, intros, rest, walks, departures, former] = await Promise.all([
    rows('v3_dogs'), rows('v3_dog_numbers'), rows('v3_sheet_main'), rows('v3_intros'), rows('v3_rest'), rows('v3_walks'), readDepartures(db), rows('v3_sheet_former_numbers'),
  ]);
  const differences = [], checked = {};
  const compare = (kind, key, expected, actual, field) => {
    checked[kind] = (checked[kind] || 0) + 1;
    if (!isDeepStrictEqual(expected, actual)) differences.push({ kind, key, ...(field ? { field } : {}), expected, actual });
  };
  const byNumber = new Map(numbers.map(n => [n.number, n.dog_id]));
  const dogId = dog => {
    if (dog.id) return byNumber.get(dog.id);
    const ids = new Set([...main.filter(r => !r.number && r.name === dog.name).map(r=>r.dog_id), ...walks.filter(r => !r.dog_number && r.dog_name === dog.name).map(r=>r.dog_id)]);
    return ids.size === 1 ? [...ids][0] : undefined;
  };
  const sourceDogs = new Map(source.cards.map(c => [c.id, c]));
  for (const d of source.dogs.dogs) sourceDogs.set(d.id || `名:${d.name}`, { ...sourceDogs.get(d.id), ...d });
  const links = new Map();
  for (const d of [...source.cards, ...source.dogs.dogs]) for (const old of d.formerIds || []) {
    if (!d.id) continue;
    if (!links.has(d.id)) links.set(d.id,new Set());
    if (!links.has(old)) links.set(old,new Set());
    links.get(d.id).add(old); links.get(old).add(d.id);
  }
  const related = number => {
    const seen = new Set([number]), pending = [number];
    while (pending.length) for (const n of links.get(pending.pop()) || []) if (!seen.has(n)) { seen.add(n); pending.push(n); }
    return [...seen].filter(n=>n!==number).sort();
  };
  for (const d of sourceDogs.values()) {
    const id = dogId(d), key = d.id || `名:${d.name}`;
    compare('sex', key, d.sex || '', dogs.find(r => r.dog_id === id)?.sex ?? null);
    const expected = d.id ? related(d.id) : [];
    compare('formerIds', key, expected, id && d.id ? numbers.filter(n => n.dog_id === id && n.number !== d.id).map(n=>n.number).sort() : []);
    compare('intro', key, d.intro || '', id ? intros.find(r => r.dog_id === id)?.intro || '' : null);
    const projection = main.find(r => d.id ? r.number === d.id : !r.number && r.name === d.name);
    if (projection || source.dogs.dogs.some(current => d.id ? current.id === d.id : !current.id && current.name === d.name)) {
      if (projection) {
        compare('formerIds',key,id || null,projection.dog_id,'mainIdentity');
        compare('intro',key,d.intro || '',intros.find(r=>r.dog_id===projection.dog_id)?.intro || '','main');
      }
      compare('sex',key,d.sex || '',projection?.sex ?? null,'main');
      compare('formerIds',key,[...(d.formerIds || [])].sort(),projection ? former.filter(r=>r.row_index === projection.row_index).map(r=>r.number).sort() : null,'main');
    }
  }
  const knownIds = new Set([
    ...[...sourceDogs.values(), ...source.walks.walks, ...source.departures].map(dogId),
    ...Object.keys(source.rest).map(n=>byNumber.get(n)),
    ...[...sourceDogs.values()].flatMap(d=>(d.formerIds || []).map(n=>byNumber.get(n))),
  ].filter(Boolean));
  const profileIds = new Set([...sourceDogs.values()].map(dogId).filter(Boolean));
  const keyOf = id => main.find(r=>r.dog_id===id)?.number || numbers.find(n=>n.dog_id===id)?.number || '名:' + (dogs.find(d=>d.dog_id===id)?.name || id);
  for (const dog of dogs) if (!knownIds.has(dog.dog_id)) compare('sex',keyOf(dog.dog_id),null,dog.sex,'extraDog');
  for (const intro of intros) if (!profileIds.has(intro.dog_id)) compare('intro',keyOf(intro.dog_id),null,intro.intro,'extraDog');
  const restById = new Map(Object.entries(source.rest).map(([number, r]) => [byNumber.get(number) || `missing:${number}`, { number, until: r.until, reason: r.reason || '' }]));
  for (const [id, value] of restById) compare('rest', value.number, { until: value.until, reason: value.reason }, rest.find(r => r.dog_id === id) ? { until: rest.find(r => r.dog_id === id).until_date, reason: rest.find(r => r.dog_id === id).reason } : null);
  for (const r of rest) if (!restById.has(r.dog_id)) compare('rest', numbers.find(n => n.dog_id === r.dog_id)?.number || r.dog_id, null, { until: r.until_date, reason: r.reason });
  const expectedDays = new Map();
  for (const w of source.walks.walks) {
    const id = dogId(w) || `missing:${w.id || w.name}`, key = `${id}|${w.date}`;
    const prev = expectedDays.get(key);
    if (!prev || Array.isArray(w.walkers) || !prev.walkers) expectedDays.set(key, { id: w.id || '', name: w.name, date: w.date, ...(Array.isArray(w.walkers) ? { walkers: w.walkers } : {}) });
  }
  const expectedByDog = new Map(), actualByDog = new Map();
  const add = (map,id,w) => { if (!map.has(id)) map.set(id,[]); map.get(id).push(w); };
  for (const [key,w] of expectedDays) add(expectedByDog,key.slice(0,key.lastIndexOf('|')),w);
  const actualDays = new Map();
  for (const r of [...walks].sort((a,b)=>a.ordinal-b.ordinal)) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!actualDays.has(key)) actualDays.set(key,{ id:r.dog_number,name:r.dog_name,date:r.walk_date });
    if (r.walker_code !== null) (actualDays.get(key).walkers ||= []).push(r.walker_code);
  }
  for (const [key,w] of actualDays) add(actualByDog,key.slice(0,key.lastIndexOf('|')),w);
  const sorted = list => (list || []).map(w => ({ ...w, ...(w.walkers ? { walkers:[...w.walkers].sort() } : {}) })).sort((a,b)=>a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const id of new Set([...expectedByDog.keys(),...actualByDog.keys()])) compare('walks', numbers.find(n=>n.dog_id===id)?.number || id, sorted(expectedByDog.get(id)), sorted(actualByDog.get(id)));
  const expectedDeps = new Map(source.departures.map(d=>[d.id,d])), actualDeps = new Map(departures.map(d=>[d.id,d]));
  for (const id of new Set([...expectedDeps.keys(),...actualDeps.keys()])) compare('departures',id,expectedDeps.get(id) || null,actualDeps.get(id) || null);
  return { sourceRef: source.ref || null, checked, equal: !differences.length, differences };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [ref, snapshot] = process.argv.slice(2);
    if (!snapshot) throw new Error('用法：node scripts/compare-cleanup.mjs <刪除前提交> <完整D1唯讀快照.json>');
    const report = await compareCleanup(snapshotDb(JSON.parse(await readFile(snapshot,'utf8'))), readGitSource(ref));
    console.log(JSON.stringify(report,null,2));
    if (!report.equal) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
