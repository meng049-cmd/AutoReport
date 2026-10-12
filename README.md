# AutoReport
自動報表專案

## 公開網站（GitHub Pages）

網站：https://meng049-cmd.github.io/AutoReport/

根目錄 `index.html` 為公開網站入口，`site.js` 處理介面，`merge-worker.js` 在背景執行 Excel 讀取與合併。
所有檔案在瀏覽器內處理，不需 Python 伺服器，不會上傳 Excel。完成後點選下載按鈕即可取得合併檔。
建議使用桌面版 Chrome／Edge；大型報表需要足夠記憶體。
`vendor/` 包含已核對 npm SHA-512 完整性的 SheetJS 0.18.5 與授權，執行時不依賴外部 CDN。

```sh
python3 -m http.server 8000
node --test test-merge.js
```

`.github/workflows/pages.yml` 在推送至 `main` 後發布靜態網站。
儲存庫 Settings → Pages 的 Source 需選 GitHub Actions；若選擇從 main 的根目錄發布，根目錄入口也可直接使用。
發布產物僅包含靜態網站，不包含 Python、上傳檔案或本機結果。

跨週合併的檔名採最早資料日期的 ISO 週次，相同狀態保留使用者選檔順序中的第一筆。

## 選用：執行 Python 伺服器版本

需要 Python 3.12。

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

網站監聽 5000 埠。批次上傳最多 30 份 `.xlsx`，合計最多 100 MB。
只合併 Detail，按產出日期、A 欄製程、E 欄小板序號去重，優先保留 FAIL 整列；相同狀態保留上傳順序中的第一列。
「狀態」與「產出時間」依標題辨識，各檔欄位須一致。不同日期、不同製程允許相同序號。
輸出依時間排序，名稱如 `2026_w41_1005-1008.xlsx`，週次依最早資料日期的 ISO 週次計算。

上傳原檔處理後刪除；下載結果保留在忽略追蹤的 `instance/reports/`，可在不需要時刪除。
目前為開發網站，未設登入或公開部署設定，請部署於受控環境。

## 驗證

```sh
.venv/bin/python -m unittest -v
```
