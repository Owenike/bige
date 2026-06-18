"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FloatingActionButtons } from "@/components/floating-line-button";
import LangSwitch from "./lang-switch";
import { useI18n } from "./i18n-provider";

export default function LayoutChrome({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isEmbedded = searchParams.get("embed") === "1";
  const isFrontdeskRoute = pathname?.startsWith("/frontdesk");
  const isMemberRoute = pathname?.startsWith("/member");
  const isCoachRoute = pathname?.startsWith("/coach");
  const isPublicBookingRoute = pathname?.startsWith("/booking");
  const isTrialBookingRoute = pathname?.startsWith("/trial-booking");
  const isAcpayResultRoute = pathname?.startsWith("/payment/acpay-result");
  const isCustomPaymentRoute = pathname?.startsWith("/custom-payment");
  const isTrainingRoute = pathname?.startsWith("/training");
  const isRenwuPilatesRoute = pathname?.startsWith("/renwu-pilates");
  const isRenwuPersonalTrainingRoute = pathname?.startsWith("/renwu-personal-training");
  const isFaqRoute = pathname?.startsWith("/faq");
  const isHomeRoute = pathname === "/";
  const isWorkspaceRoute = isFrontdeskRoute || isMemberRoute || isCoachRoute;
  const showTopbar =
    !isEmbedded &&
    !isWorkspaceRoute &&
    !isHomeRoute &&
    !isFaqRoute &&
    !isPublicBookingRoute &&
    !isTrialBookingRoute &&
    !isAcpayResultRoute &&
    !isCustomPaymentRoute &&
    !isRenwuPilatesRoute &&
    !isRenwuPersonalTrainingRoute &&
    !isTrainingRoute;
  const shellClassName = [
    "shell",
    isEmbedded ? "shellEmbedded" : "",
    isWorkspaceRoute ? "shellWorkspace" : "",
    isFrontdeskRoute ? "shellFrontdesk" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      {showTopbar ? (
        <header className="topbar">
          <div className="container nav">
            <div className="brand">
              <div className="brandTitle">BIGE</div>
              <div className="brandTag">{t("brand.tagline")}</div>
            </div>
            <nav className="navLinks">
              <a className="pill" href="/login?tab=staff">
                {t("nav.login")}
              </a>
              <a className="pill" href="/login?tab=member">
                {t("nav.member")}
              </a>
              <a className="pill" href="/login?tab=staff">
                {t("nav.coach")}
              </a>
              <a className="pill" href="/login?tab=staff">
                {t("nav.frontdesk")}
              </a>
              <a className="pill" href="/login?tab=staff&returnTo=/admin/trial-bookings">
                {t("nav.manager")}
              </a>
              <a className="pill" href="/login?tab=staff&returnTo=/platform-admin">
                {t("nav.platform")}
              </a>
              <LangSwitch />
            </nav>
          </div>
        </header>
      ) : null}

      {children}

      {!isEmbedded ? <FloatingActionButtons /> : null}

      {!isEmbedded && !isPublicBookingRoute && !isTrialBookingRoute && !isAcpayResultRoute && !isCustomPaymentRoute ? (
        <footer className="footer">
          <div className="footerInner">
            <div>© {new Date().getFullYear()} BigE Fitness. All rights reserved.</div>
            <div className="footerTagline">巨挺健身館 BigE｜器械皮拉提斯・重量訓練・運動按摩｜高雄市仁武區八德北路728號｜0972-484686</div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
