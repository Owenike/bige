"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getManagerDomainItems, getManagerDomainItemsForSection, type ManagerDomainSection } from "../lib/manager-domain";

type ManagerDomainNavProps = {
  section?: ManagerDomainSection | "all";
  showIndex?: boolean;
};

const GROUP_TITLES: Record<ManagerDomainSection, string> = {
  landing: "Landing pages",
  business: "Business domains",
  system: "System and policy domains",
};

export default function ManagerDomainNav(props: ManagerDomainNavProps) {
  const pathname = usePathname();
  const section = props.section || "all";
  const items = getManagerDomainItemsForSection(section);
  const allItems = getManagerDomainItems();
  const groupedSections: ManagerDomainSection[] = section === "all" ? ["landing", "business", "system"] : [section];

  return (
    <>
      <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-manager-domain-nav>
        <h2 className="sectionTitle">Manager Domain Navigation</h2>
        <p className="fdGlassText" style={{ marginTop: 8 }}>
          Use this as the stable route index for the manager-facing domain. Business CRUD pages stay under the main manager
          path, while policy-heavy pages stay under settings or dedicated domain entries so users do not need to guess URLs.
        </p>
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          {groupedSections.map((group) => {
            const groupItems = items.filter((item) => item.section === group);
            if (groupItems.length === 0) return null;
            return (
              <section key={group} className="fdGlassSubPanel" style={{ padding: 12 }} data-manager-domain-group={group}>
                <div className="kvLabel">{GROUP_TITLES[group]}</div>
                <div className="actions" style={{ marginTop: 8 }}>
                  {groupItems.map((item) => {
                    const isActive = pathname === item.pagePath;
                    return (
                      <Link
                        key={item.key}
                        className={isActive ? "fdPillBtn fdPillBtnPrimary" : "fdPillBtn"}
                        href={item.pagePath}
                        data-manager-domain-link={item.key}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="fdDataGrid" style={{ marginTop: 10 }} data-manager-domain-route-consistency>
          <p className="sub" style={{ marginTop: 0 }}>
            Direct manager subpages kept for business areas:{" "}
            {allItems
              .filter((item) => item.routeKind === "manager-subpage")
              .map((item) => item.label)
              .join(", ")}
            .
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            Settings child routes kept where policy pages already lived under settings:{" "}
            {allItems
              .filter((item) => item.routeKind === "settings-subpage")
              .map((item) => item.label)
              .join(", ")}
            .
          </p>
          <p className="sub" style={{ marginTop: 0 }}>
            Dedicated domain-entry pages kept where a deeper manager subdomain already existed:{" "}
            {allItems
              .filter((item) => item.routeKind === "domain-entry")
              .map((item) => item.label)
              .join(", ")}
            .
          </p>
        </div>
      </section>

      {props.showIndex ? (
        <section className="fdGlassSubPanel" style={{ padding: 14, marginBottom: 14 }} data-manager-domain-index>
          <h2 className="sectionTitle">Manager Responsibility Index</h2>
          <div className="fdThreeCol" style={{ gap: 12, marginTop: 8 }}>
            {items.map((item) => (
              <section key={item.key} className="fdGlassSubPanel" style={{ padding: 12 }} data-manager-domain-card={item.key}>
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
