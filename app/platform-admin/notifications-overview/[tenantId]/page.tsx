import NotificationOverviewTenantDrilldown from "../../../../components/notification-overview-tenant-drilldown";

export default async function PlatformNotificationsOverviewTenantPage(props: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await props.params;
  return <NotificationOverviewTenantDrilldown tenantId={tenantId} />;
}
