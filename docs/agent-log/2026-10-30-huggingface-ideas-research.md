# 研究：Hugging Face 上 3D 以外適合溜狗表的模型與工具

- 日期：2026-10-30。Agent：Claude Code（研究代理）。
- 依據：K 2026-10-30 對話。前面已討論「拍狗照片變 3D」（TRELLIS、Hunyuan3D、TripoSR、Stable Fast 3D），K 確認用途是：一、讓志工覺得好玩。二、送養宣傳，讓認養人看到狗的樣子。條件是免費、先只給 K 自己用。
- 硬體：Windows 11 筆電，RTX 3070 Laptop GPU（8GB VRAM），系統 Python 3.13。
- 做了什麼：只查一手來源（Hugging Face 模型卡、官方 GitHub、Hugging Face 與 Cloudflare 官方文件），每個論點附連結。標「估算」的是我依官方數字自己算的，標「未查證」的是找不到一手來源。
- 沒有改程式、沒有寫 D1。
- 相關 PR：分支 `docs/dog-game-research` 的只加文件 PR，跟 `2026-10-30-dog-face-decoration-research.md` 同一個 PR 收進 repo。後來做成的狗狗變裝秀，上線規格見 #795。
- 例外與未完成：沒有實際試用任何一項，待確認的事項在第 7 節。

## 1. 先講結論

| 項目 | 志工或認養人看到什麼 | 在哪裡跑 | 免費程度 | 難度 |
|---|---|---|---|---|
| FLUX.2 klein 4B（Workers AI） | 每隻狗一張插圖或貼圖版本 | Cloudflare Workers AI | 每天 10,000 Neurons 免費額度內，估算約 90 張 | 低，現有 Worker 加一個 binding |
| FramePack | 送養照變幾秒的短影片（狗轉頭、搖尾巴） | K 的筆電 | 程式 Apache-2.0，權重授權有疑慮 | 中，有 Windows 一鍵包 |
| BiRefNet 去背 | 乾淨去背的送養卡、統一背景 | 筆電、瀏覽器或 Cloudflare Images | MIT | 低到中 |
| Depth Anything V2 Small | 照片手指一滑就有立體視差，「假 3D」 | 瀏覽器（Transformers.js） | Apache-2.0 | 中 |
| Gemma 4 視覺（Workers AI） | 依照片自動產生外觀描述、替代文字 | Cloudflare Workers AI | 免費額度內，估算每天數百張 | 低 |
| DINOv2 相似度 | 「長得像的狗」、花色相近的狗並排比對 | 瀏覽器或筆電 | Apache-2.0 | 中 |
| Real-ESRGAN | 模糊舊照放大變清楚 | 筆電，免安裝 exe | BSD-3-Clause | 低 |
| BreezyVoice | 狗的介紹配上台灣腔語音 | 筆電 | Apache-2.0 | 中到高 |

## 2. 共用的免費額度

