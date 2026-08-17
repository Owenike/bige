import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const stylesheetPath = join(projectRoot, "app", "student-autonomous-approval-mobile.css");
const styles = readFileSync(stylesheetPath, "utf8");
const layout = readFileSync(join(projectRoot, "app", "layout.tsx"), "utf8");

test("loads the autonomous-training approval mobile stylesheet", () => {
  assert.match(layout, /import "\.\/student-autonomous-approval-mobile\.css";/);
});

test("keeps autonomous-training approval actions visible on mobile", () => {
  assert.match(
    styles,
    /\.studentCheckInsApprovalDialog:not\(\.studentDropInApprovalDialog\)[\s\S]*?\.studentCheckInsApprovalActions\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:/,
  );
  assert.match(styles, /padding:\s*14px 16px calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
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
