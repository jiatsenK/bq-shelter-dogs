# 研究：認狗遊戲困難模式的狗臉裝飾定位與素材

- 日期：2026-10-30。Agent：Claude Code（研究代理）。
- 依據：K 2026-10-30 對話。認狗遊戲有 117 隻狗的照片（手機拍、260px 到 1200px、黑狗多、常張嘴、常側臉）。困難模式在狗臉貼裝飾，目前靠 AI 子代理看圖標左眼、右眼、鼻子、頭頂四點，標記常不準，黑狗最嚴重，眼罩和鬍子會跑到額頭或臉頰旁。條件是免費、前端純靜態，可以在本機先算好座標存成 JSON。
- 做了什麼：只查一手來源（模型卡、論文、官方 GitHub、授權頁），每個論點附連結。標「估算」的是我依官方數字自己推的，標「不確定」的是找不到一手來源。
- 沒有改程式。
- 相關：只加文件的 PR（分支 `docs/dog-game-research`）收進 repo；狗狗變裝秀上線規格見 #795。

## 1. 結論

1. **改用 `hugocornellier/dog-face-landmarks`**：這是用 DogFLW 訓練的兩段式模型（先框狗臉，再標 46 點），有眼睛（每邊 4 點）、鼻子、嘴、下巴、耳朵，眼睛誤差約為兩眼距離的 5%。權重是 CC BY-NC 4.0，非商業的公益網頁可以用，但要標註。Python 套件 `ai-edge-litert` 有 Windows 和 Python 3.13 的版本，117 張在筆電 CPU 上跑完沒問題（估算）。
2. **依裝飾決定要多準**：帽子、皇冠、派對帽只靠頭頂和臉寬，不太怕誤差。墨鏡、眼罩、面具一定要眼睛點，鬍子要鼻子和嘴的點。每張圖先做幾何檢查（左右翻轉再跑一次比對、兩眼距離和臉框比例），沒通過的照片就只給帽子類。
3. **影像生成或編輯模型（直接幫狗戴配件）不建議用在這個遊戲**：會改到狗的毛色和臉型，認狗的線索會被破壞。本機 8GB 顯示卡也跑不動主要模型。
4. **素材首選 Fluent Emoji（MIT）和 Noto Emoji（Apache-2.0）**，有帽子、皇冠、墨鏡、蝴蝶結。眼罩、鬍子、聖誕帽、派對帽、面具在 Unicode 沒有單獨的符號，要自己畫 SVG 或到 SVG Repo 逐個看授權。「蝙蝠俠」是 DC 的角色，建議改成一般的「蝙蝠面具」或「英雄眼罩」造型。
5. 建議流程：Python 腳本跑一次，產出 `decor-points.json`（兩眼中心、鼻子、嘴、頭頂估計、是否通過檢查），再產生一張縮圖總表讓 K 用眼睛快速抽查，人工只修沒通過的幾張。

## 2. 狗臉關鍵點模型與資料集

### 2.1 比較表

| 名稱 | 是什麼 | 臉部有哪些點 | 授權 | 怎麼跑 | 117 張本機 CPU | 準度 |
|---|---|---|---|---|---|---|
| `hugocornellier/dog-face-landmarks` | 已訓練好的模型 | 46 點：眼、鼻、嘴、下巴、額頭、耳 | 權重 CC BY-NC 4.0，程式 Apache-2.0 | Python `ai-edge-litert`（TFLite） | 可行（估算數十秒到幾分鐘） | 驗證集 NME_IOD 8.56，眼睛約 5 |
| DogFLW | 資料集，沒有釋出模型 | 46 點 | CC BY-NC 4.0 | 要自己訓練 | 不適用 | 論文最佳 NME 6.52 |
| dlib dog hipsterizer | 已訓練好的狗臉框加 6 點 | 頭頂、左右耳、左右眼、鼻子 | 模型 CC0（公有領域） | 只有 C++，沒有 Python API | 可行但要自己編 C++ | 官方沒公布 |
| Ultralytics dog-pose | 資料集，沒有釋出模型 | 24 點中有左右眼、鼻子、下巴、耳根、耳尖 | 程式 AGPL-3.0，資料集授權頁面沒寫 | 要自己用 YOLO 訓練 | 訓練要 GPU | 官方沒公布 |
| StanfordExtra | 資料集（標註） | 全身點，含臉部幾點（詳細名單見 repo） | 標註 MIT | 要自己訓練 | 不適用 | 不適用 |
| AP-10K | 資料集加 MMPose 模型 | 只有左右眼、鼻子 | CC-BY-4.0 | MMPose（PyTorch） | 可行但安裝重 | 全身 AP 約 0.72 |
| Animal-Pose | 資料集加 MMPose 模型 | 不確定（資料集頁面沒查到點位清單） | 不確定 | MMPose | 可行但安裝重 | 全身 AP 約 0.74 |
| SuperAnimal-Quadruped | 已訓練好的四足動物全身模型 | 39 點（點位名稱不在模型卡內） | 修改版 MIT，限學術與非商業 | DeepLabCut／PyTorch | 可行但安裝重 | 模型卡自己說零樣本不適合要求高精度的用途 |

