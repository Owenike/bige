# Giveme 電子發票 API 5.5 可讀版

> 文件密級：保密
> 原始文件：`API文檔-Giveme電子發票加值中心.pdf`
> 原始版本：5.5
> 原始 PDF：13 頁
> 原始檔 SHA-256：`C0FF442A9C7D045ACBFBB04BD60C6EC0FE420604640A3C022E6141905A18296C`
> 轉錄日期：2026-08-16
> 用途：將 PDF 內容轉成 UTF-8、可搜尋、可複製的專案參考文件。

## 閱讀原則

- 「文件規格」只記錄 PDF 明確寫出的內容。
- 「BIG E 實作提醒」是依文件做的系統設計註記，不代表 Giveme 的承諾。
- PDF 沒有記載的功能會明確標成「未記載」，不能自行推定。
- API 帳號、密碼及正式憑證不得寫入本文件或前端程式。

## 目錄

1. 共用驗證及後台設定
2. B2C 發票新增
3. B2B 發票新增
4. B2B／B2C 發票作廢
5. B2B／B2C 發票網頁列印
6. B2B／B2C 發票圖片列印
7. 雲列印
8. B2B／B2C 發票查詢
9. 文件已回答與未回答事項
10. BIG E 使用情境對照

---

## 1. 共用驗證及後台設定（原 PDF 第 1 頁）

### 1.1 簽章

`sign` 的產生方式：

```text
MD5(timeStamp + idno + password).toUpperCase()
```

- `timeStamp`：目前時間的毫秒數。
- `idno`：API 帳號。
- `password`：登入密碼。
- MD5 結果必須轉為大寫。
- 文件提供的 Java 參考寫法：

```java
Md5.MD5(timeStamp + idno + password).toUpperCase()
```

### 1.2 Giveme 發票系統後台設定

1. `系統設定 → 員工設定 → 新增 API 帳號密碼`，文件註記密碼請複雜化。
2. `系統設定 → 白名單設定`，輸入貴司固定 IP。

### 1.3 請求格式

- 開立、作廢、圖片列印及查詢皆以 HTTP 請求呼叫 Giveme API。
- 文件中的 JSON 範例以 Postman 的 raw body 示意。
- 各端點的請求方法與 `Content-Type` 以後續章節為準。

### BIG E 實作提醒

- `password` 只用於伺服器端產生簽章，不可傳到瀏覽器。
- `timeStamp` 的有效期間在各端點表格均標示為 5 分鐘。
- 正式環境的白名單來源應是「實際呼叫 Giveme 的雲端後端出口 IP」，不是操作人員瀏覽器或健身房電腦的 IP。

---

## 2. B2C 發票新增（原 PDF 第 2 至 5 頁）

### 2.1 適用範圍

文件原文說明此介面用於：

- 一般消費者發票。
- 混合稅發票（包含混合稅有統編）。
- 文件註記：無開立混合稅免上傳混合稅相關。

### 2.2 端點

```http
POST https://www.giveme.com.tw/invoice.do?action=addB2C
Content-Type: application/json
```

### 2.3 頂層參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `timeStamp` | varchar | 是 | 目前時間毫秒數，5 分鐘內有效。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |
| `idno` | varchar | 是 | API 帳號。 |
| `sign` | varchar | 是 | 簽名，算法見本文件第 1 節。 |
| `customerName` | varchar | 否 | 內部註記；顯示於網頁，發票上不顯示。 |
| `phone` | varchar | 否 | 財政部手機條碼載具，例如 `/1234567`。不列印感熱紙時，`phone`／`orderCode` 擇一必填。 |
| `orderCode` | varchar | 否 | 自行定義的編號載具。不列印感熱紙時，`phone`／`orderCode` 擇一必填。 |
| `datetime` | varchar | 是 | 發票日期，格式 `yyyy-MM-dd`；文件同欄另註「電腦時間毫秒數」。 |
| `email` | varchar | 否 | 第一組 Email。 |
| `email2` | varchar | 否 | 備用 Email；需要傳送第二個 Email 時使用。 |
| `state` | varchar | 是 | 發票捐贈狀態：`0` 不捐贈、`1` 捐贈。 |
| `donationCode` | varchar | 條件必填 | 捐贈碼；`state=1` 時必填。 |
| `taxType` | int | 否 | 課稅別：`0` 應稅、`1` 零稅率、`2` 免稅、`3` 特種稅、`4` 混合稅。預設跟隨系統設定。 |
| `companyCode` | varchar | 條件必填 | 客戶統一編號；`taxType=4` 混合稅時必填。 |
| `freeAmount` | int | 條件必填 | 免稅銷售額合計；`taxType=4` 時必填。 |
| `zeroAmount` | int | 條件必填 | 零稅率銷售額合計；`taxType=4` 時必填。 |
| `sales` | int | 條件必填 | 應稅銷售額合計；`taxType=4` 時必填。 |
| `amount` | int | 條件必填 | 稅額；`taxType=4` 時必填。 |
| `totalFee` | varchar | 是 | 文件原文為「不可為 0，大於 1，不可有小數點」。但 BIG E 已實測 1 元可成功開立，因此此處不自行解讀成嚴格的 `> 1`；可確定的是正整數且不可有小數。 |
| `content` | varchar | 是 | 總備註，顯示於網頁及發票上。 |
| `items` | 集合 | 是 | 商品明細集合，欄位見下一節。 |

