import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const stylesheetPath = join(projectRoot, "app", "student-autonomous-approval-mobile.css");
const styles = readFileSync(stylesheetPath, "utf8");
const layout = readFileSync(join(projectRoot, "app", "layout.tsx"), "utf8");
const adminPage = readFileSync(join(projectRoot, "app", "admin", "student-check-ins", "page.tsx"), "utf8");

test("loads the autonomous-training approval mobile stylesheet", () => {
  assert.match(layout, /import "\.\/student-autonomous-approval-mobile\.css";/);
});

test("keeps a large autonomous-training identity photo on mobile", () => {
  assert.match(
    styles,
    /grid-template-rows:\s*clamp\(300px, 45dvh, 400px\) minmax\(0, 1fr\)/,
  );
  assert.match(styles, /grid-template-rows:\s*clamp\(240px, 39dvh, 280px\) minmax\(0, 1fr\)/);
});

test("hides only the three unnecessary autonomous approval rows on mobile", () => {
  assert.equal(adminPage.match(/className="studentCheckInsApprovalMobileHidden"/g)?.length, 3);
  assert.match(adminPage, /studentCheckInsApprovalMobileHidden"><dt>登入方式<\/dt>/);
  assert.match(adminPage, /studentCheckInsApprovalMobileHidden"><dt>開始日期<\/dt>/);
  assert.match(adminPage, /studentCheckInsApprovalMobileHidden"><dt>結束日期<\/dt>/);
  assert.match(styles, /\.studentCheckInsApprovalMobileHidden\s*\{\s*display:\s*none;/);
});

test("centers the identity hint and adds glow without replacing button colors", () => {
  assert.match(styles, /\.studentCheckInsApprovalHint\s*\{[\s\S]*?text-align:\s*center;/);
  assert.match(styles, /\.studentCheckInsRejectButton\s*\{[\s\S]*?box-shadow:/);
  assert.match(styles, /\.studentCheckInsApproveButton\s*\{[\s\S]*?box-shadow:/);
  assert.doesNotMatch(styles, /\.studentCheckInsRejectButton\s*\{[^}]*background:/);
  assert.doesNotMatch(styles, /\.studentCheckInsApproveButton\s*\{[^}]*background:/);
});

test("keeps actions beside the approval details without a large spacer", () => {
  assert.match(
    styles,
    /\.studentCheckInsApprovalDialog:not\(\.studentDropInApprovalDialog\)[\s\S]*?\.studentCheckInsApprovalActions\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/,
  );
  assert.match(styles, /padding:\s*14px 16px calc\(10px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(styles, /calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
});

test("excludes the NT$50 drop-in approval dialog from every mobile override", () => {
  const selectorBlocks = styles.match(/[^{}]+\{/g) ?? [];
  const approvalSelectors = selectorBlocks.filter((selector) =>
    selector.includes("studentCheckInsApprovalDialog"),
  );

  assert.ok(approvalSelectors.length > 0);
  for (const selector of approvalSelectors) {
    assert.match(selector, /:not\(\.studentDropInApprovalDialog\)/);
  }
});
