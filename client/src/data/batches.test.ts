// اختبارات دفعات الأصناف: الصرف بالأقرب انتهاءً، التتبع، والصلاحيات.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createSupplier,
  postPurchase,
  postSale,
  postSaleReturn,
} from "./operations";
import {
  batchTrace,
  batchedQty,
  batchesOf,
  consumeFEFO,
  createBatch,
  expiringBatches,
  restoreBatches,
} from "./batches";
import type { DbState, Product } from "./types";

function product(id: number): Product {
  return {
    id,
    name: `مبيد ${id}`,
    category: "مبيدات",
    unit: "عبوة",
    stock: 0,
    price: 100,
    color: "gold",
    barcode: `6291000000${id}`,
    avgCost: 0,
    lastCost: 0,
  };
}

/** تاريخ بعد عدد أيام من الآن. */
function inDays(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString();
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
  run(d => createSupplier(d, { name: "الوادي" }));
});

describe("إنشاء الدفعات من الشراء", () => {
  it("فاتورة الشراء برقم تشغيلة تُنشئ دفعة", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          {
            productId: 1,
            qty: 20,
            unitCost: 50,
            lotNo: "LOT-A",
            expiryDate: inDays(200),
          },
        ],
      })
    );
    expect(db.batches).toHaveLength(1);
    const b = db.batches[0];
    expect(b.lotNo).toBe("LOT-A");
    expect(b.qtyReceived).toBe(20);
    expect(b.qtyRemaining).toBe(20);
    expect(b.unitCost).toBe(50);
    expect(b.supplierName).toBe("الوادي");
  });

  it("الشراء بلا رقم تشغيلة لا يُنشئ دفعة", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    expect(db.batches).toHaveLength(0);
    // المخزون يزيد رغم ذلك، فالدفعات اختيارية.
    expect(db.products[0].stock).toBe(10);
  });

  it("يرفض رقم تشغيلة فارغًا أو كمية صفرية", () => {
    expect(() =>
      run(d =>
        createBatch(d, {
          productId: 1,
          productName: "مبيد",
          lotNo: "  ",
          qty: 5,
          unitCost: 10,
          purchaseNo: 1,
          supplierName: "س",
        })
      )
    ).toThrow(/رقم التشغيلة مطلوب/);
    expect(() =>
      run(d =>
        createBatch(d, {
          productId: 1,
          productName: "مبيد",
          lotNo: "L1",
          qty: 0,
          unitCost: 10,
          purchaseNo: 1,
          supplierName: "س",
        })
      )
    ).toThrow(/أكبر من صفر/);
  });
});

describe("الصرف بالأقرب انتهاءً أولًا", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          // الأبعد صلاحية يصل أولًا، ليثبت أن الترتيب بالصلاحية لا بالوصول.
          { productId: 1, qty: 10, unitCost: 50, lotNo: "بعيد", expiryDate: inDays(300) },
          { productId: 1, qty: 10, unitCost: 50, lotNo: "قريب", expiryDate: inDays(30) },
        ],
      })
    );
  });

  it("يرتب الدفعات بالأقرب انتهاءً", () => {
    const order = batchesOf(db, 1).map(b => b.lotNo);
    expect(order).toEqual(["قريب", "بعيد"]);
  });

  it("البيع يسحب من الأقرب انتهاءً أولًا", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 6, price: 100 }] }));
    const near = db.batches.find(b => b.lotNo === "قريب")!;
    const far = db.batches.find(b => b.lotNo === "بعيد")!;
    expect(near.qtyRemaining).toBe(4);
    expect(far.qtyRemaining).toBe(10);
    // السطر يحمل الدفعة المستهلكة.
    expect(db.sales[0].lines[0].batches).toHaveLength(1);
    expect(db.sales[0].lines[0].batches![0].lotNo).toBe("قريب");
  });

  it("يعبر إلى الدفعة التالية عند نفاد الأولى", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 14, price: 100 }] }));
    const near = db.batches.find(b => b.lotNo === "قريب")!;
    const far = db.batches.find(b => b.lotNo === "بعيد")!;
    expect(near.qtyRemaining).toBe(0);
    expect(far.qtyRemaining).toBe(6);
    const consumed = db.sales[0].lines[0].batches!;
    expect(consumed).toHaveLength(2);
    expect(consumed[0].qty).toBe(10);
    expect(consumed[1].qty).toBe(4);
  });

  it("الدفعة بلا صلاحية تُصرف أخيرًا", () => {
    run(d =>
      createBatch(d, {
        productId: 1,
        productName: "مبيد 1",
        lotNo: "بلا",
        qty: 5,
        unitCost: 50,
        purchaseNo: 0,
        supplierName: "س",
      })
    );
    const order = batchesOf(db, 1).map(b => b.lotNo);
    expect(order[order.length - 1]).toBe("بلا");
  });

  it("يصرف المتاح فقط إن لم تكف الدفعات", () => {
    // 20 في الدفعات، نطلب 25 مباشرة من المحرك.
    const taken = run(d => consumeFEFO(d, 1, 25));
    const total = taken.reduce((s, t) => s + t.qty, 0);
    expect(total).toBe(20);
    expect(batchedQty(db, 1)).toBe(0);
  });
});

