// 狗狗變裝秀（#795）的規則：哪些狗能出題、選項、拉近狗臉、裝飾戴在哪。不碰 DOM，畫面在 games.js。
// 臉部位置檔 data/dog-faces.json 由 scripts/dog-faces.py 產生：編號 → { photoVersion, le, re, nose, lip, chin, top }，
// 都是照片比例座標（0～1），左右以畫面為準。

export const Q_COUNT = 10;
export const LIMIT_MS = 10000;

export function shuffle(list, rand = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 能出題的狗：在所（/api/dogs 有列）、有編號、有照片、名字不是括號開頭（暫定），
// 而且臉部位置檔有這隻、算位置時的照片版本跟現在一樣（換過照片沒重跑腳本就先不出題）
export function playableDogs(data, faces) {
  const versions = data && data.photoVersions && typeof data.photoVersions === 'object' ? data.photoVersions : {};
  const text = v => (v == null ? '' : String(v).trim());
  const out = [];
  for (const d of (data && Array.isArray(data.dogs) ? data.dogs : [])) {
    const id = text(d && d.id), name = text(d && d.name);
    if (!id || !name || /^[(（]/.test(name)) continue;
    const version = versions[`photos/${id}.jpg`];
    const face = faces && Object.hasOwn(faces, id) ? faces[id] : null;
    if (!version || !face || face.photoVersion !== version) continue;
    out.push({ id, name, face, photo: `photos/${encodeURIComponent(id)}.jpg?v=${version}`,
      thumb: `photos/thumbs/${encodeURIComponent(id)}.jpg?v=${versions[`photos/thumbs/${id}.jpg`] || version}` });
  }
  return out;
}

// 選項：答案加 3 個名字。有長相（4×4 色塊）時從顏色最像的 6 隻隨機挑，名字不重複
export function optionNames(answer, dogs, sigs, rand = Math.random) {
  const others = dogs.filter(d => d.name !== answer.name);
  const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const mine = sigs[answer.id];
  const pool = mine
    ? shuffle(others.filter(d => sigs[d.id]).sort((a, b) => dist(mine, sigs[a.id]) - dist(mine, sigs[b.id])).slice(0, 6), rand)
    : [];
  const names = [];
  for (const d of [...pool, ...shuffle(others, rand)]) {
    if (!names.includes(d.name)) names.push(d.name);
    if (names.length === 3) break;
  }
  return shuffle([answer.name, ...names], rand);
}

// 照片比例座標換成正方形方框裡的百分比（照片用 object-fit: cover 置中裁切）
export function toBox([w, h], [u, v]) {
  const s = Math.max(1 / w, 1 / h);
  return [(.5 + (u - .5) * w * s) * 100, (.5 + (v - .5) * h * s) * 100];
}

// 拉近狗臉：兩眼距離放大到方框約 22%，最大 2.6 倍、不超過照片短邊每 300 像素 1 倍、最少 1.12 倍；
// 兩眼中點移到 (50%, 54%)（上面留位置給帽子），邊緣留 4%，照片不露出空白
export function zoomToFace(size, f, rand = Math.random) {
  const le = toBox(size, f.le), re = toBox(size, f.re);
  const o = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  const d = Math.max(Math.hypot(re[0] - le[0], re[1] - le[1]), 1);
  const cap = Math.max(1.12, Math.min(size[0], size[1]) / 300);
  const k = Math.min(2.6, cap, Math.max(1.12, 22 / d));
  const target = [50, 54], m = 4;
  const t = o.map((v, i) => Math.min(k * v - v - m, Math.max(100 - v - k * (100 - v) + m, target[i] - v)));
  const deg = (rand() - .5) * 8;
  return { o, t, k, deg };
}

const star = (cx, cy, R, r) => 'M' + Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 5 * i - Math.PI / 2, l = i % 2 ? r : R; return `${(cx + l * Math.cos(a)).toFixed(1)} ${(cy + l * Math.sin(a)).toFixed(1)}`; }).join(' L') + 'Z';
const heart = (cx, cy) => `M${cx} ${cy + 28} C${cx - 50} ${cy - 5} ${cx - 30} ${cy - 38} ${cx} ${cy - 14} C${cx + 30} ${cy - 38} ${cx + 50} ${cy - 5} ${cx} ${cy + 28}Z`;