### 2.4 `phone` 手機條碼規則

文件列出的驗證方式：

1. 第 1 碼為 `/`。
2. 其餘 7 碼可由數字 `0-9`、大寫英文字母 `A-Z` 組成。
3. 另可使用特殊符號 `+`、`-`、`.`；合計為 39 種可用字元。

因此手機條碼的可讀正規表示式為：

```regex
^\/[0-9A-Z+\-.]{7}$
```

### 2.5 `orderCode` 文件列出的用途

`orderCode` 可自行定義，文件舉例：

1. 訂單號：蝦皮單號、Facebook 單號、訂單編號等。
2. 行動電話：消費者手機號碼。
3. 自訂：會員編號或不重複編號等。

文件沒有說明 Giveme 是否會檢查 `orderCode` 唯一性，也沒有承諾會以它阻擋重複開票。

### 2.6 `items` 商品明細

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `name` | varchar | 是 | 商品名稱；請勿含特殊符號。 |
| `money` | int | 是 | 單價，可為 0，但至少要有一筆商品單價為 1 以上。 |
| `number` | int | 是 | 數量。 |
| `taxType` | int | 條件必填 | 商品課稅別：`0` 應稅、`1` 零稅率、`2` 免稅；混合稅時必填。 |
| `remark` | varchar | 否 | 單一商品備註；請勿含特殊符號。 |

原 PDF 第 1 頁的 Postman 圖片把 `items` 放成「序列化後的 JSON 字串」，例如概念上是：

```json
{
  "items": "[{\"name\":\"商品1\",\"money\":500,\"number\":1}]"
}
```

但欄位表將 `items` 標成「集合」。BIG E 在 2026-08-13 的 B2C 實測以 JSON 陣列送出亦成功開立及查詢，因此供應商後端目前至少接受 B2C 陣列格式；B2B 是否同樣接受陣列仍應以測試結果為準。

### 2.7 零稅率相關參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `customsMark` | varchar | 條件必填 | 通關方式：`0` 非經海關出口、`1` 經海關出口。零稅率（包含混合稅）必填，其餘課稅別忽略。 |
| `zeroRemark` | varchar | 條件必填 | 零稅率原因，填寫 `71` 至 `79`。零稅率（包含混合稅）必填，其餘課稅別忽略。 |

`zeroRemark` 代碼：

| 代碼 | 原文件說明 |
|---:|---|
| `71` | 第一款：外銷貨物。 |
| `72` | 第二款：與外銷有關之勞務，或在國內提供而在國外使用之勞務。 |
| `73` | 第三款：依法設立之免稅商店銷售與過境或出境旅客之貨物。 |
| `74` | 第四款：銷售與保稅區營業人供營運之貨物或勞務。 |
| `75` | 第五款：國際間之運輸；但外國運輸事業在中華民國境內經營國際運輸業務者，應以各該國對中華民國國際運輸事業予以相等待遇或免徵類似稅捐者為限。 |
| `76` | 第六款：國際運輸用之船舶、航空器及遠洋漁船。 |
| `77` | 第七款：銷售與國際運輸用之船舶、航空器及遠洋漁船所使用之貨物或修繕勞務。 |
| `78` | 第八款：保稅區營業人銷售與課稅區營業人未輸往課稅區而直接出口之貨物。 |
| `79` | 第九款：保稅區營業人銷售與課稅區營業人存入自由港區事業或海關管理之保稅倉庫、物流中心以供外銷之貨物。 |

