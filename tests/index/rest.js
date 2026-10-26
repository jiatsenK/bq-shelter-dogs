// ── 暫住、休養中（K 2026-10-09 阿拉丁：剛動完手術不能溜，暫時搬到獨立籠）──
async function runRestTests() {
  const saved = [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, restMap, restEdit];
  const main = document.getElementById('main');
  const box = main.parentElement;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const T = new Date();
  const ymd = d => isoDay(d);
  const ago = n => { const d = new Date(T); d.setDate(d.getDate() - n); return d; };
  const later = n => { const d = new Date(T); d.setDate(d.getDate() + n); return d; };
  try {
    box.classList.remove('hidden');
    await check('暫住：試算表「(阿拉丁)」這種括號名字、沒有編號的列，合到同名那隻；籠位換成暫住的那籠，原本的記著', () => {
      const dogs = mergeTempCages([
        { id: '9601', name: '暫住甲', cage: '新B04' },
        { id: '', name: '(暫住甲)', cage: '舊B16' },
        { id: '', name: '（沒這隻）', cage: '舊B17' },
        { id: '9602', name: '一般乙', cage: 'A01' },
      ]);
      eq(dogs.map(d => [d.name, d.cage, d.homeCage || '']), [['暫住甲', '舊B16', '新B04'], ['（沒這隻）', '舊B17', ''], ['一般乙', 'A01', '']], '合併：');
      const card = document.createElement('div');
      card.innerHTML = dogCard(dogs[0], T);
      eq(card.querySelector('.temp-cage') && card.querySelector('.temp-cage').textContent, '暫住，原本 新B04', '狗卡：');
    });
    UPLOAD_URL = 'https://worker.test';
    allDogs = [
      { id: '9611', name: '休養甲', cage: 'A01', note: '', covered: false, walkedDate: ago(20) },
      { id: '9612', name: '一般乙', cage: 'A02', note: '', covered: false, walkedDate: ago(1) },
      { id: '9613', name: '固定丙', cage: 'A03', note: '', covered: true, walkedDate: null },
    ];
    groupMap = {}; activeTab = 'walk'; searchQuery = '';
    phoneStore = fakeStorage(); walkRecords = freshWalkRecords(); walkerNameMemory = '';
    restMap = { '9611': { until: ymd(later(3)), reason: '術後休養' } };
    render();
    await check('休養中：排在溜狗表最下面（有人固定照顧也在它上面），色籤寫「休養中」，沒有溜了；過了日期自動恢復', () => {
      eq([...main.querySelectorAll('.card .name')].map(n => n.firstChild.textContent), ['一般乙', '固定丙', '休養甲'], '順序：');
      const card = main.querySelector('.card[data-dog="0"]');
      eq([card.querySelector('.last .val').classList.contains('rest'), card.querySelector('.last').textContent.includes('休養中'), !!card.querySelector('.walk-btn')], [true, true, false], '狗卡：');
      eq(computeStatus(allDogs[0], later(3)).kind, 'rest', '最後一天還在休養：');
      eq(computeStatus(allDogs[0], later(4)).kind, 'dated', '隔天恢復：');
    });
    await check('休養中：詳細資訊寫「10/20 前暫停帶出」，底部沒有溜了；最下面有管理用的「改休養設定」', () => {
      showDetail(allDogs[0]);
      const d = document.getElementById('detail');
      eq([!!d.querySelector('.rest-note'), !!document.getElementById('groupWalk'), !!document.getElementById('restEdit')], [true, false, true], '詳細資訊：');
      if (!d.querySelector('.rest-note').textContent.includes('術後休養')) throw new Error('要寫原因');
      hideDetail();
    });
    await check('休養設定（ADR 0004）：不用通關碼、要先選名字，PUT /rest/編號 帶 editor；成功後這支手機馬上排到下面', async () => {
      const calls = fakeApi((name, id, b) => json({ ok: true, id: '9612', rest: { until: b.until, reason: b.reason } }));
      showDetail(allDogs[1]);
      document.getElementById('restEdit').click();
      eq([!!document.querySelector('#detail input[type="password"]'), document.getElementById('restReason').value], [false, '術後休養'], '表單沒有通關碼：');
      document.getElementById('restForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 20));
      eq([restEdit && restEdit.phase, restEdit && restEdit.error, calls.length], ['error', NEED_EDITOR, 0], '沒選名字：');
      saveWalkerName('志工我');
      document.getElementById('restForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 20));
      eq([calls.length, calls[0][0], calls[0][1], calls[0][2].reason, calls[0][2].editor, 'passcode' in calls[0][2]], [1, 'saveRest', '9612', '術後休養', '志工我', false], '送出：');
      eq([restEdit, computeStatus(allDogs[1], T).kind], [null, 'rest'], '成功：');
      hideDetail(); BQWalkUI.hideToast();
      eq([...main.querySelectorAll('.card .name')].map(n => n.firstChild.textContent), ['固定丙', '休養甲', '一般乙'], '設好的那隻也排到最下面：');
    });
    await check('#285 移除完整狗卡頂部警語，首頁警語與備註原文保留', () => {
      const dog = { id: '2021021703', name: '警語測試', cage: 'A1', note: '不親狗，請保持距離。', intro: '' };
      const detail = document.createElement('div'); detail.innerHTML = detailHtml(dog, new Date());
      eq(detail.querySelector('.info .warn-note'), null);
      eq(detail.querySelector('[data-section="note"] .note-text').textContent, dog.note);
      const card = document.createElement('div'); card.innerHTML = dogCard(dog, new Date());
      eq(card.querySelector('.warn-note .text').textContent, dog.note);
    });
    await check('#285 保留早上版面，入所逐次列日期與原因並可編輯，同號可有不同事件', async () => {
      const dog = parseDogsData({ dogs: [{ id: '2021021703', name: '測試狗', cage: 'A1', intro: '保留完整原介紹', formerIds: ['2015081801'], intakeEvents: [
        { number: '2021021703', date: '2021-02-17', event: '迷路入所' },
        { number: '2021021703', date: '2026-01-02', event: '領養退回' },
      ] }] }).dogs[0];
      try {
        showDetail(dog);
        eq([...document.querySelectorAll('.intake-list time')].map(el => el.textContent), ['2015/08/18', '2021/02/17', '2026/01/02'], '舊編號那次也列成入所：');
        eq(document.querySelectorAll('.intake-number').length, 0, '閱讀不逐筆重複編號，編輯仍保留對應編號：');
        eq(document.querySelector('[data-section="intro"] .content').textContent, dog.intro);
        if (!document.querySelector('[data-section="walks"]') || !document.getElementById('staysEdit')) throw new Error('保留早上其他區塊');
        document.getElementById('introEdit').click();
        eq([...document.querySelectorAll('[data-intake-field="number"]')].map(el => el.value), ['2021021703', '2021021703']);
        const reason = document.querySelector('[data-intake-row="1"][data-intake-field="event"]');
        reason.value = '領養退回（補正）'; reason.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('intakeAdd').click();
        eq(document.querySelectorAll('.intake-row').length, 3);
        document.querySelector('[data-intake-remove="2"]').click();
        const calls = [];
        fakeApi((name, id, body) => { calls.push(body); return json({ ok: true, intro: body.text, intakeEvents: body.events }); });
        document.getElementById('introForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 20));
        eq(calls, [{ editor: '志工我', text: dog.intro, events: [dog.intakeEvents[0], { ...dog.intakeEvents[1], event: '領養退回（補正）' }] }]);
        eq(document.querySelectorAll('.intake-list li').length, 3);
        eq(document.querySelectorAll('.intake-event')[1].textContent, '領養退回（補正）');
      } finally { hideDetail(); BQWalkUI.hideToast(); delete introOverrides[dog.id]; }
    });
    await check('入所介紹（10-10）：直接點那一段就能改（不另外放按鈕）、不用通關碼、帶 editor，PUT /intro/編號；存好這台馬上看到，不寫試算表', async () => {
      const calls = fakeApi((name, id, b) => json({ ok: true, id: '9613', intro: b.text }));
      showDetail(allDogs[2]);
      eq([document.getElementById('introEdit').closest('[data-section]').dataset.section, document.getElementById('introEdit').getAttribute('aria-label'), document.querySelectorAll('#detail [data-section="rest"] .admin-btn').length], ['intro', '補入所介紹', 1], '沒介紹：那一段本身可以點，管理用只剩設定休養中：');
      document.getElementById('introEdit').click();
      eq([!!document.querySelector('#detail .detail-bar [form="introForm"]'), !!document.querySelector('#detail .detail-bar #groupWalk')], [true, false], '底部列換成儲存介紹、溜了收起來：');
      const text = document.getElementById('introText');
      text.value = '  親人\n喜歡散步  '; text.dispatchEvent(new Event('input', { bubbles: true }));
      eq(document.querySelector('.intro-count').textContent, '11 / 1000 字', '字數：');
      eq(!!document.querySelector('#detail input[type="password"]'), false, '沒有通關碼欄：');
      document.getElementById('introForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 20));
      eq([calls.length, calls[0][0], calls[0][1], calls[0][2].text], [1, 'saveIntro', '9613', '親人\n喜歡散步'], '送出：');
      eq(calls[0][2].editor, '志工我', '帶名字：');
      eq([introEdit, introOf(allDogs[2])], [null, '親人\n喜歡散步'], '成功：');
      eq(document.querySelector('[data-section="intro"] .content').textContent, '親人\n喜歡散步', '馬上看到：');
      eq(document.getElementById('introEdit').getAttribute('aria-label'), '改入所介紹', '有介紹：點了是改：');
      if (calls.some(c => c[0] === 'walk')) throw new Error('不應該寫試算表');
      hideDetail(); BQWalkUI.hideToast();
      delete introOverrides['9613'];
    });
    // #639（ADR 0021）：舊編號併進出入所表。測試狗只有目前編號 9613（看不出日期，入所日空著）
    const staysHelpers = () => {
      const set = (i, field, v) => {
        const el = document.querySelector(`[data-stay-row="${i}"][data-stay-field="${field}"]`);
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const submit = async () => {
        document.getElementById('staysForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 20));
      };
      const edit = () => document.getElementById('staysEdit').click();
      return { set, submit, edit };
    };
    const sortedStays = stays => [...stays].sort((x, y) => x.in.localeCompare(y.in));
    await check('舊編號（#289、#639）：在出入所表新增一列填編號就是補、刪掉那一列就是刪，PUT /stays/編號；入所日跟著編號、入所標籤馬上改', async () => {
      const calls = [];
      fakeApi((name, id, b) => {
        calls.push([name, id, b]);
        if (b.stays.some(s => s.number === '2015010101')) return json({ ok: false, error: '編號屬於另一隻狗，不能合併' }, 409);
        return json({ ok: true, id: '9613', stays: sortedStays(b.stays) });
      });
      const dog = allDogs[2];
      const before = { stays: dog.stays, formerIds: dog.formerIds };
      const { set, submit, edit } = staysHelpers();
      try {
        delete dog.stays; dog.formerIds = [];
        showDetail(dog);
        eq([document.querySelector('#detail .stay-lines'), document.getElementById('staysEdit').textContent], [null, '＋補出入所紀錄'], '只有目前編號：不列，只留補的入口：');
        edit();
        eq([document.querySelector('[data-stay-row="0"][data-stay-field="number"]').readOnly, document.querySelector('[data-stay-remove="0"]')], [true, null], '目前編號那列不能改、不能刪：');
        document.getElementById('staysAdd').click();
        set(1, 'number', '123');
        await submit();
        eq([calls.length, document.querySelector('#staysForm [role="alert"]').textContent], [0, '編號要是 10 碼數字，前 8 碼是入所日期'], '格式不對先擋，不送出：');
        set(1, 'number', '2015010101');
        const day = document.querySelector('[data-stay-row="1"][data-stay-field="in"]');
        eq([day.value, day.readOnly], ['2015-01-01', true], '入所日跟著編號、不能另外改：');
        await submit();
        eq([calls.length, document.querySelector('#staysForm [role="alert"]').textContent, document.querySelector('[data-stay-row="1"][data-stay-field="number"]').value], [1, '編號屬於另一隻狗，不能合併', '2015010101'], 'Worker 擋下：原因寫出來、打的字留著：');
        set(1, 'number', ' 2015081801 ');
        await submit();
        eq([calls.length, calls[1][0], calls[1][2].editor, calls[1][2].stays[1]], [2, 'saveStays', '志工我', { number: '2015081801', in: '2015-08-18', out: '', reason: '' }], '送出：帶選好的名字、整張表：');
        eq([staysEdit, dog.formerIds, ymd(BQDates.firstIntake(dog))], [null, ['2015081801'], '2015-08-18'], '成功：舊編號跟著表、入所日改從最舊的編號算：');
        if (!document.querySelector('#detail .chips').textContent.includes('入所 2015/8')) throw new Error('入所標籤沒有跟著改');
        if (!document.querySelector('#detail .stay-lines').textContent.includes('2015/08/18入所')) throw new Error('出入所紀錄沒有列出補的編號那次入所');
        edit();
        document.querySelector('[data-stay-remove="1"]').click();
        await submit();
        eq([calls[2][2].stays, dog.formerIds], [[{ number: '9613', in: '', out: '', reason: '' }], []], '刪掉那一列就刪掉舊編號：');
        if (calls.some(c => c[0] === 'walk')) throw new Error('不應該寫試算表');
      } finally {
        Object.assign(dog, before);
        if (!before.stays) delete dog.stays;
        staysEdit = null;
        hideDetail(); BQWalkUI.hideToast();
      }
    });
    await check('出入所紀錄（#333）：照時間列出；整張表 PUT /stays/編號、帶改之前的表；入所日取最早；別人剛改過就提示重新整理', async () => {
      const calls = [];
      let conflict = false;
      fakeApi((name, id, b) => {
        calls.push([name, id, b]);
        if (conflict) return json({ ok: false, error: '別人剛改過，請重新整理再改' }, 409);
        return json({ ok: true, id: '9613', stays: sortedStays(b.stays) });
      });
      const dog = allDogs[2];
      const before = { stays: dog.stays, formerIds: dog.formerIds };
      const { set, submit, edit } = staysHelpers();
      const current = { number: '9613', in: '', out: '', reason: '' };
      try {
        delete dog.stays; dog.formerIds = [];
        showDetail(dog);
        edit();
        document.getElementById('staysAdd').click();
        set(1, 'in', '2019-03-01'); set(1, 'out', '2019-02-01');
        await submit();
        eq([calls.length, document.querySelector('#staysForm [role="alert"]').textContent], [0, '離所日不能早於入所日'], '離所早於入所先擋：');
        set(1, 'out', '2019-06-01'); set(1, 'outReason', '整修移所');
        document.getElementById('staysAdd').click();
        set(2, 'in', '2015-08-18'); set(2, 'reason', '迷路');
        await submit();
        eq([calls.length, calls[0][0], calls[0][1], calls[0][2].editor, calls[0][2].before], [1, 'saveStays', '9613', '志工我', [current]], '送出：帶名字和改之前的表：');
        eq(calls[0][2].stays, [current, { number: '', in: '2019-03-01', out: '2019-06-01', reason: '', outReason: '整修移所' }, { number: '', in: '2015-08-18', out: '', reason: '迷路' }], '整張送出（離所原因有填才帶）：');
        eq([staysEdit, ymd(BQDates.firstIntake(dog))], [null, '2015-08-18'], '成功：入所日改從最早那次算：');
        eq([...document.querySelectorAll('[data-section="intro"] .stay-lines li')].map(li => li.textContent), ['2015/08/18入所迷路', '2019/03/01入所', '2019/06/01離所整修移所', '日期未確認入所'], '一行一件事，入所／離所在原因前面：');
        if (!document.querySelector('#detail .chips').textContent.includes('入所 2015/8')) throw new Error('入所標籤沒有跟著改');
        // 刪掉一列：送出的 before 是剛剛存好的表
        edit();
        document.querySelector('[data-stay-remove="1"]').click();
        await submit();
        eq([calls[1][2].before.length, calls[1][2].stays], [3, [current, { number: '', in: '2019-03-01', out: '2019-06-01', reason: '', outReason: '整修移所' }]], '刪一列：');
        eq(ymd(BQDates.firstIntake(dog)), '2019-03-01', '刪了就回到剩下最早的：');
        conflict = true;
        edit();
        set(1, 'outReason', '移所');
        await submit();
        eq([document.querySelector('#staysForm [role="alert"]').textContent, dog.stays[1].outReason], ['別人剛改過，請重新整理再改', '整修移所'], '別人剛改過：提示、不改這台的資料：');
        if (calls.some(c => c[0] === 'walk')) throw new Error('不應該寫試算表');
      } finally {
        Object.assign(dog, before);
        if (!before.stays) delete dog.stays;
        staysEdit = null;
        hideDetail(); BQWalkUI.hideToast();
      }
    });
    // #481：只觀察表單與 API，保護共用狀態轉換前後的既有行為。
    for (const spec of [
      { name: '入所介紹', open: 'introEdit', form: 'introForm', field: '#introText', value: '保留這份介紹草稿', api: 'saveIntro', cancel: 'introCancel' },
      { name: '出入所紀錄', open: 'staysEdit', form: 'staysForm', field: '[data-stay-field="reason"]', value: '迷路', api: 'saveStays', cancel: 'staysCancel' },
      { name: '休養設定', open: 'restEdit', form: 'restForm', field: '#restReason', value: '保留休養原因', api: 'saveRest', cancel: 'restCancel' },
    ]) {
      await check('#481 ' + spec.name + '：儲存中只送一次；失敗保留草稿、重試清掉錯誤；取消回閱讀畫面', async () => {
        let release;
        const tick = () => new Promise(r => setTimeout(r, 0));
        const calls = fakeApi(() => new Promise(r => { release = () => r(json({ ok: false, error: '暫時無法儲存' }, 503)); }));
        const submit = () => document.getElementById(spec.form).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        const type = (selector, value) => {
          const input = document.querySelector(selector);
          input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        try {
          showDetail(allDogs[2]);
          if (!document.getElementById(spec.open)) document.getElementById('introEdit').click();
          document.getElementById(spec.open).click();
          if (spec.api === 'saveStays') type('[data-stay-field="in"]', '2015-08-18');
          type(spec.field, spec.value);
          submit(); submit();
          await tick();
          eq(calls.map(c => c[0]), [spec.api], '重複送出只呼叫一次：');
          eq([document.querySelector(spec.field).disabled, document.querySelector('#' + spec.form + ' [type="submit"], [form="' + spec.form + '"]').textContent], [true, '儲存中…'], '儲存中：');
          release(); await tick(); await tick();
          eq([document.querySelector(spec.field).value, document.querySelector('#' + spec.form + ' [role="alert"]').textContent], [spec.value, '暫時無法儲存'], '失敗後草稿與錯誤：');
          submit(); await tick();
          eq([calls.length, document.querySelector('#' + spec.form + ' [role="alert"]'), document.querySelector(spec.field).value], [2, null, spec.value], '重試保留草稿並清掉錯誤：');
          release(); await tick(); await tick();
          document.getElementById(spec.cancel).click();
          eq(document.getElementById(spec.form), null, '取消關掉表單：');
        } finally {
          if (release) { release(); await tick(); }
          hideDetail(); BQWalkUI.hideToast(); restoreApi();
        }
      });
    }
    await check('找狗的「最久沒溜的狗」、分析頁「超過 3 天沒溜」不算休養中的狗', () => {
      const due = dueDogs(allDogs, T).filter(d => { const st = computeStatus(d, T); return st.kind === 'unknown' || (st.kind === 'dated' && st.days >= AMBER_DAYS); });
      eq(due.map(d => d.name), [], '最久沒溜：');
    });
  } finally {
    restoreApi();
    hideDetail(); BQWalkUI.hideToast();
    box.classList.add('hidden');
    history.replaceState(null, '');
    saveWalkerName('');
    [allDogs, groupMap, activeTab, searchQuery, phoneStore, walkRecords, UPLOAD_URL, restMap, restEdit] = saved;
    render();
  }
}
