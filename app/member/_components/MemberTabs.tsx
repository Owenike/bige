"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useI18n } from "../../i18n-provider";

type TabItem = {
  href: string;
  zh: string;
  en: string;
};

const TAB_ITEMS: TabItem[] = [
  { href: "/member", zh: "首頁", en: "Home" },
  { href: "/member/bookings", zh: "預約", en: "Bookings" },
  { href: "/member/entitlements", zh: "方案", en: "Plans" },
  { href: "/member/progress", zh: "進度", en: "Progress" },
  { href: "/member/profile", zh: "我的", en: "My" },
];

function isActive(pathname: string, href: string) {
  if (href === "/member") return pathname === "/member";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MemberTabs() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const zh = locale !== "en";

  const tabs = useMemo(
    () =>
      TAB_ITEMS.map((item) => ({
        href: item.href,
        label: zh ? item.zh : item.en,
      })),
    [zh],
  );

  return (
    <nav className="memberTabs" aria-label={zh ? "會員導覽分頁" : "Member tabs"}>
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "memberTab memberTabActive" : "memberTab"}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
      <style jsx>{`
        .memberTabs {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          overflow-x: auto;
          padding-bottom: 2px;
          scrollbar-width: thin;
        }
        .memberTab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 78px;
          padding: 8px 14px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: linear-gradient(140deg, rgba(255, 255, 255, 0.8), rgba(242, 247, 255, 0.58));
          color: #1f2b3d;
          font-size: 14px;
          line-height: 1.2;
          white-space: nowrap;
          text-decoration: none;
        }
        .memberTab:hover {
          text-decoration: none;
          background: linear-gradient(140deg, rgba(255, 255, 255, 0.92), rgba(238, 245, 255, 0.72));
        }
        .memberTabActive {
          border-color: rgba(137, 188, 236, 0.9);
          background: radial-gradient(130% 140% at 20% 30%, rgba(126, 196, 255, 0.5), rgba(229, 241, 255, 0.88));
          color: #23425f;
          font-weight: 600;
        }
      `}</style>
    </nav>
  );
}
