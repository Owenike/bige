import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";

export async function prepareAugustGoogleDriveSource(inputPath, outputPath) {
  const sourceText = await fs.readFile(inputPath, "utf8");
  const totalScheduleCsv = sourceText.split("\f", 1)[0].replace(/^\uFEFF/, "");
  if (!totalScheduleCsv.trim()) throw new Error("Google Drive 來源沒有可解析的總表內容");

  const csvPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.csv`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(csvPath, totalScheduleCsv, "utf8");

  const parsed = new ExcelJS.Workbook();
  const parsedSheet = await parsed.csv.readFile(csvPath);
  if (!parsedSheet?.rowCount || parsedSheet.columnCount < 2) throw new Error("Google Drive 總表欄列不足");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("總表");
  for (let rowNumber = 1; rowNumber <= parsedSheet.rowCount; rowNumber += 1) {
    const sourceRow = parsedSheet.getRow(rowNumber);
    const values = [];
    for (let columnNumber = 2; columnNumber <= parsedSheet.columnCount; columnNumber += 1) {
      values.push(sourceRow.getCell(columnNumber).value);
    }
    sheet.addRow(values);
  }
  await workbook.xlsx.writeFile(outputPath);
  return { inputPath, outputPath, rows: sheet.rowCount, columns: sheet.columnCount };
}

async function main() {
  const [inputArg, outputArg] = process.argv.slice(2);
  if (!inputArg || !outputArg) {
    throw new Error("用法：node scripts/prepare-august-google-drive-source.mjs <Drive文字輸出> <xlsx輸出>");
  }
  const result = await prepareAugustGoogleDriveSource(path.resolve(inputArg), path.resolve(outputArg));
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
