# AutoReport 登入與跨裝置雲端同步（Supabase）

兩個網站都準備啟用，使用兩個獨立 Supabase 專案。AutoReport 專案建議命名 `autoreport`；TWStockSearch 使用另一個 `twstocksearch` 專案。不同資料格式可以共用 PostgreSQL 專案，但本版為 AutoReport 使用專用資料表、函式及私人檔案儲存空間，不修改其他網站資源。每位使用者的備份分開保存，資料透過 HTTPS 傳送至私人 Storage bucket；PostgreSQL 保存目前版本及檔案位置。RLS 限制每位使用者只能讀寫自己的資料，匿名訪客不能存取。這不是團隊共用資料庫。

## 兩站容量與分類分開管理

| 網站 | Supabase 專案 | PostgreSQL 資料表 | 私人 Storage bucket | 保存範圍 |
| --- | --- | --- | --- | --- |
| AutoReport | autoreport | autoreport_workspaces | autoreport-sync | 對照庫、原始檔、比對檔、分析檔與分類中繼資料 |
| TWStockSearch | twstocksearch | twstocksearch_workspaces | twstocksearch-sync | 個人研究筆記、規則、匯入資料與設定 |

兩站應填入不同的 Project URL 與對應公開金鑰，各自執行自己儲存庫的 SQL。不可把兩份 SQL 都放到同一專案來當作容量隔離。專案分開保存與查看用量，但同一 Supabase 組織的方案配額或費用可能合併計算，須以實際方案為準；分開 bucket 本身不會建立獨立的總容量配額。本程式的 50 MB 是每份備份大小上限，不是整個專案的容量預算，舊版本仍占空間。

兩個專案的 Auth 使用者與登入狀態也分開；可使用相同信箱，但需在兩站分別註冊與驗證。兩站均為手動同步，各專案管理者可依敏感性與成長速度設定各自的保留政策。TWStockSearch 的公開行情仍留在原本靜態檔案流程，不搬入私人同步空間。

## 第一次啟用

1. 在 Supabase 建立或選擇專案，建議命名 `autoreport`。保留資料庫密碼在安全位置，網站不需要資料庫密碼。
2. 在 SQL Editor 執行本儲存庫的 `supabase/schema.sql`。請使用本儲存庫的 AutoReport 專用 SQL。它會建立 `public.autoreport_workspaces`、`public.commit_autoreport_workspace` 與私人 bucket `autoreport-sync`，只允許 `app=autoreport`。先前共用版本的資源會保留，不會刪除或自動搬移舊備份。確認 `autoreport-sync` bucket 為 **Private**，大小限制 50 MB。若既有同名 bucket 設定不同，先檢查並修正，不要開放公開讀取。不要另外加入允許所有人的資料表或 Storage policy。
3. 在 Authentication 啟用 Email 登入及郵件驗證。將 Site URL 設為正式網站，URL Configuration 的 Redirect URLs 加入 `https://meng049-cmd.github.io/AutoReport/`。正式使用請設定可用的 SMTP 寄信服務與寄信限制，先測試確認信；預設寄信服務可能有限制。
4. 從 Supabase 專案取得 Project URL 與 **Publishable key**（舊版 `anon` key 亦可）。在下列設定檔填入 `url` 及 `publishableKey`，保留 `app` 為 `autoreport`：
   - AutoReport：`cloud/cloud-config.js`
   這兩項為公開瀏覽器設定。**絕對不能填 service_role、secret key 或資料庫密碼**。安全性來自登入 JWT、私人 bucket 與 RLS，而不是隱藏 publishable key。
5. AutoReport 執行 `npm run build`，將 `dist/` 依既有流程部署。新版網站與專用 SQL 需一起更新，因為新版不再使用原先共用的資源名稱。不要只發布 HTML。
6. 雲端開發環境若要連線驗證，需在環境網路允許清單新增實際專案的 `<project-ref>.supabase.co`。沒有專案時不需要新增猜測的網域或萬用允許規則。

