

// 詳細資訊五種編輯器的草稿與狀態；畫面、驗證、API 與成功後的資料更新由主頁負責。
const BQDetailEditor = (() => {
  function create(redraw) {
    function draft(edit, fields) {
      Object.assign(edit, fields);
    }
    function refresh(edit, fields = {}) {
      draft(edit, fields);
      redraw();
    }
    return {
      // 先讓呼叫端接住草稿，再重畫，避免重畫時仍讀到上一份狀態。
      open(dog, fields, phase = 'edit') {
        return { dog, revision:dog.editRevision, ...fields, phase, error: '' };
      },
      draft,
      refresh,
      saving(edit, phase = 'saving') {
        refresh(edit, { phase, error: '' });
      },
      fail(edit, error) {
        refresh(edit, { phase: 'error', error });
      },
    };
  }
  return { create };
})();

export { BQDetailEditor };
