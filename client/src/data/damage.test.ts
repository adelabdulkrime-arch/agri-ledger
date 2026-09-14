// اختبارات إتلاف البضاعة واقتراح إعادة الطلب.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { createSupplier, postPurchase, postSale } from "./operations";
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
import { damageSummary, damagesOf, recordDamage } from "./damage";
import { createWarehouse, stockAt } from "./warehouses";
import {
  DEFAULT_WINDOW_DAYS,
  groupBySupplier,
  reorderSuggestions,
} from "./reorder";
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

beforeEach(() => {
  db = emptyState();
  db.products = [product(1), product(2, 50)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "cash",
      lines: [
        { productId: 1, qty: 100, unitCost: 60 },
        { productId: 2, qty: 40, unitCost: 30 },
      ],
    });
  });
});

describe("إتلاف البضاعة", () => {
  it("ينقص المخزون ويحمّل الخسارة حسابها المستقل", () => {
    const rec = run(d =>
      recordDamage(d, { productId: 1, qty: 5, reason: "expired" })
    );

    expect(rec.no).toBe(11000);
    expect(rec.total).toBe(300);
    expect(db.products[0].stock).toBe(95);
    // الخسارة باسمها، لا مختلطة بتسويات الجرد.
    expect(accountBalance(db, ACC.damageLoss)).toBe(300);
    expect(accountBalance(db, ACC.inventoryAdjust)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يسجّل حركة مخزون من نوع إتلاف", () => {
    run(d => recordDamage(d, { productId: 1, qty: 2, reason: "broken" }));
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("DAMAGE");
    expect(move.qty).toBe(-2);
    expect(move.refType).toBe("damage");
    // الحركة والمستند يحملان الرقم نفسه فيربطهما التتبّع.
    expect(move.refNo).toBe(db.damages![0].no);
  });

  it("يرفض إتلاف أكثر من الرصيد", () => {
    expect(() =>
      run(d => recordDamage(d, { productId: 1, qty: 999, reason: "broken" }))
    ).toThrow(/الرصيد المتاح/);
    expect(db.products[0].stock).toBe(100);
    expect(db.damages).toHaveLength(0);
  });

  it("يرفض الكمية غير الصحيحة والصنف المجهول", () => {
    expect(() =>
      run(d => recordDamage(d, { productId: 1, qty: 0, reason: "other" }))
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      run(d => recordDamage(d, { productId: 99, qty: 1, reason: "other" }))
    ).toThrow(/الصنف غير موجود/);
  });

  it("يتحقق من رصيد المخزن لا الإجمالي", () => {
    const branch = run(d => createWarehouse(d, { name: "الفرع الثاني" }).id);
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        warehouseId: branch,
        lines: [{ productId: 1, qty: 3, unitCost: 60 }],
      })
    );

    // الإجمالي 103 لكن الفرع فيه 3 فقط.
    expect(() =>
      run(d =>
        recordDamage(d, {
          productId: 1,
          qty: 10,
          reason: "expired",
          warehouseId: branch,
        })
      )
    ).toThrow(/الرصيد المتاح/);

    run(d =>
      recordDamage(d, {
        productId: 1,
        qty: 3,
        reason: "expired",
        warehouseId: branch,
      })
    );
    expect(stockAt(db, 1, branch)).toBe(0);
  });

  it("إتلاف دفعة ينقصها بعينها", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 10, unitCost: 60, lotNo: "A-9", expiryDate: "2026-01-01" },
        ],
      })
    );
    const batch = db.batches![0];

    run(d =>
      recordDamage(d, {
        productId: 1,
        qty: 4,
        reason: "expired",
        batchId: batch.id,
      })
    );

    expect(db.batches![0].qtyRemaining).toBe(6);
    expect(db.damages![0].lotNo).toBe("A-9");
  });

  it("يرفض إتلاف أكثر من المتبقي في الدفعة", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 5, unitCost: 60, lotNo: "B-1" }],
      })
    );
    const batch = db.batches![0];
    expect(() =>
      run(d =>
        recordDamage(d, {
          productId: 1,
          qty: 9,
          reason: "broken",
          batchId: batch.id,
        })
      )
    ).toThrow(/المتبقي في التشغيلة/);
  });

  it("الملخّص يوزّع الخسارة على الأسباب", () => {
    run(d => {
      recordDamage(d, { productId: 1, qty: 5, reason: "expired" });
      recordDamage(d, { productId: 2, qty: 4, reason: "theft" });
      recordDamage(d, { productId: 1, qty: 1, reason: "expired" });
    });

    const s = damageSummary(db);
    expect(s.count).toBe(3);
    // 6×60 + 4×30
    expect(s.total).toBe(480);
    const expired = s.byReason.find(r => r.reason === "expired")!;
    expect(expired.count).toBe(2);
    expect(expired.total).toBe(360);
    expect(damagesOf(db, { reason: "theft" })).toHaveLength(1);
  });
});

