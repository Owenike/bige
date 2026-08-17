import type { ReactNode } from "react";
import { StudentCheckInAdminPendingAlert } from "../../../components/student-checkin-admin-pending-alert";

export default function StudentCheckInsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="studentCheckInsAdminScope">
      {children}
      <StudentCheckInAdminPendingAlert />
    </div>
  );
}
