"use client";

import { useSearchParams } from "next/navigation";
import { FrontdeskCheckinView } from "./CheckinView";

export default function FrontdeskCheckinPage() {
  const searchParams = useSearchParams();
  return <FrontdeskCheckinView embedded={searchParams.get("embed") === "1"} />;
}
