// #155 我的常溜：☆／★ 收藏，只存這支手機，找狗頁可直接篩
async function runFavTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords();
    const dog = (name, id, cage) => ({ name, id, cage, walkedDate: null, covered: false, note: '', intro: '', sex: '', formerIds: [] });
    allDogs = [dog('常溜甲', '2024100501', '新A03'), dog('常溜乙', '2024100502', '舊B04'), dog('常溜丙', '', '新A05')];
    groupMap = {}; searchQuery = ''; activeTab = 'find'; findView = 'list'; findZone = 'all'; findCage = null;
    const main = document.getElementById('main');
    const chip = () => main.querySelector('.find-chip[data-find-zone="fav"]');
    await check('#155 找狗分區按鈕最前面是「★ 我的常溜」；沒收藏時有提示', () => {
      render();
      eq(main.querySelector('.find-chips .find-chip').dataset.findZone, 'fav', '最前面：');
      eq(chip().textContent, '★ 我的常溜0', '按鈕字＋隻數：');
      chip().click();
      eq([findZone, findView], ['fav', 'list'], '篩常溜：');
      if (!main.querySelector('.status-msg').textContent.includes('「☆ 常溜」加進來')) throw new Error('沒收藏的提示不見了');
    });
    await check('#155 詳細資訊按「☆ 常溜」收藏、再按取消，找狗頁立即跟著變；不送伺服器', () => {
      const calls = fakeApi(() => Promise.reject(new Error('不該送出')));
      showDetail(allDogs[1]);
      const btn = () => document.getElementById('favToggle');
      eq([btn().textContent, btn().getAttribute('aria-pressed')], ['☆ 常溜', 'false'], '還沒收藏：');
      btn().click();
      eq([btn().textContent, btn().getAttribute('aria-pressed')], ['★ 我的常溜', 'true'], '收藏後：');
      eq([...main.querySelectorAll('.find-dog .find-name .n')].map(n => n.textContent), ['常溜乙'], '找狗頁只列收藏的：');
      eq(chip().textContent, '★ 我的常溜1', '隻數：');
      eq(!!main.querySelector('.find-dog .fav-mark'), true, '名字後面有小 ★：');
      eq(JSON.parse(phoneStore.get('bq-favs')), ['2024100502'], '存在這支手機：');
      eq(calls.length, 0, '沒有送到伺服器：');
      btn().click();
      eq(btn().textContent, '☆ 常溜', '再按取消：');
      eq(chip().textContent, '★ 我的常溜0', '取消後隻數：');
      hideDetail();
    });
    await check('#155 沒有編號的狗用名字記；重新整理（重讀手機存的）仍保留', () => {
      favorites.toggleFav(allDogs[2]); favorites.toggleFav(allDogs[0]);
      eq(favorites.loadFavs(), ['2024100501', '名:常溜丙'], '存的鍵：');
      findZone = 'all'; render();
      eq(chip().textContent, '★ 我的常溜2', '重畫後：');
      eq([...main.querySelectorAll('.find-dog')].filter(b => b.querySelector('.fav-mark')).map(b => b.querySelector('.n').textContent), ['常溜甲', '常溜丙'], '全部列表也標 ★：');
    });
    await check('#155 常溜可搜尋；切到平面圖就回到全部', () => {
      findZone = 'fav'; searchQuery = '乙'; render();
      eq(main.querySelector('.status-msg').textContent, '我的常溜裡找不到「乙」', '常溜裡搜尋：');
      eq(!!main.querySelector('.find-map-card'), false, '常溜不放地圖：');
      searchQuery = '甲'; render();
      eq([...main.querySelectorAll('.find-dog .n')].map(n => n.textContent), ['常溜甲'], '找得到：');
      searchQuery = ''; render();
      main.querySelector('[data-find-view="map"]').click();
      eq([findView, findZone], ['map', 'all'], '平面圖：');
      chip().click();
      eq([findView, findZone], ['list', 'fav'], '從平面圖按常溜回到列表：');
    });
  } finally {
    if (detailDog) hideDetail();
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, findView, findZone, findCage] = saved; restoreApi();
  }
}

