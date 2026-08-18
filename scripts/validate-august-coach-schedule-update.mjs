import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { buildAugustImportPlan } from "./import-august-coach-schedule.mjs";

const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const sourcePath = sourceArg
  ? path.resolve(sourceArg.slice("--source=".length))
  : "C:\\Users\\User\\Downloads\\8月教練預約本.xlsx- (2).xlsx";
const expectedSourceSha256 = "8a6c272bfbcd95ed394febdfaed376b1c0e0c6e8edbdb9860e7d86ebaf5029ed";
const expectedPlanSha256 = "d7c213e970cb790d9200265f3f916a639995d7cf3d0cf95c67034503bebcf11b";

const { sourceSha256, plan } = await buildAugustImportPlan(sourcePath);
const allRows = [...plan.members, ...plan.schedules, ...plan.notes, ...plan.businessDays];
const planRows = [
  ...plan.schedules.map((row) => ["booking", row.sourceRowKey, row.date, row.time, row.coach, row.marker, row.name, row.phone, row.legacyNumber, row.courseType, row.durationMinutes]),
  ...plan.notes.map((row) => ["note", row.sourceRowKey, row.date, row.time, row.coach, row.content]),
  ...plan.businessDays.map((row) => ["business", row.sourceRowKey, row.date, row.frontdeskName, row.isClosed, row.closureLabel]),
];
const planSha256 = crypto.createHash("sha256").update(JSON.stringify(planRows)).digest("hex");

assert.equal(sourceSha256, expectedSourceSha256, "來源 Excel SHA-256 不符");
assert.equal(planSha256, expectedPlanSha256, "逐格正規化指紋不符，可能有格子遺漏或內容改變");
assert.equal(plan.members.length, 166, "會員規劃筆數不符");
assert.equal(plan.schedules.length, 678, "排課格數不符");
assert.equal(plan.schedules.filter((row) => row.operationKind === "pt").length, 622, "PT 格數不符");
assert.equal(plan.schedules.filter((row) => row.operationKind === "trial").length, 56, "FA 格數不符");
assert.equal(plan.notes.length, 424, "自由文字格數不符");
assert.equal(plan.businessDays.length, 23, "營業日設定筆數不符");
assert.equal(allRows.length, 1291, "逐筆稽核總數不符");
assert.deepEqual(allRows.filter((row) => row.issues?.length), [], "來源仍有驗證異常");
assert.equal(new Set(plan.schedules.map((row) => `${row.date}|${row.time}|${row.coach}`)).size, plan.schedules.length, "同一排課格重複");
assert.equal(new Set(plan.notes.map((row) => `${row.date}|${row.time}|${row.coach}|${row.content}`)).size, plan.notes.length, "同一文字格重複");
assert.equal(plan.schedules.some((row) => row.coach === "Miranda"), false, "Miranda 沒有正式帳號，不應匯入排課");
assert.equal(plan.notes.some((row) => row.coach === "Miranda"), false, "Miranda 沒有正式帳號，不應匯入文字");

const supplied = plan.schedules.find((row) => row.date === "2026-08-22" && row.time === "13:00" && row.coach === "Becky");
assert.equal(supplied?.sourceCell, "總表!C513");
assert.equal(supplied?.sourceContent, "");
assert.equal(supplied?.marker, "FA1");
assert.equal(supplied?.name, "林建宇");
assert.equal(supplied?.phone, "0980120570");
assert.equal(supplied?.courseType, "weight_training");
assert.equal(supplied?.durationMinutes, 120);

console.log(JSON.stringify({
  ok: true,
  sourcePath,
  sourceSha256,
  planSha256,
  members: plan.members.length,
  schedules: plan.schedules.length,
  notes: plan.notes.length,
  businessDays: plan.businessDays.length,
  suppliedCell: supplied.sourceRowKey,
}, null, 2));
