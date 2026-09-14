// اختبارات التسوية البنكية: ما ظهر في الكشف، وما لم يظهر، والفرق بينهما.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  addExpense,
  collectFromCustomer,
  createCustomer,
  createSupplier,
  postPurchase,
  postSale,
} from "./operations";
import { postOpeningBalance, transferCash } from "./ledger";
import { clearAllUpTo, reconcileBank, toggleCleared } from "./reconcile";
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
  db.products = [product(1)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "credit",
      lines: [{ productId: 1, qty: 100, unitCost: 50 }],
    });
  });
});

describe("جمع حركات البنك", () => {
  it("لا يلتقط إلا ما مسّ حساب البنك", () => {
    run(d => {
      postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] }); // نقدي
      postSale(d, {
        instrument: "card",
        lines: [{ productId: 1, qty: 2, price: 100 }],
      });
    });
    const r = reconcileBank(db);
    // البيع النقدي لا يظهر في كشف البنك.
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0].debit).toBe(200);
    expect(r.bookBalance).toBe(200);
  });

  it("يجمع الوارد والصادر بإشارتيهما", () => {
    run(d => {
      postOpeningBalance(d, { bank: 5000 });
      addExpense(d, {
        category: "rent",
        description: "إيجار",
        amount: 1200,
        instrument: "transfer",
      });
    });
    const r = reconcileBank(db);
    expect(r.movements).toHaveLength(2);
    expect(r.bookBalance).toBe(3800);
  });

  it("التحويل بين الصندوق والبنك يظهر في التسوية", () => {
    run(d => {
      postOpeningBalance(d, { cash: 3000 });
      transferCash(d, { from: "cash", amount: 1000 });
    });
    const r = reconcileBank(db);
    expect(r.movements).toHaveLength(1);
    expect(r.bookBalance).toBe(1000);
  });
});

describe("التأشير والفرق", () => {
  beforeEach(() => {
    run(d => {
      createCustomer(d, { name: "أحمد", terms: "credit" });
      postSale(d, {
        customerId: 1,
        terms: "credit",
        lines: [{ productId: 1, qty: 10, price: 100 }],
      });
      collectFromCustomer(d, 1, 600, "تحصيل", { instrument: "transfer" });
      collectFromCustomer(d, 1, 400, "تحصيل", { instrument: "card" });
    });
  });

  it("بلا تأشير يكون المطابق صفرًا وكل شيء معلّقًا", () => {
    const r = reconcileBank(db);
    expect(r.bookBalance).toBe(1000);
    expect(r.clearedBalance).toBe(0);
    expect(r.unclearedCount).toBe(2);
    expect(r.unclearedTotal).toBe(1000);
  });

  it("التأشير ينقل الحركة إلى المطابق", () => {
    const key = reconcileBank(db).movements[0].key;
    run(d => toggleCleared(d, key));

    const r = reconcileBank(db);
    expect(r.clearedBalance).toBe(600);
    expect(r.unclearedCount).toBe(1);
    expect(r.movements.find(m => m.key === key)!.cleared).toBe(true);
  });

  it("التأشير يُلغى بنفس الاستدعاء", () => {
    const key = reconcileBank(db).movements[0].key;
    run(d => toggleCleared(d, key));
    run(d => toggleCleared(d, key));
    expect(reconcileBank(db).clearedBalance).toBe(0);
    expect(db.reconciled).toHaveLength(0);
  });

  it("الفرق يصير صفرًا حين يطابق المؤشَّر كشفَ البنك", () => {
    run(d => {
      reconcileBank(d).movements.forEach(m => toggleCleared(d, m.key));
    });
    const r = reconcileBank(db, { statementBalance: 1000 });
    expect(r.clearedBalance).toBe(1000);
    expect(r.difference).toBe(0);
  });

  it("الفرق يكشف نقصًا في الكشف", () => {
    const key = reconcileBank(db).movements[0].key;
    run(d => toggleCleared(d, key));
    // أشّرنا 600 والكشف يقول 1000: فرق 400 لم يُؤشَّر بعد.
    const r = reconcileBank(db, { statementBalance: 1000 });
    expect(r.difference).toBe(-400);
  });

  it("التأشير الجماعي حتى تاريخ", () => {
    const count = run(d => clearAllUpTo(d, new Date()));
    expect(count).toBe(2);
    const r = reconcileBank(db, { statementBalance: 1000 });
    expect(r.unclearedCount).toBe(0);
    expect(r.difference).toBe(0);
    // لا يُعيد تأشير ما أُشّر.
    expect(run(d => clearAllUpTo(d, new Date()))).toBe(0);
  });
});

describe("حدّ التاريخ", () => {
  it("يستبعد ما بعد تاريخ التسوية", () => {
    run(d => {
      postOpeningBalance(d, {
        bank: 2000,
        at: new Date(2026, 0, 10).toISOString(),
      });
      addExpense(d, {
        category: "rent",
        description: "إيجار فبراير",
        amount: 500,
        instrument: "transfer",
        at: new Date(2026, 1, 15).toISOString(),
      });
    });
    const janOnly = reconcileBank(db, { to: new Date(2026, 0, 31) });
    expect(janOnly.movements).toHaveLength(1);
    expect(janOnly.bookBalance).toBe(2000);

    const both = reconcileBank(db, { to: new Date(2026, 2, 1) });
    expect(both.movements).toHaveLength(2);
    expect(both.bookBalance).toBe(1500);
  });
});

describe("بلا حركات بنكية", () => {
  it("تسوية فارغة متوازنة", () => {
    const r = reconcileBank(db);
    expect(r.movements).toHaveLength(0);
    expect(r.bookBalance).toBe(0);
    expect(r.difference).toBe(0);
  });
});
