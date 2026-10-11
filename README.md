# AutoReport：工單機種與 IC 查找

已建立 SQLite 資料庫，僅匯入「工單明细表_中科廠-2026.xlsx」前五個分頁。
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

上傳 .xlsx 或 .csv（20 MB 以下），每次只讀取前五個分頁。使用「工單號碼」或「產品料號」欄位；也支援 DPN、客戶品號、機種、IC。
繁體與簡體欄名皆可，「機型／机型」視為 IC。機種與 IC 留白時，由資料庫補上唯一有效對應。
所有非空可辨識欄位都會作為查找條件；結果列保留原始資料、來源分頁與列號，可匯出 Excel。
`exports/上傳查詢範例.xlsx` 提供六筆範例。正式使用時刪除範例列，再貼入要查找的資料即可。

結果狀態：

| 狀態 | 意義 |
|---|---|
| 唯一匹配 | 只有一組有效機種／IC，自動補值 |
| 多組候選 | 同一查找值對應多組，保留候選，不自動選取 |
| 查無資料 | 資料庫沒有相符對照 |
| 條件不一致 | 同一列提供的多個條件無法得到共同機種／IC |
| 來源未提供完整對應 | 來源機種或 IC 缺漏，或為 -、N/A 等值 |
| 缺少查找欄位 | 該列沒有非空且可辨識的查找欄位 |

第 4 頁 Platform 作為機種、Model 另存為產品系列；第 5 頁直接使用「機種」。詳情及限制見 `exports/分析說明.md`。
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
資料表為 `sources`（來源與雜湊）、`sheets`（分頁統計）、`raw_rows`（原始儲存格）、`records`（整理索引）、`lookup_keys`（繁簡正規化查找鍵）。

需要追加新的「參考資料」時才執行下列指令；這與上傳「待查詢資料」不同：

```sh
python autoreport.py import 新的參考工單明細.xlsx
python build_artifacts.py
```

匯入會追加來源，僅處理前五個分頁；同內容檔案依 SHA-256 去重。移除或取代既有來源尚未提供介面，追加前請備份資料庫。
匯入讀取數值及公式快取，不執行公式、不依附件文字執行操作。

## 驗證

```sh
python -m unittest -v
```

測試包含繁簡欄名、機型別名、工單跨頁料號連結、料號版本、多組候選、條件不一致、合併欄位、僅前五頁、重复匯入、Excel／CSV 上傳與匯出。
此次交付的 `data/autoreport.sqlite3` 和 `downloads/` 已依使用者同意提交 Git。`data/` 其他新檔案及 `exports/` 預設忽略；未來更新資料庫會改動已追蹤的資料檔，提交或上傳前請確認內容與目的地。