### 2.8 回傳參數

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `success` | varchar | 成功：`true`；失敗：`false`。 |
| `code` | varchar | 發票號碼；`success=true` 時回傳。 |
| `msg` | varchar | 錯誤描述。 |
| `totalFee` | varchar | 開立發票商品總金額。 |
| `orderCode` | varchar | 編號載具（會員載具）；無資料則為空值。 |
| `phone` | varchar | 財政部手機條碼載具；無資料則為空值。 |

### 2.9 可讀請求骨架

以下僅將文件欄位整理成可讀 JSON 骨架，值為示意，並非原文件提供的測試憑證：

```json
{
  "timeStamp": "CURRENT_TIME_IN_MILLISECONDS",
  "uncode": "SELLER_TAX_ID",
  "idno": "API_ACCOUNT",
  "sign": "UPPERCASE_MD5_SIGNATURE",
  "customerName": "消費者姓名或內部註記",
  "phone": "/ABCD123",
  "orderCode": "",
  "datetime": "2026-08-16",
  "email": "customer@example.com",
  "email2": "",
  "state": "0",
  "donationCode": "",
  "taxType": 0,
  "totalFee": "50",
  "content": "50元入場",
  "items": [
    {
      "name": "50元入場",
      "money": 50,
      "number": 1
    }
  ]
}
```

---

## 3. B2B 發票新增（原 PDF 第 5 至 8 頁）

### 3.1 適用範圍

文件原文說明：

- 開立有統編的發票。
- 買方是公司行號，必須提供統一編號。

### 3.2 端點

```http
POST https://www.giveme.com.tw/invoice.do?action=addB2B
```

### 3.3 頂層參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `timeStamp` | varchar | 是 | 目前時間毫秒數，5 分鐘內有效。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |
| `idno` | varchar | 是 | API 帳號。 |
| `sign` | varchar | 是 | 簽名，算法見本文件第 1 節。 |
| `customerName` | varchar | 否 | 買方公司名稱，非必填。 |
| `phone` | varchar | 是 | 買方統一編號，必填。注意：B2B 的 `phone` 並不是手機條碼。 |
| `datetime` | varchar | 是 | 發票日期，格式 `yyyy-MM-dd`；文件同欄另註「電腦時間毫秒數」。 |
| `email` | varchar | 否 | 需要傳送 Email 時使用。 |
| `email2` | varchar | 否 | 備用 Email；需要傳送第二個 Email 時使用。 |
| `taxState` | varchar | 是 | 單價是否含稅：`0` 含稅（預設）、`1` 未稅。 |
| `totalFee` | varchar | 是 | 文件原文為「不可為 0，大於 1，不可有小數點」。B2B 尚未完成實測，不進一步推定最低可開立金額。 |
| `amount` | varchar | 是 | 稅額；整數，不可有小數點。 |
| `sales` | varchar | 是 | 未稅銷售額；整數，不可有小數點。 |
| `taxType` | int | 否 | 課稅別：`0` 應稅、`1` 零稅率、`2` 免稅。預設跟隨系統設定。 |
| `content` | varchar | 是 | 總備註，顯示於網頁及發票上。 |
| `items` | 集合 | 是 | 商品明細集合，欄位見下一節。 |

### 3.4 `items` 商品明細

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `name` | varchar | 是 | 商品名稱；請勿含特殊符號。 |
| `money` | double | 是 | 單價可為 0 或負數；所有商品加總必須大於 1；最多兩位小數。 |
| `number` | int | 是 | 數量。 |
| `remark` | varchar | 否 | 單一商品備註；請勿含特殊符號。 |

### 3.5 零稅率相關參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `customsMark` | varchar | 條件必填 | 通關方式：`0` 非經海關出口、`1` 經海關出口；零稅率必填。 |
| `zeroRemark` | varchar | 條件必填 | 零稅率原因，填寫 `71` 至 `79`；代碼內容與 B2C 章節相同。 |

### 3.6 回傳參數

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `success` | varchar | 成功：`true`；失敗：`false`。 |
| `code` | varchar | 發票號碼；`success=true` 時回傳。 |
| `msg` | varchar | 錯誤描述。 |
| `phone` | varchar | 買方統一編號。 |
| `totalFee` | varchar | 開立發票商品總金額。 |

### 3.7 可讀請求骨架