// 19 種裝飾（天使光環 K 要求拿掉，不要加回來）。裝飾以兩眼距離 d 當尺寸單位、跟著兩眼連線轉角度。
// slot：佔用臉的哪一區，同一區只放一個；at：貼在哪個臉部位置；w：寬度是 d 的幾倍；o：裝飾圖裡要對準那個位置的點（寬高比例）；vb：viewBox 寬高
export const DECOS = {
  // 頭頂
  santa: { slot: ['head'], at: 'top', w: 2.3, o: [.5, .8], vb: [200, 150], svg: `<path d="M30 118 Q70 10 150 22 Q178 40 176 70 L160 66 Q150 48 132 48 Q120 90 170 118Z" fill="#d23a2f"/><rect x="18" y="104" width="164" height="34" rx="17" fill="#fff"/><circle cx="170" cy="74" r="18" fill="#fff"/>` },
  party: { slot: ['head'], at: 'top', w: 1.3, o: [.5, .9], vb: [100, 130], svg: `<path d="M50 6 L90 120 L10 120Z" fill="#7a5cf0"/><path d="M30 64 L70 64 L76 82 L24 82Z M18 100 L82 100 L88 118 L12 118Z" fill="#f2b33d"/><circle cx="50" cy="8" r="9" fill="#ff6fae"/>` },
  flowers: { slot: ['head'], at: 'top', w: 2.4, o: [.5, .55], vb: [200, 70], svg: `<path d="M6 46 Q100 0 194 46" stroke="#3f8f3a" stroke-width="5" fill="none"/><circle cx="24" cy="38" r="13" fill="#ff8fb6"/><circle cx="58" cy="22" r="14" fill="#ffd45c"/><circle cx="100" cy="14" r="15" fill="#ff6f61"/><circle cx="142" cy="22" r="14" fill="#9ad3ff"/><circle cx="176" cy="38" r="13" fill="#ffd45c"/>` },
  witch: { slot: ['head'], at: 'top', w: 2.4, o: [.5, .86], vb: [200, 170], svg: `<path d="M60 142 L108 10 Q118 -2 124 14 L146 142Z" fill="#4b3470"/><ellipse cx="100" cy="146" rx="96" ry="18" fill="#3d2a5c"/><path d="M64 124 L142 124 L146 142 L60 142Z" fill="#f2b33d"/><rect x="94" y="122" width="22" height="22" rx="3" fill="none" stroke="#3d2a5c" stroke-width="4"/>` },
  bunny: { slot: ['head'], at: 'top', w: 2.1, o: [.5, .88], vb: [200, 160], svg: `<ellipse cx="66" cy="66" rx="22" ry="60" transform="rotate(-14 66 66)" fill="#fff" stroke="#ffb3cd" stroke-width="5"/><ellipse cx="66" cy="72" rx="9" ry="40" transform="rotate(-14 66 72)" fill="#ffb3cd"/><ellipse cx="134" cy="66" rx="22" ry="60" transform="rotate(14 134 66)" fill="#fff" stroke="#ffb3cd" stroke-width="5"/><ellipse cx="134" cy="72" rx="9" ry="40" transform="rotate(14 134 72)" fill="#ffb3cd"/><path d="M14 152 Q100 112 186 152" stroke="#ff8fb6" stroke-width="12" fill="none" stroke-linecap="round"/>` },
  horns: { slot: ['head'], at: 'top', w: 2.2, o: [.5, .95], vb: [200, 90], svg: `<path d="M40 88 Q18 42 44 4 Q52 52 80 80Z M160 88 Q182 42 156 4 Q148 52 120 80Z" fill="#d6303a"/>` },
  tiara: { slot: ['head'], at: 'top', w: 1.9, o: [.5, .9], vb: [200, 80], svg: `<path d="M10 76 L30 38 L62 58 L100 6 L138 58 L170 38 L190 76Z" fill="#eef2fa" stroke="#aab6cc" stroke-width="4" stroke-linejoin="round"/><circle cx="100" cy="44" r="11" fill="#ff5c9a"/><circle cx="34" cy="60" r="7" fill="#58b4ff"/><circle cx="166" cy="60" r="7" fill="#58b4ff"/>` },
  // 眼睛（模型的眼睛點最準）；蝙蝠面具連頭頂一起佔
  batmask: { slot: ['head', 'eyes'], at: 'eyes', w: 2.94, o: [.5, .64], vb: [200, 110], svg: `<path d="M18 64 L34 4 L66 44 Q100 36 134 44 L166 4 L182 64 Q190 96 150 100 Q118 102 100 82 Q82 102 50 100 Q10 96 18 64Z" fill="#1d1d24"/><ellipse cx="66" cy="70" rx="20" ry="13" fill="#fff" opacity=".18"/><ellipse cx="134" cy="70" rx="20" ry="13" fill="#fff" opacity=".18"/>` },
  shades: { slot: ['eyes'], at: 'eyes', w: 1.89, o: [.5, .52], vb: [200, 64], svg: `<rect x="8" y="10" width="78" height="46" rx="20" fill="#14141a"/><rect x="114" y="10" width="78" height="46" rx="20" fill="#14141a"/><rect x="80" y="20" width="40" height="8" rx="4" fill="#14141a"/><rect x="20" y="18" width="26" height="9" rx="4" fill="#fff" opacity=".35"/>` },
  hearts: { slot: ['eyes'], at: 'eyes', w: 2, o: [.5, .5], vb: [200, 80], svg: `<path d="${heart(50, 40)} ${heart(150, 40)}" fill="#ff4f8b"/><rect x="86" y="26" width="28" height="7" rx="3" fill="#ff4f8b"/><ellipse cx="34" cy="28" rx="8" ry="5" fill="#fff" opacity=".5"/>` },
  stars: { slot: ['eyes'], at: 'eyes', w: 2, o: [.5, .52], vb: [200, 80], svg: `<path d="${star(50, 42, 42, 19)} ${star(150, 42, 42, 19)}" fill="#ffcc33" stroke="#e08a00" stroke-width="4" stroke-linejoin="round"/><rect x="84" y="34" width="32" height="7" rx="3" fill="#e08a00"/>` },
  nerd: { slot: ['eyes'], at: 'eyes', w: 2, o: [.5, .5], vb: [200, 80], svg: `<circle cx="50" cy="40" r="33" fill="#fff" fill-opacity=".18" stroke="#3b2a1a" stroke-width="7"/><circle cx="150" cy="40" r="33" fill="#fff" fill-opacity=".18" stroke="#3b2a1a" stroke-width="7"/><path d="M84 36 Q100 24 116 36" stroke="#3b2a1a" stroke-width="7" fill="none"/>` },
  bandit: { slot: ['eyes'], at: 'eyes', w: 2.4, o: [.5, .5], vb: [240, 90], svg: `<path fill-rule="evenodd" d="M8 40 Q20 12 70 16 Q120 26 170 16 Q220 12 232 40 Q228 72 180 74 Q140 76 120 60 Q100 76 60 74 Q12 72 8 40Z M50 45 a20 13 0 1 0 40 0 a20 13 0 1 0 -40 0Z M150 45 a20 13 0 1 0 40 0 a20 13 0 1 0 -40 0Z" fill="#2a3a8f"/>` },
  patch: { slot: ['eyes'], at: 'le', w: 2.4, o: [.29, .5], vb: [200, 80], svg: `<path d="M0 18 L200 60" stroke="#14141a" stroke-width="6"/><ellipse cx="58" cy="40" rx="34" ry="30" fill="#14141a"/>` },
  monocle: { slot: ['eyes'], at: 're', w: .9, o: [.5, .3], vb: [100, 140], svg: `<circle cx="50" cy="42" r="36" fill="#fff" fill-opacity=".2" stroke="#d9a520" stroke-width="7"/><path d="M50 78 Q62 110 40 138" stroke="#d9a520" stroke-width="3" fill="none"/>` },
  // 口鼻
  clown: { slot: ['nose', 'mouth'], at: 'nose', w: .62, o: [.5, .5], vb: [100, 100], svg: `<circle cx="50" cy="50" r="46" fill="#e8323c"/><ellipse cx="36" cy="34" rx="12" ry="8" fill="#fff" opacity=".55"/>` },
  stache: { slot: ['mouth'], at: 'lip', w: 1.4, o: [.5, .3], vb: [200, 70], svg: `<path d="M100 22 Q70 0 40 18 Q14 34 4 22 Q8 62 52 58 Q86 54 100 36 Q114 54 148 58 Q192 62 196 22 Q186 34 160 18 Q130 0 100 22Z" fill="#3a2414"/>` },
  // 脖子
  bow: { slot: ['neck'], at: 'neck', w: 1.2, o: [.5, .5], vb: [120, 70], svg: `<path d="M60 35 L8 6 Q0 35 8 64Z M60 35 L112 6 Q120 35 112 64Z" fill="#e2405f"/><rect x="48" y="22" width="24" height="26" rx="8" fill="#b82c49"/>` },
  bowtie: { slot: ['neck'], at: 'neck', w: 1.2, o: [.5, .5], vb: [120, 60], svg: `<path d="M60 30 L6 4 L6 56Z M60 30 L114 4 L114 56Z" fill="#2a6fd6"/><circle cx="26" cy="20" r="5" fill="#fff"/><circle cx="24" cy="42" r="5" fill="#fff"/><circle cx="94" cy="20" r="5" fill="#fff"/><circle cx="96" cy="42" r="5" fill="#fff"/><rect x="50" y="20" width="20" height="20" rx="5" fill="#1d4f9e"/>` },
};

