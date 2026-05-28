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
  const isTrainingRoute = pathname?.startsWith("/training");
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

      {!isEmbedded && !isPublicBookingRoute && !isTrialBookingRoute && !isAcpayResultRoute ? (
        <footer className="footer">
          <div className="footerInner">
            <div>© {new Date().getFullYear()} BigE Fitness. All rights reserved.</div>
            <div className="footerTagline">巨挺健身館 BigE｜高雄仁武區健身房・器械皮拉提斯・重量訓練・運動按摩</div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
