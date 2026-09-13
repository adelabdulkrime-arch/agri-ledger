// اختبارات ميزان المراجعة: يجب أن يتوازن الجانبان دائمًا.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  addExpense,
  collectFromCustomer,
  createCustomer,
  createSupplier,
  postPurchase,
  postSale,
  postSaleReturn,
  trialBalance,
} from "./operations";
import type { DbState, Product } from "./types";

function product(id: number): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price: 100,
    color: "leaf",
    barcode: `6286000000${id}`,
    avgCost: 0,
    lastCost: 0,
  };
}

let db: DbState;

function run<T>(fn: (draft: DbState) => T): T {
  const draft: DbState = JSON.parse(JSON.stringify(db));
  const out = fn(draft);
  db = draft;
  return out;
}

beforeEach(() => {
  db = emptyState();
  db.products = [product(1)];
});

describe("ميزان المراجعة", () => {
  it("يتوازن على سجل فارغ", () => {
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("يتوازن بعد شراء نقدي", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    // المخزون 500 يظهر مدينًا.
    const inv = tb.rows.find(r => r.account === "المخزون آخر المدة")!;
    expect(inv.debit).toBe(500);
  });

  it("يتوازن بعد شراء آجل ويظهر ذمم الموردين دائنة", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    const payables = tb.rows.find(r => r.account.includes("الموردون"))!;
    expect(payables.credit).toBe(500);
  });

  it("يتوازن بعد بيع نقدي ويظهر المبيعات والتكلفة", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] });
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find(r => r.account.includes("المبيعات"))!.credit).toBe(400);
    expect(
      tb.rows.find(r => r.account === "تكلفة البضاعة المباعة")!.debit
    ).toBe(200);
  });

  it("يتوازن مع ذمم العملاء بعد بيع آجل", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 4, price: 100 }],
      });
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find(r => r.account.includes("العملاء"))!.debit).toBe(400);
  });

  it("يتوازن بعد التحصيل والمرتجع والمصروفات", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      });
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 8, price: 100 }],
      });
      collectFromCustomer(d, 1, 300);
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] });
      addExpense(d, { category: "rent", description: "إيجار", amount: 120 });
    });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    // المصروفات تظهر مدينة.
    expect(tb.rows.find(r => r.account.includes("المصروفات"))!.debit).toBe(120);
    // المبيعات بعد خصم المرتجع: 800 ناقص 200.
    expect(tb.rows.find(r => r.account.includes("المبيعات"))!.credit).toBe(600);
  });
});