describe("اقتراح إعادة الطلب", () => {
  /** يبيع كمية بتاريخ قديم داخل نافذة القياس. */
  function sell(d: DbState, productId: number, qty: number, daysAgo: number) {
    postSale(d, {
      at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      lines: [{ productId, qty, price: 100 }],
    });
  }

  it("لا يقترح شيئًا حين الرصيد وافر ولا بيع", () => {
    expect(reorderSuggestions(db)).toHaveLength(0);
  });

  it("يقترح ما نفد من المخزن", () => {
    run(d => sell(d, 2, 40, 5));
    const rows = reorderSuggestions(db);
    const row = rows.find(r => r.productId === 2)!;
    expect(row.reason).toBe("نفد من المخزن");
    expect(row.suggestedQty).toBeGreaterThan(0);
  });

  it("يحسب متوسط الصرف اليومي من البيع الفعلي", () => {
    // 90 كيسًا خلال النافذة = كيس واحد يوميًا.
    run(d => {
      for (let i = 1; i <= 9; i++) sell(d, 1, 10, i * 5);
    });
    const row = reorderSuggestions(db).find(r => r.productId === 1);
    expect(row).toBeTruthy();
    expect(row!.soldInWindow).toBe(90);
    expect(row!.dailyUse).toBe(round2(90 / DEFAULT_WINDOW_DAYS));
  });

  it("يقترح ما لا يكفي رصيده مدة التوريد", () => {
    // نبيع 90 من أصل 100 فيتبقى 10 مع صرف يومي 1 → تغطية 10 أيام.
    run(d => {
      for (let i = 1; i <= 9; i++) sell(d, 1, 10, i * 5);
    });
    const row = reorderSuggestions(db).find(r => r.productId === 1)!;
    expect(row.stock).toBe(10);
    expect(row.reason).toContain("يكفي");
    // الهدف 21 يومًا من الصرف ناقص الرصيد الحالي.
    expect(row.suggestedQty).toBeGreaterThan(0);
  });

  it("يتجاهل البيع خارج نافذة القياس", () => {
    run(d => sell(d, 1, 50, 200));
    const row = reorderSuggestions(db).find(r => r.productId === 1);
    // البيع قديم، والرصيد المتبقي وافر، فلا اقتراح.
    expect(row).toBeUndefined();
  });

  it("ينسب الاقتراح لآخر مورد اشتُري منه", () => {
    run(d => sell(d, 2, 40, 3));
    const row = reorderSuggestions(db).find(r => r.productId === 2)!;
    expect(row.supplierId).toBe(1);
    expect(row.supplierName).toBe("الوادي");
  });

  it("يجمع الاقتراحات في طلب لكل مورد", () => {
    run(d => {
      sell(d, 1, 95, 3);
      sell(d, 2, 40, 3);
    });
    const groups = groupBySupplier(reorderSuggestions(db));
    expect(groups).toHaveLength(1);
    expect(groups[0].supplierName).toBe("الوادي");
    expect(groups[0].rows.length).toBe(2);
    expect(groups[0].total).toBeGreaterThan(0);
  });
});

/** تقريب مساعد للاختبار وحده. */
function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
