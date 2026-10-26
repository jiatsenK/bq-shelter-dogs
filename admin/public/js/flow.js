import { readFlowStatus } from './api.js';
import { VIEWS, parseFlowStatus, liveStatus, LEVEL_TEXT, edgesOf, nodeOf } from './flow-model.js';
import { byId, element } from './dom.js';

// 資料流頁（K 2026-10-26）：節點是按鈕、連線畫在節點底下的 SVG；點節點右側顯示詳細並亮起它的連線。
// 圖與說明在 flow-model.js；燈號每次開頁或按重新讀取讀一次 /api/manage/flow-status（只讀、0 寫入），不背景輪詢。
const SVG = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
let view = VIEWS[params.get('view')] ? params.get('view') : 'flow';
let selected = nodeOf(view, params.get('node'))?.id || '';
let status = null, statusError = '';

const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function saveUrl() {
  const next = new URLSearchParams();
  if (view !== 'flow') next.set('view', view);
  if (selected) next.set('node', selected);
  history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
}

function nodeState(node) {
  if (!node.live) return null;
  if (!status) return { level: 'unknown', text: statusError ? '讀不到' : '讀取中…', lines: [] };
  return liveStatus(node.live, status);
}

function renderGraph() {
  const v = VIEWS[view], grid = byId('flow-grid');
  grid.dataset.view = view;
  grid.style.gridTemplateColumns = `repeat(${v.cols}, var(--flow-node-width))`;
  grid.replaceChildren(...v.nodes.map(n => {
    const button = element('button', undefined, 'flow-node');
    button.type = 'button';
    button.dataset.id = n.id;
    button.style.gridColumn = String(n.col + 1);
    button.style.gridRow = String(n.row + 1);
    button.setAttribute('aria-pressed', String(n.id === selected));
    button.append(element('span', n.kind, 'flow-kind'), element('strong', n.title, 'flow-title'));
    const s = nodeState(n);
    if (s) {
      button.dataset.level = s.level;
      const line = element('span', undefined, 'flow-state');
      line.append(element('span', '', 'flow-dot'), element('span', `${LEVEL_TEXT[s.level]}・${s.text}`));
      button.append(line);
    }
    button.addEventListener('click', () => select(n.id === selected ? '' : n.id));
    return button;
  }));
  byId('flow-intro').textContent = v.intro;
  for (const tab of document.querySelectorAll('[data-view-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.viewTab === view));
  drawWires();
}

// 接點：節點那一邊的中點，shift 沿著那一邊錯開；控制點往那一邊的外側推，線才會彎出去再進來
function port(rect, side, shift = 0) {
  const x = { l: rect.left, r: rect.right, t: rect.left + rect.width / 2 + shift, b: rect.left + rect.width / 2 + shift }[side];
  const y = { t: rect.top, b: rect.bottom, l: rect.top + rect.height / 2 + shift, r: rect.top + rect.height / 2 + shift }[side];
  const [dx, dy] = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] }[side];
  return { x, y, dx, dy };
}