尚未填設定時，網頁會顯示「尚未設定雲端服務」，原本的本機功能可繼續使用。只有執行 SQL、填入公開設定並部署後，真實登入與雲端同步才啟用；模擬測試不代表線上服務已驗證。

## 跨裝置使用

- 在第一台裝置展開「帳號與雲端同步」，註冊、完成信箱驗證後登入。登入不會自動上傳或覆蓋資料。
- 完成當前匯入／分析／儲存筆記，關閉此網站其他分頁，按「上傳本機資料」。確認帳號與資料內容後，上傳成為該網站的新雲端版本。
- 在另一台裝置登入同一帳號，按「還原雲端資料」。系統會先下載本機備份；請確認備份確實儲存，再允許取代本機資料，最後按「重新整理」。其他裝置需再次登入；登入狀態不跨裝置傳播。
- 「下載雲端備份」只下載，不改本機。「從備份檔復原本機資料」可還原這裡產生的備份；TWStockSearch 既有研究備份仍透過原本的研究備份入口處理。
- 若另一台裝置先上傳，新上傳會被版本衝突檢查拒絕。先下載雲端備份、另存本機備份並比較；可選擇還原雲端資料，或在確認要以本機取代雲端後按「讀取雲端版本」再上傳。**不會自動合併工單檔案或筆記**。
- 暫時離線時仍能使用原有本機功能；沒有離線上傳佇列或背景自動同步。登出只清除此分頁的登入憑證，保留本機資料；公用裝置請另行清除網站資料。請勿將工單資料上傳至不受信任的帳號。

## 同步範圍與限制

- AutoReport：本瀏覽器 SQLite 對照庫及對照索引、原始檔／比對檔／分析檔案庫的內容與中繼資料。分析計算快取不傳送，還原後清除快取以重新計算。原有 Python CLI／本機伺服器的磁碟資料庫不會自動同步。
- 每個網站每份編碼後備份最多 50 MB；二進位檔採 base64 編碼，實際原始檔可容納量小於 50 MB。超限會拒絕上傳，保留本機資料。這是整份工作區的手動快照，適合個人中小型工作區，不適合大型持續增長的原始檔庫。
- 每次成功上傳使用不同物件名稱，透過版本條件原子更新目前指標。舊備份保留以便復原，會占用 Storage 配額；請依需求在 Supabase 管理後台檢視儲存量及保留政策。上傳失敗或網路中斷也可能留下未引用物件。不要刪除資料表目前 `object_path` 指向的檔案。
- 還原在單一 IndexedDB 內為交易操作；跨資料庫失敗會嘗試回復先前資料，不能宣稱瀏覽器崩潰／儲存空間耗盡時仍具跨庫原子性。因此必須保留下載的本機備份，還原時不要在其他分頁寫入。
- 這不是端對端加密；Supabase 專案管理者可存取專案資料。實際費用、容量與備份政策以所選方案為準。

## 驗證

AutoReport 儲存庫：

```sh
npm run build
node --test cloud/cloud-sync.test.mjs
BROWSER_EXECUTABLE=/usr/bin/chromium node --test cloud/cloud-sync.browser.test.mjs
npm test
```

新增測試涵蓋二進位資料保真、損毀備份拒絕、兩台裝置版本衝突、登入 UI、獨立瀏覽器的本機還原與筆記保存。後端使用模擬回應；**不等同於真實 Supabase 的 RLS／寄信／跨裝置驗證**。

啟用真實專案後，必須再驗證：

1. 帳號 A 在裝置一匯入測試資料並上傳，裝置二登入 A 還原，確認內容與下載檔一致。
2. 裝置一、二先讀同版本，一台更新後另一台上傳應拒絕，原雲端版本保持不變。
3. 帳號 B 的版本清單不應含 A 的資料；以 B 的 JWT 要求 A 的 Storage 路徑應失敗，以匿名 publishable key 讀取資料表或私人檔案也應失敗。
4. 確認資源名稱為 AutoReport 專用，且登出／重新開啟分頁後的登入狀態與畫面正確。
5. 驗證信箱確認信、失效登入及網路中斷錯誤提示。確認既有 RLS policy 沒有額外授權其他使用者讀取。
