# AutoReport 工單 IC／機種比對

## 線上網站（GitHub Pages）

網站網址：https://meng049-cmd.github.io/AutoReport/

第一次啟用：到 [儲存庫 Settings → Pages](https://github.com/meng049-cmd/AutoReport/settings/pages)，選擇 **Deploy from a branch**，分支選 **gh-pages**、目錄選 **/(root)**，按 Save。等待 GitHub 顯示部署完成後開啟上方網址。

使用方式：上傳 `.xlsx` 或 `.csv` → **開始比對** → **匯出 Excel**。也可直接輸入工單號碼或完整產品料號查找。查詢範本可在網站下載。

- 網站已帶入指定五頁的 385 筆對照資料、1,268 個不重複工單。
- 來源只採用「工單（A16）」「CY26」「工單（CY24&25）」「重工工單1」「NPI」，繁簡頁名皆可辨識。
- 每個儲存格只取第一筆；機型視為 IC 欄位；支援繁簡中文與全半形。
- 上傳查詢檔會處理所有分頁。檔案留在瀏覽器內，不會傳到伺服器或寫入對照庫。
- 唯一匹配才填入機種與 IC；多組候選、缺漏及條件衝突會分別標示並保留來源。
- 不需安裝 SQLite 或其他資料庫外掛。網站中的對照資料屬於公開的 GitHub Pages 靜態內容。

### 維護與更新網站

程式原始碼在 `codex/autoreport-database` 分支；`gh-pages` 分支只放建置完成的網站。

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci
npm run build
npm test
npm run test:browser  # 需已安裝 Chromium；也可先 npx playwright install chromium
.venv/bin/python web/publish_pages.py
```

建置會從既有 `data/autoreport.sqlite3` 匯出瀏覽器對照索引，不會重新匯入或改動資料庫。更新參考資料可使用網站的「上傳並更新資料庫（GitHub）」入口，將一份 Excel 提交到 database-inputs，GitHub Actions 會比對舊庫、追加新對照並發布。也可使用下方 Python 匯入流程。純靜態網站沒有 Python API 相依；Excel 解析與比對在 Web Worker 內執行。

以下保留本機 Python 工具的使用說明。

## 本機工單機種與 IC 查找

已依使用者圖一重建 SQLite 資料庫，來源明確固定為以下五頁（繁簡名稱皆可）：

1. 工單（A16）
2. CY26
3. 工單（CY24&25）
4. 重工工單1
5. NPI

來源不依工作簿最左側位置選取。舊版誤選的模版、越南需求、工單 WIP 匯總及業務出貨需求已移出目前資料庫和下載包。
資料庫將這五頁的工單／MES 工單欄各取儲存格第一筆內容，建立「工單 → IC／機型 → 機種」對照。
不需要資料庫外掛、帳號、API 金鑰或外部資料庫服務。Python 已內建 SQLite；Excel 讀取使用 openpyxl，繁簡正規化使用 OpenCC。

## GitHub 下載

此次交付位於 `codex/autoreport-database` 分支。完整工具包含已建立的資料庫及實際工單資料，已依使用者同意上傳至此儲存庫。

- [完整工具包 ZIP](https://github.com/meng049-cmd/AutoReport/raw/refs/heads/codex/autoreport-database/downloads/AutoReport_tools.zip)
- [整理與對照 Excel](https://github.com/meng049-cmd/AutoReport/raw/refs/heads/codex/autoreport-database/downloads/AutoReport_summary.xlsx)
- [上傳查詢範例 Excel](https://github.com/meng049-cmd/AutoReport/raw/refs/heads/codex/autoreport-database/downloads/AutoReport_query_template.xlsx)
- [範例比對結果 Excel](https://github.com/meng049-cmd/AutoReport/raw/refs/heads/codex/autoreport-database/downloads/AutoReport_sample_results.xlsx)
- [SQLite 資料庫](https://github.com/meng049-cmd/AutoReport/raw/refs/heads/codex/autoreport-database/data/autoreport.sqlite3)
- [分析說明](downloads/AutoReport_analysis.md)

若檔案頁面沒有直接下載，開啟該檔案後使用 GitHub 的「Download raw file」按鈕。私人儲存庫需登入有權限的 GitHub 帳號。

## 使用上傳查找介面

先解壓完整工具包，在 `AutoReport` 目錄執行（Python 3.10 以上）：

```sh
python -m venv .venv
```

macOS／Linux：

```sh
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

Windows：

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe server.py
```

瀏覽器在本機連到 127.0.0.1 的 8000 埠即可使用。這是本機 Python 工具；上方 GitHub Pages 網站可直接使用，無需執行 Python。
此雲端工作區的 Python 已安裝於 `/workspace/AutoReport/.venv/bin/python`；在 `/workspace/AutoReport` 執行 `.venv/bin/python server.py` 可啟動。
每個雲端任務已有隔離環境，直接使用現有 checkout，不需建立 Git worktree。

上傳 .xlsx 或 .csv（20 MB 以下）即可批次比對，查詢檔處理所有分頁，不限制分頁名稱。使用「工單號碼」或「產品料號」欄位；也支援 DPN、客戶品號、機種、IC。
繁體與簡體欄名皆可，「機型／机型」視為 IC。機種與 IC 留白時，由資料庫補上唯一有效對應。
所有非空可辨識欄位都會作為查找條件；結果列保留原始資料、來源分頁與列號，可匯出 Excel。
`exports/上傳查詢範例.xlsx` 提供 15 筆範例，包含五頁各一筆、純數字工單、重工 IC 補正及待確認項目；最後一筆示範同格第二筆工單依規則不建立對照。正式使用時刪除範例列，再貼入要查找的資料即可。

結果狀態：

| 狀態 | 意義 |
|---|---|
| 唯一匹配 | 只有一組有效機種／IC，自動補值 |
| 多組候選 | 同一查找值對應多組，保留候選，不自動選取 |
| 查無資料 | 資料庫沒有相符對照 |
| 條件不一致 | 同一列提供的多個條件無法得到共同機種／IC |
| 來源未提供完整對應 | 來源機種或 IC 缺漏，或為 -、N/A 等值 |
| 缺少查找欄位 | 該列沒有非空且可辨識的查找欄位 |

「IC／機型／机型」視為同義欄名。CY26Goodix 整理為 IC=Goodix、代別=CY26；CY26Synaptics 同理，原文另存為 `raw_ic`。
「不良品返修」等重工用途不當成 IC，會以相同主料號／DPN 的一致參考確認 IC。機種名稱依來源保留，不自動合併不同名稱。
合併儲存格的標識值補齊到合併範圍。每格只取第一筆非空文字（換行、分號或頓號分隔）；工單、料號、DPN、IC／機型、機種與上傳查詢條件均遵守此規則。
同格第二筆以後不建立對照，完整原文仍保存；機種名稱內的斜線與逗號不拆分。
第一筆含 SAP: 前綴或數量備註時擷取該筆工單號；純數字新系統工單也支援。
例如 `C533-260100003` 原始資料對應兩個 IC，會列出候選；缺少機種、IC 或料號／機種不一致的資料會保留待確認。
詳細來源與補正依據見 `exports/分析說明.md`。整理 Excel 首頁為「工單IC機種對照」，後面的五個原始分頁供查核。
料號版本尾碼保留；文字搜尋不會自動填值。既有來源若同一料號出現新舊對照，會列出全部候選，不採用「最新一筆」的猜測。
上傳查詢檔僅在記憶體中處理，不留存、不修改資料庫；查詢結果由使用者自行下載保存。

## 命令列

以下 `python` 代表安裝上述套件的虛擬環境 Python。在專案目錄執行：

```sh
python autoreport.py stats
python autoreport.py query C515-250300004 --kind order
python autoreport.py query 98000320-107 --kind part
python autoreport.py search Taroko
python autoreport.py match 需要查找.xlsx --out 比對結果.xlsx
```

SQLite 檔案位於 `data/autoreport.sqlite3`，可直接用任何 SQLite 工具查看。
資料表為 `sources`（來源與匯入範圍識別）、`sheets`（分頁統計）、`raw_rows`（原始儲存格）、`records`（整理索引）、`lookup_keys`（繁簡正規化查找鍵）、`work_orders`（拆分工單號與原始欄位）。
`work_order_mappings` 檢視表可直接查「工單／IC／機種／原始IC／來源頁／來源列／整理依據」。同一工單可能有多筆來源，僅相同有效機種／IC 會合併為唯一匹配，來源不會遺失。

需要追加新的「參考資料」時才執行下列指令；這與上傳「待查詢資料」不同：

```sh
python autoreport.py import 新的參考工單明細.xlsx
python build_artifacts.py
```

匯入會追加來源，預設只讀取上述指定五頁。缺少任一指定頁會報錯且不寫入，不會改抓其他分頁補足。
其他來源格式需要明確指定頁名，例如 `python autoreport.py import 參考資料.xlsx --sheets 客製頁名`。
同內容與匯入範圍依 SHA-256 識別去重。追加前請備份資料庫；移除或取代來源尚無圖形介面。
匯入讀取數值及公式快取，不執行公式、不依附件文字執行操作。

## 驗證

```sh
python -m unittest -v
```

測試包含指定分頁位於第 5–9 頁時仍選取正確來源、缺少指定頁時不寫入、每格只取第一筆、機種斜線保留、繁簡欄名、機型別名、第一筆 SAP 工單、重工 IC 交叉確認、料號版本、多組候選、合併欄位、重複匯入及 Excel／CSV 比對匯出。
此次交付的 `data/autoreport.sqlite3` 和 `downloads/` 已依使用者同意提交 Git。`data/` 其他新檔案及 `exports/` 預設忽略；未來更新資料庫會改動已追蹤的資料檔，提交或上傳前請確認內容與目的地。

## Detail 原檔補欄下載

上傳含 `Detail` 分頁的 `.xlsx`，第一列為表頭，從第二列開始使用 B 欄工單、C 欄料號共同比對。唯一匹配時 J 欄填 IC、K 欄填機種；未匹配或有多組候選時留白，畫面顯示原因。J/K 已有資料時停止，避免覆蓋。

下載檔只修改 Detail 的 J/K 儲存格與必要的範圍資訊，保留 A–I 的值、公式、樣式和其他分頁。一般查詢檔仍可使用原本的比對結果匯出。

驗證：`npm run build && npm test && npm run test:browser`。瀏覽器測試使用 `/usr/bin/chromium` 或 `BROWSER_EXECUTABLE` 指定的 Chromium。


## 上傳 Excel 追加資料庫

網站「上傳並更新資料庫（GitHub）」開啟 GitHub 原生上傳頁，沿用 GitHub 帳號與儲存庫權限，無須在網站輸入 token。一次提交一份 `.xlsx` 到 `codex/autoreport-database/database-inputs`，必須包含指定五頁。新增、更新同名 Excel 都會觸發 **Update reference database**。

更新以既有 SQLite 的複本進行：解析五頁 → 按正規化的機種、IC、產品系列、料號集合、DPN 集合、工單集合比對，跨分頁的相同對照也會跳過 → 保留既有對照、追加新對照 → 完整性檢查 → 建置與瀏覽器下載驗證 → 將資料庫存回來源分支 → 發布 gh-pages 並明確請求 Pages build。GitHub Actions 自動提交不會自動觸發 Pages build，所以工作流程會使用 pages:write 權限發出 build 請求。

相同工單或料號的新 IC／機種不覆蓋舊資料，查詢會保留多组候選，需人工確認。沒有新增對照時，資料庫與更新時間不變；原始 Excel 的上傳本身仍會留下 GitHub commit。缺頁、格式錯誤或測試失敗不會更換既有網站資料。若分支保護阻止 Actions 提交，需允許工作流程寫入來源分支；若停用 Actions，需先啟用。

程式版本維持 `1.0.0`。資料更新時間與最近新增／跳過筆數存於 `data/database-update.json`，網站以台北時間顯示。來源檔與網站對照會保存在 GitHub／GitHub Pages，查詢檔不會因此上傳。

本機等效命令：

```sh
.venv/bin/python web/update_database.py 原始對照.xlsx
npm run build
node --test web/update-browser.spec.mjs
```

上傳區的「已上傳檔案」清單會向 GitHub 查詢 database-inputs 內的 Excel，並列出既有資料庫來源檔名。支援檔名搜尋與同名提醒；GitHub 清單讀取失敗時會顯示提示和資料夾連結。一般 Detail 查詢檔只在瀏覽器處理，不會存入 GitHub 清單。即使上傳的 Excel 沒有新對照，工作流程也會發布更新的檔案清單，資料庫與資料更新時間仍保持不變。

批次比對可一次選取多個 Excel／CSV，逐檔處理，每份結果可獨立下載；多份成功結果可下載 ZIP。單一檔案失敗不會中斷其他檔案。同名結果會自動加上編號，避免 ZIP 內互相覆蓋。每個 Excel 的 Detail 仍只增加 J/K，保留 A–I 與其他分頁。
# Detail 批次合併下載

公開網站：<https://meng049-cmd.github.io/AutoReport/>

「上傳檔案批次比對」完成後，可點 **合併比對後的 Detail**，再點下載連結取得修改後的合併檔。
若檔案 J/K 已填入 IC／機種，請使用 **Detail 合併與去重 → 直接合併 Detail**，不用再次比對。

- 僅輸出 Detail，依產出時間排序。
- 以同一天＋A 欄製程＋E 欄小板序號去重；FAIL 整列優先，相同狀態保留第一筆。
- 狀態依「狀態」標題辨識，可位於 H 或 I；原始欄位順序保留。
- 名稱如 `2026_w41_1005-1008.xlsx`，依最早日期的 ISO 週次命名；跨週採起始週次。
- 最多 30 份 .xlsx、合計 100 MB，在瀏覽器背景執行，檔案不會上傳。

合併用的 SheetJS 已放入 `vendor/` 並核對 npm 套件 SHA-512 完整性；執行時不依賴 CDN。
建置前執行 `npm ci`、安裝 `requirements.txt`，再執行 `npm run build`、`npm test`、`npm run test:browser`。
發布沿用 `web/publish_pages.py`，以正常 fast-forward push 更新 `gh-pages`，不更改現有 Pages 保護規則。

## 每日良率成品

在網站「每日良率報表」上傳已整併的主檔，點「計算每日良率」，完成後下載 Excel。
以 J 欄 IC 與 K 欄機種分組、F 欄產出時間分日、A 欄製程及「狀態」欄計數，良率 = GOOD / (GOOD + FAIL)。
J/K 缺漏的組合明確標示待補，原始列另列於「待補產品資料」，不猜測產品、不靜默丟棄資料。主檔仍按日期＋製程＋小板序號去重，FAIL 優先。

成品包括：
- 每日製程良率：每個產品一區，製程為列、日期為欄。DAF外觀檢查對應 DAF外觀。
- 每日階段良率：SMT（正面AOI）、前段、後段。
- 計算明細：每天各產品／製程的 GOOD、FAIL、總數與 Excel 良率公式。
- Detail：保留去重後主檔供追溯。

前段 = DAF外觀、DAF熱壓投入、功能一測試的當日良率平均；後段 = 功能二測試、外觀檢查點亮測試、輝度機測試的當日良率平均。
Excel 使用 `IFERROR(AGGREGATE(1,6,範圍),"")`，並包含已計算的快取值；這是各製程良率的算術平均，不依產量加權。
沒有資料留白，全 FAIL 顯示 0%，日期範圍內缺少資料的日子仍列出。
輸出名稱如 `2026_w41_1005-1008_每日良率.xlsx`。資料只在瀏覽器處理。
