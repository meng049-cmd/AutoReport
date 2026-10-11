# 上傳原始對照 Excel 更新資料庫

在此資料夾上傳一份 `.xlsx`，並提交到 `codex/autoreport-database` 分支。

Excel 必須包含：工單（A16）、CY26、工單（CY24&25）、重工工單1、NPI；繁簡中文頁名皆可。單次最多 20 MB，一次提交一份 Excel。不要上傳 Detail 查詢檔。

GitHub Actions 會比對舊庫，僅增加新的對照、跳過重複對照，保留舊資料。相同工單或料號若對應不同 IC／機種，保留為多組候選供人工確認。

同一個檔名可以重新上傳替換，GitHub 會保留歷史內容。相同內容不會重複增加資料。來源檔案會存入這個 GitHub 儲存庫，網站對照內容也會公開。

提交後查看 Actions 的 **Update reference database**。更新或驗證失敗不會覆蓋既有網站資料。網站程式版本不變，GitHub commit 仍會記錄資料變更與時間。