function drawWires() {
  const graph = byId('flow-graph'), wires = byId('flow-wires'), labelLayer = byId('flow-labels'), box = graph.getBoundingClientRect();
  const rects = new Map([...graph.querySelectorAll('.flow-node')].map(n => {
    const r = n.getBoundingClientRect();
    return [n.dataset.id, { left: r.left - box.left + graph.scrollLeft, right: r.right - box.left + graph.scrollLeft, top: r.top - box.top, bottom: r.bottom - box.top, width: r.width, height: r.height }];
  }));
  for (const layer of [wires, labelLayer]) { layer.setAttribute('width', graph.scrollWidth); layer.setAttribute('height', graph.scrollHeight); }
  const defs = svg('defs');
  for (const id of ['flow-arrow', 'flow-arrow-on']) {
    const marker = svg('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M0 0L10 5L0 10z', class: id }));
    defs.append(marker);
  }
  const lines = [], labels = [];
  for (const e of VIEWS[view].edges) {
    const a = rects.get(e.from[0]), b = rects.get(e.to[0]);
    if (!a || !b) continue;
    const p = port(a, e.from[1], e.from[2]), q = port(b, e.to[1], e.to[2]);
    // 接在同一邊（例如兩個都接上緣）時少彎一點，免得彎出圖外
    const pull = e.from[1] === e.to[1] ? 40 : Math.min(90, Math.max(36, Math.hypot(q.x - p.x, q.y - p.y) * 0.35));
    const c1 = { x: p.x + p.dx * pull, y: p.y + p.dy * pull }, c2 = { x: q.x + q.dx * pull, y: q.y + q.dy * pull };
    const on = selected && (e.from[0] === selected || e.to[0] === selected);
    const kind = `flow-wire${e.back ? ' back' : ''}${e.cron ? ' cron' : ''}${on ? ' on' : selected ? ' dim' : ''}`;
    lines.push(svg('path', { d: `M${p.x} ${p.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`, class: kind, 'marker-end': `url(#${on ? 'flow-arrow-on' : 'flow-arrow'})` }));
    // 標籤放在曲線中點（t=0.5）
    const mx = (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8, my = (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8;
    const text = svg('text', { x: mx, y: my, class: `flow-label${on ? ' on' : selected ? ' dim' : ''}`, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    text.textContent = e.label;
    labels.push(text);
  }
  // 線在節點底下，標籤在節點上面，標籤才不會被節點蓋住
  wires.replaceChildren(defs, ...lines);
  labelLayer.replaceChildren(...labels);
}

function renderDetail() {
  const panel = byId('flow-detail'), node = selected && nodeOf(view, selected);
  if (!node) {
    panel.replaceChildren(element('h2', '點一個節點看詳細'),
      element('p', '節點上的燈號是開頁時讀到的狀態；按「重新讀取」更新。沒有燈號的節點不看狀態。', 'flow-help'), legend());
    return;
  }
  const head = element('div', undefined, 'flow-detail-head');
  head.append(element('span', node.kind, 'flow-kind'), element('h2', node.title));
  const close = element('button', '關閉', 'btn btn-sm');
  close.type = 'button';
  close.addEventListener('click', () => select(''));
  head.append(close);
  const parts = [head];
  const s = nodeState(node);
  if (s) {
    const box = element('div', undefined, 'flow-live');
    box.dataset.level = s.level;
    const title = element('p', undefined, 'flow-live-title');
    title.append(element('span', '', 'flow-dot'), element('strong', `${LEVEL_TEXT[s.level]}：${s.text}`));
    box.append(title);
    if (s.lines.length) {
      const list = element('ul');
      list.append(...s.lines.map(t => element('li', t)));
      box.append(list);
    }
    if (statusError) box.append(element('p', statusError));
    parts.push(box);
  }
  const dl = element('dl', undefined, 'flow-facts');
  for (const [label, key] of [['做什麼', 'role'], ['資料', 'data'], ['什麼時候', 'trigger'], ['失敗時', 'failure'], ['程式', 'code']]) {
    dl.append(element('dt', label), element('dd', node.detail[key], key === 'code' ? 'flow-code' : undefined));
  }
  parts.push(dl);
  const links = edgesOf(view, node.id);
  if (links.length) {
    parts.push(element('h3', '連線'));
    const list = element('ul', undefined, 'flow-links');
    list.append(...links.map(e => {
      const out = e.from[0] === node.id, other = nodeOf(view, out ? e.to[0] : e.from[0]);
      const li = element('li');
      const go = element('button', `${out ? '→' : '←'} ${other.title}`, 'flow-link');
      go.type = 'button';
      go.addEventListener('click', () => select(other.id));
      li.append(go, element('span', `：${e.label}`));
      return li;
    }));
    parts.push(list);
  }
  panel.replaceChildren(...parts);
}

function legend() {
  const list = element('ul', undefined, 'flow-legend');
  for (const level of ['ok', 'warn', 'bad', 'info', 'none']) {
    const li = element('li');
    li.dataset.level = level;
    li.append(element('span', '', 'flow-dot'), element('span', { ok: '正常', warn: '注意：還在處理或有待比對的', bad: '有問題：失敗、被拒或過期', info: '資訊：只是最近一次的時間', none: '沒有紀錄：還沒跑過，不代表有問題' }[level]));
    list.append(li);
  }
  const wires = element('li', '實線是主要方向，虛線是回頭的線，點線是排程。', 'flow-legend-note');
  list.append(wires);
  return list;
}

// 重畫會換掉節點按鈕：焦點原本在節點或右側的連線上，就移到選到的那個節點（關閉時回到剛才那個），鍵盤操作不會掉到頁首
function select(id) {
  const active = document.activeElement, before = selected;
  const keep = active?.classList.contains('flow-node') || active?.closest?.('#flow-detail');
  selected = id;
  saveUrl();
  renderGraph();
  renderDetail();
  if (keep) byId('flow-grid').querySelector(`[data-id="${id || before}"]`)?.focus();
  requestAnimationFrame(drawWires);
}

async function load() {
  const reload = byId('reload'), note = byId('flow-status');
  reload.disabled = true;
  note.removeAttribute('data-error');
  note.textContent = '正在讀取狀態…';
  const result = await readFlowStatus();
  try {
    if (!result.ok) throw Error(result.data?.error);
    status = parseFlowStatus(result.data);
    statusError = '';
    // 同一個燈號來源在兩張圖都有，只算一次
    const keys = new Set(VIEWS.flow.nodes.concat(VIEWS.chain.nodes).map(n => n.live).filter(Boolean));
    const levels = [...keys].map(key => liveStatus(key, status).level);
    const bad = levels.filter(l => l === 'bad').length, warn = levels.filter(l => l === 'warn').length;
    note.textContent = `${new Date(status.readAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })} 讀取。${bad ? `${bad} 個燈號有問題。` : warn ? `${warn} 個燈號要注意。` : '燈號都正常或還沒有紀錄。'}`;
    if (bad) note.dataset.error = 'true';
  } catch (error) {
    status = null;
    statusError = `${error.message || '狀態讀取失敗'}。燈號暫時無法判斷，不代表正常，請重新讀取。`;
    note.dataset.error = 'true';
    note.textContent = statusError;
  }
  reload.disabled = false;
  renderGraph();
  renderDetail();
}

for (const tab of document.querySelectorAll('[data-view-tab]')) tab.addEventListener('click', () => {
  if (tab.dataset.viewTab === view) return;
  view = tab.dataset.viewTab;
  selected = '';
  select('');
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selected) select(''); });
byId('reload').addEventListener('click', load);
new ResizeObserver(() => drawWires()).observe(byId('flow-graph'));
renderGraph();
renderDetail();
load();
