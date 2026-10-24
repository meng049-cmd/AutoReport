# AutoReport 部署至 Vercel

## 已有的資料流程

分析檔案先寫入目前瀏覽器的 IndexedDB，不是自動存到電腦的下載資料夾。只有使用匯出／下載功能才會產生由使用者保存的本機檔案。分析在瀏覽器與 Web Worker 執行，Vercel 提供靜態網站，不執行文件分析，也不保存使用者上傳文件。

按「上傳本機資料」後，對照庫與檔案庫合併成工作區備份，存入 Supabase 的私人 `autoreport-sync` bucket。瀏覽器的資料仍保留；雲端上傳不會自動刪除本機資料。另一台裝置登入並還原後，也有自己的本機副本。清除網站資料可能刪除本機資料，應先確認雲端備份或另存檔案。

目前同步為整份工作區的手動備份，編碼後上限 50 MB；二進位檔編碼會增加體積。Supabase Storage 總容量與 PostgreSQL 容量以專案／組織方案及後台用量為準，不能把 50 MB 當成方案配額。舊備份也占用 Storage。目前沒有自動清理舊版本或增量同步。要保存大量文件，應另做逐檔上傳、分頁清單、增量下載及保留政策，不能只把目前 50 MB 改大。

## Vercel 設定

1. 登入 Vercel → Add New → Project → 匯入 `meng049-cmd/AutoReport`。
2. 目前最新原始碼在 `codex/autoreport-cloud-sync`。若未合併 main，請在 Git 設定將 Production Branch 設為此分支；不要使用 `gh-pages` 作為原始碼建置分支。
3. Framework 選 Other，Root Directory 為儲存庫根目錄。`vercel.json` 已提供安裝、建置與 dist 輸出設定，Node.js 選 24.x。建置需 Python 3 與 venv，腳本會建立 .venv 並安裝 requirements.txt；若 Vercel 的建置映像不提供 Python/venv，應改用 GitHub Actions 預建 dist 再部署，不能宣稱首次 Vercel 建置已通過。
4. 發布後取得實際的 `https://你的專案.vercel.app/`。這裡尚無 Vercel 帳號連線或正式網域，因此不代表已在 Vercel 發布。
5. Supabase → Authentication → URL Configuration：將選定正式站設為 Site URL，Additional Redirect URLs 加入 Vercel 正式網址。若 GitHub Pages 仍保留，亦保留其完整網址。預覽網域若需要測試，另行加入明確的預覽網址；不要任意允許所有來源。
6. 若允許公開註冊，確認 Email provider、信箱確認信與正式 SMTP 可用，並設定適合的寄信、登入及上傳用量限制。若只允許邀請，須在 Supabase 關閉公開註冊並建立／邀請指定使用者；單純隱藏網頁註冊按鈕不能阻止 API 註冊。
7. 在 Vercel 正式網址驗證登入、合成文件分析、上傳雲端、另一瀏覽器還原、版本衝突與資料隔離。也要檢查手機及較大文件的記憶體用量。正式站與 GitHub Pages 為不同來源，各自有不同 IndexedDB／登入狀態；先從舊站上傳雲端，再在新站登入還原。

瀏覽器程式只需要公開的 Supabase Project URL／Publishable key，已在 `cloud/cloud-config.js` 中設定；不要將測試帳密、service_role、資料庫密碼或管理金鑰部署到 Vercel 前端。

## 登入與資料權限

Supabase Auth 的使用者是網站帳號，不是電腦登入帳號，也不是 Supabase 管理後台帳號。JWT 與 RLS 限制每位使用者只能讀寫自己的私人資料；不會取得管理整個資料庫或存取電腦其他資料夾的權限。選擇文件仍需使用者透過瀏覽器的選檔操作。

先前已驗證登入、跨裝置還原、衝突與 A/B 隔離；這些測試針對雲端保存權限。原版分析介面可匿名使用，不能把雲端登入測試當成已驗證整站「未登入不得分析」。若要此限制，需要明確實作與驗證分析入口的登入要求。靜態前端隱藏或停用分析入口屬於操作限制，不能讓公開 JavaScript 變成私有程式；需要強制服務端執行權限時，須將相關 API／運算移到受 JWT 保護的後端。
