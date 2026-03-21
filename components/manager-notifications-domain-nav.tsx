"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getManagerNotificationsDomainItems } from "../lib/manager-notifications-domain";

type ManagerNotificationsDomainNavProps = {
  showIndex?: boolean;
};

export default function ManagerNotificationsDomainNav(props: ManagerNotificationsDomainNavProps) {
  const pathname = usePathname();
  const items = getManagerNotificationsDomainItems();
  const parallelItems = items.filter((item) => item.routeKind === "parallel");
  const nestedItems = items.filter((item) => item.routeKind === "nested");

  return (
    <>
      <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-domain-nav>
        <h2 className="sectionTitle">Notifications Domain Navigation</h2>
        <p className="fdGlassText" style={{ marginTop: 8 }}>
          Use this as the stable route index for the manager-facing notifications domain. The route forms are mixed by
          historical landing choice, but the domain entry points are kept consistent here so users do not need to type
          URLs manually.
        </p>
        <div className="actions" style={{ marginTop: 10 }}>
          {items.map((item) => {
            const isActive = pathname === item.pagePath;
            return (
              <Link
                key={item.key}
                className={isActive ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"}
                href={item.pagePath}
                data-notifications-domain-link={item.key}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="fdDataGrid" style={{ marginTop: 10 }} data-notifications-domain-route-consistency>
          <p className="sub" style={{ marginTop: 0 }}>
            Parallel routes kept for historical manager pages: {parallelItems.map((item) => item.label).join(", ")}.
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            Nested routes kept where the page already lived under the notifications path: {nestedItems.map((item) => item.label).join(", ")}.
          </p>
        </div>
      </section>

      {props.showIndex ? (
        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-notifications-domain-index>
          <h2 className="sectionTitle">Notifications Responsibility Index</h2>
          <div className="fdThreeCol" style={{ gap: 12, marginTop: 8 }}>
            {items.map((item) => (
              <section key={item.key} className="fdGlassSubPanel" style={{ padding: 12 }} data-notifications-domain-card={item.key}>
                <div className="kvLabel">{item.label}</div>
                <p className="sub" style={{ marginTop: 8 }}>
                  <strong>Owns:</strong> {item.owns}
                </p>
                <p className="sub" style={{ marginTop: 8 }}>
                  <strong>Does not own:</strong> {item.doesNotOwn}
                </p>
                <p className="sub" style={{ marginTop: 8 }}>
                  <strong>Use when:</strong> {item.useWhen}
                </p>
                <p className="sub" style={{ marginTop: 8 }}>
                  <strong>Route form:</strong> {item.routeKind}
                </p>
              </section>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
