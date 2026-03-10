"use client";

import { useSearchParams } from "next/navigation";
import { useI18n } from "../i18n-provider";

function getReasonText(code: string | null, zh: boolean) {
  if (code === "INACTIVE_ACCOUNT") {
    return zh ? "帳號尚未啟用或已停用，請聯絡管理員。" : "This account is inactive. Please contact your administrator.";
  }
  if (code === "BRANCH_SCOPE_DENIED") {
    return zh ? "目前帳號缺少分店權限，請聯絡管理員設定分店範圍。" : "This account is missing branch scope permissions.";
  }
  if (code === "TENANT_INACTIVE" || code === "SUBSCRIPTION_INACTIVE") {
    return zh ? "租戶或訂閱狀態限制，請聯絡管理員確認。" : "Tenant or subscription status is blocking access.";
  }
  return zh ? "您目前沒有此頁面的存取權限。" : "You do not have access to this page.";
}

export default function ForbiddenPage() {
  const { locale } = useI18n();
  const searchParams = useSearchParams();
  const zh = locale !== "en";
  const code = searchParams.get("code");

  return (
    <main className="fdGlassScene">
      <section className="fdGlassBackdrop">
        <section className="hero" style={{ paddingTop: 0 }}>
          <div className="card fdGlassPanel">
            <div className="fdEyebrow">{zh ? "存取控制" : "ACCESS CONTROL"}</div>
            <h1 className="h1" style={{ marginTop: 10, fontSize: 36 }}>
              {zh ? "無法存取" : "Forbidden"}
            </h1>
            <p className="fdGlassText">{getReasonText(code, zh)}</p>
            {code ? (
              <p className="fdGlassText" style={{ marginTop: 6, opacity: 0.8 }}>
                {zh ? "代碼：" : "Code: "}
                {code}
              </p>
            ) : null}
            <div className="actions" style={{ marginTop: 10 }}>
              <a className="fdPillBtn fdPillBtnPrimary" href="/login">
                {zh ? "前往登入" : "Go to login"}
              </a>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