async function runFavSyncTests() {
  await favorites.whenIdle();
  const saved = [allDogs, phoneStore, walkerCodesMemory, favorites, UPLOAD_URL];
  const code = 'abcdef123456', alias = '123456abcdef';
  const a = 'a'.repeat(32), b = 'b'.repeat(32);
  const books = { [code]: new Set(), [alias]: new Set() };
  let aliases = { '2024100501': a, '2018100501': a, '名:無編號': b };
  const calls = [], keyCalls = [];
  let offline = false;
  let pauseWrite = null;
  const device = () => { phoneStore = fakeStorage(); walkerCodesMemory = null; favorites = BQFavorites.create(); };
  try {
    UPLOAD_URL = 'https://favorites.test/api';
    fakeApi(async (name, arg) => {
      if (offline) throw new Error('offline');
      if (name === 'saveFavorite') {
        const input = arg;
        if (pauseWrite) await pauseWrite();
        calls.push(input);
        for (const c of input.codes) { if (input.on) books[c].add(input.dogId); else books[c].delete(input.dogId); }
        return apiJson({ ok: true });
      }
      if (name !== 'favorites') throw new Error(`不該呼叫 ${name}`);
      const params = new URLSearchParams(arg), codes = params.get('codes').split(','), keys = params.getAll('key');
      keyCalls.push(keys);
      // 跟 Worker 一樣只回常溜的狗和問到的鍵（#406）
      const ids = [...new Set(codes.flatMap(c => [...books[c]]))];
      const dogs = new Set([...ids, ...keys.map(k => aliases[k]).filter(Boolean)]);
      const picked = Object.fromEntries(Object.entries(aliases).filter(([, id]) => dogs.has(id)));
      return apiJson({ ok: true, aliases: picked, ids });
    });
    device();
    allDogs = [{ name: '甲', id: '2024100501', formerIds: ['2018100501'] }, { name: '無編號', id: '', formerIds: [] }];
    await check('#267 未設定名字可收藏；設定後自動合併舊編號、名字，未知資料保留', async () => {
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      eq(favorites.isFav(allDogs[0]), true);
      eq(calls.length, 0);
      phoneStore.writeJson(BQStore.keys.favs, ['2018100501', '名:無編號', '無法辨識']);
      saveMyCodes([code, alias]); await favorites.whenIdle();
      eq([...books[code]].sort(), [a, b].sort());
      eq([...books[alias]], [], '只寫第一個代號：');
      eq(phoneStore.readJson(BQStore.keys.favs, []), ['無法辨識']);
      eq(allDogs.map(favorites.isFav), [true, true]);
    });
    await check('#406 沒有舊格式常溜時，讀常溜不帶 key', async () => {
      keyCalls.length = 0;
      phoneStore.writeJson(BQStore.keys.favs, []);
      await favorites.syncFavs();
      eq(keyCalls, [[]]);
      eq(allDogs.map(favorites.isFav), [true, true], '常溜的狗仍認得：');
      phoneStore.writeJson(BQStore.keys.favs, ['無法辨識']);
    });
    await check('#680 切回網頁 5 分鐘內不重抓；有待送常溜、換身分或超過 5 分鐘才同步', async () => {
      const realNow = Date.now;
      try {
        let now = realNow(); Date.now = () => now;
        await favorites.syncFavs();
        const reads = () => keyCalls.length;
        const start = reads();
        now += 4 * 60 * 1000; await favorites.syncFavsOnReturn();
        eq(reads(), start, '4 分鐘內：');
        offline = true; favorites.toggleFav(allDogs[1]); await favorites.whenIdle(); offline = false;
        const pending = calls.length;
        await favorites.syncFavsOnReturn();
        eq(calls.length, pending + 1, '有待送的常溜照常重送：');
        const afterRetry = reads();
        now += 60 * 1000; await favorites.syncFavsOnReturn();
        eq(reads(), afterRetry, '重送後重新計時：');
        now += 5 * 60 * 1000; await favorites.syncFavsOnReturn();
        eq(reads(), afterRetry + 1, '超過 5 分鐘：');
        saveMyCodes([alias, code]); await favorites.whenIdle();
        const switched = reads();
        saveMyCodes([code, alias], { syncFavs: false });
        await favorites.syncFavsOnReturn();
        eq(reads(), switched + 1, '換了身分：');
        await favorites.syncFavs();
        eq(reads(), switched + 2, '直接同步（同步鈕、恢復連線）不受限：');
        favorites.toggleFav(allDogs[1]); await favorites.whenIdle();
      } finally { Date.now = realNow; }
    });
    const firstPhone = phoneStore;
    await check('#267 第二台讀回同一份；各自取消不同狗後兩邊改動都保留', async () => {
      device(); saveMyCodes([code, alias]); await favorites.whenIdle();
      eq(allDogs.map(favorites.isFav), [true, true]);
      favorites.toggleFav(allDogs[1]); await favorites.whenIdle();
      phoneStore = firstPhone; favorites = BQFavorites.create();
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      eq([...books[code]], []);
      eq(allDogs.map(favorites.isFav), [false, false]);
    });
    await check('#267 離線操作重開仍可重試；換編號仍顯示收藏，清除名字不串資料', async () => {
      offline = true;
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      eq(favorites.isFav(allDogs[0]), true);
      favorites = BQFavorites.create();
      eq(favorites.isFav(allDogs[0]), true, '離線操作保存在手機：');
      offline = false; await favorites.syncFavs();
      eq([...books[code]], [a]);
      aliases = { ...aliases, '2026101601': a };
      allDogs[0] = { ...allDogs[0], id: '2026101601', name: '改名' };
      await favorites.syncFavs();
      eq(favorites.isFav(allDogs[0]), true);
      saveMyCodes([]); await favorites.whenIdle();
      eq(favorites.isFav(allDogs[0]), false);
    });
    await check('#267 舊搬移回應較慢，不能刪掉清除名字後新加的訪客收藏', async () => {
      phoneStore.writeJson(BQStore.keys.favs, ['2026101601']);
      let release, started;
      const waiting = new Promise(resolve => { started = resolve; });
      pauseWrite = () => { started(); return new Promise(resolve => { release = resolve; }); };
      saveMyCodes([code]);
      await waiting;
      saveMyCodes([]);
      favorites.toggleFav(allDogs[0]); // 取消原本的本機收藏
      favorites.toggleFav(allDogs[0]); // 訪客新收藏
      pauseWrite = null; release();
      await favorites.whenIdle();
      eq(phoneStore.readJson(BQStore.keys.favs, []), ['2026101601']);
      eq(favorites.isFav(allDogs[0]), true);
    });
    await check('#267 離線取消後訪客重新收藏，設回原名字時以較晚的收藏為準', async () => {
      saveMyCodes([code]); await favorites.whenIdle();
      offline = true;
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      saveMyCodes([]); await favorites.whenIdle();
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      eq(favorites.isFav(allDogs[0]), true);
      saveMyCodes([code]); await favorites.whenIdle();
      offline = false; await favorites.syncFavs();
      eq([...books[code]], [a]);
      eq(favorites.isFav(allDogs[0]), true);
      eq(phoneStore.readJson(BQStore.keys.favs, []), []);
    });
    await check('#267 多次更名有九個代號仍可取消常溜，舊待送操作也只以單碼送出', async () => {
      device(); books[code] = new Set([a]);
      const codes = [code, ...Array.from({length:8}, (_, i) => (i+1).toString(16).padStart(12,'0'))];
      saveMyCodes(codes); await favorites.whenIdle();
      favorites.toggleFav(allDogs[0]); await favorites.whenIdle();
      eq([...books[code]], []); eq(calls.at(-1).codes, [code]);
      const stored = phoneStore.readJson(BQStore.keys.favsSync);
      stored.pending.push({ codes, dogId: a, on: true });
      phoneStore.writeJson(BQStore.keys.favsSync, stored);
      favorites = BQFavorites.create(); // 重開網頁後重試舊版留下的多代號操作
      await favorites.syncFavs();
      eq(calls.at(-1).codes, [code], '舊操作也正規化為單碼：');
    });
  } finally {
    await favorites.whenIdle();
    [allDogs, phoneStore, walkerCodesMemory, favorites, UPLOAD_URL] = saved; restoreApi();
    BQWalkUI.hideToast();
  }
}

