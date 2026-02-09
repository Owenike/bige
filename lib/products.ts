export type PurchasableProduct = {
  code: string;
  title: string;
  itemType: "subscription" | "entry_pass";
  unitPrice: number;
  // Quantity multiplier stored in order_items.quantity.
  // Example: punch_10 uses quantity=1 but fulfillment interprets code.
  quantity: number;
};

// Keep this list the single source of truth for what the UI can sell.
// Fulfillment rules live in lib/order-fulfillment.ts and are keyed off `code`.
export const PURCHASE_PRODUCTS: PurchasableProduct[] = [
  {
    code: "single_pass",
    title: "單次票",
    itemType: "entry_pass",
    unitPrice: 300,
    quantity: 1,
  },
  {
    code: "punch_10",
    title: "10 次票",
    itemType: "entry_pass",
    unitPrice: 2500,
    quantity: 1,
  },
  {
    code: "monthly_30d",
    title: "30 天月費",
    itemType: "subscription",
    unitPrice: 1800,
    quantity: 1,
  },
];

export function getPurchasableProduct(code: string) {
  const trimmed = String(code || "").trim();
  return PURCHASE_PRODUCTS.find((p) => p.code === trimmed) || null;
}

