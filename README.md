# AutoReport：工單機種與 IC 查找

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

瀏覽器在本機連到 127.0.0.1 的 8000 埠即可使用。這是本機工具，尚未部署為公開網站。
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
