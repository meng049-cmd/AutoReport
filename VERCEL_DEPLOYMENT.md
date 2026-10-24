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

先前已驗證登入、跨裝置還原、衝突與 A/B 隔離；這些測試針對雲端保存權限。目前已要求登入後才能使用分析。頁面初始隱藏且停用分析區，不載入分析程式；密碼登入／恢復工作階段後會向 Supabase `/auth/v1/user` 確認使用者已驗證信箱，才啟動分析。登出、HTTP 401 或登入到期會重新鎖定。不同帳號使用同一瀏覽器時，必須由原帳號先另存本機備份，再明確確認清除前一帳號副本，才可啟用新帳號的分析與同步；不會自動將舊檔上傳到新帳號。靜態前端隱藏或停用分析入口屬於操作限制，不能讓公開 JavaScript 變成私有程式；需要強制服務端執行權限時，須將相關 API／運算移到受 JWT 保護的後端。

## 本次公開註冊站點

使用者提供的網址為 `https://auto-report-fa7j2zj07-project1-dc31.vercel.app/`。在 Supabase URL Configuration 加入這個完整網址，並確認正式 Site URL；若這是單次部署網址，應以 Vercel 專案 Domains 中的穩定正式網址取代，後續不要依賴舊的部署網址。Supabase 公開設定已確認 `disable_signup=false`、`mailer_autoconfirm=false`，表示可註冊且要求信箱確認；實際郵件送達仍須透過正式 SMTP 與可收信帳號驗證。

開發環境讀取該 Vercel 網域所需的網路允許項目已存入環境草稿，尚須使用者套用。沒有 Vercel API 授權或 Git Production Branch 設定時，無法由本機保證該網址已部署最新分支；在 Vercel 設定 `codex/autoreport-cloud-sync` 為來源／正式分支後 Redeploy，或另經授權合併 main。

本機資料不能因為切換帳號就匯出給新帳號。原帳號可在登入時按「下載本機備份」保存未同步資料；新帳號若選擇切換，只會經確認清除舊副本，不會取得舊檔案。瀏覽器 IndexedDB 本身不是加密的多使用者作業系統隔離；共用裝置仍應在離開前備份並清理網站資料。

## 本次部署查核發現的阻擋

目前以無效診斷驗證碼檢查重新導向，GitHub Pages 與提供的 Vercel 網址都被導回 `http://localhost:3000`。這表示正式 URL 設定尚未驗證完成；公開註冊不能只以既有測試帳號登入成功當作已就緒。需在 Supabase Authentication → URL Configuration 設定正式 Site URL 與允許的 Redirect URLs，再測試確認信。

每次建置會產生 `/release.json`，可比對 `buildId`、`sourceCommit`、`requireLoginForAnalysis` 與 `supabaseHost`，以驗證 GitHub Pages 與 Vercel 是否部署相同來源。該檔不含密碼或機密金鑰。

既有 `web/browser.spec.mjs` 的完整報表流程有已知基線失敗：其工作表順序與階段製程等舊規格不符現行報表。此變更只為該測試補上登入情境與正確 JavaScript MIME，不刪除舊斷言，也不將全套瀏覽器測試宣稱為已通過。登入專項、同步測試、分析單元測試與本機資料庫瀏覽器測試已另行驗證。

## 已完成的 Vercel Production 部署

正式網址為 https://auto-report-five.vercel.app/ ，專案 `project1-dc31/auto-report`（不是單次部署的隨機網址）。已連結 GitHub `meng049-cmd/AutoReport` 的 main 分支。專案設定已改為 Framework Other、Node 24、安裝 `npm ci --include=dev`、建置 `bash scripts/build-vercel.sh`、輸出 dist。已以 Vercel Build Output API 的預先建置靜態成品部署，平台回報 READY；部署內的 release.json 已透過授權 API 核對與 Git 來源一致。

Vercel SSO 保護改為 `prod_deployment_urls_and_all_previews`，保留預覽與單次部署網址的保護，讓正式 Production 別名不需先登入 Vercel；AutoReport 自己的登入與 Supabase RLS 仍保留。正式網域的 Codex 網路允許設定已另存草稿，須套用後才能完成實站瀏覽器核對。Supabase 的 Site URL 與 Redirect URLs 應使用正式網址，不可繼續指向 localhost。

Vercel CLI 產生的 .env.local 與 .vercel 內容僅供本機部署，已排除 Git 版本控制，不可提交其中的登入或 OIDC 資訊。