以下僅將文件欄位整理成可讀 JSON 骨架，值為示意：

```json
{
  "timeStamp": "CURRENT_TIME_IN_MILLISECONDS",
  "uncode": "SELLER_TAX_ID",
  "idno": "API_ACCOUNT",
  "sign": "UPPERCASE_MD5_SIGNATURE",
  "customerName": "買方公司名稱",
  "phone": "BUYER_TAX_ID",
  "datetime": "2026-08-16",
  "email": "buyer@example.com",
  "email2": "",
  "taxState": "0",
  "totalFee": "1050",
  "amount": "50",
  "sales": "1000",
  "taxType": 0,
  "content": "教練課程",
  "items": [
    {
      "name": "私人教練課程",
      "money": 1050,
      "number": 1
    }
  ]
}
```

### 3.8 文件沒有提供的 B2B 欄位

B2B 新增參數中沒有下列欄位：

- `orderCode`
- B2C 手機條碼載具
- 由 Giveme 端執行的自訂訂單唯一性或冪等鍵

BIG E 若要避免同一筆課程訂單重複開票，必須在自己的資料庫與後端流程中實作唯一鍵、狀態與重試保護。

---

## 4. B2B／B2C 發票作廢（原 PDF 第 8 至 9 頁）

### 4.1 文件限制

- 兩個月為一期，例如 1 至 2 月為一期。
- 尚未申報 401 前可隨時作廢，再重新開立。
- 文件明確寫明：折讓及原發票號碼異動發票內容，請於系統後台手動開立。

因此本版文件只有「作廢 API」，沒有「折讓 API」或「修改發票內容 API」。

### 4.2 端點

```http
POST https://www.giveme.com.tw/invoice.do?action=cancelInvoice
Content-Type: application/json
```

### 4.3 參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `timeStamp` | varchar | 是 | 目前時間毫秒數，5 分鐘內有效。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |
| `idno` | varchar | 是 | API 帳號。 |
| `sign` | varchar | 是 | 簽名。 |
| `code` | varchar | 是 | 發票號碼。 |
| `remark` | varchar | 是 | 作廢原因。 |

### 4.4 回傳參數

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `success` | varchar | 成功：`true`；失敗：`false`。 |
| `code` | varchar | 發票號碼；`success=true` 時回傳。 |
| `msg` | varchar | 錯誤描述。 |

---

## 5. B2B／B2C 發票網頁列印（原 PDF 第 9 至 10 頁）

### 5.1 文件說明

- 以網頁模式取得列印。
- 若需要列印感熱紙發票，文件第 1.1.4 至 1.1.6 三種方式擇一即可。
- 開立雲端載具發票可免列印感熱紙。

### 5.2 端點

```http
GET https://www.giveme.com.tw/invoice.do?action=invoicePrint&code={INVOICE_CODE}&uncode={SELLER_TAX_ID}
Content-Type: application/json
```

### 5.3 參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `code` | varchar | 是 | 發票號碼。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |

### 5.4 回傳參數

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `success` | varchar | 成功：`true`；失敗：`false`。 |
| `code` | varchar | 發票號碼；`success=true` 時回傳。 |
| `msg` | varchar | 錯誤描述。 |

---

## 6. B2B／B2C 發票圖片列印（原 PDF 第 10 至 11 頁）

### 6.1 文件說明

- 取得發票圖片進行列印。
- 若需要列印感熱紙發票，文件第 1.1.4 至 1.1.6 三種方式擇一即可。
- 開立雲端載具發票可免列印感熱紙。

### 6.2 端點

```http
POST https://www.giveme.com.tw/invoice.do?action=picture
Content-Type: application/json
```

### 6.3 參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `timeStamp` | varchar | 是 | 目前時間毫秒數，5 分鐘內有效。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |
| `idno` | varchar | 是 | API 帳號。 |
| `sign` | varchar | 是 | 簽名。 |
| `code` | varchar | 是 | 發票號碼。 |
| `type` | varchar | 是 | 圖片內容類型，見下表。 |

`type` 值：

| 值 | 圖片內容 |
|---:|---|
| `1` | 發票證明聯 + 交易明細。 |
| `2` | 發票證明聯。 |
| `3` | 交易明細。 |

### 6.4 回傳

- 請求失敗：回傳 `success=false`、`code`、`msg`。
- 請求成功：回傳文件流（Stream）；原文件以 Postman 的「Save to a file」示意儲存圖片。

---

