# Changelog

## [9.3.0](https://github.com/jiatsenK/bq-shelter-dogs/compare/v9.2.1...v9.3.0) (2026-10-22)


### 新功能

* 名單修改與復原先存 D1 再寫回試算表 ([#457](https://github.com/jiatsenK/bq-shelter-dogs/issues/457)) ([#469](https://github.com/jiatsenK/bq-shelter-dogs/issues/469)) ([a8edd13](https://github.com/jiatsenK/bq-shelter-dogs/commit/a8edd13bf4f6218941a661c704369da3d5abba2a))
* 我溜過的「說明」改成資訊頁的「使用說明」 ([#449](https://github.com/jiatsenK/bq-shelter-dogs/issues/449)) ([a1b9ef9](https://github.com/jiatsenK/bq-shelter-dogs/commit/a1b9ef94db408e6a0d17479c82f9e9a9856dd680))
* 持久重試試算表寫回並保持跨日最新結果 ([#459](https://github.com/jiatsenK/bq-shelter-dogs/issues/459)) ([#468](https://github.com/jiatsenK/bq-shelter-dogs/issues/468)) ([07dbffd](https://github.com/jiatsenK/bq-shelter-dogs/commit/07dbffd9976f27ffa4ed39e7b2395750c4451a6d))


### 修正

* 常溜狗群換群箭頭回到「溜了」兩側並固定位置 ([#443](https://github.com/jiatsenK/bq-shelter-dogs/issues/443)) ([#453](https://github.com/jiatsenK/bq-shelter-dogs/issues/453)) ([cfdf65a](https://github.com/jiatsenK/bq-shelter-dogs/commit/cfdf65af65058b1c5331977805ce53670adda918))
* 試算表清空誰遛的、遛狗日期，手機也跟著清；附同步坑研究 ([#438](https://github.com/jiatsenK/bq-shelter-dogs/issues/438)) ([6f8635b](https://github.com/jiatsenK/bq-shelter-dogs/commit/6f8635ba86f2290df3ae3417bc0b5da48db615b9))

## [9.2.1](https://github.com/jiatsenK/bq-shelter-dogs/compare/v9.2.0...v9.2.1) (2026-10-19)


### 修正

* 存登記名字只寫新的或今天還沒更新的（[#407](https://github.com/jiatsenK/bq-shelter-dogs/issues/407)） ([#410](https://github.com/jiatsenK/bq-shelter-dogs/issues/410)) ([89a9507](https://github.com/jiatsenK/bq-shelter-dogs/commit/89a95074aad8e3d31424fe9aa4dce1cf10d130c7))
* 常溜狗群照片改正放、大小一致 ([#387](https://github.com/jiatsenK/bq-shelter-dogs/issues/387)) ([#394](https://github.com/jiatsenK/bq-shelter-dogs/issues/394)) ([cc617d6](https://github.com/jiatsenK/bq-shelter-dogs/commit/cc617d65d9fca55c0d16f4229b839881d53f2c95))
* 常溜狗群照片放大，換群箭頭移到溜了兩側 ([#387](https://github.com/jiatsenK/bq-shelter-dogs/issues/387)) ([#395](https://github.com/jiatsenK/bq-shelter-dogs/issues/395)) ([60c3702](https://github.com/jiatsenK/bq-shelter-dogs/commit/60c3702733934a914e6da7696ec05465771aebb6))
* 手機鍵盤彈出時畫面不再亂跳 ([#389](https://github.com/jiatsenK/bq-shelter-dogs/issues/389)) ([#393](https://github.com/jiatsenK/bq-shelter-dogs/issues/393)) ([086fcec](https://github.com/jiatsenK/bq-shelter-dogs/commit/086fcecfc95d3535cdca554299c98c89236ed844))
* 狗群已溜再按復原、搜尋狗名，四個主分頁共用表頭 ([#385](https://github.com/jiatsenK/bq-shelter-dogs/issues/385)) ([08da566](https://github.com/jiatsenK/bq-shelter-dogs/commit/08da566a9fc8f54c00dcfd98c4c63f8e528bc759))
* 狗群按＋在群組上方就地輸入，完成後留在原處 ([#388](https://github.com/jiatsenK/bq-shelter-dogs/issues/388)) ([#391](https://github.com/jiatsenK/bq-shelter-dogs/issues/391)) ([a3816cf](https://github.com/jiatsenK/bq-shelter-dogs/commit/a3816cf1ed14c9bd602b234e9384378a9ab3097d))
* 狗群換群箭頭放兩側、頭尾相接，整群溜了單排置中 ([#386](https://github.com/jiatsenK/bq-shelter-dogs/issues/386)) ([54cfd80](https://github.com/jiatsenK/bq-shelter-dogs/commit/54cfd8001daf340939c8232a9bba5d585b38c32b))
* 讀常溜只附常溜狗與舊格式鍵的對照，不再整張讀狗編號 ([#406](https://github.com/jiatsenK/bq-shelter-dogs/issues/406)) ([#411](https://github.com/jiatsenK/bq-shelter-dogs/issues/411)) ([3efcd63](https://github.com/jiatsenK/bq-shelter-dogs/commit/3efcd630483e4ef879dc3f360c5cc7da04ffe1a9))


### 改善速度

* 有版本照片使用邊緣快取（[#279](https://github.com/jiatsenK/bq-shelter-dogs/issues/279) B 段） ([#414](https://github.com/jiatsenK/bq-shelter-dogs/issues/414)) ([fb00d9f](https://github.com/jiatsenK/bq-shelter-dogs/commit/fb00d9f3ddb1792ecab856e8f5d8a00e0c2a79f8))

## [9.2.0](https://github.com/jiatsenK/bq-shelter-dogs/compare/v9.1.1...v9.2.0) (2026-10-16)


### 新功能

* 今日溜狗紀錄，其他手機很快看到今天溜過（ADR 0007） ([#308](https://github.com/jiatsenK/bq-shelter-dogs/issues/308)) ([0283641](https://github.com/jiatsenK/bq-shelter-dogs/commit/0283641493910e3767700e1a144b6f7fbdc1b886))
* 入所事件條列與完整狗卡排版（[#285](https://github.com/jiatsenK/bq-shelter-dogs/issues/285)） ([#311](https://github.com/jiatsenK/bq-shelter-dogs/issues/311)) ([03f2918](https://github.com/jiatsenK/bq-shelter-dogs/commit/03f29183721994bfbb7f833e9415de08899e3954))
* 首頁暫時公告，D1 額度用完網站今日看不到別人最新的已溜 ([#304](https://github.com/jiatsenK/bq-shelter-dogs/issues/304)) ([28618d7](https://github.com/jiatsenK/bq-shelter-dogs/commit/28618d7108649396bb315afadec031e890a76b96))


### 修正

* GitHub Actions 分鐘數：有改才同步、縮圖不重叫、只改文件不跑測試（[#305](https://github.com/jiatsenK/bq-shelter-dogs/issues/305)） ([#312](https://github.com/jiatsenK/bq-shelter-dogs/issues/312)) ([e31ab05](https://github.com/jiatsenK/bq-shelter-dogs/commit/e31ab0559ed00f89e798dab48a48bee88b3fbb15))
* 同步改成差異同步，寫入量異常時停寫（[#302](https://github.com/jiatsenK/bq-shelter-dogs/issues/302)） ([#303](https://github.com/jiatsenK/bq-shelter-dogs/issues/303)) ([2da5ce7](https://github.com/jiatsenK/bq-shelter-dogs/commit/2da5ce723c4eec22f8addeb47ef0e5d83d95aa63))
* 手機編輯鍵盤避讓與入所逐次條列（[#285](https://github.com/jiatsenK/bq-shelter-dogs/issues/285)） ([#326](https://github.com/jiatsenK/bq-shelter-dogs/issues/326)) ([2f26894](https://github.com/jiatsenK/bq-shelter-dogs/commit/2f2689482efdb71d161b18dcfd1e14bfd5bac99e))


### 改善速度

* /api/today 改看版本號，沒變只讀 1 列 ([#314](https://github.com/jiatsenK/bq-shelter-dogs/issues/314)) ([#316](https://github.com/jiatsenK/bq-shelter-dogs/issues/316)) ([87f5deb](https://github.com/jiatsenK/bq-shelter-dogs/commit/87f5deb7b19bc2dbb160086d0b2c6dfc808b4686))
* 歷史資料包＋只讀今天，沒變時每次只讀 1 列版本號 ([#315](https://github.com/jiatsenK/bq-shelter-dogs/issues/315)) ([#317](https://github.com/jiatsenK/bq-shelter-dogs/issues/317)) ([0a5b98c](https://github.com/jiatsenK/bq-shelter-dogs/commit/0a5b98cf5d972a842edf4644e25494a517c1befb))
* 頁首「更新」縮短等待：同步讀 D1 現況改並行、手機每 5 秒看一次 ([#299](https://github.com/jiatsenK/bq-shelter-dogs/issues/299)) ([f97e455](https://github.com/jiatsenK/bq-shelter-dogs/commit/f97e4556fdf0bf98002a41f393d96ea850138695))


### 還原

* 恢復早上狗卡版面與編輯方式（[#285](https://github.com/jiatsenK/bq-shelter-dogs/issues/285)） ([#318](https://github.com/jiatsenK/bq-shelter-dogs/issues/318)) ([c60e031](https://github.com/jiatsenK/bq-shelter-dogs/commit/c60e031be3533c9a11f7f183c82452f4f9a25a2a))

## [9.1.1](https://github.com/jiatsenK/bq-shelter-dogs/compare/v9.1.0...v9.1.1) (2026-10-16)


### 修正

* 同步時補建正式 D1 缺少的資料表，修好編輯紀錄頁讀不到 ([7e6f760](https://github.com/jiatsenK/bq-shelter-dogs/commit/7e6f760312e86c21e3c715efc58e52155f53a5cf))
* 復原沒收到回應時，手機「我溜過」殘留已溜的狗 ([b8d7e1d](https://github.com/jiatsenK/bq-shelter-dogs/commit/b8d7e1df12b806c27aa13f40a6902676d19a6dd7))
* 復原沒收到回應時，打開網頁用試算表現況清掉手機殘留的已溜紀錄 ([0ac5be8](https://github.com/jiatsenK/bq-shelter-dogs/commit/0ac5be8a0895241aff1998685c614c5305a8ccb8))

## [9.1.0](https://github.com/jiatsenK/bq-shelter-dogs/compare/v9.0.0...v9.1.0) (2026-10-16)


### 新功能

* 入所日照最舊編號算，詳細資訊可以補／刪舊編號 ([#289](https://github.com/jiatsenK/bq-shelter-dogs/issues/289)) ([cd716ba](https://github.com/jiatsenK/bq-shelter-dogs/commit/cd716baaebb095acfd2b79d577431d98ab12853b))
* 固定志工身分、更名與確認合併 ([#267](https://github.com/jiatsenK/bq-shelter-dogs/issues/267)) ([a7d17ec](https://github.com/jiatsenK/bq-shelter-dogs/commit/a7d17ec77e758b0e57193d6968d2ab23f7028833))
* 固定志工身分並支援更名與確認合併 ([#267](https://github.com/jiatsenK/bq-shelter-dogs/issues/267)) ([b138358](https://github.com/jiatsenK/bq-shelter-dogs/commit/b1383581feab90811a0df391b0ef17253ca77290))
* 常溜狗群頁，網站可以看群組、直接加狗、移出、開新群 ([70f1e8b](https://github.com/jiatsenK/bq-shelter-dogs/commit/70f1e8bb9f34cdffa5a17e5ef1b2abde1f7dd033))
* 常溜狗群頁，網站可以看群組、直接編輯 ([a627db8](https://github.com/jiatsenK/bq-shelter-dogs/commit/a627db88af1204eb53aac53ad65ab32841710d92))
* 我的常溜跟著代號與永久狗 ID 存 D1 ([#267](https://github.com/jiatsenK/bq-shelter-dogs/issues/267)) ([be78564](https://github.com/jiatsenK/bq-shelter-dogs/commit/be785641bad3180b0665a9b396babff1ed40d74c))
* 支援核對代號注入並完成真實資料隔離演練 ([#267](https://github.com/jiatsenK/bq-shelter-dogs/issues/267)) ([9e08604](https://github.com/jiatsenK/bq-shelter-dogs/commit/9e08604c80d98808d2f9d7b47f650470702d42a3))
* 網站可追加試算表備註與異動紀錄（[#281](https://github.com/jiatsenK/bq-shelter-dogs/issues/281)） ([a3f3c75](https://github.com/jiatsenK/bq-shelter-dogs/commit/a3f3c75ad329cb21781381258a460add7cc7f23d))
* 網站可追加試算表備註與異動紀錄（[#281](https://github.com/jiatsenK/bq-shelter-dogs/issues/281)） ([5f47480](https://github.com/jiatsenK/bq-shelter-dogs/commit/5f474802a2083bd6d1cd42bfc6708eaf305c7ca2))
* 開放編輯、拿掉通關碼，新增編輯紀錄頁 ([58a483c](https://github.com/jiatsenK/bq-shelter-dogs/commit/58a483c7ab227332ce471076f89f4a9760ca6882))
* 開放編輯、拿掉通關碼，新增編輯紀錄頁 ([#284](https://github.com/jiatsenK/bq-shelter-dogs/issues/284)) ([a4a8df3](https://github.com/jiatsenK/bq-shelter-dogs/commit/a4a8df32e6abbadfe06e28856adb9eb53040442a))


### 修正

* 常遛狗群英文名不分大小寫、母幼區各自一籠 ([2d5e590](https://github.com/jiatsenK/bq-shelter-dogs/commit/2d5e590c33c9a55e04ee33fb81c4da3347ab4bcf))
* 常遛狗群英文名不分大小寫、母幼區各自一籠 ([af96f0b](https://github.com/jiatsenK/bq-shelter-dogs/commit/af96f0b8566e0d630196acbfae692cee0e0a9b87))
* 換新編號就是再入所，但畫面不標第幾次入所 ([#289](https://github.com/jiatsenK/bq-shelter-dogs/issues/289)) ([ccb2b22](https://github.com/jiatsenK/bq-shelter-dogs/commit/ccb2b222763de3ec124be1bf3e058819ff75f13b))
* 換新編號就是再入所，狗卡保留「第 N 次入所」 ([#289](https://github.com/jiatsenK/bq-shelter-dogs/issues/289)) ([a33470d](https://github.com/jiatsenK/bq-shelter-dogs/commit/a33470d2b45679a4ed44318bc335fe131cc47d4e))
* 正式 D1 還沒有群名表時同步失敗 ([df2ede2](https://github.com/jiatsenK/bq-shelter-dogs/commit/df2ede23cfa033d394e5e0427173b287f5283cba))
* 正式 D1 還沒有群名表時同步失敗 ([541f9e1](https://github.com/jiatsenK/bq-shelter-dogs/commit/541f9e1a2ade82590a477cd6130b77bd647a6ddf))
* 測試改用新標題「休養設定」 ([0012960](https://github.com/jiatsenK/bq-shelter-dogs/commit/00129608316496aa2a899e7e52b83b88fa0e29c8))
* 狗群編輯接上編輯紀錄 ([8221af4](https://github.com/jiatsenK/bq-shelter-dogs/commit/8221af45c12676b7be4eac5c36789b420b71290a))
