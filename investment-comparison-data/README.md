# 獨立投資比較資料同步

此目錄只讀既有估值、財務工具與公開 JSON，產生供第五個工具使用的 `latest.json`，不修改原工具。

排程每小時第 17 分執行（UTC；台北時間同為每小時第 17 分），亦在來源檔案變更時更新。新工具開啟時另每五分鐘嘗試同步報價；關閉時仍有 GitHub Actions 排程。排程可能受平台延遲或公開儲存庫閒置停用政策影響。

資料公開端點：`https://raw.githubusercontent.com/weiny0608/weiny0608.github.io/main/investment-comparison-data/latest.json`。

- 股價：沿用既有工具 CNBC 報價端點，保留原始 `last_time`，不以執行時間代替行情時間。
- 估值：安全解析既有股票工具的 `stocks` 純資料字面值，維持 2027／2029 EPS 口徑。只採財報 JSON 明列 `newEps` 的校準，不採 `bullEps`。
- 財務與債券：安全解析既有信用工具的 `CORPS_DATA` 與 `BONDS_DATA`；未提供財報／報價日期則保留 null。
- 總經與財報排程：沿用既有 JSON 的 `updatedAt`。同步成功不代表上游內容已更新。
- FCN 報價仍須手動輸入銀行實際條款；模型與財報資料不會產生可執行 FCN 報價。

只允許數字、字串、陣列、物件等純資料，不執行下載頁面的 JavaScript。主要來源失敗時保留上一版，缺少新報價時保留前一筆帶時間的報價。所有私人本機研究修改只保留在訪客瀏覽器，不寫入公開資料檔。
