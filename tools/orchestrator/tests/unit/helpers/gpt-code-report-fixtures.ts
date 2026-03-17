export const completedSliceReport = `
建議級別：中

判斷理由
上一輪功能面已完成，這輪只需要正式收尾。

**本輪實際修改到的檔案路徑**
- [schema.ts](/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/schema.ts)
- [index.ts](/c:/Users/User/bige/tools/orchestrator/src/gpt-code-report/index.ts)

**本輪僅檢查未修改的檔案路徑**
- [reviewer.ts](/c:/Users/User/bige/tools/orchestrator/src/reviewer/index.ts)

**本輪完成了什麼**
- 新增 GPT CODE 中文回報 parser
- 新增 normalize 與 renderer

**為什麼這樣做**
- 讓 A 能把固定中文回報轉成 machine-readable state

**如何確保既有邏輯不變**
- 沒有新增 execution path
- 只延伸 orchestrator 側邏輯

**驗收結果**
- 通過：
- \`npm run lint\`
- \`npm run typecheck\`
- \`npm run test:orchestrator:typecheck\`
- \`npm run test:orchestrator:lint\`

**已 commit / push**
- commit: \`abc1234\`
- 已 push 到 \`origin/main\`

**補充**
- 目前仍需要人工複製貼上回報文字

**剩餘待辦**
- 等待 CI run 完成

**風險提醒**
- transport 尚未接上

**git status --short 是否乾淨**
- 否

**若不乾淨，請分開列出：**
- 本輪造成的變更
- 無；本輪變更已全部進入 commit \`abc1234\` 並已 push。
- 與本輪無關的既有變更
- [package-lock.json](/c:/Users/User/bige/package-lock.json)
- [app/forgot-password/page.tsx](/c:/Users/User/bige/app/forgot-password/page.tsx)

**CI run 狀態**
- 上一輪收尾 run \`23159099566\`：\`success\`
- 本輪新 push run \`23190000001\`：\`success\`

**關鍵摘要**
- 這輪把中文回報正式 machine-readable
`.trim();

export const inspectionSliceReport = `
**本輪實際修改到的檔案路徑**
- 無。本輪是 inspection / audit slice，沒有修改任何檔案。

**本輪僅檢查未修改的檔案路徑**
- [AGENTS.md](/c:/Users/User/bige/AGENTS.md)

**本輪完成了什麼**
- 只做現況盤點

**為什麼這樣做**
- 先確認現況能力，不擴題

**如何確保既有邏輯不變**
- 沒有修改任何檔案

**驗收結果**
- 實際執行的檢查：
- \`git status --short\`
- \`gh run list --limit 3\`

**已 commit / push**
- 無 commit
- 無 push

**補充**
- 這輪仍需要人工搬運

**剩餘待辦**
- 無

**風險提醒**
- 無足夠證據的能力不可直接當成已完成

**git status --short 是否乾淨**
- 否

**若不乾淨，請分開列出：**
- 本輪造成的變更
- 無
- 與本輪無關的既有變更
- [package-lock.json](/c:/Users/User/bige/package-lock.json)

**CI run 狀態**
- 目前最新 CI run：\`23182278367\`，狀態 \`success\`
- 本輪沒有 push

**關鍵摘要**
- 這輪是 inspection / audit slice
`.trim();
