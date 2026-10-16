// 丟棄式原型（prototype/d1-monthly-packs，#320）：溜狗歷史按月分段，量 D1 讀取列數（meta.rows_read）。
// 只用本機 D1（wrangler getPlatformProxy／miniflare，跟正式 D1 同一套 SQLite 計數），不部署、不連正式資料庫。
// 執行：node scripts/prototype/d1-monthly/measure.cjs <wrangler 安裝目錄> [年數=3]
const path = require('node:path');
const { createRequire } = require('node:module');
const { getPlatformProxy } = createRequire(path.resolve(process.argv[2]) + path.sep)('wrangler');
const YEARS = Number(process.argv[3] || 3);
const PER_DAY = 110; // 正式一天約 110 筆（研究筆記）
const DOGS = 150;
const CHUNK = 1_000_000;
const TODAY = '2026-10-16';

const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => ymd(Date.parse(d + 'T00:00:00Z') + n * 864e5);
const nextMonth = m => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const bytes = s => Buffer.byteLength(s, 'utf8');

// 計數：每個 statement 的 rows_read／rows_written
function meter(db) {
  const log = { read: 0, written: 0 };
  const wrap = stmt => ({
    _raw: stmt,
    bind: (...a) => wrap(stmt.bind(...a)),
    async all() { const r = await stmt.all(); log.read += r.meta.rows_read; log.written += r.meta.rows_written; return r; },
    async first() { return ((await this.all()).results || [])[0] ?? null; },
    async run() { const r = await stmt.run(); log.read += r.meta.rows_read; log.written += r.meta.rows_written; return r; },
  });
  return {
    log, prepare: sql => wrap(db.prepare(sql)),
    async batch(stmts) { const res = await db.batch(stmts.map(s => s._raw)); for (const r of res) { log.read += r.meta.rows_read; log.written += r.meta.rows_written; } return res; },
    reset() { const out = { ...log }; log.read = 0; log.written = 0; return out; },
  };
}

// 跟 worker/src/packs.js 一樣的排序與分組
const WALK_COLS = 'dog_id,walk_date,walker_code,dog_number,dog_name,position';
function groupWalks(rows) {
  rows.sort((a, b) => a.walk_date < b.walk_date ? -1 : a.walk_date > b.walk_date ? 1 : a.dog_number < b.dog_number ? -1 : a.dog_number > b.dog_number ? 1 : a.dog_name < b.dog_name ? -1 : a.dog_name > b.dog_name ? 1 : a.position - b.position);
  const days = new Map();
  for (const r of rows) {
    const key = `${r.dog_id}|${r.walk_date}`;
    if (!days.has(key)) days.set(key, { id: r.dog_number, name: r.dog_name, date: r.walk_date });
    if (r.walker_code !== null) (days.get(key).walkers ||= []).push(r.walker_code);
  }
  return [...days.values()];
}
function chunks(text) { const out = []; let s = text; while (bytes(s) > CHUNK) { let n = CHUNK; while (bytes(s.slice(0, n)) > CHUNK) n = Math.floor(n * 0.9); out.push(s.slice(0, n)); s = s.slice(n); } out.push(s); return out; }

// ---- 按月分段 ----
const MONTHLY_SETUP = [
  'CREATE TABLE pm_ver (id INTEGER PRIMARY KEY CHECK(id=1), total INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, cutoff TEXT NOT NULL DEFAULT \'\')',
  'INSERT INTO pm_ver(id) VALUES(1)',
  'CREATE TABLE pm_month (month TEXT PRIMARY KEY, ver INTEGER NOT NULL)',
  'CREATE TABLE pm_pack (month TEXT NOT NULL, seq INTEGER NOT NULL, ver INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(month,seq))',
  // 切點以前的列：總版本號＋那個月的版本號；以後的列：live
  ...['INSERT', 'DELETE', 'UPDATE'].map(op => {
    const rows = op === 'INSERT' ? ['NEW'] : op === 'DELETE' ? ['OLD'] : ['OLD', 'NEW'];
    const body = rows.map(r => `UPDATE pm_ver SET total=total+(${r}.walk_date<cutoff), live=live+(${r}.walk_date>=cutoff) WHERE id=1; INSERT INTO pm_month(month,ver) SELECT substr(${r}.walk_date,1,7),1 FROM pm_ver WHERE id=1 AND ${r}.walk_date<cutoff ON CONFLICT(month) DO UPDATE SET ver=ver+1;`).join(' ');
    return `CREATE TRIGGER pm_walks_${op} AFTER ${op} ON v3_walks BEGIN ${body} END`;
  }),
];