// 挑最多 3 個裝飾、算好每個在方框裡的位置（百分比）與角度。回傳 [{ key, left, top, width, height, ox, oy, deg }]
export function dressUp(size, f, rand = Math.random) {
  const box = p => toBox(size, p);
  const le = box(f.le), re = box(f.re), nose = box(f.nose), chin = box(f.chin);
  const eyes = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2];
  const d = Math.max(Math.hypot(re[0] - le[0], re[1] - le[1]), 6);
  const rad = Math.atan2(re[1] - le[1], re[0] - le[0]);
  // 脖子沿兩眼連線的垂直方向往下（側臉才不會跑到旁邊）：取眼鼻距離 3.1 倍、下巴再往下 0.35 個兩眼距離比較遠的，
  // 抬頭張嘴的狗才不會戴到嘴上（scripts/dog-faces.py 的對照表用同一個算法）
  const ax = [-Math.sin(rad), Math.cos(rad)];
  const far = Math.max(Math.hypot(nose[0] - eyes[0], nose[1] - eyes[1]) * 3.1, (chin[0] - eyes[0]) * ax[0] + (chin[1] - eyes[1]) * ax[1] + d * .35);
  const spots = { eyes, le, re, nose, top: box(f.top), lip: box(f.lip), neck: [eyes[0] + ax[0] * far, eyes[1] + ax[1] * far] };
  const used = new Set(), keys = [];
  for (const key of shuffle(Object.keys(DECOS), rand)) {
    const k = DECOS[key];
    if (k.slot.some(s => used.has(s))) continue;
    if (k.at === 'neck' && spots.neck[1] > 92) continue; // 超出照片下緣 92%，脖子那區不放
    k.slot.forEach(s => used.add(s));
    keys.push(key);
    if (keys.length === 3) break;
  }
  return keys.map(key => {
    const k = DECOS[key], [x, y] = spots[k.at], width = k.w * d, height = width * k.vb[1] / k.vb[0];
    return { key, left: x - k.o[0] * width, top: y - k.o[1] * height, width, height, ox: k.o[0], oy: k.o[1], deg: rad * 180 / Math.PI };
  });
}

// 一題的分數：答對 100 分，再加剩下時間的比例（最多 100）
export function points(usedMs) {
  return 100 + Math.round(100 * Math.max(0, 1 - usedMs / LIMIT_MS));
}
