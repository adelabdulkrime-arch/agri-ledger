// اختبارات أوامر الشراء ودورة حالاتها.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { createSupplier, postPurchase } from "./operations";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  findPurchaseOrder,
  markReceived,
  orderToPurchaseInput,
  purchaseOrderSummary,
  purchaseOrdersOf,
} from "./purchaseorders";
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
    barcode: `6289000000${id}`,
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
  db.products = [product(1), product(2)];
  run(d => createSupplier(d, { name: "الوادي" }));
});

/** أمر قياسي: 20 من صنف 1 و10 من صنف 2. */
function makeOrder(d: DbState) {
  return createPurchaseOrder(d, {
    supplierId: 1,
    lines: [
      { productId: 1, qty: 20, unitCost: 60 },
      { productId: 2, qty: 10, unitCost: 30 },
    ],
  });
}

describe("إنشاء أمر الشراء", () => {
  it("يبدأ مسودة ولا يمسّ المخزون ولا الدفاتر", () => {
    const order = run(makeOrder);

    expect(order.no).toBe(4000);
    expect(order.status).toBe("draft");
    expect(order.total).toBe(1500);
    // لا حركة مخزنية ولا قيد.
    expect(db.products[0].stock).toBe(0);
    expect(db.stockMoves).toHaveLength(0);
    expect(db.journal).toHaveLength(0);
  });

  it("يرفض المدخلات غير الصحيحة", () => {
    expect(() =>
      run(d => createPurchaseOrder(d, { supplierId: 99, lines: [] }))
    ).toThrow(/موردًا/);
    expect(() =>
      run(d => createPurchaseOrder(d, { supplierId: 1, lines: [] }))
    ).toThrow(/صنفًا واحدًا/);
    expect(() =>
      run(d =>
        createPurchaseOrder(d, {
          supplierId: 1,
          lines: [{ productId: 1, qty: 0, unitCost: 10 }],
        })
      )
    ).toThrow(/أكبر من صفر/);
  });
});

describe("دورة الحالات", () => {
  it("مسودة ← معتمد", () => {
    const order = run(makeOrder);
    run(d => approvePurchaseOrder(d, order.no));

    const stored = findPurchaseOrder(db, order.no)!;
    expect(stored.status).toBe("approved");
    expect(stored.approvedAt).toBeTruthy();
  });

  it("لا يُعتمد مرتين", () => {
    const order = run(makeOrder);
    run(d => approvePurchaseOrder(d, order.no));
    expect(() => run(d => approvePurchaseOrder(d, order.no))).toThrow(
      /معتمد/
    );
  });

  it("لا يُستلم أمر لم يُعتمد", () => {
    const order = run(makeOrder);
    expect(() => run(d => markReceived(d, order.no, 5001))).toThrow(
      /اعتمد الأمر/
    );
  });

  it("الإلغاء يمنع المتابعة", () => {
    const order = run(makeOrder);
    run(d => cancelPurchaseOrder(d, order.no, "تأخر المورد"));
    const stored = findPurchaseOrder(db, order.no)!;
    expect(stored.status).toBe("cancelled");
    expect(stored.note).toContain("تأخر");
    expect(() => run(d => markReceived(d, order.no, 5001))).toThrow(/ملغى/);
  });
});

describe("الاستلام والتحويل لفاتورة", () => {
  beforeEach(() => {
    run(d => {
      makeOrder(d);
      approvePurchaseOrder(d, 4000);
    });
  });

  it("يحوّل الأمر إلى فاتورة شراء تحرّك المخزون", () => {
    const order = findPurchaseOrder(db, 4000)!;
    const purchase = run(d => {
      const p = postPurchase(d, {
        ...orderToPurchaseInput(order),
        paymentMethod: "credit",
      });
      markReceived(d, order.no, p.no);
      return p;
    });

    // الآن فقط تحرك المخزون.
    expect(db.products[0].stock).toBe(20);
    expect(db.products[1].stock).toBe(10);
    expect(purchase.total).toBe(1500);

    const stored = findPurchaseOrder(db, 4000)!;
    expect(stored.status).toBe("received");
    expect(stored.purchaseNos).toContain(purchase.no);
  });

  it("الاستلام الجزئي يُبقي الأمر مفتوحًا", () => {
    run(d => markReceived(d, 4000, 5001, [{ productId: 1, qty: 12 }]));

    const stored = findPurchaseOrder(db, 4000)!;
    // لم يكتمل بعد: 12 من 20، و0 من 10.
    expect(stored.status).toBe("approved");
    expect(stored.lines[0].receivedQty).toBe(12);

    // المتبقي فقط هو ما يُطلب في الفاتورة التالية.
    const remaining = orderToPurchaseInput(stored);
    expect(remaining.lines.find(l => l.productId === 1)!.qty).toBe(8);
    expect(remaining.lines.find(l => l.productId === 2)!.qty).toBe(10);
  });

  it("يكتمل الأمر بعد استلام الباقي", () => {
    run(d => {
      markReceived(d, 4000, 5001, [{ productId: 1, qty: 12 }]);
      markReceived(d, 4000, 5002, [
        { productId: 1, qty: 8 },
        { productId: 2, qty: 10 },
      ]);
    });

    const stored = findPurchaseOrder(db, 4000)!;
    expect(stored.status).toBe("received");
    expect(stored.purchaseNos).toHaveLength(2);
  });

  it("يرفض استلام أكثر من المطلوب", () => {
    expect(() =>
      run(d => markReceived(d, 4000, 5001, [{ productId: 1, qty: 99 }]))
    ).toThrow(/يتجاوز المطلوب/);
  });

  it("لا يُستلم أمر اكتمل", () => {
    run(d => markReceived(d, 4000, 5001));
    expect(() => run(d => markReceived(d, 4000, 5002))).toThrow(
      /استُلم بالكامل/
    );
  });
});

describe("التصفية والملخّص", () => {
  it("يعدّ المفتوح والمتأخر", () => {
    run(d => {
      // أمر متأخر: موعده أمس.
      createPurchaseOrder(d, {
        supplierId: 1,
        expectedAt: new Date(Date.now() - 86400000).toISOString(),
        lines: [{ productId: 1, qty: 5, unitCost: 60 }],
      });
      // أمر في موعده.
      createPurchaseOrder(d, {
        supplierId: 1,
        expectedAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        lines: [{ productId: 2, qty: 5, unitCost: 30 }],
      });
    });

    const s = purchaseOrderSummary(db);
    expect(s.total).toBe(2);
    expect(s.open).toBe(2);
    expect(s.late).toBe(1);
    expect(s.openValue).toBe(450);
  });

  it("يصفّي بالحالة والمورد", () => {
    run(d => {
      makeOrder(d);
      approvePurchaseOrder(d, 4000);
      createPurchaseOrder(d, {
        supplierId: 1,
        lines: [{ productId: 1, qty: 3, unitCost: 60 }],
      });
    });

    expect(purchaseOrdersOf(db)).toHaveLength(2);
    expect(purchaseOrdersOf(db, { status: "approved" })).toHaveLength(1);
    expect(purchaseOrdersOf(db, { status: "draft" })).toHaveLength(1);
    expect(purchaseOrdersOf(db, { supplierId: 1 })).toHaveLength(2);
  });
});
