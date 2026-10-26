// 評審用本機假後端：/ 對應 public/，/api/* 回合成資料，POST /api/walk 照接。
// 用法：node mock-server.cjs <repoRoot> <port>
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(process.argv[2], 'public');
const PORT = Number(process.argv[3] || 8787);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp' };

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const ago = n => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
const cages = [];
['新1', '新2', '新3', '新5', '新6', '新7', '新8'].forEach(p => ['A', 'B', 'C'].forEach(s => cages.push(p + s)));
['舊1', '舊2', '舊3', '舊4', '舊5', '舊6'].forEach(p => ['-1', '-2'].forEach(s => cages.push(p + s)));
['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].forEach(c => cages.push(c));
['母幼1', '母幼2', '住院1', '住院2'].forEach(c => cages.push(c));
const names = '小黑 小白 阿福 旺財 豆豆 妞妞 黑糖 奶茶 布丁 芝麻 皮皮 咖啡 球球 毛毛 胖虎 小花 花生 麻糬 可樂 雪球 大黃 米克斯 阿呆 招財 金寶 樂樂 糖糖 小虎 蛋黃 饅頭 嘟嘟 呆呆 黑皮 喜樂 平安 多多 來福 丸子 阿吉 小乖 啾啾 黑妞 小米 栗子 阿弟 黃金 波波 烏龍 小雨 冬瓜'.split(' ');
const notes = ['', '', '', '', '', '親人，會暴衝', '勿溜，腳傷休養中', '不親狗，要單獨溜', '怕打雷', '', '曾咬人，有攻擊傾向，戴嘴套', '', '剛結紮', '', '不要跟公狗一起', '', '很會拉', ''];
const days = [0, 0, 1, 2, 2, 3, 4, 5, 6, 8, 11, 15, 1, 0, 3, 22, 7, 2];
const dogs = names.map((name, i) => ({
  id: String(2025010100 + i * 7), name, cage: cages[i % cages.length],
  walkedDate: i === 17 ? '' : ago(days[i % days.length]), covered: false, myWalked: false,
  note: notes[i % notes.length], sex: i % 2 ? 'female' : 'male', intro: i % 3 ? '' : `${name}個性溫和，喜歡被摸頭。`,
  walkers: i % 4 ? ['abcdef123456'] : [], myWalkedDate: i % 4 ? ago(days[i % days.length]) : null, formerIds: [],
}));
const groups = { 小黑: ['小白', '阿福'], 小白: ['小黑', '阿福'], 阿福: ['小黑', '小白'], 豆豆: ['妞妞'], 妞妞: ['豆豆'] };
const data = { version: 1, syncedAt: `${today} 08:30`, dogs, groups,
  sheetNotes: [{ label: '異動', text: '新3B 本週轉住院' }],
  groupColumns: [{ column: 1, label: '新犬舍好朋友', names: ['小黑', '小白', '阿福', '豆豆', '妞妞'] }, { column: 2, label: '舊犬舍散步隊', names: ['皮皮', '咖啡', '球球'] }] };
let pack = { ok: true, source: 'd1', date: today, version: 0, walks: [] };

const json = (res, body, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const ep = url.pathname.slice(5);
    if (ep === 'walk' && req.method === 'POST') {
      let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
        const sent = JSON.parse(raw || '{}');
        const results = (sent.dogs || []).map(d => {
          const undo = sent.action === 'undo';
          const current = undo ? { date: ago(3), walker: '' } : { date: today, walker: sent.walker || sent.walkerName || '志工' };
          const row = { key: d.id || d.key, version: (pack.version || 0) + 1, walkedDate: current.date, walker: current.walker, syncStatus: 'pending', at: new Date().toISOString() };
          pack = { ...pack, version: pack.version + 1, walks: [...pack.walks.filter(w => w.key !== row.key), row] };
          return { ...d, status: undo ? 'restored' : 'written', accepted: true, requestId: sent.requestId, operationDate: today, version: row.version, current, syncStatus: 'pending', at: row.at };
        });
        setTimeout(() => json(res, { ok: true, source: 'd1', today, snapshot: pack, results }), 600);
      });
      return;
    }
    if (ep === 'dogs') return json(res, data);
    if (ep === 'today') return json(res, pack);
    if (ep === 'walkers') return json(res, { walkers: { abcdef123456: '小陳' }, dates: {}, names: ['小陳', '阿美', '志明', '春嬌'] });
    if (ep === 'rest') return json(res, { rest: {} });
    return json(res, { ok: true, walks: [], departures: [], ids: [], aliases: {}, activities: [], edits: [], cards: [] });
  }
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, () => console.log(`mock on http://localhost:${PORT}/ (today ${today})`));
