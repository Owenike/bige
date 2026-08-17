"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FloatingActionButtons } from "@/components/floating-line-button";
import LangSwitch from "./lang-switch";
import { useI18n } from "./i18n-provider";
import StaffNotificationButton from "../components/staff-notification-button";
import { StaffPageTelemetry } from "../components/staff-page-telemetry";

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
  const isStudentCheckInRoute = pathname?.startsWith("/check-in");
  const isStudentCheckInAdminRoute = pathname?.startsWith("/admin/student-check-ins");
  const isTrialBookingAdminRoute = pathname?.startsWith("/admin/trial-bookings");
  const isLoginRoute = pathname === "/login" || pathname?.startsWith("/login/");
  const isForbiddenRoute = pathname === "/forbidden";
  const isStaffSecurityRoute =
    pathname === "/staff/change-password" || pathname === "/staff/activate";
  const isStaffNotificationRoute = pathname === "/staff/notifications";
  const isStaffScheduleRoute =
    pathname === "/staff/schedule" ||
    pathname === "/manager/staff-scheduling" ||
    pathname === "/staff/attendance" ||
    pathname === "/manager/staff-attendance";
  const isStaffPayrollRoute = pathname === "/staff/payroll" || pathname === "/manager/staff-payroll";
  const isStaffPerformanceRoute = pathname === "/staff/performance" || pathname === "/manager/staff-performance";
  const isStaffLeaveRoute = pathname === "/staff/leave" || pathname === "/manager/staff-leave";
  const isFitnessOperationsRoute =
    pathname === "/manager/fitness" ||
    pathname === "/manager/staff" ||
    pathname === "/manager/staff-scheduling" ||
    pathname === "/manager/staff-attendance" ||
    pathname === "/manager/staff-payroll" ||
    pathname === "/manager/staff-performance" ||
    pathname === "/manager/staff-leave" ||
    pathname === "/frontdesk/fitness" ||
    pathname === "/coach/fitness" ||
    pathname === "/dev/fitness-preview";
  const isStudentPasswordRecoveryRoute = pathname === "/reset-password" && searchParams.get("mode") === "student";
  const isAdminRoute = pathname?.startsWith("/admin");
  const isAuthenticatedAccountRoute =
    pathname?.startsWith("/manager") ||
    pathname?.startsWith("/frontdesk") ||
    pathname?.startsWith("/coach") ||
    pathname?.startsWith("/staff") ||
    pathname?.startsWith("/member") ||
    pathname?.startsWith("/platform-admin") ||
    pathname?.startsWith("/admin");
  const isAcpayResultRoute = pathname?.startsWith("/payment/acpay-result");
  const isCustomPaymentRoute = pathname?.startsWith("/custom-payment");
  const isTrainingRoute = pathname?.startsWith("/training");
  const isRenwuPilatesRoute = pathname?.startsWith("/renwu-pilates");
  const isRenwuPersonalTrainingRoute = pathname?.startsWith("/renwu-personal-training");
  const isRenwuSportsMassageRoute = pathname?.startsWith("/renwu-sports-massage");
  const isFaqRoute = pathname?.startsWith("/faq");
  const isHomeRoute = pathname === "/";
  const loginReturnTo = searchParams.get("returnTo") || searchParams.get("redirect") || searchParams.get("next");
  const isStudentCheckInAdminLogin =
    (pathname === "/login" || pathname === "/login/staff") &&
    (loginReturnTo === "/admin/student-check-ins" || loginReturnTo?.startsWith("/admin/student-check-ins?"));
  const isWorkspaceRoute =
    isFrontdeskRoute ||
    isMemberRoute ||
    isCoachRoute ||
    isFitnessOperationsRoute ||
    isStaffSecurityRoute ||
    isStaffNotificationRoute ||
    isStaffScheduleRoute ||
    isStaffPayrollRoute ||
    isStaffPerformanceRoute ||
    isStaffLeaveRoute;
  const showStaffNotifications =
    !isEmbedded &&
    !isLoginRoute &&
    !isStaffSecurityRoute &&
    !isMemberRoute &&
    !isStudentCheckInAdminRoute &&
    !isTrialBookingAdminRoute &&
    (pathname?.startsWith("/manager") ||
      pathname?.startsWith("/frontdesk") ||
      pathname?.startsWith("/coach") ||
      pathname?.startsWith("/staff/schedule") ||
      pathname?.startsWith("/staff/attendance") ||
      pathname?.startsWith("/staff/payroll") ||
      pathname?.startsWith("/staff/performance") ||
      pathname?.startsWith("/staff/leave") ||
      pathname?.startsWith("/platform-admin") ||
      pathname?.startsWith("/admin") ||
      isStaffNotificationRoute);
  const showTopbar = false;
  const shellClassName = [
    "shell",
    isEmbedded ? "shellEmbedded" : "",
    isWorkspaceRoute ? "shellWorkspace" : "",
    isFrontdeskRoute ? "shellFrontdesk" : "",
    isStudentCheckInAdminLogin ? "shellStudentCheckInLogin" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClassName}>
      <StaffPageTelemetry />
      {showTopbar ? (
        <header className="topbar">
          <div className="container nav">
            <div className="brand">
              <div className="brandTitle">BIGE</div>
              <div className="brandTag">{t("brand.tagline")}</div>
            </div>
            <nav className="navLinks">
              <a className="pill" href="/login/staff">
                {t("nav.login")}
              </a>
              <a className="pill" href="/login/member">
                {t("nav.member")}
              </a>
              <a className="pill" href="/login/staff">
                {t("nav.coach")}
              </a>
              <a className="pill" href="/login/staff">
                {t("nav.frontdesk")}
              </a>
              <a className="pill" href="/login/staff?returnTo=/admin/trial-bookings">
                {t("nav.manager")}
              </a>
              <a className="pill" href="/login/staff?returnTo=/platform-admin">
                {t("nav.platform")}
              </a>
              <LangSwitch />
            </nav>
          </div>
        </header>
      ) : null}

      {children}

      {showStaffNotifications ? <StaffNotificationButton /> : null}

      {!isEmbedded && !isLoginRoute && !isForbiddenRoute && !isAuthenticatedAccountRoute && !isWorkspaceRoute && !isStaffSecurityRoute && !isStudentCheckInRoute && !isStudentCheckInAdminRoute && !isTrialBookingAdminRoute && !isStudentPasswordRecoveryRoute && !isStudentCheckInAdminLogin ? <FloatingActionButtons /> : null}

      {!isEmbedded && !isLoginRoute && !isForbiddenRoute && !isFitnessOperationsRoute && !isStaffSecurityRoute && !isPublicBookingRoute && !isTrialBookingRoute && !isStudentCheckInRoute && !isStudentCheckInAdminRoute && !isStudentPasswordRecoveryRoute && !isStudentCheckInAdminLogin && !isAcpayResultRoute && !isCustomPaymentRoute ? (
        <footer className="footer">
          <div className="footerInner">
            <div>© {new Date().getFullYear()} BigE Fitness. All rights reserved.</div>
            <div className="footerTagline">巨挺健身館 BigE｜器械皮拉提斯・重量訓練・運動按摩｜高雄市仁武區八德北路728號｜0972-484686</div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