async function savePack(db, month, ver, list) {
  await db.batch([db.prepare('DELETE FROM pm_pack WHERE month=?').bind(month), ...chunks(JSON.stringify(list)).map((t, i) => db.prepare('INSERT INTO pm_pack VALUES(?,?,?,?)').bind(month, i, ver, t))]);
}
async function buildMonth(db, month, cutoff) {
  const end = nextMonth(month) + '-01';
  return groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=? AND walk_date<?`).bind(month + '-01', end < cutoff ? end : cutoff).all()).results);
}

// mem：這台機器的記憶體 { total, live, cutoff, months: Map(month → { ver, list }), liveList }
async function fresh(db, today, mem) {
  let v = await db.prepare('SELECT total,live,cutoff FROM pm_ver WHERE id=1').first();
  if (v.cutoff < today) {
    // 跨日：只把舊切點到今天之間（正常是昨天）的列補進那幾個月
    const add = v.cutoff ? (await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=? AND walk_date<?`).bind(v.cutoff, today).all()).results : null;
    await db.prepare('UPDATE pm_ver SET cutoff=? WHERE id=1 AND cutoff=?').bind(today, v.cutoff).run();
    if (add) {
      const byMonth = new Map();
      for (const r of add) { const m = r.walk_date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(r); }
      for (const [m, rows] of byMonth) {
        const cur = await loadMonth(db, m, mem);
        const ver = ((await db.prepare('SELECT ver FROM pm_month WHERE month=?').bind(m).first()) || { ver: 0 }).ver + 1;
        const list = [...(cur ? cur.list : []), ...groupWalks(rows)];
        await db.batch([db.prepare('INSERT INTO pm_month(month,ver) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET ver=excluded.ver').bind(m, ver), db.prepare('UPDATE pm_ver SET total=total+1 WHERE id=1')]);
        await savePack(db, m, ver, list);
        mem.months.set(m, { ver, list });
      }
    } else {
      // 第一次：全部月份從頭算
      const months = (await db.prepare('SELECT DISTINCT substr(walk_date,1,7) AS m FROM v3_walks WHERE walk_date<?').bind(today).all()).results.map(r => r.m);
      for (const m of months) {
        const list = await buildMonth(db, m, today);
        await db.prepare('INSERT INTO pm_month(month,ver) VALUES(?,1) ON CONFLICT(month) DO UPDATE SET ver=ver+1').bind(m).run();
        const ver = (await db.prepare('SELECT ver FROM pm_month WHERE month=?').bind(m).first()).ver;
        await savePack(db, m, ver, list);
        mem.months.set(m, { ver, list });
      }
      await db.prepare('UPDATE pm_ver SET total=total+1 WHERE id=1').run();
    }
    v = await db.prepare('SELECT total,live,cutoff FROM pm_ver WHERE id=1').first();
    mem.live = null;
  }
  if (mem.total !== v.total) {
    for (const { month, ver } of (await db.prepare('SELECT month,ver FROM pm_month').all()).results) {
      if (mem.months.get(month)?.ver === ver) continue;
      const pack = await db.prepare('SELECT seq,ver,body FROM pm_pack WHERE month=?').bind(month).all();
      const ok = pack.results.length && pack.results.every(r => r.ver === ver);
      const list = ok ? JSON.parse(pack.results.sort((a, b) => a.seq - b.seq).map(r => r.body).join('')) : await buildMonth(db, month, v.cutoff);
      if (!ok) await savePack(db, month, ver, list);
      mem.months.set(month, { ver, list });
    }
    mem.total = v.total;
  }
  if (mem.live !== v.live) {
    mem.liveList = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=?`).bind(v.cutoff).all()).results);
    mem.live = v.live;
  }
  return [...[...mem.months.keys()].sort().flatMap(m => mem.months.get(m).list), ...mem.liveList];
}
async function loadMonth(db, m, mem) {
  if (mem.months.has(m)) return mem.months.get(m);
  const pack = (await db.prepare('SELECT seq,body FROM pm_pack WHERE month=?').bind(m).all()).results;
  return pack.length ? { list: JSON.parse(pack.sort((a, b) => a.seq - b.seq).map(r => r.body).join('')) } : null;
}
const newMem = () => ({ total: null, live: null, months: new Map(), liveList: [] });


// ---- 做法 B：按月失效、按年存成少數大列 ----
// D1 照掃過的列數計費、跟一列多大無關：每月版本號放在版本號那一列的 JSON 裡，資料包一年存成幾個 1 MB 的大列
const mkey = r => `'$."'||substr(${r}.walk_date,1,7)||'"'`;
const B_SETUP = [
  "CREATE TABLE pb_ver (id INTEGER PRIMARY KEY CHECK(id=1), total INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, cutoff TEXT NOT NULL DEFAULT '', months TEXT NOT NULL DEFAULT '{}')",
  'INSERT INTO pb_ver(id) VALUES(1)',
  // vers：這一年的資料包是用哪些月份版本號算的（每段都存一份）
  'CREATE TABLE pb_pack (year TEXT NOT NULL, seq INTEGER NOT NULL, vers TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(year,seq))',
  ...['INSERT', 'DELETE', 'UPDATE'].map(op => {
    const rows = op === 'INSERT' ? ['NEW'] : op === 'DELETE' ? ['OLD'] : ['OLD', 'NEW'];
    const body = rows.map(r => `UPDATE pb_ver SET total=total+(${r}.walk_date<cutoff), live=live+(${r}.walk_date>=cutoff), months=CASE WHEN ${r}.walk_date<cutoff THEN json_set(months,${mkey(r)},COALESCE(json_extract(months,${mkey(r)}),0)+1) ELSE months END WHERE id=1;`).join(' ');
    return `CREATE TRIGGER pb_walks_${op} AFTER ${op} ON v3_walks BEGIN ${body} END`;
  }),
];
const yearOf = m => m.slice(0, 4);
async function saveYear(db, year, vers, monthsObj) {
  await db.batch([db.prepare('DELETE FROM pb_pack WHERE year=?').bind(year), ...chunks(JSON.stringify(monthsObj)).map((t, i) => db.prepare('INSERT INTO pb_pack VALUES(?,?,?,?)').bind(year, i, JSON.stringify(vers), t))]);
}
async function loadYear(db, year) {
  const rows = (await db.prepare('SELECT seq,vers,body FROM pb_pack WHERE year=?').bind(year).all()).results.sort((a, b) => a.seq - b.seq);
  return rows.length ? { vers: JSON.parse(rows[0].vers), months: JSON.parse(rows.map(r => r.body).join('')) } : { vers: {}, months: {} };
}
// mem：{ total, live, months: { 月: { ver, list } }, liveList }
async function freshB(db, today, mem) {
  let v = await db.prepare('SELECT total,live,cutoff,months FROM pb_ver WHERE id=1').first();
  if (v.cutoff < today) {
    const first = !v.cutoff;
    const add = (await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=? AND walk_date<?`).bind(v.cutoff, today).all()).results;
    await db.prepare('UPDATE pb_ver SET cutoff=? WHERE id=1 AND cutoff=?').bind(today, v.cutoff).run();
    const byMonth = new Map();
    for (const r of add) { const m = r.walk_date.slice(0, 7); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(r); }
    const vers = JSON.parse(v.months);
    for (const m of byMonth.keys()) vers[m] = (vers[m] || 0) + 1;
    for (const year of new Set([...byMonth.keys()].map(yearOf))) {
      const pack = first ? { months: {} } : await loadYear(db, year);
      for (const [m, rows] of byMonth) if (yearOf(m) === year) pack.months[m] = [...(pack.months[m] || []), ...groupWalks(rows)];
      const yv = Object.fromEntries(Object.keys(pack.months).map(m => [m, vers[m]]));
      await saveYear(db, year, yv, pack.months);
      for (const m of Object.keys(pack.months)) mem.months[m] = { ver: vers[m], list: pack.months[m] };
    }
    await db.prepare('UPDATE pb_ver SET months=?, total=total+1 WHERE id=1').bind(JSON.stringify(vers)).run();
    v = await db.prepare('SELECT total,live,cutoff,months FROM pb_ver WHERE id=1').first();
    mem.live = null;
  }
  if (mem.total !== v.total) {
    const vers = JSON.parse(v.months);
    const stale = Object.keys(vers).filter(m => !mem.months[m] || mem.months[m].ver !== vers[m]);
    for (const year of new Set(stale.map(yearOf))) {
      const pack = await loadYear(db, year);
      let changed = false;
      for (const m of stale.filter(m => yearOf(m) === year)) {
        if (pack.vers[m] !== vers[m]) { pack.months[m] = await buildMonth(db, m, v.cutoff); pack.vers[m] = vers[m]; changed = true; }
        mem.months[m] = { ver: vers[m], list: pack.months[m] };
      }
      if (changed) await saveYear(db, year, pack.vers, pack.months);
    }
    mem.total = v.total;
  }
  if (mem.live !== v.live) {
    mem.liveList = groupWalks((await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date>=?`).bind(v.cutoff).all()).results);
    mem.live = v.live;
  }
  return [...Object.keys(mem.months).sort().flatMap(m => mem.months[m].list), ...mem.liveList];
}
const newMemB = () => ({ total: null, live: null, months: {}, liveList: [] });

(async () => {
  const proxy = await getPlatformProxy({ configPath: path.join(__dirname, 'wrangler.jsonc'), persist: false });
  const raw = proxy.env.DB;
  const db = meter(raw);
  const out = {};
  try {
    // v3_walks 照正式結構（db/compact-schema.sql），加 #315 的 walk_date 索引
    await raw.exec("CREATE TABLE v3_dogs (dog_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)");
    await raw.exec("CREATE TABLE v3_walks (dog_id TEXT NOT NULL REFERENCES v3_dogs(dog_id), walk_date TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, walker_name TEXT, walker_code TEXT, dog_number TEXT NOT NULL DEFAULT '', dog_name TEXT NOT NULL DEFAULT '', PRIMARY KEY(dog_id,walk_date,position))");
    await raw.exec('CREATE INDEX v3_walks_date ON v3_walks(walk_date)');
    const dogs = Array.from({ length: DOGS }, (_, i) => ({ id: `d${String(i).padStart(31, '0')}`, number: `2024${String(100000 + i)}`, name: `狗狗${i}號` }));
    await raw.batch(dogs.map(d => raw.prepare('INSERT INTO v3_dogs VALUES(?,?)').bind(d.id, d.name)));
    // 合成資料：每天 PER_DAY 隻狗被溜，一半兩個人一起溜
    const start = addDays(TODAY, -365 * YEARS);
    let rows = [];
    const flush = async () => { if (!rows.length) return; await raw.exec(`INSERT INTO v3_walks VALUES ${rows.join(',')}`); rows = []; };
    let total = 0;
    for (let d = start, n = 0; d < TODAY; d = addDays(d, 1), n++) {
      for (let k = 0; k < PER_DAY; k++) {
        const dog = dogs[(n * 7 + k) % DOGS];
        const people = k % 2 ? 2 : 1;
        for (let p = 0; p < people; p++) { rows.push(`('${dog.id}','${d}',${p},NULL,'${(n * 31 + k * 7 + p).toString(16).padStart(12, '0').slice(-12)}','${dog.number}','${dog.name}')`); total++; }
        if (rows.length >= 400) await flush();
      }
    }
    // 今天也溜了一些
    for (let k = 0; k < 40; k++) { const dog = dogs[k]; rows.push(`('${dog.id}','${TODAY}',0,NULL,'aaaaaaaaaaaa','${dog.number}','${dog.name}')`); total++; }
    await flush();
    out.data = { years: YEARS, walkRows: total };

    for (const s of MONTHLY_SETUP) await raw.exec(s.replace(/\s+/g, ' '));
    const direct = async () => groupWalks((await raw.prepare(`SELECT ${WALK_COLS} FROM v3_walks`).all()).results);
    const same = async list => JSON.stringify(list) === JSON.stringify(await direct());

    // #315 現在的做法：跨日整份重讀歷史
    db.reset(); await db.prepare(`SELECT ${WALK_COLS} FROM v3_walks WHERE walk_date<?`).bind(TODAY).all();
    out.current315_crossDay = db.reset();

    const memA = newMem();
    db.reset(); let list = await fresh(db, TODAY, memA);
    out.monthly_firstBuild = { ...db.reset(), same: await same(list) };
    list = await fresh(db, TODAY, memA);
    out.monthly_warmNoChange = { ...db.reset(), same: await same(list) };
    list = await fresh(db, TODAY, newMem());
    out.monthly_coldNewMachine = { ...db.reset(), same: await same(list), months: memA.months.size };

    // 觸發器成本：今天加一筆
    const dog = dogs[100];
    db.reset(); await db.prepare('INSERT INTO v3_walks VALUES(?,?,0,NULL,?,?,?)').bind(dog.id, TODAY, 'bbbbbbbbbbbb', dog.number, dog.name).run();
    out.trigger_insertToday = db.reset();
    list = await fresh(db, TODAY, memA);
    out.monthly_afterTodayInsert = { ...db.reset(), same: await same(list) };

    // 改一筆舊紀錄（一年半前）
    const old = addDays(TODAY, -540);
    db.reset(); await db.prepare("UPDATE v3_walks SET walker_code='cccccccccccc' WHERE walk_date=? AND position=0 AND rowid=(SELECT rowid FROM v3_walks WHERE walk_date=? LIMIT 1)").bind(old, old).run();
    out.trigger_updateOld = db.reset();
    list = await fresh(db, TODAY, memA);
    out.monthly_afterOldEdit = { ...db.reset(), same: await same(list) };

    // 跨日
    const tomorrow = addDays(TODAY, 1);
    list = await fresh(db, tomorrow, memA);
    out.monthly_crossDay = { ...db.reset(), same: await same(list) };
    list = await fresh(db, tomorrow, newMem());
    out.monthly_crossDayOtherMachine = { ...db.reset(), same: await same(list) };


    // ---- 做法 B（另一份記憶體、另一組表），接著同一份資料量 ----
    for (const s of B_SETUP) await raw.exec(s.replace(/\s+/g, ' '));
    const memB = newMemB();
    db.reset(); list = await freshB(db, tomorrow, memB);
    out.B_firstBuild = { ...db.reset(), same: await same(list) };
    list = await freshB(db, tomorrow, memB);
    out.B_warmNoChange = { ...db.reset(), same: await same(list) };
    list = await freshB(db, tomorrow, newMemB());
    out.B_coldNewMachine = { ...db.reset(), same: await same(list) };
    const dog2 = dogs[101];
    db.reset(); await db.prepare('INSERT INTO v3_walks VALUES(?,?,0,NULL,?,?,?)').bind(dog2.id, tomorrow, 'dddddddddddd', dog2.number, dog2.name).run();
    out.trigger_insertToday_A_and_B = db.reset();
    list = await freshB(db, tomorrow, memB);
    out.B_afterTodayInsert = { ...db.reset(), same: await same(list) };
    const old2 = addDays(TODAY, -700);
    db.reset(); await db.prepare("UPDATE v3_walks SET walker_code='eeeeeeeeeeee' WHERE rowid=(SELECT rowid FROM v3_walks WHERE walk_date=? LIMIT 1)").bind(old2).run();
    out.trigger_updateOld_A_and_B = db.reset();
    list = await freshB(db, tomorrow, memB);
    out.B_afterOldEdit = { ...db.reset(), same: await same(list) };
    const day3 = addDays(TODAY, 2);
    list = await freshB(db, day3, memB);
    out.B_crossDay = { ...db.reset(), same: await same(list) };
    list = await freshB(db, day3, newMemB());
    out.B_crossDayOtherMachine = { ...db.reset(), same: await same(list) };
    out.B_packRows = (await raw.prepare('SELECT COUNT(*) AS n FROM pb_pack').first()).n;

    // 大小：每月、每年合併
    const packs = (await raw.prepare('SELECT month, SUM(length(CAST(body AS BLOB))) AS b, COUNT(*) AS c FROM pm_pack GROUP BY month').all()).results;
    const byYear = new Map();
    for (const p of packs) { const y = p.month.slice(0, 4); byYear.set(y, (byYear.get(y) || 0) + p.b); }
    out.sizes = {
      monthKB: { min: Math.round(Math.min(...packs.map(p => p.b)) / 1024), max: Math.round(Math.max(...packs.map(p => p.b)) / 1024) },
      monthRows: packs.reduce((n, p) => n + p.c, 0),
      yearMB: Object.fromEntries([...byYear].map(([y, b]) => [y, +(b / 1e6).toFixed(2)])),
      yearMergedRows: [...byYear.values()].reduce((n, b) => n + Math.ceil(b / CHUNK), 0),
    };
    console.log(JSON.stringify(out, null, 1));
  } finally { await proxy.dispose(); }
})();