### 2.2 推薦：`hugocornellier/dog-face-landmarks`

- **架構**：兩段。第一段 `dog_face_localizer.tflite`（16 MB，EfficientNetB2，224px）回傳臉框。第二段 `dog_face_landmarks_full.tflite`（11 MB，MobileNetV3-Large，384px）把臉框外擴 0.1 後裁切，輸出 92 個數字（46 組 x、y）。另有 55 MB 的 EfficientNetV2-S 版本。來源：[模型卡](https://huggingface.co/hugocornellier/dog-face-landmarks)
- **點位分組**：耳朵每邊 7 點、眼睛每邊 4 點、鼻樑 2 點、鼻孔周圍 8 點、嘴和下巴 14 點，共 46 點。來源：[dog_detection 套件說明](https://pub.dev/packages/dog_detection)。**每個編號對應哪個點，模型卡和訓練 repo 都沒寫清楚**（不確定），實作時先畫一張編號圖確認，或參考 DogFLW 論文附錄的標註手冊。來源：[訓練 repo](https://github.com/hugocornellier/dog-face-landmarks-training)、[DogFLW 論文（Scientific Reports）](https://pmc.ncbi.nlm.nih.gov/articles/PMC12218811/)
- **準度**：NME_IOD 是平均誤差除以兩眼距離。小模型 8.57，眼睛約 5，耳朵 12 到 14，耳尖 15 到 18。最好的組合（三個模型加翻轉和多尺度）是 8.04。來源：[訓練 repo](https://github.com/hugocornellier/dog-face-landmarks-training)、[模型卡](https://huggingface.co/hugocornellier/dog-face-landmarks)。估算：兩眼相距 100px 的照片，眼睛點平均偏約 5px，墨鏡、眼罩夠用。
- **黑狗、張嘴、側臉**：官方沒有依毛色或角度分開的準度數字（不確定）。DogFLW 的圖片來自 Stanford Dogs，含 120 個品種，標註有「被遮住」的旗標，所以訓練資料有一部分側臉。來源：[DogFLW 論文](https://pmc.ncbi.nlm.nih.gov/articles/PMC12218811/)。建議跑完後專門看黑狗那幾張。
- **授權**：權重 CC BY-NC 4.0，限非商業，商業使用要另找 DogFLW 作者（海法大學 Tech4Animals Lab）取得同意。程式 Apache-2.0。來源：[模型卡](https://huggingface.co/hugocornellier/dog-face-landmarks)。CC BY-NC 4.0 要求標註來源，所以網頁上要寫模型和資料集名稱。公益的志工網頁不收費、不賣東西，一般解讀屬於非商業，但不是法律意見。
- **怎麼跑**：模型卡的範例用 Python 的 `ai-edge-litert` 套件。來源：[模型卡](https://huggingface.co/hugocornellier/dog-face-landmarks)。`ai-edge-litert` 2.3.0（2026-10-06 發布）有 Windows `win_amd64` 版本，支援 Python 3.10 到 3.14。來源：[PyPI](https://pypi.org/project/ai-edge-litert/#files)
- **不能直接在瀏覽器跑**：只有 TFLite 和 Keras 檔，沒有 ONNX 或 Transformers.js 版本。來源：[訓練 repo](https://github.com/hugocornellier/dog-face-landmarks-training)。Transformers.js 目前也沒有關鍵點偵測的任務。來源：[Transformers.js 文件](https://huggingface.co/docs/transformers.js/index)。本專案在本機預先算好存 JSON 就不受影響。
- **輸出沒有信心分數**：模型卡描述的輸出只有座標，沒有每點信心值。要判斷可不可信，得自己做檢查（見第 3 節）。

### 2.3 其他選項的細節

- **DogFLW**：3,732 張狗照、120 個品種、46 點加臉框，訓練 3,252 張、測試 480 張。論文比較的模型中 ELD（EfficientNetV2S）最好，NME 6.52，但論文沒有釋出權重，程式要跟作者申請。來源：[DogFLW 論文](https://pmc.ncbi.nlm.nih.gov/articles/PMC12218811/)。資料集在 Kaggle 下載，授權 CC BY-NC 4.0。來源：[DogFLW GitHub](https://github.com/martvelge/DogFLW)。自己訓練不如直接用 2.2 的現成權重。
- **dlib dog hipsterizer**：dlib 官方範例，就是「偵測狗臉後戴眼鏡和鬍子」，跟本專案的需求幾乎一樣。輸出 6 點：頭頂、左耳、左眼、鼻子、右耳、右眼。來源：[範例程式](http://dlib.net/dnn_mmod_dog_hipsterizer.cpp.html)。模型檔 CC0，作者說「任何人都可以拿這些模型做任何事」。來源：[dlib-models](https://github.com/davisking/dlib-models)。缺點：作者在部落格說只找「看鏡頭的狗」，而且明說「沒有 Python API」能載入這個檔，要寫 C++。來源：[dlib 部落格 2016-10-07](https://blog.dlib.net/2016/10/hipsterize-your-dog-with-deep-learning.html)。訓練資料是 Columbia Dogs，原始資料集的授權不確定。來源：[dlib-models](https://github.com/davisking/dlib-models)。側臉多的照片可能偵測不到。
- **Ultralytics dog-pose**：8,476 張，每張 24 點，含左右眼、鼻子、下巴、耳根、耳尖。點位沿用 StanfordExtra。官方只提供訓練教學，沒有現成的 dog-pose 權重。來源：[Ultralytics dog-pose](https://docs.ultralytics.com/datasets/pose/dog-pose/)。Ultralytics 程式是 AGPL-3.0，商業用途要買企業授權。來源：[Ultralytics GitHub](https://github.com/ultralytics/ultralytics)。眼睛只有 1 點、沒有嘴巴，對貼鬍子幫助有限，還要自己訓練。
- **StanfordExtra**：12,000 隻狗的 2D 關鍵點和分割標註，2024-11-02 起改為 MIT。不含圖片，圖片要另外從 Stanford Dogs 下載。來源：[StanfordExtra](https://github.com/benjiebob/StanfordExtra)。Stanford Dogs 官網連線失敗，圖片的使用條款我沒查到（不確定）。
- **AP-10K**：54 種動物、17 點，臉部只有左右眼和鼻子，資料集 CC-BY-4.0。來源：[AP-10K](https://github.com/AlexTheBad/AP-10K)。MMPose 上 RTMPose-m 在 AP-10K 的 AP 是 0.722，Animal-Pose 上 HRNet-w32 是 0.740，都是 256x256 全身模型，只提供 PyTorch 檔。來源：[MMPose 動物模型列表](https://mmpose.readthedocs.io/en/latest/model_zoo/animal_2d_keypoint.html)。全身模型的眼睛點是附帶的，不是專門做臉，準度不適合貼眼罩。
- **Animal-Pose**：ICCV 2019 論文的資料集，含狗和貓。來源：[論文](https://openaccess.thecvf.com/content_ICCV_2019/papers/Cao_Cross-Domain_Adaptation_for_Animal_Pose_Estimation_ICCV_2019_paper.pdf)。資料集授權和點位清單我沒有從一手來源查到（不確定）。
- **SuperAnimal-Quadruped（DeepLabCut）**：四足動物全身模型，模型卡寫主要用於側面照，零樣本不適合要求高精度的場合，並列出光線差、對比低、解析度低時準度會下降。授權是修改版 MIT，限學術與非商業。來源：[模型卡](https://huggingface.co/mwmathis/DeepLabCutModelZoo-SuperAnimal-Quadruped)。點位數 39 點來自 [DeepLabCut Model Zoo](https://www.mackenziemathislab.org/dlc-modelzoo)，模型卡本身沒列點名。黑狗多、解析度低正是它說不擅長的情況。

## 3. 讓裝飾不怕標記誤差的做法

### 3.1 依裝飾分級（建議，成本最低）

| 等級 | 裝飾 | 需要的點 | 誤差影響 |
|---|---|---|---|
| A 容錯高 | 聖誕帽、派對帽、皇冠、頭頂蝴蝶結 | 頭頂附近、臉寬、頭的角度 | 偏 10% 看起來還是戴在頭上 |
| B 中 | 墨鏡、半臉面具 | 兩眼中心 | 面具本身大，偏一點還能蓋住眼睛 |
| C 容錯低 | 單眼眼罩、鬍子、領結 | 單眼中心、鼻子、嘴角 | 偏一點就跑到額頭或臉頰 |

- 頭頂點：46 點裡有額頭的點（模型卡的黃色組），但耳朵和額頭點誤差比眼睛大。來源：[模型卡](https://huggingface.co/hugocornellier/dog-face-landmarks)。建議用「兩眼中點往鼻子反方向延伸約一個兩眼距離」當頭頂，帽子底部對齊臉框上緣，不依賴單一點（這是我的設計建議，不是官方做法）。
- 鬍子：用鼻孔周圍 8 點的中心，加上嘴巴點的上緣，取兩者之間，比只用鼻子一點穩。

### 3.2 檢查每張照片，決定能放哪一級（建議）

模型沒有信心分數，可以自己做下列檢查，全部通過才開放 C 級裝飾：

1. **左右翻轉再跑一次**：把照片水平翻轉後再算一次，把結果翻回來，跟原本比較，兩眼位置差超過兩眼距離的 10% 就視為不穩。訓練 repo 本身就用翻轉來提高準度，表示這個做法跟模型相容。來源：[訓練 repo](https://github.com/hugocornellier/dog-face-landmarks-training)。10% 這個門檻是我訂的，要用實際照片調。
2. **幾何合理**：兩眼距離佔臉框寬度的比例要在合理範圍，鼻子要在兩眼連線的下方（依頭的角度旋轉後判斷），兩眼都要在臉框內。
3. **臉框信心**：第一段臉框跟第二段 46 點的外框差太多，就視為不穩。
4. 沒通過的只開放 A 級，並在總表標紅，讓 K 決定要不要人工修。

### 3.3 分割遮罩（SAM 2 等）

- **用途**：把臉框當提示，切出狗頭的輪廓。帽子可以貼在輪廓最上緣，裝飾也可以裁在頭部範圍內，不會飄到背景。黑狗在暗背景下輪廓可能切不準（不確定，官方沒有這類數字）。
- **授權與執行**：SAM 2 的程式和模型都是 Apache-2.0，最小的 `sam2.1_hiera_tiny.pt` 約 38.9M 參數。官方安裝說明以 GPU 為主，沒寫 CPU 支援。來源：[SAM 2](https://github.com/facebookresearch/sam2)。Transformers.js 的 `mask-generation` 任務標為不支援，所以只能在 Python 預先算。來源：[Transformers.js 文件](https://huggingface.co/docs/transformers.js/index)
- **零樣本偵測替代**：OWLv2（Apache-2.0）可以用文字「dog head」找框，Transformers.js 支援 `zero-shot-object-detection`。來源：[OWLv2 模型卡](https://huggingface.co/google/owlv2-base-patch16-ensemble)、[Transformers.js 文件](https://huggingface.co/docs/transformers.js/index)。只能給框，不能取代眼睛點。
- **評估**：成本中等（多裝一套 PyTorch），對帽子有幫助，對眼罩、鬍子沒幫助。建議等 3.1 和 3.2 做完、還覺得帽子歪時再加。

### 3.4 影像生成或編輯模型（直接畫配件上去）

| 模型 | 授權 | 硬體 | 備註 |
|---|---|---|---|
| Qwen-Image-Edit-2509 | Apache-2.0 | 20B 參數 BF16，估算光權重約 40GB，8GB 筆電跑不動 | 強調保留人臉身分，沒特別寫動物。來源：[模型卡](https://huggingface.co/Qwen/Qwen-Image-Edit-2509) |
| FLUX.1 Kontext dev | FLUX.1 dev 非商業授權（輸出可商用） | 12B 參數 | 依文字指令改圖。來源：[模型卡](https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev) |
| FLUX.2 klein 4B（Workers AI） | 權重 Apache-2.0 | 雲端，免費額度估算每天約 90 張 | 參考圖要小於 512x512。見同目錄 [2026-10-30-huggingface-ideas-research.md](2026-10-30-huggingface-ideas-research.md) 3.1 節 |

- **品質風險**：生成模型會重畫整張圖或局部，可能改到毛色、斑紋、眼睛顏色。認狗遊戲靠的正是這些細節，改到就等於出錯題。這是我依用途判斷的風險，沒有針對狗的官方評測。
- **成本**：117 張用 Workers AI 的免費額度約兩天做完（估算），但每張都要人工檢查有沒有變臉，重做次數不確定。
- **結論**：不建議用在困難模式題目。如果想要「每隻狗一張戴帽子的紀念圖」放在別的地方（例如送養貼文），可以另外評估，但要標示是生成圖。

## 4. 免費可愛配件素材

### 4.1 授權比較

| 來源 | 授權 | 要不要標註 | 格式 | 來源連結 |
|---|---|---|---|---|
| Fluent Emoji（Microsoft） | MIT | MIT 要求保留著作權與授權聲明，建議在「關於」頁或原始碼放授權全文 | 每個符號有 3D、Color、Flat、High Contrast 四種資料夾 | [GitHub](https://github.com/microsoft/fluentui-emoji)、[Top hat 資料夾](https://github.com/microsoft/fluentui-emoji/tree/main/assets/Top%20hat) |
| Noto Emoji（Google） | 圖片與工具 Apache-2.0，字型 OFL 1.1，旗幟圖為公有領域 | Apache-2.0 要附授權聲明 | SVG、PNG | [GitHub](https://github.com/googlefonts/noto-emoji) |
| Twemoji（jdecked 維護版） | 圖片 CC-BY 4.0，程式 MIT | 要。官方接受寫在網站頁尾、「關於」或 HTML／JS 原始碼 | SVG、PNG | [GitHub](https://github.com/jdecked/twemoji) |
| OpenMoji | CC BY-SA 4.0 | 要，建議文字是「All emojis designed by OpenMoji – the open-source emoji and icon project」。改過的圖要用同一授權釋出 | SVG、PNG | [OpenMoji FAQ](https://openmoji.org/faq/) |
| SVG Repo | 每個圖示各自標授權（有 CC0、MIT 等） | CC0 不用標註，其他看各圖示頁面 | SVG | [SVG Repo 授權頁](https://www.svgrepo.com/page/licensing/)（我抓頁面時被擋，內容來自搜尋摘要，使用前請逐個圖示確認） |

Twemoji 原本由 Twitter 維護，jdecked 這個 repo 是不是官方延續版本，頁面沒有明寫（不確定），但 repo 的貢獻者包含前 Twitter 員工。來源：[GitHub](https://github.com/jdecked/twemoji)

### 4.2 每種裝飾的素材狀況

- **Unicode 有現成符號**：大禮帽（U+1F3A9）、皇冠（U+1F451）、墨鏡（U+1F576）、蝴蝶結緞帶（U+1F380）、學士帽（U+1F393）、鴨舌帽（U+1F9E2）。上面四套 emoji 都有，可以直接用。
- **Unicode 沒有單獨符號**：聖誕帽、派對帽、單眼眼罩、鬍子、半臉面具。Unicode 只有「聖誕老人」「派對臉」「變裝臉（眼鏡加鼻子加鬍子）」這類整張臉的符號，要從裡面裁出配件會變成改作，OpenMoji 就會觸發同授權條款。建議自己畫簡單 SVG（線條少、可愛風格的帽子和眼罩不難畫），或到 SVG Repo 找標 CC0 的圖。
- **蝙蝠俠面具**：Batman 是 DC 的角色，名稱和造型可能受商標與著作權保護（一般常識，不是法律意見）。建議改成「蝙蝠耳面具」「英雄眼罩」「怪盜眼罩」等通用造型，名稱也不要寫 Batman。

### 4.3 面具多樣化的建議清單

都是 B 級（只靠兩眼中心），可以共用同一套定位：怪盜眼罩、蝙蝠耳面具、貓耳面具、威尼斯嘉年華面具、潛水鏡、愛心眼鏡、星星眼鏡、圓框眼鏡、3D 紅藍眼鏡、單片眼鏡。自己畫 SVG 時統一用「兩眼中心在 SVG 內的固定座標」當錨點，程式只要算縮放和旋轉。

## 5. 建議的實作步驟（給後續開票參考）

1. 本機建 Python 虛擬環境，安裝 `ai-edge-litert`，下載兩個 TFLite 檔。
2. 寫腳本跑 117 張：臉框、46 點、翻轉後再跑一次，輸出 JSON（兩眼中心、鼻子中心、嘴上緣、頭頂估計、頭的角度、通過哪一級）。
3. 先畫一張編號圖確認 46 點的順序，再寫進腳本。
4. 產生一張縮圖總表（每隻狗疊上點和裝飾），K 抽查，重點看黑狗和側臉。
5. 前端讀 JSON，依等級隨機挑裝飾。
6. 網頁「關於」或頁尾加標註：模型（dog-face-landmarks，CC BY-NC 4.0，資料來自 DogFLW）、所用的 emoji 套件與授權。
