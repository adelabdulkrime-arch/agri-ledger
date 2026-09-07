// اختبارات المرتجعات: عكس المخزون والتكلفة وحساب المورد.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createSupplier,
  netProfitSummary,
  payablesTotal,
  postPurchase,
  postPurchaseReturn,
  postSale,
  postSaleReturn,
  profitSummary,
  returnedQuantities,
  supplierTotals,
} from "./operations";
import type { DbState, Product } from "./types";

function product(id: number, name: string): Product {
  return {
    id,
    name,
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price: 100,
    color: "leaf",
    barcode: `6280000000${id}`,
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
  db.products = [product(1, "سماد NPK"), product(2, "مبيد فطري")];
  // شراء 20 بتكلفة 50 ثم بيع 10 بسعر 100
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "credit",
      lines: [{ productId: 1, qty: 20, unitCost: 50 }],
    });
    postSale(d, {
      customer: "أحمد",
      lines: [{ productId: 1, qty: 10, price: 100 }],
    });
  });
});

describe("مرتجع البيع", () => {
  it("يعيد البضاعة للمخزن ويسجل حركة", () => {
    expect(db.products[0].stock).toBe(10);
    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 3 }] })
    );
    expect(db.products[0].stock).toBe(13);
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("SALE_RETURN");
    expect(move.qty).toBe(3);
    expect(move.qtyBefore).toBe(10);
    expect(move.qtyAfter).toBe(13);
  });

  it("يستخدم تكلفة الفاتورة الأصلية لا متوسط اليوم", () => {
    // شراء لاحق بسعر مختلف يرفع المتوسط
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 200 }],
      })
    );
    const ret = run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] })
    );
    // التكلفة الأصلية 50، وليست المتوسط الجديد.
    expect(ret.lines[0].unitCost).toBe(50);
    expect(ret.cogs).toBe(100);
  });

  it("يخصم المرتجع من صافي المبيعات والربح", () => {
    const before = profitSummary(db.sales);
    expect(before.revenue).toBe(1000);
    expect(before.grossProfit).toBe(500);

    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 4 }] })
    );
    const net = netProfitSummary(db, db.sales);
    // 4 × 100 مرتجع => المبيعات 600، التكلفة 300، الربح 300
    expect(net.returnsTotal).toBe(400);
    expect(net.revenue).toBe(600);
    expect(net.cogs).toBe(300);
    expect(net.grossProfit).toBe(300);
    expect(net.margin).toBe(50);
  });

  it("يمنع إرجاع أكثر من الكمية المباعة", () => {
    expect(() =>
      run(d =>
        postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 99 }] })
      )
    ).toThrow(/المتاحة للإرجاع/);
  });

  it("يمنع تجاوز الكمية عبر مرتجعات متعددة", () => {
    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 6 }] })
    );
    expect(returnedQuantities(db, "sale", 1049).get(1)).toBe(6);
    // بقي 4 فقط
    expect(() =>
      run(d =>
        postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 5 }] })
      )
    ).toThrow(/هي 4 فقط/);
    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 4 }] })
    );
    expect(db.products[0].stock).toBe(20);
  });

  it("يرفض صنفًا ليس في الفاتورة أو كمية غير صحيحة", () => {
    expect(() =>
      run(d =>
        postSaleReturn(d, { refNo: 1049, lines: [{ productId: 2, qty: 1 }] })
      )
    ).toThrow(/ليس ضمن الفاتورة/);
    expect(() =>
      run(d =>
        postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 0 }] })
      )
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      run(d => postSaleReturn(d, { refNo: 9999, lines: [] }))
    ).toThrow(/غير موجودة/);
  });
});

describe("مرتجع الشراء", () => {
  it("ينقص المخزون ويقلل المستحق للمورد", () => {
    expect(payablesTotal(db)).toBe(1000);
    run(d =>
      postPurchaseReturn(d, { refNo: 5001, lines: [{ productId: 1, qty: 5 }] })
    );
    // 10 في المخزن ناقص 5 مرتجعة
    expect(db.products[0].stock).toBe(5);
    // 1000 ناقص 250 قيمة المرتجع
    expect(payablesTotal(db)).toBe(750);
    expect(supplierTotals(db, 1).balance).toBe(750);
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("PURCHASE_RETURN");
    expect(move.qty).toBe(-5);
  });

  it("يسجل قيدًا مدينًا في كشف حساب المورد", () => {
    run(d =>
      postPurchaseReturn(d, { refNo: 5001, lines: [{ productId: 1, qty: 4 }] })
    );
    const entry = db.supplierLedger.at(-1)!;
    expect(entry.type).toBe("مرتجع شراء");
    expect(entry.debit).toBe(200);
    expect(entry.credit).toBe(0);
  });

  it("يمنع الإرجاع إذا كان الرصيد الحالي لا يكفي", () => {
    // بيع كل ما تبقى
    run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] })
    );
    expect(db.products[0].stock).toBe(0);
    expect(() =>
      run(d =>
        postPurchaseReturn(d, { refNo: 5001, lines: [{ productId: 1, qty: 5 }] })
      )
    ).toThrow(/لا يكفي للإرجاع/);
  });

  it("يمنع تجاوز الكمية المشتراة", () => {
    expect(() =>
      run(d =>
        postPurchaseReturn(d, {
          refNo: 5001,
          lines: [{ productId: 1, qty: 25 }],
        })
      )
    ).toThrow(/المتاحة للإرجاع/);
  });

  it("لا يغير شيئًا عند فشل المرتجع", () => {
    const before = JSON.stringify(db);
    expect(() =>
      run(d =>
        postPurchaseReturn(d, {
          refNo: 5001,
          lines: [{ productId: 1, qty: 999 }],
        })
      )
    ).toThrow();
    expect(JSON.stringify(db)).toBe(before);
  });
});
