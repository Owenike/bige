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
    <nav
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: 8,
        marginTop: 12,
      }}
      aria-label={zh ? "會員主分頁" : "Member main tabs"}
    >
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "btn btnPrimary" : "btn"}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
