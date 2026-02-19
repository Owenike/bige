"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import LangSwitch from "./lang-switch";
import { useI18n } from "./i18n-provider";

type NavMenuKey = "manager" | "platform";
type NavMenuState = "ready" | "building" | "planned";

type NavMenuItem = {
  label: string;
  desc: string;
  href?: string;
  state: NavMenuState;
};

type NavMenuSection = {
  title: string;
  items: NavMenuItem[];
};

export default function LayoutChrome({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get("embed") === "1";
  const zh = locale !== "en";
  const [openMenu, setOpenMenu] = useState<NavMenuKey | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);

  const managerSections = useMemo<NavMenuSection[]>(
    () => zh
      ? [
          {
            title: "人員與組織",
            items: [
              { label: "人員名單與角色", desc: "櫃檯、教練、角色與啟用狀態。", href: "/manager/staff", state: "ready" },
              { label: "分店資料", desc: "分店開關、基本設定與營運狀態。", href: "/manager/branches", state: "ready" },
            ],
          },
          {
            title: "課務與會員",
            items: [
              { label: "教練時段管理", desc: "可預約時段、關閉時段與調整。", href: "/manager/coach-slots", state: "ready" },
              { label: "會員管理", desc: "會員資料維護與分店歸屬。", href: "/manager/members", state: "ready" },
            ],
          },
          {
            title: "商品與銷售",
            items: [
              { label: "商品方案", desc: "會籍、堂數、商品上架與停售。", href: "/manager/products", state: "ready" },
              { label: "服務項目", desc: "服務定義、時長與可預約設定。", href: "/manager/services", state: "ready" },
            ],
          },
        ]
      : [
          {
            title: "Team & Org",
            items: [
              { label: "Staff & Roles", desc: "Frontdesk/coach roster and active status.", href: "/manager/staff", state: "ready" },
              { label: "Branches", desc: "Branch lifecycle and operational flags.", href: "/manager/branches", state: "ready" },
            ],
          },
          {
            title: "Classes & Members",
            items: [
              { label: "Coach Slots", desc: "Availability windows and slot controls.", href: "/manager/coach-slots", state: "ready" },
              { label: "Member Admin", desc: "Member profile and branch mapping.", href: "/manager/members", state: "ready" },
            ],
          },
          {
            title: "Catalog & Sales",
            items: [
              { label: "Products", desc: "Membership/pass/product catalog controls.", href: "/manager/products", state: "ready" },
              { label: "Services", desc: "Service definitions and booking options.", href: "/manager/services", state: "ready" },
            ],
          },
        ],
    [zh],
  );

  const platformSections = useMemo<NavMenuSection[]>(
    () => zh
      ? [
          {
            title: "租戶與帳號",
            items: [
              { label: "租戶/使用者控台", desc: "建立租戶與角色帳號，集中管理。", href: "/platform-admin", state: "ready" },
              { label: "功能旗標", desc: "功能開關、灰度發布與租戶白名單。", state: "building" },
            ],
          },
          {
            title: "治理與安全",
            items: [
              { label: "權限治理", desc: "跨租戶權限模型、風險權限檢核。", state: "building" },
              { label: "稽核中心", desc: "跨店操作稽核與異常告警。", state: "planned" },
            ],
          },
          {
            title: "平台營運",
            items: [
              { label: "訂閱與計費", desc: "方案、用量、付款與帳單週期。", state: "planned" },
              { label: "系統監控", desc: "API 健康、錯誤率、排程與通知。", state: "planned" },
            ],
          },
        ]
      : [
          {
            title: "Tenant & Account",
            items: [
              { label: "Tenant/User Console", desc: "Create tenant users and role identities.", href: "/platform-admin", state: "ready" },
              { label: "Feature Flags", desc: "Rollout controls and tenant allowlists.", state: "building" },
            ],
          },
          {
            title: "Governance & Security",
            items: [
              { label: "RBAC Governance", desc: "Cross-tenant role model and risk checks.", state: "building" },
              { label: "Audit Center", desc: "Cross-branch audit trail and anomaly alerts.", state: "planned" },
            ],
          },
          {
            title: "Platform Ops",
            items: [
              { label: "Billing", desc: "Plans, usage metering, and invoice cycle.", state: "planned" },
              { label: "Observability", desc: "API health, errors, jobs, and notifications.", state: "planned" },
            ],
          },
        ],
    [zh],
  );

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function navMenuStateLabel(state: NavMenuState) {
    if (state === "ready") return zh ? "已上線" : "Ready";
    if (state === "building") return zh ? "建置中" : "Building";
    return zh ? "規劃中" : "Planned";
  }

  return (
    <div className={`shell ${isEmbedded ? "shellEmbedded" : ""}`}>
      {!isEmbedded ? (
        <header className="topbar">
          <div className="container nav">
            <div className="brand">
              <div className="brandTitle">BIGE</div>
              <div className="brandTag">{t("brand.tagline")}</div>
            </div>
            <nav className="navLinks" ref={menuRef}>
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
              <div className="navMenuWrap">
                <button
                  type="button"
                  className="pill navMenuTrigger"
                  aria-haspopup="dialog"
                  aria-expanded={openMenu === "manager"}
                  onClick={() => setOpenMenu((prev) => (prev === "manager" ? null : "manager"))}
                >
                  {t("nav.manager")}
                </button>
                {openMenu === "manager" ? (
                  <div className="navMenuPanel" role="dialog" aria-label={t("nav.manager")}>
                    <div className="navMenuGrid">
                      {managerSections.map((section) => (
                        <section className="navMenuSection" key={section.title}>
                          <h4 className="navMenuSectionTitle">{section.title}</h4>
                          <div className="navMenuList">
                            {section.items.map((item) => (
                              item.href ? (
                                <a key={item.label} className="navMenuItem" href={item.href} onClick={() => setOpenMenu(null)}>
                                  <div className="navMenuItemTop">
                                    <strong>{item.label}</strong>
                                    <span className={`navMenuState navMenuState${item.state}`}>{navMenuStateLabel(item.state)}</span>
                                  </div>
                                  <p>{item.desc}</p>
                                </a>
                              ) : (
                                <div key={item.label} className="navMenuItem navMenuItemStatic">
                                  <div className="navMenuItemTop">
                                    <strong>{item.label}</strong>
                                    <span className={`navMenuState navMenuState${item.state}`}>{navMenuStateLabel(item.state)}</span>
                                  </div>
                                  <p>{item.desc}</p>
                                </div>
                              )
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="navMenuWrap">
                <button
                  type="button"
                  className="pill navMenuTrigger"
                  aria-haspopup="dialog"
                  aria-expanded={openMenu === "platform"}
                  onClick={() => setOpenMenu((prev) => (prev === "platform" ? null : "platform"))}
                >
                  {t("nav.platform")}
                </button>
                {openMenu === "platform" ? (
                  <div className="navMenuPanel" role="dialog" aria-label={t("nav.platform")}>
                    <div className="navMenuGrid">
                      {platformSections.map((section) => (
                        <section className="navMenuSection" key={section.title}>
                          <h4 className="navMenuSectionTitle">{section.title}</h4>
                          <div className="navMenuList">
                            {section.items.map((item) => (
                              item.href ? (
                                <a key={item.label} className="navMenuItem" href={item.href} onClick={() => setOpenMenu(null)}>
                                  <div className="navMenuItemTop">
                                    <strong>{item.label}</strong>
                                    <span className={`navMenuState navMenuState${item.state}`}>{navMenuStateLabel(item.state)}</span>
                                  </div>
                                  <p>{item.desc}</p>
                                </a>
                              ) : (
                                <div key={item.label} className="navMenuItem navMenuItemStatic">
                                  <div className="navMenuItemTop">
                                    <strong>{item.label}</strong>
                                    <span className={`navMenuState navMenuState${item.state}`}>{navMenuStateLabel(item.state)}</span>
                                  </div>
                                  <p>{item.desc}</p>
                                </div>
                              )
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <LangSwitch />
            </nav>
          </div>
        </header>
      ) : null}

      {children}

      {!isEmbedded ? (
        <footer className="footer">
          <div className="footerInner">
            <div>c {new Date().getFullYear()} BIGE</div>
            <div>{t("footer.tagline")}</div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
