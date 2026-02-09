"use client";

import React from "react";
import LangSwitch from "./lang-switch";
import { useI18n } from "./i18n-provider";

export default function LayoutChrome({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container nav">
          <div className="brand">
            <div className="brandTitle">BIGE</div>
            <div className="brandTag">{t("brand.tagline")}</div>
          </div>
          <nav className="navLinks">
            <a className="pill" href="/login">
              {t("nav.login")}
            </a>
            <a className="pill" href="/member">
              {t("nav.member")}
            </a>
            <a className="pill" href="/coach">
              {t("nav.coach")}
            </a>
            <a className="pill" href="/frontdesk">
              {t("nav.frontdesk")}
            </a>
            <a className="pill" href="/manager">
              {t("nav.manager")}
            </a>
            <a className="pill" href="/platform-admin">
              {t("nav.platform")}
            </a>
            <LangSwitch />
          </nav>
        </div>
      </header>

      {children}

      <footer className="footer">
        <div className="footerInner">
          <div>© {new Date().getFullYear()} BIGE</div>
          <div>{t("footer.tagline")}</div>
        </div>
      </footer>
    </div>
  );
}

