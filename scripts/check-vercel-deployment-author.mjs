import { execFileSync } from "node:child_process";

const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test",
]);

export function isPlaceholderEmail(email) {
  const normalized = String(email ?? "").trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return true;

  const domain = normalized.slice(separator + 1);
  return (
    PLACEHOLDER_DOMAINS.has(domain) ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".localhost") ||
    domain.endsWith(".test")
  );
}

export function deploymentIdentityMatches(authorEmail, vercelEmail) {
  if (isPlaceholderEmail(authorEmail) || isPlaceholderEmail(vercelEmail)) return false;
  return authorEmail.trim().toLowerCase() === vercelEmail.trim().toLowerCase();
}

function readHeadAuthorEmail() {
  return execFileSync("git", ["log", "-1", "--format=%ae"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function readVercelAccountEmail() {
  const executable = process.platform === "win32" ? "powershell.exe" : "vercel";
  const args =
    process.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", "vercel api /v2/user"]
      : ["api", "/v2/user"];
  const raw = execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const response = JSON.parse(raw);
  return String(response?.user?.email ?? response?.email ?? "").trim();
}

function runSelfTest() {
  const cases = [
    [isPlaceholderEmail("owen@example.com"), true, "example.com must be blocked"],
    [isPlaceholderEmail("operator@company.test"), true, ".test must be blocked"],
    [isPlaceholderEmail("operator@company.com"), false, "real domain must be allowed"],
    [
      deploymentIdentityMatches("operator@company.com", "OPERATOR@company.com"),
      true,
      "matching verified addresses must pass",
    ],
    [
      deploymentIdentityMatches("other@company.com", "operator@company.com"),
      false,
      "different addresses must fail",
    ],
  ];

  for (const [actual, expected, message] of cases) {
    if (actual !== expected) throw new Error(`Self-test failed: ${message}`);
  }

  console.log("Vercel deployment author guard self-test passed.");
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const authorEmail = readHeadAuthorEmail();
  if (isPlaceholderEmail(authorEmail)) {
    throw new Error(
      "正式部署已停止：最新 Git 提交仍使用示範／測試信箱。請先設定本專案的真實 Git 信箱並建立新提交。",
    );
  }

  const vercelEmail = readVercelAccountEmail();
  if (!deploymentIdentityMatches(authorEmail, vercelEmail)) {
    throw new Error(
      "正式部署已停止：最新 Git 提交作者與目前登入的 Vercel 帳號不一致。請修正 Git 作者後再部署。",
    );
  }

  console.log("Vercel deployment identity verified. Production deployment may continue.");
}

const isDirectRun = process.argv[1]?.endsWith("check-vercel-deployment-author.mjs");
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
