# 官方 FedWatch 歷史機率同步

本資料流程使用 CME FedWatch 公開工具的 **Historical → Downloads** 歷史 CSV；直接讀取已發布機率，不從期貨價格自行估算。資料可能落後數個交易日，網站始終顯示實際觀察日期。

## 每日流程

`.github/workflows/update-fedwatch.yml` 每天台灣時間 **11:23** 執行，也能在 GitHub Actions 手動選擇 **Run workflow**。GitHub 排程可能延遲；美國週末與假日資料日期可能不變。流程在 GitHub 的標準 Linux 執行環境運行，不依賴個人電腦開機，也不需要 CME API key 或付費 API 訂閱。

1. 用一般 Chromium 瀏覽器正常開啟 CME 官方 FedWatch 頁面，載入內嵌工具。
2. 進入 Downloads，讀取當次工作階段提供的未來會議 CSV 連結。`insid`／`qsid` 不寫死、不保存到公開資料。
3. 下載並檢查會議日期、觀察日期、有效機率、區間完整性及機率總和；所有會議通過才更新 `latest.json`。
4. 從相同官方歷史檔選出上一個可用交易日及一週前或更早的最後可用觀察，附上各自日期。
5. 提交 JSON，明確要求 GitHub Pages 重建，使資料更新確實發布到網站。

首頁與 `/nasdaq/` 共用 `fedwatch.js`，只向本站讀取 JSON，不讓訪客直接向 CME 請求資料。

## 失敗與資料日期

- 下載、驗證或上游存取失敗時，保留整份上次成功的 `latest.json`，更新 `status.json`，並讓該次 Actions 顯示失敗。
- 不使用預設機率、不用空白欄位填 0，也不以自算數字補缺。官方明確發布的 0 與沒有資料分開處理。
- `data_as_of` 是所有會議最新觀察日中最早的一天；每個會議及歷史比較另外保留自己的 `as_of`。
- 官方更改頁面結構、工作階段方式或存取政策時，下載器可能需要維護。這個公開下載流程沒有官方 API 的穩定性保證，不繞過登入、驗證碼或存取限制。

## 本機執行

使用 Python 3.11 或以上，先建立獨立虛擬環境，再於儲存庫根目錄執行：

```sh
python3 -m pip install -r fedwatch-data/requirements.txt
python3 -m playwright install --no-shell chromium
python3 -B -m unittest discover -s fedwatch-data -p 'test_*.py'
python3 -B fedwatch-data/collector.py --output-dir fedwatch-data
```

## 資料來源與使用

- [CME FedWatch](https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html)
- [CME 使用指南與歷史下載說明](https://www.cmegroup.com/tools-information/quikstrike/cme-fedwatch-tool-user-guide.html)
- [CME 資料使用條款](https://www.cmegroup.com/trading/market-data-explanation-disclaimer.html)

免費瀏覽或下載不代表取得不受限的再發布授權；資料對外使用須符合來源條款。程式不把工作階段識別碼或瀏覽器 cookies 寫入儲存庫。
