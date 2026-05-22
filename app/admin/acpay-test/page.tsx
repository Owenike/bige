import { AcpayTestClient } from "./acpay-test-client";

export default function AcpayTestPage() {
  const isTestEnv = process.env.ACPAY_ENV === "test";

  return (
    <main className="acpayTestPage">
      <section className="acpayTestHero">
        <p>ACPAY TEST ONLY</p>
        <h1>ACpay 測試工具</h1>
        <div>
          <span>此頁僅用於 ACpay 測試區檢核表資料收集。</span>
          <span>請先確認付款已成功，再執行請款；請款成功後才執行退款。</span>
        </div>
      </section>

      {isTestEnv ? (
        <AcpayTestClient />
      ) : (
        <section className="acpayTestBlocked">此測試工具僅允許在 ACpay test 環境使用。</section>
      )}
    </main>
  );
}
