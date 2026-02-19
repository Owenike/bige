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
            title: "\u4eba\u54e1\u8207\u7d44\u7e54",
            items: [
              { label: "\u4eba\u54e1\u8207\u89d2\u8272", desc: "\u6ac3\u6aaf/\u6559\u7df4\u540d\u55ae\u8207\u72c0\u614b", href: "/manager/staff", state: "ready" },
              { label: "\u5206\u9928\u8a2d\u5b9a", desc: "\u5206\u9928\u8cc7\u6599\u8207\u71df\u904b\u72c0\u614b", href: "/manager/branches", state: "ready" },
            ],
          },
          {
            title: "\u8ab2\u52d9\u8207\u6703\u54e1",
            items: [
              { label: "\u6559\u7df4\u6642\u6bb5", desc: "\u6392\u73ed\u6642\u6bb5\u8207\u53ef\u9810\u7d04\u63a7\u5236", href: "/manager/coach-slots", state: "ready" },
              { label: "\u6703\u54e1\u7ba1\u7406", desc: "\u6703\u54e1\u8cc7\u6599\u8207\u6b78\u5c6c\u7dad\u8b77", href: "/manager/members", state: "ready" },
            ],
          },
          {
            title: "\u5546\u54c1\u8207\u670d\u52d9",
            items: [
              { label: "\u5546\u54c1/\u65b9\u6848", desc: "\u6703\u7c4d\u3001\u5802\u6578\u3001\u5546\u54c1\u4e0a\u4e0b\u67b6", href: "/manager/products", state: "ready" },
              { label: "\u670d\u52d9\u9805\u76ee", desc: "\u670d\u52d9\u5b9a\u7fa9\u8207\u9810\u7d04\u8a2d\u5b9a", href: "/manager/services", state: "ready" },
            ],
          },
        ]
      : [
          {
            title: "Team & Org",
            items: [
              { label: "Staff & Roles", desc: "Frontdesk/coach roster and active status.", href: "/manager/staff", state: "ready" },
              { label: "Branch Settings", desc: "Branch records and operating status.", href: "/manager/branches", state: "ready" },
            ],
          },
          {
            title: "Classes & Members",
            items: [
              { label: "Coach Slots", desc: "Availability windows and booking controls.", href: "/manager/coach-slots", state: "ready" },
              { label: "Member Admin", desc: "Member profile and ownership maintenance.", href: "/manager/members", state: "ready" },
            ],
          },
          {
            title: "Catalog & Services",
            items: [
              { label: "Products/Plans", desc: "Membership/pass/product lifecycle control.", href: "/manager/products", state: "ready" },
              { label: "Service Catalog", desc: "Service definitions and booking setup.", href: "/manager/services", state: "ready" },
            ],
          },
        ],
    [zh],
  );

  const platformSections = useMemo<NavMenuSection[]>(
    () => zh
      ? [
          {
            title: "\u5e73\u53f0\u7e3d\u89bd",
            items: [
              { label: "\u79df\u6236/\u5e33\u865f\u63a7\u53f0", desc: "\u79df\u6236\u8207\u4f7f\u7528\u8005\u5efa\u7acb/\u7ba1\u7406", href: "/platform-admin", state: "ready" },
              { label: "\u529f\u80fd\u65d7\u6a19", desc: "\u79df\u6236\u5c64\u7d1a Feature Flag \u958b\u95dc", href: "/platform-admin/feature-flags", state: "ready" },
            ],
          },
          {
            title: "\u6cbb\u7406\u8207\u7a3d\u6838",
            items: [
              { label: "\u6b0a\u9650\u6cbb\u7406", desc: "\u89d2\u8272\u3001\u79df\u6236\u3001\u555f\u7528\u72c0\u614b\u7ba1\u63a7", href: "/platform-admin/rbac", state: "ready" },
              { label: "\u7a3d\u6838\u4e2d\u5fc3", desc: "\u8de8\u79df\u6236\u64cd\u4f5c\u8a18\u9304\u67e5\u8a62", href: "/platform-admin/audit", state: "ready" },
            ],
          },
          {
            title: "\u5e73\u53f0\u71df\u904b",
            items: [
              { label: "\u8a02\u95b1\u8207\u8a08\u8cbb", desc: "\u8a02\u55ae/\u6536\u6b3e/\u8a02\u95b1\u72c0\u614b\u6458\u8981", href: "/platform-admin/billing", state: "ready" },
              { label: "\u7cfb\u7d71\u76e3\u63a7", desc: "Webhook/Notification/\u98a8\u96aa\u4efb\u52d9\u5065\u5eb7\u5ea6", href: "/platform-admin/observability", state: "ready" },
            ],
          },
        ]
      : [
          {
            title: "Platform Core",
            items: [
              { label: "Tenant/User Console", desc: "Tenant and account provisioning.", href: "/platform-admin", state: "ready" },
              { label: "Feature Flags", desc: "Per-tenant feature rollout controls.", href: "/platform-admin/feature-flags", state: "ready" },
            ],
          },
          {
            title: "Governance",
            items: [
              { label: "RBAC Governance", desc: "Role, tenant, and active-state control.", href: "/platform-admin/rbac", state: "ready" },
              { label: "Audit Center", desc: "Cross-tenant operation log explorer.", href: "/platform-admin/audit", state: "ready" },
            ],
          },
          {
            title: "Platform Ops",
            items: [
              { label: "Billing", desc: "Orders, payments, and subscription summary.", href: "/platform-admin/billing", state: "ready" },
              { label: "Observability", desc: "Webhook, notifications, and risk-task health.", href: "/platform-admin/observability", state: "ready" },
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
    if (state === "ready") return zh ? "\u5df2\u4e0a\u7dda" : "Ready";
    if (state === "building") return zh ? "\u5efa\u7f6e\u4e2d" : "Building";
    return zh ? "\u898f\u5283\u4e2d" : "Planned";
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
