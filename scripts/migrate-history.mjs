// #217：只操作傳入的隔離 D1。歷史來源保留於 v2_history_sources。
import { createHash, randomBytes } from 'node:crypto';
import { classifyDeparture } from './sync-sheet.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const randomId = () => randomBytes(16).toString('hex');
const text = v => String(v ?? '').trim();
const key = row => text(row.id) || `名:${text(row.name).normalize('NFKC').replace(/\s+/g, '')}`;
const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

async function resolve(db, row, source) {
  const bound = await db.prepare("SELECT a.* FROM v2_source_bindings b JOIN v2_admissions a USING(admission_id) WHERE b.binding_id=? AND b.state='confirmed'").bind(hash([source, key(row)])).first();
  if (bound) return bound;
  if (text(row.id)) return db.prepare('SELECT a.* FROM v2_admission_numbers n JOIN v2_admissions a USING(admission_id) WHERE n.number=?').bind(text(row.id)).first();
  const rows = (await db.prepare("SELECT DISTINCT a.* FROM v2_source_bindings b JOIN v2_admissions a USING(admission_id) WHERE b.source_key=? AND b.state='confirmed'").bind(key(row)).all()).results;
  return rows.length === 1 ? rows[0] : null;
}

async function saveSource(db, kind, sourceKey, row, state, reason, admission = null, walk_id = null) {
  await db.prepare('INSERT INTO v2_history_sources(source_id,source_kind,source_key,state,reason,raw_json,admission_id,walk_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,raw_json=excluded.raw_json,admission_id=excluded.admission_id,walk_id=excluded.walk_id').bind(hash([kind, sourceKey]), kind, sourceKey, state, reason, JSON.stringify(row), admission?.admission_id || null, walk_id).run();
}

async function putWalk(db, admission, date, codes, evidence, state, finalized_on) {
  const prior = await db.prepare('SELECT walk_id FROM v2_daily_walks WHERE admission_id=? AND walk_date=?').bind(admission.admission_id, date).first();
  const walk_id = prior?.walk_id || hash([admission.admission_id, date]);
  const roster = [...new Set((codes || []).filter(c => /^[a-f0-9]{12}$/.test(c)))];
  const participants = [];
  for (const code of roster) {
    let walker = await db.prepare('SELECT walker_id FROM v2_walker_codes WHERE code=?').bind(code).first();
    if (!walker) {
      walker = { walker_id: randomId() };
      await db.batch([
        db.prepare('INSERT INTO v2_walkers VALUES(?,?)').bind(walker.walker_id, `${date}T00:00:00+08:00`),
        db.prepare("INSERT INTO v2_walker_codes VALUES(?,?,'primary',NULL)").bind(code, walker.walker_id),
      ]);
    }
    if (!participants.includes(walker.walker_id)) participants.push(walker.walker_id);
  }
  await db.batch([
    db.prepare('INSERT INTO v2_daily_walks(walk_id,admission_id,walk_date,state,participant_quality,evidence,finalized_on) VALUES(?,?,?,?,?,?,?) ON CONFLICT(admission_id,walk_date) DO UPDATE SET state=excluded.state,participant_quality=excluded.participant_quality,evidence=excluded.evidence,finalized_on=excluded.finalized_on').bind(walk_id, admission.admission_id, date, state, roster.length ? 'known' : 'unknown', evidence, finalized_on),
    db.prepare('DELETE FROM v2_walk_participants WHERE walk_id=?').bind(walk_id),
    ...participants.map(id => db.prepare('INSERT INTO v2_walk_participants VALUES(?,?)').bind(walk_id, id)),
  ]);
  return walk_id;
}

