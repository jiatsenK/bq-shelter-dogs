// 志工身分（#623 R8）：用登記名字跟 Worker 換最新的登記名字與代號。
// 設定名字（welcome.js）、背景同步常溜（favorites.js）、打開圖鑑（cards.js）共用同一條規則；
// 各頁自己的手機資料怎麼讀、怎麼存由呼叫的地方帶進來，這裡不碰頁面狀態。
import { BQApi } from './api.js';

// 身分相關的 /api/identity 請求；失敗丟 Error（訊息給人看），名字已被別的身分使用時帶 targetCode
export async function identityRequest(action, body) {
  const r = await BQApi.identity(action, body);
  if (r.error === 'network' || !r.data) throw new Error(r.message);
  const out = r.data;
  if (!r.ok || !out.ok) { const e = new Error(out.error || '身分設定失敗，請稍後再試'); e.targetCode = out.targetCode; throw e; }
  return out;
}

const snapshot = ({ name, codes }) => `${name}\n${codes.join(',')}`;

// read()：這支手機現在的 { name, codes }；write(identity)：存 Worker 回的 { name, codes }。
// 送出前記下 read()，回來時名字和代號都沒變才 write，回 { status: 'saved', identity }；
// 中途被改過（剛改名、另一個分頁換了身分）不存，回 { status: 'changed' }，由呼叫的地方決定怎麼告訴志工
export async function refreshIdentity(name, { read, write }) {
  const before = snapshot(read());
  const out = await identityRequest('', { name });
  if (snapshot(read()) !== before) return { status: 'changed' };
  write(out.identity);
  return { status: 'saved', identity: out.identity };
}