- **Cloudflare Workers AI**：Workers Free 和 Workers Paid 每天都有 10,000 Neurons 免費，每天 00:00 UTC（台灣 08:00）重置，Free 方案用完就停，不會收費。Kimi、GLM、DeepSeek V4 等少數模型要付費方案。來源：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **Hugging Face ZeroGPU Spaces**：任何人都能免費用別人做好的 ZeroGPU Space，每日 GPU 額度為未登入 2 分鐘、免費帳號 5 分鐘、PRO 40 分鐘。帳號滿 30 天且驗證過 email，可以免費架 2 個自己的 ZeroGPU Space（只支援 Gradio）。適合「先試效果、不想在筆電裝」。來源：[Spaces ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu)
- **在 Worker 本體裡直接跑模型不可行**：Worker 每個 isolate 記憶體 128 MB，Free 方案每次請求 CPU 時間 10 ms。所以 Transformers.js 這類模型要在使用者瀏覽器跑，或改呼叫 Workers AI。來源：[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Transformers.js**：支援 `background-removal`、`depth-estimation`、`image-feature-extraction`、`image-to-text`、`zero-shot-image-classification` 等任務，預設用 WASM 跑在 CPU，設 `device: 'webgpu'` 可用 GPU，但官方提醒 WebGPU 在許多瀏覽器仍屬實驗性。來源：[Transformers.js 文件](https://huggingface.co/docs/transformers.js/index)

## 3. 逐項說明

### 3.1 照片變插圖或貼圖：FLUX.2 klein 4B（Workers AI）

- **是什麼**：Black Forest Labs 的小型圖片生成模型，同一個模型同時能文字生圖和改圖。來源：[Workers AI 模型頁](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/)
- **怎麼用在專案**：把狗的主照片當參考圖，提示詞寫「改成水彩插圖」「LINE 貼圖風格、白邊」等，產出每隻狗的插圖。志工可以在狗卡上看到「插圖版」，送養貼文可以用統一畫風的海報。Workers AI 版支援最多 4 張參考圖，欄位名稱必須是 `input_image_0` 到 `input_image_3`，可以做風格轉換、把角色放進另一張圖。來源：[Cloudflare changelog 2026-01-15](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/)
- **免費程度**：
  - 開源權重是 Apache-2.0，可商用。來源：[FLUX.2-klein-4B 模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)。Workers AI 版標為 Partner model，條款連到 BFL 服務條款。來源：[Workers AI 模型頁](https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/)
  - Workers AI 計價：每個輸入 512x512 區塊 5.37 Neurons，每個輸出區塊 26.05 Neurons。來源：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)。估算：輸出 1024x768（約 4 個區塊）加一張參考圖，約 110 Neurons 一張，每天免費額度約可做 90 張。
  - 本機跑需要約 13GB VRAM（模型卡寫 RTX 3090、4070 以上），8GB 筆電不適合直接跑。來源：[模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- **已知坑**：Workers AI 版的參考圖「必須小於 512x512」，要先用現有縮圖或縮小再送。來源：[changelog](https://developers.cloudflare.com/changelog/post/2026-01-15-flux-2-klein-4b-workers-ai/)。`steps` 固定 4 步不能改。生成圖可能改變狗的花色細節，送養用途要標示是插圖，不能當實際照片。
- 同目錄另有 `flux-2-dev`、`flux-2-klein-9b`、`flux-1-schnell` 等，9B 每張第一百萬像素就要 1363.64 Neurons，免費額度只夠做幾張。來源：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

### 3.2 照片變短影片：FramePack（本機）

- **是什麼**：lllyasviel 做的影片生成桌面軟體，用一張圖產生影片，把輸入內容壓成固定長度，所以影片變長也不會更吃記憶體。來源：[FramePack GitHub](https://github.com/lllyasviel/FramePack)
- **怎麼用在專案**：送養照變 3 到 5 秒的短片（狗眨眼、轉頭、搖尾巴），貼到送養社群或狗卡上，比靜態照更能讓認養人感受狗的樣子。
- **免費程度與硬體**：
  - 程式 Apache-2.0。最低「至少 6GB GPU 記憶體」，支援 RTX 30XX、40XX、50XX，作者自己在 3070ti 筆電和 3060 筆電測過，寫明筆電 GPU 可以。來源：[FramePack GitHub](https://github.com/lllyasviel/FramePack)
  - 有 Windows 一鍵包（CUDA 12.6 加 PyTorch 2.6），解壓後跑 `update.bat`、`run.bat`，自帶 Python，不會碰到系統 Python 3.13 的相容問題。來源：同上
  - 速度：4090 桌機每格約 1.5 到 2.5 秒，筆電慢 4 到 8 倍。來源：同上。估算：3070 Laptop 做 5 秒（約 150 格）要 15 到 50 分鐘，適合晚上批次跑。
- **疑慮**：模型權重 [lllyasviel/FramePackI2V_HY](https://huggingface.co/lllyasviel/FramePackI2V_HY) 的模型卡沒有寫授權，也沒寫基底模型，名字裡的 HY 推測是 HunyuanVideo，但模型卡沒寫，未查證。HunyuanVideo-I2V 本身是 `tencent-hunyuan-community` 授權。來源：[HunyuanVideo-I2V 模型卡](https://huggingface.co/tencent/HunyuanVideo-I2V)。志工非營利送養宣傳應該不成問題，但權重授權未確認，正式大量使用前要再看授權全文。
- **其他選項（8GB 跑不動）**：
  - Wan2.2-TI2V-5B：Apache-2.0，單卡要至少 24GB VRAM，5 秒 720P 在消費級 GPU 約 9 分鐘內。來源：[模型卡](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)。可以找 ZeroGPU Space 免費試幾支（每天 5 分鐘額度）。
  - HunyuanVideo-I2V：720p 最低 60GB，不考慮。來源：[模型卡](https://huggingface.co/tencent/HunyuanVideo-I2V)

### 3.3 去背：BiRefNet

- **是什麼**：0.2B 參數的高精度去背／前景分割模型，MIT 授權。來源：[ZhengPeng7/BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet)
- **怎麼用在專案**：每隻狗的主照片去背，換成統一底色或收容所識別色，做成整齊的送養卡、圖鑑頁。志工看到的是乾淨的狗卡，認養人看到狗不被籠子、地板干擾的樣子。也可以當 3.1 插圖或 3D 的前處理。
- **三種跑法**：
  1. **本機 Python**：模型卡示範 1024x1024、半精度。模型卡沒寫 VRAM，0.2B 參數在 8GB 應該很寬鬆（估算，未實測）。
  2. **瀏覽器 Transformers.js**：[onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)，MIT，模型卡有 Transformers.js 範例並標 `background-removal`。不用伺服器，照片不離開手機。
  3. **Cloudflare Images 的 `segment=foreground`**：官方說這個參數用 BiRefNet 透過 Workers AI 去背，算一般 Images 轉換，不另收 Neurons。來源：[Transform via URL](https://developers.cloudflare.com/images/transform-images/transform-via-url/)。Free 方案每月 5,000 個不重複轉換免費，可以轉 R2 等外部圖片。來源：[Images pricing](https://developers.cloudflare.com/images/pricing/)
- **疑慮**：Cloudflare Images 轉換要「在 zone 上啟用」。來源：[Images get started](https://developers.cloudflare.com/images/get-started/)。本專案 `wrangler.jsonc` 沒有自訂網域路由，目前只用 workers.dev，能不能用要等有自訂網域，workers.dev 能不能用未查證。
- **不建議**：BRIA RMBG-2.0 是 CC BY-NC 4.0，非商用可以，但要登入填表才能下載。來源：[briaai/RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0)。BiRefNet 是 MIT 又不用填表，優先用 BiRefNet。

### 3.4 假 3D 視差：Depth Anything V2 Small（瀏覽器）

- **是什麼**：從單張照片推估深度圖。Small 版 24.8M 參數、Apache-2.0。Base、Large、Giant 是 CC-BY-NC-4.0。來源：[Depth-Anything-V2 GitHub](https://github.com/DepthAnything/Depth-Anything-V2)、[模型卡](https://huggingface.co/depth-anything/Depth-Anything-V2-Small)
- **怎麼用在專案**：拿深度圖讓狗照片隨手指滑動或手機傾斜產生立體視差（類似 iPhone 立體桌布）。比真正 3D 模型輕很多，每張照片都能做，不用另外拍多角度，作為「3D」的入門版很適合。官方 README 社群支援區列了 Transformers.js 的網頁即時深度估計 Space（Xenova/webgpu-realtime-depth-estimation）。來源：[GitHub](https://github.com/DepthAnything/Depth-Anything-V2)
- **難度**：模型部分簡單，視差效果要自己寫 WebGL 或 Canvas，是前端工作量。深度圖也可以在筆電先算好存 R2，前端只做顯示，避免手機下載模型。

### 3.5 照片自動描述：Gemma 4 視覺（Workers AI）

- **是什麼**：Workers AI 上的 `@cf/google/gemma-4-26b-a4b-it`，支援視覺輸入、256,000 tokens 上下文。來源：[Workers AI 模型頁](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- **怎麼用在專案**：上傳照片時自動產生「黑色短毛、胸口白斑、左耳折」這類外觀描述，給圖鑑的替代文字或幫 K 補介紹草稿。介紹（狗自己的個性）仍由人寫，模型只看得到外觀，ADR 0022 的介紹定義不受影響。
- **免費程度**：每百萬輸入 tokens 9,091 Neurons、輸出 27,273 Neurons，不在需付費名單。來源：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)。估算：一張圖加提示約 2,000 輸入、400 輸出 tokens，約 30 Neurons，每天可跑三百張上下。
- **繁體中文**：模型頁沒寫支援語言，繁中與台灣用語品質未查證，要實測。
- **其他選項**：
  - 本機 Qwen3-VL-4B-Instruct：Apache-2.0，4B 參數，社群有 llama.cpp、Ollama、LM Studio 的量化版。模型卡沒有列出支援語言，中文能力未從模型卡查證。來源：[模型卡](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct)
  - 本機 Llama-Breeze2-3B-Instruct（聯發科創新基地）：專門強化繁體中文，有視覺能力，授權為 Llama 3.2 Community License。模型卡沒有 VRAM 數字。來源：[模型卡](https://huggingface.co/MediaTek-Research/Llama-Breeze2-3B-Instruct)。台灣用語需求高時優先試這個。
  - 文字改寫（例如把介紹改成送養貼文語氣）可用 Workers AI 的 `@cf/qwen/qwen3-30b-a3b-fp8`，模型頁寫支援多語言但沒寫中文，繁中品質未查證。來源：[模型頁](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)

### 3.6 長得像的狗、花色相近的狗：DINOv2 相似度

- **是什麼**：Meta 的自監督影像特徵模型，`facebook/dinov2-small` 22.1M 參數、Apache-2.0，可直接拿來抽特徵。來源：[模型卡](https://huggingface.co/facebook/dinov2-small)。有 Transformers.js 版本 [onnx-community/dinov2-small-ONNX](https://huggingface.co/onnx-community/dinov2-small-ONNX)（`image-feature-extraction`），該頁沒寫授權，以原模型 Apache-2.0 為準。
- **怎麼用在專案**：
  - 好玩：每隻狗頁面下方「長得像的狗」，或志工上傳自己狗的照片看最像收容所哪隻。
  - 實用：新照片上傳時列出最像的三隻，提醒「這張是不是放錯狗」，幫忙分辨花色相近的狗。
- **限制**：DINOv2 是通用特徵，分得出「黑狗和黃狗」，但同花色不同隻的狗不一定分得開，要用現有照片實測。專門做動物個體辨識的 [MegaDescriptor-L-384](https://huggingface.co/BVRA/MegaDescriptor-L-384) 是 CC-BY-NC-4.0，模型卡沒寫訓練資料有沒有狗，搭配的 [wildlife-tools](https://github.com/WildlifeDatasets/wildlife-tools)（MIT）也沒提到狗。是否適合狗，未查證。
- **Workers AI**：目錄裡沒有影像嵌入模型，只有文字嵌入，所以要在瀏覽器或筆電算。來源：[Workers AI models](https://developers.cloudflare.com/workers-ai/models/)

### 3.7 舊照放大：Real-ESRGAN

- **是什麼**：照片超解析度與修復，BSD-3-Clause。來源：[Real-ESRGAN GitHub](https://github.com/xinntao/Real-ESRGAN)
- **怎麼用在專案**：早期手機拍的小張、模糊送養照，放大 4 倍後再做送養海報。
- **難度**：有 Windows 免安裝版 `realesrgan-ncnn-vulkan-20220424-windows.zip`，官方寫「不需要 CUDA 或 PyTorch 環境」，最省事。部分功能（例如 `outscale`）免安裝版沒有。來源：同上
- **注意**：放大會「補」出細節，毛色紋路可能和本狗不同，送養用途適度使用。

### 3.8 語音：BreezyVoice

- **是什麼**：聯發科創新基地的語音合成，專門調整成台灣華語，可以用注音輔助控制發音，可複製聲音，Apache-2.0，部分衍生自 CosyVoice。模型卡沒寫硬體需求。來源：[模型卡](https://huggingface.co/MediaTek-Research/BreezyVoice)
- **怎麼用在專案**：送養短片配「我是小黑，我喜歡散步」的旁白，或狗卡上的語音介紹。
- **評估**：好玩度有，但安裝要自己架 Python 環境，對兩個用途的效果不如影片和插圖，排後面。Workers AI 的 `@cf/myshell-ai/melotts` 模型頁只舉英文、法文為例，沒寫中文，未查證。來源：[模型頁](https://developers.cloudflare.com/workers-ai/models/melotts/)

## 4. 3D 類補充

- **SAM 3D Objects（Meta）**：單張圖重建 3D 物件，但官方安裝需求是 Linux 64 位元和「至少 32GB VRAM」，SAM License，要填全名、生日、組織才能下載。8GB Windows 筆電不能跑。來源：[setup.md](https://raw.githubusercontent.com/facebookresearch/sam-3d-objects/main/doc/setup.md)、[模型卡](https://huggingface.co/facebook/sam-3d-objects)
- **建議**：真 3D 先用前面討論的方案。想要每隻狗都有、又輕量的立體感，用 3.4 深度視差比較實際，而且可以先用 3.3 去背把狗切乾淨。

## 5. 看過但沒列入

- **品種辨識**：收容所多為米克斯，品種結果對送養幫助有限，也可能誤導認養人，沒有深入查。
- **Workers AI `m2m100-1.2b` 翻譯**：可以中翻英，但目前對象是台灣認養人，需求不明顯。來源：[Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## 6. 建議優先試的前 3 項

1. **FLUX.2 klein 4B 插圖或貼圖（Workers AI）**：兩個用途都直接有效（志工覺得好玩、送養海報統一畫風），完全在 Cloudflare 免費額度內，不用在筆電裝任何東西，現有 Worker 加 AI binding 就能試。要記得參考圖縮到 512x512 以下，並標明是插圖。
2. **FramePack 照片變短影片（本機）**：對送養宣傳效果最強，作者明說 6GB、筆電 GPU 可以，有 Windows 一鍵包。缺點是一支要十幾到幾十分鐘，權重授權待確認，只適合 K 自己挑幾隻重點狗做。
3. **BiRefNet 去背**：效果穩、MIT 授權、8GB 綽綽有餘，而且是插圖、海報、深度視差的共同前處理，做一次後面都受惠。先用本機 Python 或 Transformers.js 批次試，等有自訂網域再評估 Cloudflare Images `segment=foreground`。

次選：Depth Anything V2 Small 視差效果，作為「3D」的輕量版，前端工作量較大。

## 7. 待確認與疑慮

- FramePack 權重（`lllyasviel/FramePackI2V_HY`）模型卡沒有授權與基底模型資訊。
- Cloudflare Images `segment` 需要 zone，本專案目前只有 workers.dev。
- Gemma 4、Qwen3、Qwen3-VL 的繁體中文與台灣用語品質，官方頁面沒寫，要實測。
- 各本機模型的實際 VRAM 用量（BiRefNet、Breeze2、BreezyVoice）模型卡沒寫，表中「8GB 夠」是依參數量估算。
- 系統 Python 3.13 與各模型套件的相容性沒有逐一查證。本機要裝 Python 套件時，建議另開 3.11 或 3.12 的虛擬環境（一般做法，未查官方說明）。FramePack 一鍵包自帶環境，不受影響。