// #155 K 2026-10-04 選「兩頁都放」：溜狗表也有「★ 我的常溜」（2026-10-08 起跟「全部」兩個選一個）
async function runWalkFavTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, walkFavMemory];
  const TODAY = new Date();
  const ymdDash = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const d = (name, id, days) => parseDogsData({ dogs: [{ id, name, cage: '舊A01', note: '', covered: false, walkedDate: ymdDash(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - days)) }] }).dogs[0];
  try {
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkFavMemory = false;
    allDogs = [d('常溜一', '2024100601', 9), d('常溜二', '2024100602', 1), d('常溜三', '2024100603', 12)];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    const main = document.getElementById('main');
    const names = () => [...main.querySelectorAll('.card .name')].map(n => n.textContent.trim());
    const favChip = () => main.querySelector('[data-walk-fav="1"]');
    await check('#155 溜狗表「全部」旁邊是「★ 我的常溜」；沒收藏時有提示', () => {
      render();
      eq([...main.querySelectorAll('.chips .chip')][1], favChip(), '第二個：');
      eq([favChip().textContent, favChip().getAttribute('aria-pressed')], ['★ 我的常溜0', 'false'], '還沒開：');
      favChip().click();
      eq(favChip().getAttribute('aria-pressed'), 'true', '開了：');
      if (!main.querySelector('.status-msg').textContent.includes('「☆ 常溜」加進來')) throw new Error('沒收藏的提示不見了');
    });
    await check('#155 溜狗表常溜只列收藏的；按「全部」回來；記在這支手機', () => {
      favorites.toggleFav(allDogs[0]); favorites.toggleFav(allDogs[1]);
      render();
      eq([favChip().textContent, names().sort()], ['★ 我的常溜2', ['常溜一', '常溜二']], '常溜：');
      main.querySelector('[data-walk-fav="0"]').click();
      eq(names().sort(), ['常溜一', '常溜三', '常溜二'], '全部：');
      eq(phoneStore.get('bq-walk-fav'), 'false', '存在手機：');
    });
  } finally {
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, walkFavMemory] = saved;
  }
}