## 7. 雲列印（原 PDF 第 11 至 12 頁）

### 7.1 文件說明

免串接直接使用雲發票機，由 API 上傳開立後自動列印。

使用條件與能力：

1. 需購買雲發票機。
2. 需啟用雲列印加值服務。
3. 可透過 Wi-Fi 或手機分享網路，直接列印感熱紙發票。
4. 支援手機、平板、電腦、筆電列印。
5. 可分配使用，例如 A 展區 5 人使用一台、B 展區 3 人共用一台。
6. 支援多台、多人員同時使用。

原文件提供的聯絡方式：Line 客服 ID `@giveme`。

---

## 8. B2B／B2C 發票查詢（原 PDF 第 12 至 13 頁）

### 8.1 文件說明

- 此功能標示為「非串接必需，選擇性使用」。
- 可查詢 B2B 與 B2C 發票。

### 8.2 端點

```http
POST https://www.giveme.com.tw/invoice.do?action=query
Content-Type: application/json
```

### 8.3 參數

| 參數 | 類型 | 必填 | 文件規格 |
|---|---|---:|---|
| `timeStamp` | varchar | 是 | 目前時間毫秒數，5 分鐘內有效。 |
| `uncode` | varchar | 是 | 貴公司統一編號。 |
| `idno` | varchar | 是 | API 帳號。 |
| `sign` | varchar | 是 | 簽名。 |
| `code` | varchar | 是 | 發票號碼。 |

### 8.4 回傳參數

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `success` | varchar | 成功：`true`；失敗：`false`。 |
| `code` | varchar | 發票號碼；`success=true` 時回傳。 |
| `msg` | varchar | 錯誤描述。 |
| `type` | varchar | 發票類型：`0` B2C、`1` B2B。 |
| `tranno` | varchar | 載具（開立時有輸入載具者）或買方統編。 |
| `email` | varchar | 第一組 Email。 |
| `email2` | varchar | 第二組 Email。 |
| `totalFee` | varchar | 總金額。 |
| `randomCode` | varchar | 4 位隨機碼。 |
| `datetime` | varchar | 發票日期。 |
| `status` | varchar | 狀態：`0` 正常、`1` 作廢。 |
| `delRemark` | varchar | 作廢說明；`status=1` 時回傳。 |
| `delTime` | varchar | 作廢時間；`status=1` 時回傳。格式範例：`2023-02-02 10:00:00`。 |
| `details` | 集合 | 商品明細集合。 |

`details` 商品明細：

| 參數 | 類型 | 文件規格 |
|---|---|---|
| `name` | varchar | 商品名稱。 |
| `number` | varchar | 數量。 |
| `money` | varchar | 金額。 |

---

## 9. 文件已回答與未回答事項

下表專門用來避免重複詢問「文件已經有寫」的問題。

| 問題 | 文件狀態 | 結論 |
|---|---|---|
| B2C 如何開立？ | 已記載 | 使用 `POST ...?action=addB2C`，第 2 節有完整欄位。 |
| B2B 如何開立？ | 已記載 | 使用 `POST ...?action=addB2B`，第 3 節有完整欄位。 |
| B2B 的公司抬頭是否必填？ | 已記載 | `customerName` 是買方公司名稱，文件標示「非必填」。 |
| B2B 的統編是否必填？ | 已記載 | 必填，放在 `phone` 欄位。 |
| B2C 手機條碼格式？ | 已記載 | `/` 加 7 碼，可用 `0-9`、`A-Z`、`+`、`-`、`.`。 |
| 是否支援多個商品明細？ | 已記載 | B2C、B2B 都有 `items` 集合，可傳多筆明細。 |
| 開立後是否回傳發票號碼？ | 已記載 | 成功時 `code` 回傳發票號碼。 |
| 是否能查 B2C、B2B？ | 已記載 | 共用 `query`，回傳 `type`、狀態與商品明細。 |
| 是否有作廢 API？ | 已記載 | 共用 `cancelInvoice`。 |
| 是否有折讓 API？ | 明確未提供 | 文件要求至系統後台手動處理折讓及原發票號碼異動。 |
| 是否有退費 API？ | 未記載 | 文件沒有付款或退費 API；退款屬 BIG E 金流流程，發票端另做作廢或折讓。 |
| B2C 是否支援自訂訂單編號？ | 已記載 | `orderCode` 可放訂單號、手機號、會員編號或不重複編號。 |
| Giveme 是否用 `orderCode` 自動阻擋重複開票？ | 未記載 | 不可推定；BIG E 必須自行做冪等及防重。 |
| B2B 是否支援 `orderCode`？ | 未記載 | B2B 欄位表沒有 `orderCode`。 |
| B2C、B2B 是否使用同一套簽章欄位？ | 已記載 | 兩者皆使用 `timeStamp`、`uncode`、`idno`、`sign`。 |
| 同一組正式帳密是否一定同時啟用 B2C、B2B？ | 未明文保證 | 文件介面相同，但帳號權限是否另行啟用並未寫明。供應商已口頭表示發票端兩者都有。 |
| 發票是否上傳財政部平台？ | 未明確描述流程 | 文件是電子發票 API 規格，但沒有寫上傳時程、失敗重試及通知責任。 |
| Email 是否自動寄送、寄送什麼內容？ | 部分記載 | 欄位可傳 Email，但寄送時機、內容及失敗處理未記載。 |
| 固定 IP 白名單是否必要？ | 已記載 | 後台設定要求輸入貴司固定 IP。 |
| 「IP 抓取」加值功能如何運作？ | 未記載 | PDF 完全沒有說明。 |
| 是否支援 Vercel 動態出口 IP？ | 未記載 | PDF 完全沒有說明。 |
| 是否可登記多組 IPv4？ | 未記載 | PDF 完全沒有說明。 |
| 測試帳密是否同時開放 B2B？ | 未記載 | PDF 沒有測試帳號權限說明。 |
| B2B 是否有指定測試買方統編？ | 未記載 | PDF 沒有測試資料規則。 |

