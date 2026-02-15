"use client";

import { useSearchParams } from "next/navigation";
import { FrontdeskMemberSearchView } from "./MemberSearchView";

export default function FrontdeskMemberSearchPage() {
  const searchParams = useSearchParams();
  return (
    <div className="card" style={{ display: "contents" }}>
      <FrontdeskMemberSearchView embedded={searchParams.get("embed") === "1"} />
    </div>
  );
}