function departureDate(value, asOf) {
  const m = text(value).match(/^(?:(\d{3,4})[\/\-.年])?(\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (!m) return null;
  let year = m[1] ? Number(m[1]) : Number(asOf.slice(0, 4));
  if (year < 1911) year += 1911;
  const result = `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return validDate(result) ? result : null;
}

async function importDepartures(db, rows, jsonRows, asOf) {
  const sheetNumbers = new Set();
  for (const [index, row] of rows.entries()) {
    const source = String(row.rowNumber ?? index + 2);
    const classification = classifyDeparture(row.note);
    const reason = classification.reason === 'unknown' ? 'pending' : classification.reason;
    const preceding = classification.at == null ? '' : classification.text.slice(0, classification.at);
    const dates = [...preceding.matchAll(/(?:\d{3,4}[\/\-.年])?\d{1,2}[\/\-.月]\d{1,2}日?/g)];
    const fromNote = dates.length ? departureDate(dates.at(-1)[0], asOf) : null;
    const fromColumn = departureDate(row.dateText, asOf);
    const ambiguousColumn = /遛|溜/.test(row.dateColumnLabel || '') && !text(row.dateConfirmedEvidence);
    const date = fromNote || (ambiguousColumn ? null : fromColumn);
    const evidence = { ...row, date_source: fromNote ? 'note' : ambiguousColumn ? 'ambiguous_walk_date_column' : 'sheet_date_column', classification: { reason, flags: classification.flags } };
    let admission = await resolve(db, row, '已出所');
    let pendingReason = !/^\d{10}$/.test(text(row.id)) ? 'invalid_or_missing_departure_number' : date > asOf ? 'future_departure_date' : admission?.status === 'in' ? 'departure_conflicts_with_current_admission' : null;
    if (!pendingReason) {
      sheetNumbers.add(text(row.id));
      if (!admission) {
        if (!text(row.name)) pendingReason = 'departure_without_name';
        else {
          const dog_id = randomId(), admission_id = randomId();
          const intake = departureDate(`${row.id.slice(0, 4)}/${row.id.slice(4, 6)}/${row.id.slice(6, 8)}`, asOf);
          await db.batch([
            db.prepare('INSERT INTO v2_dogs(dog_id,name) VALUES(?,?)').bind(dog_id, text(row.name)),
            db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status,intake_date,intake_date_source) VALUES(?,?,'departed',?,?)").bind(admission_id, dog_id, intake, intake ? 'number' : null),
            db.prepare("INSERT INTO v2_admission_numbers VALUES(?,?,'current')").bind(text(row.id), admission_id),
          ]);
          admission = { dog_id, admission_id };
        }
      }
      if (admission && !pendingReason) await db.prepare("UPDATE v2_admissions SET status='departed',departed_date=?,departed_date_source='note',departed_reason=? WHERE admission_id=?").bind(date, reason, admission.admission_id).run();
    }
    await saveSource(db, 'departed_sheet', source, evidence, pendingReason || !date || reason === 'pending' ? 'pending' : 'imported', pendingReason || (!date ? 'departure_date_unconfirmed' : reason === 'pending' ? 'departure_reason_pending' : 'departed_sheet_fact'), admission);
  }
  for (const [index, row] of jsonRows.entries()) {
    const admission = await resolve(db, row, 'data/departures.json');
    await saveSource(db, 'departure_json', hash([row.id, row.seen || row.date, index]), row, sheetNumbers.has(text(row.id)) ? 'ignored' : 'pending', sheetNumbers.has(text(row.id)) ? 'superseded_by_departed_sheet' : 'disappearance_observation_pending', admission);
  }
}

export async function migrateHistory(db, { walks = [], snapshots = [], departedSheet = [], departures = [], asOf, historyDecisions = {} } = {}) {
  if (!validDate(asOf)) throw new Error('請提供台灣日期 asOf（YYYY-MM-DD）');
  for (const decision of Object.values(historyDecisions)) if (!['retain', 'exclude'].includes(decision.decision) || !text(decision.evidence)) throw new Error('歷史例外必須有明確保留／排除決策與證據');
  await importDepartures(db, departedSheet, departures, asOf);
  const sourceOccurrences = new Map();
  const rowSourceKey = (source, row) => {
    const base = `${source}:${key(row)}:${hash(row)}`;
    const n = sourceOccurrences.get(base) || 0; sourceOccurrences.set(base, n + 1);
    return `${base}:${n}`;
  };
  const before = [], after = [];
  for (const [index, row] of walks.entries()) {
    const source = rowSourceKey('data/walks.json', row);
    (validDate(row.date) && row.date < '2026-09-25' ? before : after).push({ row, source });
  }
  for (const { row, source } of before) {
    const admission = await resolve(db, row, 'data/walks.json');
    const reason = !admission ? 'identity_unconfirmed' : !validDate(row.date) || row.date > asOf ? 'invalid_or_future_date' : null;
    const walk_id = reason ? null : await putWalk(db, admission, row.date, row.walkers, 'legacy', 'final', null);
    await saveSource(db, 'walk', source, row, reason ? 'pending' : 'imported', reason || 'legacy_before_cutoff', admission, walk_id);
  }
  const latest = new Map();
  const usable = snapshot => snapshot.status !== 'failed' && validDate(snapshot.date) && snapshot.date <= asOf && Number.isFinite(Date.parse(snapshot.syncedAt)) && new Date(Date.parse(snapshot.syncedAt) + 8 * 3600000).toISOString().slice(0, 10) === snapshot.date;
  for (const snapshot of snapshots) if (usable(snapshot) && (!latest.has(snapshot.date) || Date.parse(snapshot.syncedAt) > Date.parse(latest.get(snapshot.date).syncedAt))) latest.set(snapshot.date, snapshot);
  for (const snapshot of [...snapshots].sort((a, b) => text(a.date).localeCompare(text(b.date)) || Date.parse(a.syncedAt) - Date.parse(b.syncedAt))) {
    const source = snapshot.source || `data/history/${snapshot.date}.json`;
    if (usable(snapshot) && latest.get(snapshot.date) === snapshot) await db.prepare("UPDATE v2_daily_walks SET state='superseded' WHERE walk_date=? AND evidence='snapshot' AND state IN ('provisional','final')").bind(snapshot.date).run();
    for (const row of snapshot.dogs) {
      const sourceKey = rowSourceKey(`${source}:${snapshot.syncedAt}`, row);
      const admission = await resolve(db, row, source);
      let state = 'pending', reason = 'identity_unconfirmed', walk_id = null;
      if (!usable(snapshot)) { state = snapshot.status === 'failed' ? 'ignored' : 'pending'; reason = 'unsuccessful_or_invalid_snapshot'; }
      else if (latest.get(snapshot.date) !== snapshot) { state = 'ignored'; reason = 'earlier_successful_snapshot'; }
      else if (!row.walkedDate) { state = 'ignored'; reason = 'empty_walk_date'; }
      else if (!validDate(row.walkedDate) || row.walkedDate > snapshot.date) reason = 'invalid_or_future_date';
      else if (admission) {
        const existing = await db.prepare('SELECT * FROM v2_daily_walks WHERE admission_id=? AND walk_date=?').bind(admission.admission_id, row.walkedDate).first();
        if (row.walkedDate === snapshot.date) {
          walk_id = await putWalk(db, admission, row.walkedDate, row.walkers, 'snapshot', snapshot.date < asOf ? 'final' : 'provisional', snapshot.date < asOf ? snapshot.date : null);
          state = 'imported'; reason = 'last_successful_snapshot';
        } else if (existing && ['provisional', 'final'].includes(existing.state)) {
          walk_id = existing.walk_id;
          if (Array.isArray(row.walkers)) await putWalk(db, admission, row.walkedDate, row.walkers, existing.evidence, existing.state, existing.finalized_on);
          state = 'imported'; reason = 'same_date_roster_observation';
        } else reason = 'missing_day_evidence';
      }
      await saveSource(db, 'snapshot', sourceKey, { ...row, observedDay: snapshot.date, syncedAt: snapshot.syncedAt }, state, reason, admission, walk_id);
    }
  }
  for (const { row, source } of after) {
    const admission = await resolve(db, row, 'data/walks.json');
    const existing = admission ? await db.prepare('SELECT * FROM v2_daily_walks WHERE admission_id=? AND walk_date=?').bind(admission.admission_id, row.date).first() : null;
    const decision = historyDecisions[`${key(row)}|${row.date}`];
    let state = 'pending', reason = !admission ? 'identity_unconfirmed' : 'historical_policy_unconfirmed', walk_id = null;
    if (!validDate(row.date) || row.date > asOf) reason = 'invalid_or_future_date';
    else if (decision?.decision === 'exclude') {
      state = 'ignored'; reason = 'confirmed_exclusion';
      if (existing) { await db.prepare("UPDATE v2_daily_walks SET state='cancelled' WHERE walk_id=?").bind(existing.walk_id).run(); walk_id = existing.walk_id; }
    } else if (admission && decision?.decision === 'retain') {
      walk_id = existing?.walk_id || await putWalk(db, admission, row.date, row.walkers, 'legacy', row.date < asOf ? 'final' : 'provisional', null);
      if (existing) await db.prepare('UPDATE v2_daily_walks SET state=? WHERE walk_id=?').bind(row.date < asOf ? 'final' : 'provisional', walk_id).run();
      state = 'imported'; reason = 'confirmed_historical_exception';
    } else if (existing?.evidence === 'snapshot' && ['final', 'provisional'].includes(existing.state)) { state = 'imported'; reason = 'corroborated_by_snapshot'; walk_id = existing.walk_id; }
    else if (existing?.evidence === 'legacy') await db.prepare("UPDATE v2_daily_walks SET state='superseded' WHERE walk_id=?").bind(existing.walk_id).run();
    await saveSource(db, 'walk', source, { ...row, decision: decision || null }, state, reason, admission, walk_id);
  }
  const counts = {
    walks: await db.prepare('SELECT COUNT(*) AS n FROM v2_daily_walks').first('n'),
    sources: await db.prepare('SELECT COUNT(*) AS n FROM v2_history_sources').first('n'),
    dogDays: await db.prepare("SELECT COUNT(*) AS n FROM (SELECT a.dog_id,w.walk_date FROM v2_daily_walks w JOIN v2_admissions a USING(admission_id) WHERE w.state IN ('final','provisional') GROUP BY a.dog_id,w.walk_date)").first('n'),
  };
  const pending = (await db.prepare("SELECT source_kind,source_key,reason FROM v2_history_sources WHERE state='pending' ORDER BY source_kind,source_key").all()).results;
  return { counts, pending };
}
