// 預覽測試庫補「有人固定照顧」（.github/workflows/seed-preview-db.yml）：這是網站直接寫進正式庫的（#399），試算表沒有，
// 不補的話預覽溜狗表會把這些狗當成沒有紀錄排最前。正式庫只送 SELECT；寫入只對測試庫。
// 兩個庫的狗 ID 不一定相同，用編號對；沒有編號的狗對不到，維持不固定照顧
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sqlText = v => `'${String(v).replace(/'/g, "''")}'`;
const inList = numbers => `dog_id IN (SELECT dog_id FROM v3_dog_numbers WHERE number IN (${numbers.map(sqlText).join(',') || "''"}))`;

// 名單上的編號設為固定照顧、其他取消；只改有變的列（觸發器會讓在所資料包重算）
export function fixedCareSql(numbers) {
  const want = `CASE WHEN ${inList(numbers)} THEN 1 ELSE 0 END`;
  return `UPDATE v3_dogs SET fixed_care=${want} WHERE fixed_care<>${want}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const d1 = (name, extra, sql) => JSON.parse(execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', name, '--remote', ...extra, '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 }))[0];
  const numbers = d1('bq-shelter-dogs', [], 'SELECT n.number FROM v3_dogs d JOIN v3_dog_numbers n USING(dog_id) WHERE d.fixed_care=1').results.map(r => r.number);
  const out = d1('bq-shelter-dogs-test', ['--config', 'wrangler.preview-db.jsonc'], fixedCareSql(numbers));
  console.log(`正式庫固定照顧 ${numbers.length} 個編號；測試庫改了 ${out.meta?.changes ?? '?'} 隻`);
}
