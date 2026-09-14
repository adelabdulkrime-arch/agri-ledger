// اختبارات المخازن والفروع.
// الغرض الأهم: الفرع لا يبيع ما ليس عنده، والتحويل لا يخلق قيمة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  OperationError,
  createSupplier,
  postPurchase,
  postSale,
} from "./operations";
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
import {
  createWarehouse,
  defaultWarehouse,
  stockAt,
  stockByWarehouse,
  transferStock,
  transfersOf,
  updateWarehouse,
  warehouseSummary,
} from "./warehouses";
import { batchesOf } from "./batches";
import type { DbState, Product } from "./types";

function product(id: number, price = 100): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price,
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

/** معرّف الفرع الثاني بعد إنشائه في كل اختبار. */
let branch = 0;

beforeEach(() => {
  db = emptyState();
  db.products = [product(1), product(2, 50)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    branch = createWarehouse(d, { name: "الفرع الثاني" }).id;
  });
});

describe("إنشاء المخازن", () => {
  it("النسخة الجديدة تبدأ بمخزن افتراضي", () => {
    const fresh = emptyState();
    expect(fresh.warehouses).toHaveLength(1);
    expect(defaultWarehouse(fresh)!.isDefault).toBe(true);
  });

  it("المخزن الجديد ليس افتراضيًا إلا بطلب", () => {
    expect(db.warehouses!).toHaveLength(2);
    expect(defaultWarehouse(db)!.id).toBe(1);

    run(d => updateWarehouse(d, branch, { isDefault: true }));
    expect(defaultWarehouse(db)!.id).toBe(branch);
    // افتراضي واحد فقط في أي وقت.
    expect(db.warehouses!.filter(w => w.isDefault)).toHaveLength(1);
  });

  it("يرفض الاسم المكرر والفارغ", () => {
    expect(() =>
      run(d => createWarehouse(d, { name: "الفرع الثاني" }))
    ).toThrow(/نفس الاسم/);
    expect(() => run(d => createWarehouse(d, { name: "  " }))).toThrow(
      /مطلوب/
    );
  });
});

describe("رصيد كل مخزن مستقل", () => {
  beforeEach(() => {
    run(d => {
      // 10 للمخزن الرئيسي و4 للفرع.
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 60 }],
      });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        warehouseId: branch,
        lines: [{ productId: 1, qty: 4, unitCost: 60 }],
      });
    });
  });

  it("الإجمالي مجموع المخازن", () => {
    expect(db.products[0].stock).toBe(14);
    expect(stockAt(db, 1, 1)).toBe(10);
    expect(stockAt(db, 1, branch)).toBe(4);
  });

  it("يوزّع الرصيد على المخازن للعرض", () => {
    const rows = stockByWarehouse(db, 1);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.warehouseId === branch)!.qty).toBe(4);
  });

  it("الفرع لا يبيع أكثر مما عنده ولو توفر في غيره", () => {
    // الإجمالي 14، لكن الفرع فيه 4 فقط.
    expect(() =>
      run(d =>
        postSale(d, {
          warehouseId: branch,
          lines: [{ productId: 1, qty: 6, price: 100 }],
        })
      )
    ).toThrow(/الرصيد المتاح/);
    expect(db.sales).toHaveLength(0);
  });

  it("البيع يخصم من مخزنه وحده", () => {
    run(d =>
      postSale(d, {
        warehouseId: branch,
        lines: [{ productId: 1, qty: 3, price: 100 }],
      })
    );
    expect(stockAt(db, 1, branch)).toBe(1);
    expect(stockAt(db, 1, 1)).toBe(10);
    expect(db.products[0].stock).toBe(11);
  });

  it("ملخّص المخزن يعدّ أصنافه وقيمتها", () => {
    const s = warehouseSummary(db, branch);
    expect(s.items).toBe(1);
    expect(s.value).toBe(240);
  });
});

