// #218：只操作呼叫者提供的 D1，不連線試算表、GitHub 或 R2。
import { createHash, randomBytes } from 'node:crypto';
import { thumbKey } from '../worker/src/r2.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const randomId = () => randomBytes(16).toString('hex');
const validCode = code => typeof code === 'string' && /^[a-f0-9]{12}$/.test(code);
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

async function dogForNumber(db, number) {
  return db.prepare('SELECT a.* FROM v2_admission_numbers n JOIN v2_admissions a USING(admission_id) WHERE n.number=?').bind(number).first();
}

async function ensureWalker(db, code) {
  const known = await db.prepare('SELECT walker_id FROM v2_walker_codes WHERE code=?').bind(code).first('walker_id');
  if (known) return known;
  const id = randomId();
  await db.batch([
    db.prepare('INSERT INTO v2_walkers VALUES(?,?)').bind(id, new Date().toISOString()),
    db.prepare("INSERT INTO v2_walker_codes VALUES(?,?,'primary',NULL)").bind(code, id),
  ]);
  return id;
}

export async function migrateProfiles(db, { cardOpened = [], legacyCodes = [], walkerNames = [], kv = [], walkerAliases = [], cards = [], introOriginal = {}, rest = {}, notes = {}, deferredIntroNumbers = [], introChoices = {}, photos = [], photoChoices = {} } = {}) {
  const primaryCodes = new Set(walkerAliases.map(a => a.primaryCode)), assignedAliases = new Set();
  for (const alias of walkerAliases) {
    if (!validCode(alias.primaryCode) || !Array.isArray(alias.aliasCodes) || !alias.evidence?.trim() || !Number.isFinite(Date.parse(alias.confirmedAt))) throw new Error('別名需有 K 確認、時間與合法代號');
    for (const code of alias.aliasCodes) {
      if (!validCode(code) || primaryCodes.has(code) || assignedAliases.has(code)) throw new Error('別名確認對應互相衝突');
      assignedAliases.add(code);
    }
  }
  const occurrences = new Map();
  const record = async (kind, raw, state, reason, target = {}) => {
    const base = hash(raw), number = occurrences.get(`${kind}:${base}`) || 0;
    occurrences.set(`${kind}:${base}`, number + 1);
    const source = `${base}:${number}`;
    await db.prepare('INSERT INTO v2_profile_sources(source_id,source_kind,source_key,state,reason,raw_json,dog_id,admission_id,walker_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,raw_json=excluded.raw_json,dog_id=excluded.dog_id,admission_id=excluded.admission_id,walker_id=excluded.walker_id').bind(hash([kind, source]), kind, source, state, reason, JSON.stringify(raw), target.dog_id || null, target.admission_id || null, target.walker_id || null).run();
  };
  for (const alias of walkerAliases) {
    const walker_id = await ensureWalker(db, alias.primaryCode);
    for (const code of alias.aliasCodes) {
      const old = await db.prepare('SELECT walker_id FROM v2_walker_codes WHERE code=?').bind(code).first('walker_id');
      if (old && old !== walker_id) await db.batch([
        db.prepare('INSERT INTO v2_walk_participants SELECT walk_id,? FROM v2_walk_participants WHERE walker_id=? ON CONFLICT(walk_id,walker_id) DO NOTHING').bind(walker_id, old),
        db.prepare('DELETE FROM v2_walk_participants WHERE walker_id=?').bind(old),
        db.prepare('INSERT INTO v2_card_opened SELECT ?,dog_id,opened_on FROM v2_card_opened WHERE walker_id=? ON CONFLICT(walker_id,dog_id) DO UPDATE SET opened_on=MIN(v2_card_opened.opened_on,excluded.opened_on)').bind(walker_id, old),
        db.prepare('DELETE FROM v2_card_opened WHERE walker_id=?').bind(old),
        db.prepare('UPDATE v2_operations SET actor_walker_id=? WHERE actor_walker_id=?').bind(walker_id, old),
        db.prepare("UPDATE v2_walker_codes SET walker_id=?,kind='alias',confirmed_at=COALESCE(confirmed_at,?) WHERE walker_id=?").bind(walker_id, alias.confirmedAt, old),
        db.prepare('UPDATE v2_profile_sources SET walker_id=? WHERE walker_id=?').bind(walker_id, old),
      ]);
      await db.prepare("INSERT INTO v2_walker_codes VALUES(?,?,'alias',?) ON CONFLICT(code) DO UPDATE SET walker_id=excluded.walker_id,kind='alias',confirmed_at=excluded.confirmed_at").bind(code, walker_id, alias.confirmedAt).run();
    }
    await db.batch([
      db.prepare("UPDATE v2_walker_codes SET kind='alias',confirmed_at=COALESCE(confirmed_at,?) WHERE walker_id=? AND code<>? AND kind='primary'").bind(alias.confirmedAt, walker_id, alias.primaryCode),
      db.prepare("UPDATE v2_walker_codes SET kind='primary',confirmed_at=NULL WHERE code=?").bind(alias.primaryCode),
    ]);
    await record('confirmed_alias', alias, 'imported', 'confirmed_walker_relationship', { walker_id });
  }
  for (const code of legacyCodes) {
    const id = validCode(code) ? await ensureWalker(db, code) : null;
    await record('walker_code', { code }, id ? 'imported' : 'pending', id ? 'existing_code' : 'invalid_code', { walker_id: id });
  }
  for (const row of cardOpened) {
    const dog = await dogForNumber(db, row.dog_id);
    const valid = dog && validCode(row.walker_code) && validDate(row.opened_on);
    const walker_id = valid ? await ensureWalker(db, row.walker_code) : null;
    if (valid) await db.prepare('INSERT INTO v2_card_opened VALUES(?,?,?) ON CONFLICT(walker_id,dog_id) DO UPDATE SET opened_on=MIN(v2_card_opened.opened_on,excluded.opened_on)').bind(walker_id, dog.dog_id, row.opened_on).run();
    await record('card_opened', row, valid ? 'imported' : 'pending', valid ? 'earliest_per_walker_dog' : 'unresolved_identity_or_invalid_card', { dog_id: dog?.dog_id, walker_id });
  }
  const groups = new Map();
  for (const [kind, entries] of [
    ['card', cards], ['intro_original', Object.entries(introOriginal).map(([id, body]) => ({ id, body }))],
  ]) for (const row of entries) {
    const dog = await dogForNumber(db, row.id);
    if (!dog) { await record(kind, row, 'pending', 'unresolved_dog_identity'); continue; }
    if (!groups.has(dog.dog_id)) groups.set(dog.dog_id, { cards: [], originals: [], numbers: [] });
    const group = groups.get(dog.dog_id);
    group[kind === 'card' ? 'cards' : 'originals'].push(row); group.numbers.push(row.id);
  }
  const choices = new Map();
  for (const [number, choice] of Object.entries(introChoices)) {
    const dog = await dogForNumber(db, number);
    if (!dog || !choice.evidence?.trim()) throw new Error('介紹選擇需有已確認狗身分與證據');
    choices.set(dog.dog_id, choice);
  }
  for (const [dog_id, group] of groups) {
    const choice = choices.get(dog_id);
    const deferred = group.numbers.some(n => deferredIntroNumbers.includes(n)) && !choice;
    const chosenCard = choice ? group.cards.find(c => c.id === choice.cardId) : [...group.cards].sort((a, b) => a.id.localeCompare(b.id)).at(-1);
    const chosenOriginal = choice?.originalId ? group.originals.find(c => c.id === choice.originalId) : [...group.originals].sort((a, b) => a.id.localeCompare(b.id)).at(-1);
    if (choice && (!chosenCard || (choice.originalId && !chosenOriginal))) throw new Error('已確認介紹來源不屬於同一隻狗或來源缺少');
    if (!deferred) {
      if (chosenCard?.body?.trim()) await db.prepare("UPDATE v2_dogs SET intro=?,sex=CASE WHEN ? IN ('male','female') THEN ? ELSE sex END WHERE dog_id=?").bind(chosenCard.body, chosenCard.sex || '', chosenCard.sex || '', dog_id).run();
      if (chosenOriginal) await db.prepare('UPDATE v2_dogs SET intro_original=? WHERE dog_id=?').bind(chosenOriginal.body, dog_id).run();
    }
    for (const row of group.cards) await record('card', row, deferred || !row.body?.trim() ? 'pending' : row === chosenCard ? 'imported' : 'archived', deferred ? 'intro_choice_unconfirmed' : !row.body?.trim() ? 'empty_intro' : row === chosenCard ? 'shared_dog_intro' : 'previous_intro_version', { dog_id });
    for (const row of group.originals) await record('intro_original', row, deferred ? 'pending' : row === chosenOriginal ? 'imported' : 'archived', deferred ? 'intro_choice_unconfirmed' : 'original_intro_preserved', { dog_id });
  }
  for (const [number, setting] of Object.entries(rest)) {
    const admission = await dogForNumber(db, number);
    const valid = admission && validDate(setting.until);
    if (valid) await db.prepare('INSERT INTO v2_rest_settings(admission_id,until_date,reason) VALUES(?,?,?) ON CONFLICT(admission_id) DO UPDATE SET until_date=excluded.until_date,reason=excluded.reason').bind(admission.admission_id, setting.until, setting.reason || '').run();
    await record('rest', { number, ...setting }, valid ? 'imported' : 'pending', valid ? 'original_admission_rest_only' : 'unresolved_admission_or_invalid_rest', admission || {});
  }
  for (const [number, note] of Object.entries(notes)) await record('note_archive', { number, source: 'data/my-notes.json', checksum: hash(note) }, 'archived', 'git_archive_only_no_note_content');
  const objectKeys = new Set();
  for (const object of photos) {
    if (!object.key || objectKeys.has(object.key)) throw new Error('R2 來源路徑缺少或重複');
    objectKeys.add(object.key);
  }
  const photoGroups = new Map(), linkedKeys = new Set();
  for (const object of photos) {
    const original = object.key.match(/^photos\/([0-9A-Za-z]+)\.jpg$/);
    const trash = object.key.startsWith('trash/') && object.key.endsWith('/photo.jpg') && object.metadata?.kind === 'main';
    if (!original && !trash) continue;
    const number = original?.[1] || object.metadata.dogId;
    const dog = number ? await dogForNumber(db, number) : null;
    if (!dog) continue;
    const candidateThumb = original ? thumbKey(object.key) : object.key.replace(/photo\.jpg$/, 'thumb.jpg');
    const entry = { object, number, dog_id: dog.dog_id, replaced: !!trash, thumb: objectKeys.has(candidateThumb) ? candidateThumb : null };
    if (!photoGroups.has(dog.dog_id)) photoGroups.set(dog.dog_id, []);
    photoGroups.get(dog.dog_id).push(entry);
  }
  const chosenPhotos = new Map();
  for (const [number, choice] of Object.entries(photoChoices)) {
    const dog = await dogForNumber(db, number);
    if (!dog || !choice.evidence?.trim() || !photoGroups.get(dog.dog_id)?.some(p => p.object.key === choice.objectKey && !p.replaced)) throw new Error('主照片選擇需有同狗既有 R2 來源與確認證據');
    chosenPhotos.set(dog.dog_id, choice.objectKey);
  }
  for (const [dog_id, entries] of photoGroups) {
    const currentNumber = await db.prepare("SELECT n.number FROM v2_admission_numbers n JOIN v2_admissions a USING(admission_id) WHERE a.dog_id=? AND a.status='in' AND n.kind='current'").bind(dog_id).first('number');
    const available = entries.filter(p => !p.replaced).sort((a, b) => a.number.localeCompare(b.number));
    const selected = chosenPhotos.has(dog_id) ? available.find(p => p.object.key === chosenPhotos.get(dog_id)) : available.find(p => p.number === currentNumber) || available.at(-1);
    await db.batch([
      db.prepare("UPDATE v2_dog_photos SET state='replaced' WHERE dog_id=? AND state='active'").bind(dog_id),
      ...entries.map(p => db.prepare('INSERT INTO v2_dog_photos(photo_id,dog_id,object_key,thumb_key,state,is_primary) VALUES(?,?,?,?,?,1) ON CONFLICT(photo_id) DO UPDATE SET dog_id=excluded.dog_id,thumb_key=excluded.thumb_key,state=excluded.state,is_primary=1').bind(hash(p.object.key), dog_id, p.object.key, p.thumb, p === selected ? 'active' : 'replaced')),
    ]);
    for (const entry of entries) {
      linkedKeys.add(entry.object.key);
      await record('photo', entry.object, 'imported', entry === selected ? 'active_primary_same_r2_path' : 'replaced_photo_same_r2_path', { dog_id });
      if (entry.thumb) {
        linkedKeys.add(entry.thumb);
        await record('photo', photos.find(p => p.key === entry.thumb), 'imported', 'thumbnail_linked_same_r2_path', { dog_id });
      }
    }
  }
  for (const object of photos) if (!linkedKeys.has(object.key)) await record('photo', object, 'pending', 'unresolved_photo_identity_or_orphan_object');
  for (const row of walkerNames) {
    await db.prepare('INSERT INTO walker_names(name,last_seen) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET last_seen=CASE WHEN julianday(excluded.last_seen)>=julianday(walker_names.last_seen) THEN excluded.last_seen ELSE walker_names.last_seen END').bind(row.name, row.last_seen).run();
    await record('walker_name', row, 'imported', 'recommendation_only');
  }
  for (const row of kv) {
    await db.prepare('INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=CASE WHEN julianday(excluded.updated_at)>=julianday(kv.updated_at) THEN excluded.value ELSE kv.value END,updated_at=CASE WHEN julianday(excluded.updated_at)>=julianday(kv.updated_at) THEN excluded.updated_at ELSE kv.updated_at END').bind(row.key, row.value, row.updated_at).run();
    await record('kv', row, 'imported', 'preserved_existing_kv');
  }
  return {
    sources: await db.prepare('SELECT COUNT(*) AS n FROM v2_profile_sources').first('n'),
    pending: (await db.prepare("SELECT source_kind,source_key,reason FROM v2_profile_sources WHERE state='pending' ORDER BY source_kind,source_key").all()).results,
  };
}
