import { NextResponse } from "next/server";
import { requireProfile } from "../../../../../lib/auth-context";

type DetailType = "payments" | "checkins" | "bookings";

function toIsoRange(from: string | null, to: string | null) {
  const dateFrom = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : new Date().toISOString().slice(0, 10);
  const dateTo = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : dateFrom;
  return {
    from: `${dateFrom}T00:00:00.000Z`,
    to: `${dateTo}T23:59:59.999Z`,
    dateFrom,
    dateTo,
  };
}

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const head = headers.join(",");
  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")).join("\n");
  return `${head}\n${body}`;
}

export async function GET(request: Request) {
  const auth = await requireProfile(["manager"], request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const type = (params.get("type") || "payments") as DetailType;
  const format = params.get("format") || "json";
  const range = toIsoRange(params.get("from"), params.get("to"));

  if (!["payments", "checkins", "bookings"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  if (type === "payments") {
    const result = await auth.supabase
      .from("payments")
      .select("id, order_id, amount, status, method, gateway_ref, paid_at, created_at")
      .eq("tenant_id", auth.context.tenantId)
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });

    const rows = (result.data || []) as Array<Record<string, unknown>>;
    if (format === "csv") {
      const headers = ["id", "order_id", "amount", "status", "method", "gateway_ref", "paid_at", "created_at"];
      const csv = toCsv(headers, rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="payments_${range.dateFrom}_${range.dateTo}.csv"`,
        },
      });
    }
    return NextResponse.json({ range, items: rows });
  }

  if (type === "checkins") {
    const result = await auth.supabase
      .from("checkins")
      .select("id, member_id, store_id, method, result, reason, checked_at")
      .eq("tenant_id", auth.context.tenantId)
      .gte("checked_at", range.from)
      .lte("checked_at", range.to)
      .order("checked_at", { ascending: false })
      .limit(5000);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });

    const rows = (result.data || []) as Array<Record<string, unknown>>;
    if (format === "csv") {
      const headers = ["id", "member_id", "store_id", "method", "result", "reason", "checked_at"];
      const csv = toCsv(headers, rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="checkins_${range.dateFrom}_${range.dateTo}.csv"`,
        },
      });
    }
    return NextResponse.json({ range, items: rows });
  }

  const result = await auth.supabase
    .from("bookings")
    .select("id, member_id, coach_id, service_name, starts_at, ends_at, status, note, created_at")
    .eq("tenant_id", auth.context.tenantId)
    .gte("starts_at", range.from)
    .lte("starts_at", range.to)
    .order("starts_at", { ascending: false })
    .limit(5000);
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });

  const rows = (result.data || []) as Array<Record<string, unknown>>;
  if (format === "csv") {
    const headers = ["id", "member_id", "coach_id", "service_name", "starts_at", "ends_at", "status", "note", "created_at"];
    const csv = toCsv(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bookings_${range.dateFrom}_${range.dateTo}.csv"`,
      },
    });
  }
  return NextResponse.json({ range, items: rows });
}
