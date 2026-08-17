import assert from "node:assert/strict";
import path from "node:path";
import ExcelJS from "exceljs";
import { buildAugustImportPlan } from "./import-august-coach-schedule.mjs";

const outputDir = path.resolve(".tmp", "schedule-import-analysis", "output");
const reportPath = path.join(outputDir, "august-import-report.xlsx");
const { plan } = await buildAugustImportPlan();
const allRows = [...plan.members, ...plan.schedules, ...plan.notes, ...plan.businessDays];

assert.equal(plan.members.length, 130, "會員規劃筆數不符");
assert.equal(plan.schedules.length, 555, "排課筆數不符");
assert.equal(plan.schedules.filter((row) => row.operationKind === "pt").length, 520, "PT 筆數不符");
assert.equal(plan.schedules.filter((row) => row.operationKind === "trial").length, 35, "FA 筆數不符");
assert.equal(plan.notes.length, 357, "自由文字筆數不符");
assert.equal(plan.businessDays.length, 23, "營業日設定筆數不符");
assert.deepEqual(allRows.filter((row) => row.issues?.length), [], "預演仍有異常列");
assert.equal(plan.schedules.some((row) => row.date === "2026-08-09"), false, "館休日不應有排課");
assert.equal(plan.notes.some((row) => row.date === "2026-08-09"), false, "館休日不應有自由文字排課");
assert.equal(plan.notes.some((row) => row.content === "休"), false, "休不應匯入自由文字");
assert.equal(plan.schedules.every((row) => row.hour >= 9), true, "出現 09:00 前的排課");
assert.equal(plan.schedules.filter((row) => row.operationKind === "trial").every((row) => row.durationMinutes === 120), true, "FA 必須全部為 120 分鐘");

const closure = plan.businessDays.find((row) => row.date === "2026-08-09");
assert.equal(closure?.isClosed, true, "8/9 必須設定為館休");
assert.equal(closure?.closureLabel, "館休", "8/9 館休名稱不符");

const onsite = plan.schedules.find((row) => row.date === "2026-08-07" && row.time === "11:00" && row.coach === "Becky");
assert.equal(onsite?.name, "蘇玉艷", "現場評估學員不符");
assert.equal(onsite?.courseType, "onsite_assessment", "現場評估課別不符");
assert.equal(onsite?.durationMinutes, 120, "現場評估時長不符");
assert.equal(plan.notes.some((row) => row.date === "2026-08-07" && row.time === "12:00" && row.coach === "Becky"), false, "現場評估第二小時不應重複建立自由文字");

const cupping = plan.schedules.find((row) => row.date === "2026-08-11" && row.time === "20:00" && row.coach === "Owen");
assert.equal(cupping?.name, "林鈺堯", "運動拔罐學員不符");
assert.equal(cupping?.legacyNumber, "76", "運動拔罐舊會員編號不符");
assert.equal(cupping?.courseType, "sports_cupping", "運動拔罐課別不符");

const sharedPhone = plan.schedules.find((row) => row.date === "2026-08-10" && row.time === "12:00" && row.coach === "Wiwi");
assert.equal(sharedPhone?.name, "陳葳", "共用電話 FA 學員不符");
assert.equal(sharedPhone?.phone, "0928765568", "共用電話覆寫不符");

const sharedNumbers = new Map();
for (const member of plan.members) {
  if (!member.legacyNumber) continue;
  sharedNumbers.set(member.legacyNumber, (sharedNumbers.get(member.legacyNumber) || 0) + 1);
}
assert.equal([...sharedNumbers.values()].every((count) => count <= 2), true, "舊會員編號共用超過兩人");
assert.deepEqual(
  [...sharedNumbers.entries()].filter(([, count]) => count === 2).map(([number]) => number).sort(),
  ["11", "35", "41", "52", "59", "69", "79", "83", "85"],
  "共用舊會員編號清單不符",
);
assert.deepEqual(
  plan.members.filter((row) => !row.isProspect && !row.legacyNumber).map((row) => row.fullName),
  ["盧謝秋月"],
  "缺舊會員編號提醒清單不符",
);

const report = new ExcelJS.Workbook();
await report.xlsx.readFile(reportPath);
assert.deepEqual(report.worksheets.map((sheet) => sheet.name), ["匯入摘要", "逐筆結果", "待辦提醒"]);
assert.equal(report.getWorksheet("逐筆結果")?.rowCount, allRows.length + 1, "報表逐筆結果列數不符");
assert.ok(report.getWorksheet("待辦提醒")?.getCell("B2").text.includes("盧謝秋月"), "報表未列出盧謝秋月提醒");

console.log(JSON.stringify({
  ok: true,
  members: plan.members.length,
  schedules: plan.schedules.length,
  notes: plan.notes.length,
  businessDays: plan.businessDays.length,
  reportPath,
}, null, 2));
