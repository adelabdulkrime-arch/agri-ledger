// اختبارات المصروفات التشغيلية وصافي الربح.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState, migrate, SCHEMA_VERSION } from "./store";
import {
  addExpense,
  createSupplier,
  deleteExpense,
  expensesByCategory,
  expensesTotal,
  netIncome,
  postPurchase,
  postSale,
  postSaleReturn,
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
    barcode: `628000000${id}`,
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
  db.products = [product(1, "سماد NPK")];
  // شراء 20×50 ثم بيع 10×100 => ربح إجمالي 500
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "cash",
      lines: [{ productId: 1, qty: 20, unitCost: 50 }],
    });
    postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] });
  });
});

describe("تسجيل المصروفات", () => {
  it("يضيف مصروفًا صحيحًا", () => {
    const e = run(d =>
      addExpense(d, {
        category: "rent",
        description: "إيجار المحل",
        amount: 1500,
        reference: "REC-1",
      })
    );
    expect(e.id).toBe(1);
    expect(e.amount).toBe(1500);
    expect(e.category).toBe("rent");
    expect(db.expenses).toHaveLength(1);
  });

  it("يرفض القيم غير الصحيحة", () => {
    expect(() =>
      run(d =>
        addExpense(d, { category: "rent", description: "  ", amount: 100 })
      )
    ).toThrow(/وصفًا/);
    for (const bad of [0, -50]) {
      expect(() =>
        run(d =>
          addExpense(d, { category: "rent", description: "إيجار", amount: bad })
        )
      ).toThrow(/أكبر من صفر/);
    }
    expect(() =>
      run(d =>
        addExpense(d, {
          category: "bogus" as any,
          description: "س",
          amount: 10,
        })
      )
    ).toThrow(/بند المصروف/);
  });

  it("يحذف مصروفًا ويرفض غير الموجود", () => {
    run(d =>
      addExpense(d, { category: "other", description: "أخرى", amount: 40 })
    );
    run(d => deleteExpense(d, 1));
    expect(db.expenses).toHaveLength(0);
    expect(() => run(d => deleteExpense(d, 99))).toThrow(/غير موجود/);
  });

  it("يجمّع المصروفات حسب البند مرتبة تنازليًا", () => {
    run(d => {
      addExpense(d, { category: "rent", description: "إيجار", amount: 1500 });
      addExpense(d, { category: "salaries", description: "راتب", amount: 800 });
      addExpense(d, { category: "rent", description: "إيجار مخزن", amount: 500 });
    });
    expect(expensesTotal(db.expenses)).toBe(2800);
    const groups = expensesByCategory(db.expenses);
    expect(groups[0]).toEqual({
      category: "rent",
      label: "إيجار",
      total: 2000,
    });
    expect(groups[1].total).toBe(800);
  });
});

describe("صافي الربح", () => {
  it("يطرح المصروفات من الربح الإجمالي", () => {
    run(d => {
      addExpense(d, { category: "rent", description: "إيجار", amount: 200 });
      addExpense(d, { category: "salaries", description: "راتب", amount: 100 });
    });
    const n = netIncome(db, db.sales, db.expenses);
    expect(n.revenue).toBe(1000);
    expect(n.cogs).toBe(500);
    expect(n.grossProfit).toBe(500);
    expect(n.expenses).toBe(300);
    expect(n.netProfit).toBe(200);
    expect(n.netMargin).toBe(20);
  });

  it("يحسب صافي الربح بعد المرتجعات والمصروفات معًا", () => {
    run(d => {
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 4 }] });
      addExpense(d, { category: "rent", description: "إيجار", amount: 100 });
    });
    const n = netIncome(db, db.sales, db.expenses);
    // مبيعات 600 بعد المرتجع، تكلفة 300، ربح 300، ناقص 100 مصروف = 200
    expect(n.revenue).toBe(600);
    expect(n.grossProfit).toBe(300);
    expect(n.netProfit).toBe(200);
  });

  it("يقبل الخسارة كرقم سالب", () => {
    run(d =>
      addExpense(d, { category: "rent", description: "إيجار", amount: 900 })
    );
    const n = netIncome(db, db.sales, db.expenses);
    expect(n.netProfit).toBe(-400);
  });

  it("لا يقسم على صفر بلا مبيعات", () => {
    const n = netIncome(emptyState(), [], []);
    expect(n.netMargin).toBe(0);
    expect(n.netProfit).toBe(0);
  });
});

describe("ترقية المخطط إلى 5", () => {
  it("تضيف جدول المصروفات دون فقد بيانات", () => {
    const old = {
      version: 4,
      products: [{ id: 1, name: "سماد", stock: 2, price: 10 }],
      sales: [],
      returns: [],
    };
    const out = migrate(old);
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.expenses).toEqual([]);
    expect(out.products[0].name).toBe("سماد");
  });
});