describe("المرتجع يعيد الكمية لدفعاتها", () => {
  it("يستعيد المتبقي في الدفعة الأصلية", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 10, unitCost: 50, lotNo: "L1", expiryDate: inDays(100) },
        ],
      });
      postSale(d, { lines: [{ productId: 1, qty: 6, price: 100 }] });
    });
    expect(db.batches[0].qtyRemaining).toBe(4);

    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] })
    );
    expect(db.batches[0].qtyRemaining).toBe(6);
  });

  it("الاستعادة بلا دفعات لا تفعل شيئًا", () => {
    run(d => restoreBatches(d, undefined, 5));
    expect(db.batches).toHaveLength(0);
  });
});

describe("الصلاحيات والتتبع", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 5, unitCost: 50, lotNo: "منتهية", expiryDate: inDays(-10) },
          { productId: 1, qty: 5, unitCost: 50, lotNo: "وشيكة", expiryDate: inDays(20) },
          { productId: 1, qty: 5, unitCost: 50, lotNo: "بعيدة", expiryDate: inDays(400) },
        ],
      })
    );
  });

  it("يكشف المنتهية والقريبة من الانتهاء", () => {
    const soon = expiringBatches(db, 90);
    expect(soon.map(b => b.lotNo)).toEqual(["منتهية", "وشيكة"]);
    expect(soon[0].expired).toBe(true);
    expect(soon[1].expired).toBe(false);
    expect(soon[1].daysLeft).toBeGreaterThan(0);
  });

  it("يستثني البعيدة خارج المدة", () => {
    expect(expiringBatches(db, 90).some(b => b.lotNo === "بعيدة")).toBe(false);
    expect(expiringBatches(db, 500).some(b => b.lotNo === "بعيدة")).toBe(true);
  });

  it("يتتبع من اشترى دفعة معيّنة", () => {
    run(d =>
      postSale(d, {
        customer: "مزرعة النخيل",
        lines: [{ productId: 1, qty: 3, price: 100 }],
      })
    );
    // الصرف من المنتهية أولًا لأنها الأقرب انتهاءً.
    const expired = db.batches.find(b => b.lotNo === "منتهية")!;
    const trace = batchTrace(db, expired.id)!;
    expect(trace.soldQty).toBe(3);
    expect(trace.buyers).toHaveLength(1);
    expect(trace.buyers[0].customer).toBe("مزرعة النخيل");
    expect(trace.buyers[0].saleNo).toBe(1049);
  });

  it("يعيد null لدفعة غير موجودة", () => {
    expect(batchTrace(db, 9999)).toBeNull();
  });
});
