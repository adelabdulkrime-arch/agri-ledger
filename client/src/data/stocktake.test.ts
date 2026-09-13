// اختبارات الجرد الفعلي وتصفير أرصدة البداية.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createSupplier,
  postPurchase,
  postSale,
  postStockTake,
  profitSummary,
  resetOpeningBalances,
} from "./operations";
import type { DbState, Product } from "./types";

function product(id: number, stock = 0, avgCost = 0): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock,
    price: 185,
    color: "leaf",
    barcode: `62810000000${id}`,
    avgCost,
    lastCost: avgCost,
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
  // يحاكي حالة المستخدم: رصيد ابتدائي بتكلفة صفر من الكتالوج.
  db.products = [product(1, 24, 0), product(2, 0, 0)];
});

describe("الجرد الفعلي", () => {
  it("يضبط الرصيد على الكمية المعدودة ويسجل الفرق", () => {
    run(d => postStockTake(d, [{ productId: 1, countedQty: 20 }]));
    expect(db.products[0].stock).toBe(20);
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("ADJUSTMENT");
    expect(move.qty).toBe(-4);
    expect(move.qtyBefore).toBe(24);
    expect(move.qtyAfter).toBe(20);
    expect(move.note).toContain("عجز");
  });

  it("يسجل الزيادة كما يسجل العجز", () => {
    run(d => postStockTake(d, [{ productId: 1, countedQty: 30 }]));
    expect(db.products[0].stock).toBe(30);
    expect(db.stockMoves.at(-1)!.qty).toBe(6);
    expect(db.stockMoves.at(-1)!.note).toContain("زيادة");
  });

  it("يصحّح متوسط التكلفة عند تمريره", () => {
    run(d =>
      postStockTake(d, [{ productId: 1, countedQty: 24, unitCost: 120 }])
    );
    expect(db.products[0].avgCost).toBe(120);
    // لا حركة لأن الكمية لم تتغير، لكن التكلفة صُحّحت.
    expect(db.stockMoves).toHaveLength(0);
  });

  it("لا يسجل حركة عندما تطابق الكمية الرصيد", () => {
    run(d => postStockTake(d, [{ productId: 1, countedQty: 24 }]));
    expect(db.stockMoves).toHaveLength(0);
    expect(db.products[0].stock).toBe(24);
  });

  it("يرفض المدخلات غير الصحيحة دون كتابة جزئية", () => {
    const before = JSON.stringify(db);
    expect(() => run(d => postStockTake(d, []))).toThrow(/صنفًا واحدًا/);
    expect(() =>
      run(d => postStockTake(d, [{ productId: 1, countedQty: -5 }]))
    ).toThrow(/سالبة/);
    expect(() =>
      run(d => postStockTake(d, [{ productId: 99, countedQty: 5 }]))
    ).toThrow(/غير موجود/);
    expect(() =>
      run(d =>
        postStockTake(d, [{ productId: 1, countedQty: 5, unitCost: -1 }])
      )
    ).toThrow(/التكلفة/);
    expect(JSON.stringify(db)).toBe(before);
  });

  it("يجرد عدة أصناف في عملية واحدة برقم مرجعي مشترك", () => {
    run(d =>
      postStockTake(d, [
        { productId: 1, countedQty: 10 },
        { productId: 2, countedQty: 7 },
      ])
    );
    expect(db.products[0].stock).toBe(10);
    expect(db.products[1].stock).toBe(7);
    const refs = new Set(db.stockMoves.map(m => m.refNo));
    expect(refs.size).toBe(1);
    expect(db.stockMoves.every(m => m.refType === "stocktake")).toBe(true);
  });
});

describe("تصفير أرصدة البداية", () => {
  it("يصفّر الكميات والتكاليف معًا", () => {
    const count = run(d => resetOpeningBalances(d));
    expect(count).toBe(1);
    expect(db.products[0].stock).toBe(0);
    expect(db.products[0].avgCost).toBe(0);
    expect(db.products[0].lastCost).toBe(0);
  });

  it("يترك أثرًا في سجل الحركات لا يُحذف صامتًا", () => {
    run(d => resetOpeningBalances(d));
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("ADJUSTMENT");
    expect(move.note).toContain("تصفير");
    expect(move.qtyAfter).toBe(0);
  });

  it("لا يفعل شيئًا عندما تكون الأرصدة صفرًا أصلًا", () => {
    run(d => resetOpeningBalances(d));
    const moves = db.stockMoves.length;
    const again = run(d => resetOpeningBalances(d));
    expect(again).toBe(0);
    expect(db.stockMoves).toHaveLength(moves);
  });

  it("يجعل الربح حقيقيًا بعد التصفير والشراء الفعلي", () => {
    // قبل: بيع من رصيد بتكلفة صفر يعطي ربحًا مبالغًا فيه.
    run(d => {
      resetOpeningBalances(d);
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 185 }] });
    });
    const p = profitSummary(db.sales);
    // 4×185 = 740 مبيعات، 4×50 = 200 تكلفة، الربح 540 وهو الرقم الحقيقي.
    expect(p.revenue).toBe(740);
    expect(p.cogs).toBe(200);
    expect(p.grossProfit).toBe(540);
  });
});
