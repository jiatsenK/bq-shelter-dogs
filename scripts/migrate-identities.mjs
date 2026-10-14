// #216：遷移入口只接受呼叫者提供的 D1 與來源，不連線正式服務。
import { randomBytes, createHash } from 'node:crypto';

const text = value => String(value ?? '').trim();
const nameKey = value => text(value).normalize('NFKC').replace(/\s+/g, '');
const sourceKey = row => text(row.id) || `名:${nameKey(row.name)}`;
const opaqueId = () => randomBytes(16).toString('hex');
const bindingId = (source, key) => createHash('sha256').update(JSON.stringify([source, key])).digest('hex');
function intakeDate(number) {
  if (!/^\d{10}$/.test(number)) return null;
  const date = `${number.slice(0, 4)}-${number.slice(4, 6)}-${number.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function sourceBinding(db, source, row, target, reason, kind) {
  const key = sourceKey(row), state = target ? 'confirmed' : 'candidate';
  return db.prepare('INSERT INTO v2_source_bindings(binding_id,source_kind,source_key,admission_id,state,evidence) VALUES(?,?,?,?,?,?) ON CONFLICT(binding_id) DO UPDATE SET admission_id=excluded.admission_id,state=excluded.state,evidence=excluded.evidence')
    .bind(bindingId(source, key), kind || (row.id ? 'numbered_row' : 'named_row'), key, target?.admission_id || null, state, JSON.stringify({ source, reason, row }));
}

function resolveRow(row, dogs, resolved, confirmations, knownReason) {
  const key = sourceKey(row), normalized = nameKey(row.name);
  let target = resolved.get(key);
  if (!row.id && /^\(.*\)$/.test(normalized) && !confirmations.has(key)) {
    const matches = dogs.filter(d => nameKey(d.name) === normalized.slice(1, -1));
    target = matches.length === 1 ? resolved.get(sourceKey(matches[0])) : null;
    if (target) target = { ...target, admission_id: target.current_admission_id };
    return { target, reason: target ? 'temporary_three_conditions' : 'temporary_without_unique_main_dog', kind: 'temp_row' };
  }
  return { target, reason: target ? knownReason : 'source_without_reliable_identity' };
}

// 只用可靠的關係連結，不用同名推測再入所。
function identityLinks() {
  const parents = new Map();
  const root = key => {
    if (!parents.has(key)) parents.set(key, key);
    const parent = parents.get(key);
    if (parent !== key) parents.set(key, root(parent));
    return parents.get(key);
  };
  return { root, join(a, b) { parents.set(root(a), root(b)); }, keys: () => [...parents.keys()] };
}

export async function migrateIdentities(db, { dogs = [], cards = [], sources = [], confirmedMappings = [] } = {}) {
  const sourceIds = new Set(['main']);
  for (const card of cards) {
    const source = `dogs/${card.id}.md`;
    if (sourceIds.has(source)) throw new Error(`來源路徑重複：${source}`);
    sourceIds.add(source);
  }
  for (const source of sources) {
    if (!text(source.source) || sourceIds.has(source.source)) throw new Error(`來源路徑空白或重複：${source.source}`);
    sourceIds.add(source.source);
    const keys = new Set();
    for (const row of source.rows) {
      const key = sourceKey(row);
      if (keys.has(key)) throw new Error(`來源鍵重複：${source.source} / ${key}`);
      keys.add(key);
    }
  }
  const dogsLink = identityLinks(), admissionsLink = identityLinks();
  const confirmations = new Map();
  const canonicalKey = key => key.startsWith('名:') ? `名:${nameKey(key.slice(2))}` : text(key);
  for (const confirmed of confirmedMappings) {
    if (!text(confirmed.sourceKey) || !text(confirmed.evidence) || !['same_admission', 'readmission'].includes(confirmed.relation) || !text(confirmed.targetNumber)) throw new Error('已確認對應必須有來源鍵、證據、入所關係與目標編號');
    const key = canonicalKey(confirmed.sourceKey);
    if (confirmations.has(key)) throw new Error(`重複的已確認來源：${key}`);
    confirmations.set(key, confirmed);
    dogsLink.join(key, confirmed.targetNumber);
    if (confirmed.relation === 'same_admission') admissionsLink.join(key, confirmed.targetNumber);
  }
  for (const card of cards) {
    if (!text(card.id)) throw new Error('狗卡缺少來源編號');
    for (const former of card.formerIds || []) {
      if (text(former) && text(former) !== text(card.id)) dogsLink.join(text(former), text(card.id));
    }
  }
  const current = new Map();
  for (const row of dogs) {
    if (!text(row.name)) throw new Error('主清單狗名不可空白');
    const key = sourceKey(row);
    if (current.has(key)) throw new Error(`主清單來源鍵重複：${key}`);
    current.set(key, row);
    if (row.id || !/^\(.*\)$/.test(nameKey(row.name))) dogsLink.root(key);
  }
  const groups = new Map();
  for (const [key, row] of current) {
    if (!row.id && /^\(.*\)$/.test(nameKey(row.name))) continue;
    const root = dogsLink.root(key);
    if (!groups.has(root)) groups.set(root, { rows: [], keys: [] });
    groups.get(root).rows.push({ key, row });
  }
  for (const key of dogsLink.keys()) groups.get(dogsLink.root(key))?.keys.push(key);

  const resolved = new Map();
  // 先讀回既有對應，跨兩個已建立的狗不自動合併；錯誤對應修正另需明確處理。
  const plans = [];
  for (const group of groups.values()) {
    const knownDogs = new Set(), existingAdmissions = new Map();
    for (const key of group.keys) {
      const known = key.startsWith('名:')
        ? await db.prepare('SELECT a.dog_id,a.admission_id FROM v2_source_bindings b JOIN v2_admissions a USING(admission_id) WHERE binding_id=?').bind(bindingId('main', key)).first()
        : await db.prepare('SELECT dog_id,admission_id FROM v2_admission_numbers JOIN v2_admissions USING(admission_id) WHERE number=?').bind(key).first();
      if (known) {
        knownDogs.add(known.dog_id);
        const root = admissionsLink.root(key);
        if (existingAdmissions.has(root) && existingAdmissions.get(root) !== known.admission_id) throw new Error('編號更正跨越兩個既有入所，停止，保留原資料等待確認');
        existingAdmissions.set(root, known.admission_id);
      }
    }
    if (knownDogs.size > 1) throw new Error('對應跨越兩個既有狗 ID，停止，保留原資料等待確認');
    const numbers = group.keys.filter(key => !key.startsWith('名:')).sort();
    const latest = numbers.at(-1) || group.rows[0].key;
    const active = admissionsLink.root(latest);
    const dog_id = [...knownDogs][0] || opaqueId();
    const byAdmission = new Map();
    for (const key of group.keys) {
      const root = admissionsLink.root(key);
      if (!byAdmission.has(root)) byAdmission.set(root, { admission_id: existingAdmissions.get(root) || opaqueId(), numbers: [] });
      if (!key.startsWith('名:')) byAdmission.get(root).numbers.push(key);
    }
    plans.push({ group, dog_id, active, byAdmission });
  }
  for (const { group, dog_id, active, byAdmission } of plans) {
    const { row } = group.rows[0];
    const statements = [db.prepare('INSERT INTO v2_dogs(dog_id,name,sex) VALUES(?,?,?) ON CONFLICT(dog_id) DO UPDATE SET name=excluded.name,sex=excluded.sex').bind(dog_id, text(row.name), ['male', 'female'].includes(row.sex) ? row.sex : 'unknown')];
    // 先解除舊在所，再指定新的，避免部分唯一索引擋住正常再入所。
    statements.push(db.prepare("UPDATE v2_admissions SET status='unknown' WHERE dog_id=? AND status='in'").bind(dog_id));
    for (const [root, admission] of byAdmission) {
      const targets = [...new Set(confirmedMappings.filter(c => c.relation === 'same_admission' && admission.numbers.includes(c.targetNumber)).map(c => c.targetNumber))];
      if (targets.length > 1) throw new Error('同次入所的編號更正目標互相衝突');
      const number = targets[0] || admission.numbers.sort().at(-1), date = intakeDate(number || '');
      statements.push(db.prepare("INSERT INTO v2_admissions(admission_id,dog_id,status,intake_date,intake_date_source,cage,covered,sheet_note) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(admission_id) DO UPDATE SET status=CASE WHEN v2_admissions.status='departed' AND excluded.status='unknown' THEN 'departed' ELSE excluded.status END,cage=CASE WHEN excluded.status='in' THEN excluded.cage ELSE v2_admissions.cage END,covered=CASE WHEN excluded.status='in' THEN excluded.covered ELSE v2_admissions.covered END,sheet_note=CASE WHEN excluded.status='in' THEN excluded.sheet_note ELSE v2_admissions.sheet_note END").bind(admission.admission_id, dog_id, root === active ? 'in' : 'unknown', date, date ? 'number' : null, root === active ? text(row.cage) : '', root === active && row.covered ? 1 : 0, root === active ? text(row.note) : ''));
      statements.push(db.prepare("UPDATE v2_admission_numbers SET kind='corrected' WHERE admission_id=? AND kind='current'").bind(admission.admission_id));
      for (const n of admission.numbers) statements.push(db.prepare('INSERT INTO v2_admission_numbers(number,admission_id,kind) VALUES(?,?,?) ON CONFLICT(number) DO UPDATE SET kind=excluded.kind').bind(n, admission.admission_id, n === number ? 'current' : 'corrected'));
    }
    for (const { row: mainRow } of group.rows) statements.push(sourceBinding(db, 'main', mainRow, byAdmission.get(active), 'main_row'));
    if (statements.length > 50) throw new Error('單狗的遷移批次超過 50 筆，停止以避免部分套用');
    await db.batch(statements);
    for (const key of group.keys) resolved.set(key, { dog_id, admission_id: byAdmission.get(admissionsLink.root(key)).admission_id, current_admission_id: byAdmission.get(active).admission_id });
  }

  const mapping = [], pending = [];
  const bindSource = async (source, row, target, reason, kind) => {
    const key = sourceKey(row), state = target ? 'confirmed' : 'candidate';
    await sourceBinding(db, source, row, target, reason, kind).run();
    const entry = { source, source_key: key, dog_id: target?.dog_id || null, admission_id: target?.admission_id || null, state, reason };
    mapping.push(entry);
    if (!target) pending.push(entry);
  };
  for (const row of dogs) {
    const { target, reason, kind } = resolveRow(row, dogs, resolved, confirmations, 'main_row');
    await bindSource('main', row, target ? { ...target, admission_id: target.current_admission_id } : null, reason, kind);
  }
  for (const card of cards) await bindSource(`dogs/${card.id}.md`, card, resolved.get(text(card.id)), resolved.has(text(card.id)) ? 'number_or_confirmed_relationship' : 'card_without_reliable_identity');
  for (const source of sources) for (const row of source.rows) {
    const { target, reason, kind } = resolveRow(row, dogs, resolved, confirmations, 'number_or_confirmed_relationship');
    await bindSource(source.source, row, target, reason, kind);
  }
  return { mapping, pending };
}
