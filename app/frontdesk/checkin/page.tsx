"use client";

import { useSearchParams } from "next/navigation";
import { FrontdeskCheckinView } from "./CheckinView";

export default function FrontdeskCheckinPage() {
  const searchParams = useSearchParams();
  return (
    <div className="card" style={{ display: "contents" }}>
      <FrontdeskCheckinView embedded={searchParams.get("embed") === "1"} />
    </div>
  );
}