### 真正仍需向 Giveme 確認的事項

只需詢問文件未記載、而且會影響正式上線的內容：

1. 正式帳號是否同時啟用 `addB2C` 與 `addB2B`。
2. 測試帳號能否直接測試 B2B，以及是否有指定的測試買方統編。
3. 「IP 抓取」加值功能的實際運作方式，以及是否支援 Vercel 雲端後端。
4. 若改用 Vercel Static IP，白名單是否可登記同一區域提供的多組 IPv4。
5. Email 通知由誰寄送、寄送內容及失敗處理。
6. 正式環境上傳財政部平台的時程、失敗重試與異常通知方式。

---

## 10. BIG E 使用情境對照

### 10.1 50 元單次入場

建議走 B2C：

- API：`addB2C`
- `phone`：消費者手機條碼載具
- `orderCode`：如果沒有手機條碼，才放 BIG E 入場紀錄編號或其他自訂載具編號
- `totalFee`：`50`
- `content`：`50元入場`
- `items[0].name`：`50元入場`
- `items[0].money`：`50`
- `items[0].number`：`1`

BIG E 必須自行保存：

- 入場申請 ID
- 收款狀態
- 放行狀態
- 發票開立狀態
- Giveme 發票號碼 `code`
- 失敗原因與重試次數
- 唯一鍵，防止重複開票

### 10.2 教練課程、會員方案及其他訂單

依買方需求選擇：

- 個人發票：`addB2C`
- 公司發票：`addB2B`

B2B 至少需要：

- 買方統一編號：放入 `phone`
- 發票日期：`datetime`
- 含稅狀態：`taxState`
- 總金額：`totalFee`
- 未稅銷售額：`sales`
- 稅額：`amount`
- 總備註：`content`
- 一筆或多筆 `items`

公司抬頭 `customerName` 與 Email 在 API 文件中不是必填，但 BIG E 前端仍可要求填寫，以利人工辨識、對帳與寄送。

### 10.3 作廢、退費與折讓

- 完全取消且符合文件作廢條件：呼叫 `cancelInvoice`。
- 折讓或異動原發票內容：Giveme 文件要求在後台手動處理。
- 退款本身不是 Giveme API 功能，必須由 BIG E 的付款／收款流程處理，再依發票狀況作廢或折讓。

### 10.4 防止重複開票

Giveme 文件未承諾以 `orderCode` 或其他欄位提供冪等保護。BIG E 正式實作必須：

1. 每筆可開票交易建立唯一的本地發票工作紀錄。
2. 以交易 ID／入場 ID 建立資料庫唯一約束。
3. API 成功後保存發票號碼。
4. 網路逾時或回覆不明時先查詢或交由人工確認，不直接盲目重送。
5. 發票失敗不可造成已付款或已放行紀錄消失。
