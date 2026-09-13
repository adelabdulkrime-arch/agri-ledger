// اختبارات سجل العملاء ودفتر أستاذهم (نقدي/آجل).
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  OperationError,
  collectFromCustomer,
  createCustomer,
  createSupplier,
  customerBalance,
  customerStatement,
  customerTotals,
  postPurchase,
  postSale,
  postSaleReturn,
  receivablesTotal,
  updateCustomer,
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
    barcode: `6285000000${id}`,
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
  // مخزون حقيقي بتكلفة معروفة حتى تكون الأرباح صحيحة.
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "cash",
      lines: [{ productId: 1, qty: 100, unitCost: 60 }],
    });
  });
});

describe("سجل العملاء", () => {
  it("ينشئ عميلًا ببيانات كاملة", () => {
    const c = run(d =>
      createCustomer(d, {
        name: "مزرعة النخيل",
        phone: "770",
        terms: "credit",
        creditLimit: 5000,
      })
    );
    expect(c.id).toBe(1);
    expect(c.terms).toBe("credit");
    expect(c.creditLimit).toBe(5000);
    expect(c.status).toBe("active");
  });

  it("يرفض الاسم الفارغ والمكرر والحد السالب", () => {
    run(d => createCustomer(d, { name: "أحمد" }));
    expect(() => run(d => createCustomer(d, { name: "  " }))).toThrow(
      OperationError
    );
    expect(() => run(d => createCustomer(d, { name: "أحمد" }))).toThrow(
      /نفس الاسم/
    );
    expect(() =>
      run(d => createCustomer(d, { name: "سالم", creditLimit: -5 }))
    ).toThrow(/سالبًا/);
  });

  it("يعدّل بيانات العميل", () => {
    run(d => createCustomer(d, { name: "أحمد" }));
    run(d => updateCustomer(d, 1, { terms: "credit", creditLimit: 900 }));
    expect(db.customers[0].terms).toBe("credit");
    expect(db.customers[0].creditLimit).toBe(900);
    expect(() => run(d => updateCustomer(d, 99, { name: "x" }))).toThrow(
      /غير موجود/
    );
  });
});

describe("البيع النقدي والآجل", () => {
  beforeEach(() => {
    run(d => {
      createCustomer(d, { name: "نقدي", terms: "cash" });
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
    });
  });

  it("البيع النقدي لا يترك قيدًا على العميل", () => {
    run(d =>
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 2, price: 100 }],
      })
    );
    expect(db.customerLedger).toHaveLength(0);
    expect(customerBalance(db, 1)).toBe(0);
  });

  it("البيع الآجل يقيّد مدينًا على العميل", () => {
    run(d =>
      postSale(d, {
        customerId: 2,
        lines: [{ productId: 1, qty: 3, price: 100 }],
      })
    );
    expect(customerBalance(db, 2)).toBe(300);
    const entry = db.customerLedger[0];
    expect(entry.debit).toBe(300);
    expect(entry.credit).toBe(0);
    expect(entry.type).toBe("فاتورة بيع");
    expect(db.sales[0].terms).toBe("credit");
    expect(db.sales[0].customerId).toBe(2);
  });

  it("البيع بلا عميل يبقى نقديًا كما كان", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] }));
    expect(db.sales[0].customer).toBe("عميل نقدي");
    expect(db.sales[0].customerId).toBeUndefined();
    expect(db.customerLedger).toHaveLength(0);
  });

  it("يمنع البيع الآجل بلا عميل مسجل", () => {
    expect(() =>
      run(d =>
        postSale(d, {
          terms: "credit",
          lines: [{ productId: 1, qty: 1, price: 100 }],
        })
      )
    ).toThrow(/عميلًا مسجلًا/);
  });

  it("يمنع تجاوز حد الائتمان دون كتابة جزئية", () => {
    run(d => updateCustomer(d, 2, { creditLimit: 250 }));
    const before = JSON.stringify(db);
    expect(() =>
      run(d =>
        postSale(d, {
          customerId: 2,
          lines: [{ productId: 1, qty: 3, price: 100 }],
        })
      )
    ).toThrow(/حد ائتمان/);
    expect(JSON.stringify(db)).toBe(before);
  });
});

describe("التحصيل والمرتجع وكشف الحساب", () => {
  beforeEach(() => {
    run(d => {
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 5, price: 100 }],
      });
    });
  });

  it("التحصيل يقلل ما على العميل", () => {
    expect(customerBalance(db, 1)).toBe(500);
    run(d => collectFromCustomer(d, 1, 200));
    expect(customerBalance(db, 1)).toBe(300);
    expect(db.customerLedger.at(-1)!.credit).toBe(200);
  });

  it("يمنع تحصيل أكثر من المستحق", () => {
    expect(() => run(d => collectFromCustomer(d, 1, 9999))).toThrow(
      /المستحق على العميل/
    );
    expect(() => run(d => collectFromCustomer(d, 1, 0))).toThrow(/غير صحيحة/);
  });

  it("مرتجع البيع الآجل يقلل دين العميل", () => {
    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] })
    );
    // 500 ناقص مرتجع 200
    expect(customerBalance(db, 1)).toBe(300);
    const entry = db.customerLedger.at(-1)!;
    expect(entry.type).toBe("مرتجع بيع");
    expect(entry.credit).toBe(200);
  });

  it("كشف الحساب يعرض رصيدًا تراكميًا صحيحًا", () => {
    run(d => collectFromCustomer(d, 1, 150));
    const rows = customerStatement(db, 1);
    expect(rows).toHaveLength(2);
    expect(rows[0].debit).toBe(500);
    expect(rows[0].balance).toBe(500);
    expect(rows[1].credit).toBe(150);
    expect(rows[1].balance).toBe(350);
  });

  it("يحسب إجماليات العميل والذمم المدينة", () => {
    const t = customerTotals(db, 1);
    expect(t.count).toBe(1);
    expect(t.total).toBe(500);
    expect(t.balance).toBe(500);
    expect(receivablesTotal(db)).toBe(500);
  });
});
