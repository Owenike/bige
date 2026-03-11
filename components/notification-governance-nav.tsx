"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNotificationGovernanceNavItems, type NotificationGovernanceMode } from "../lib/notification-governance-navigation";

type NotificationGovernanceNavProps = {
  mode: NotificationGovernanceMode;
};

export default function NotificationGovernanceNav(props: NotificationGovernanceNavProps) {
  const pathname = usePathname();
  const items = getNotificationGovernanceNavItems(props.mode);

  return (
    <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }}>
      <h2 className="sectionTitle">Notification Governance (Read-only)</h2>
      <p className="fdGlassText" style={{ marginTop: 8 }}>
        Navigate among read-only governance reports. No execute/retry/run action is available here.
      </p>
      <div className="actions" style={{ marginTop: 10 }}>
        {items.map((item) => {
          const isActive = pathname === item.pagePath;
          return (
            <Link key={item.key} className={isActive ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"} href={item.pagePath}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