describe("التحويل بين المخازن", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 10, unitCost: 60 },
          { productId: 2, qty: 6, unitCost: 30 },
        ],
      })
    );
  });

  it("ينقل الكمية دون تغيير الإجمالي", () => {
    const totalBefore = db.products[0].stock;
    run(d =>
      transferStock(d, {
        fromWarehouseId: 1,
        toWarehouseId: branch,
        lines: [{ productId: 1, qty: 4 }],
      })
    );
    expect(stockAt(db, 1, 1)).toBe(6);
    expect(stockAt(db, 1, branch)).toBe(4);
    // البضاعة لم تدخل المحل ولم تخرج منه.
    expect(db.products[0].stock).toBe(totalBefore);
  });

  it("لا يُنشئ قيدًا محاسبيًا ولا يغيّر التكلفة", () => {
    const journalBefore = db.journal.length;
    const inventoryBefore = accountBalance(db, ACC.inventory);
    const costBefore = db.products[0].avgCost;

    run(d =>
      transferStock(d, {
        fromWarehouseId: 1,
        toWarehouseId: branch,
        lines: [{ productId: 1, qty: 5 }],
      })
    );

    expect(db.journal).toHaveLength(journalBefore);
    expect(accountBalance(db, ACC.inventory)).toBe(inventoryBefore);
    expect(db.products[0].avgCost).toBe(costBefore);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يرفض تحويل أكثر من رصيد المُرسِل", () => {
    expect(() =>
      run(d =>
        transferStock(d, {
          fromWarehouseId: 1,
          toWarehouseId: branch,
          lines: [{ productId: 1, qty: 99 }],
        })
      )
    ).toThrow(/الرصيد المتاح/);
    // لا شيء تحرك.
    expect(stockAt(db, 1, branch)).toBe(0);
  });

  it("يرفض التحويل إلى نفس المخزن", () => {
    expect(() =>
      run(d =>
        transferStock(d, {
          fromWarehouseId: 1,
          toWarehouseId: 1,
          lines: [{ productId: 1, qty: 1 }],
        })
      )
    ).toThrow(/مخزنين مختلفين/);
  });

  it("يسجّل التحويل مستندًا مرقّمًا من 7000", () => {
    const t = run(d =>
      transferStock(d, {
        fromWarehouseId: 1,
        toWarehouseId: branch,
        lines: [
          { productId: 1, qty: 2 },
          { productId: 2, qty: 3 },
        ],
        note: "تزويد الفرع",
      })
    );
    expect(t.no).toBe(7000);
    expect(t.lines).toHaveLength(2);
    // 2×60 + 3×30
    expect(t.total).toBe(210);
    expect(transfersOf(db, branch)).toHaveLength(1);
  });

  it("سطر واحد خاطئ يمنع التحويل كله", () => {
    expect(() =>
      run(d =>
        transferStock(d, {
          fromWarehouseId: 1,
          toWarehouseId: branch,
          lines: [
            { productId: 1, qty: 2 },
            { productId: 2, qty: 999 },
          ],
        })
      )
    ).toThrow(/الرصيد المتاح/);
    expect(stockAt(db, 1, branch)).toBe(0);
    expect(db.transfers).toHaveLength(0);
  });
});

describe("الدفعات تتبع مخزنها", () => {
  it("الصرف لا يأخذ من دفعات فرع آخر", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 5, unitCost: 60, lotNo: "A-1", expiryDate: "2027-01-01" },
        ],
      });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        warehouseId: branch,
        lines: [
          { productId: 1, qty: 5, unitCost: 60, lotNo: "B-1", expiryDate: "2026-06-01" },
        ],
      });
    });

    // دفعة الفرع أقرب انتهاءً، لكن البيع من الرئيسي لا يمسّها.
    expect(batchesOf(db, 1, 1).map(b => b.lotNo)).toEqual(["A-1"]);
    expect(batchesOf(db, 1, branch).map(b => b.lotNo)).toEqual(["B-1"]);

    const sale = run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] })
    );
    expect(sale.lines[0].batches![0].lotNo).toBe("A-1");
    expect(batchesOf(db, 1, branch)[0].qtyRemaining).toBe(5);
  });
});

describe("تعطيل المخزن", () => {
  it("يمنع تعطيل مخزن به رصيد", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        warehouseId: branch,
        lines: [{ productId: 1, qty: 3, unitCost: 60 }],
      })
    );
    expect(() => run(d => updateWarehouse(d, branch, { active: false }))).toThrow(
      /به رصيد/
    );
  });

  it("يسمح بتعطيل الفارغ ويمنع تعطيل الوحيد", () => {
    run(d => updateWarehouse(d, branch, { active: false }));
    expect(db.warehouses!.find(w => w.id === branch)!.active).toBe(false);
    expect(() => run(d => updateWarehouse(d, 1, { active: false }))).toThrow(
      OperationError
    );
  });
});
