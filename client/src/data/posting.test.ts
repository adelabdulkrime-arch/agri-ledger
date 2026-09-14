// اختبارات الترحيل الآلي: كل عملية مالية يجب أن تولّد قيدًا متوازنًا،
// وميزان المراجعة المرحَّل يجب أن يبقى متوازنًا بعد كل دورة كاملة.
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
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
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
    barcode: `6287000000${id}`,
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

describe("قيد الشراء", () => {
  it("الشراء النقدي: مدين المخزون، دائن الصندوق", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
    });
    expect(accountBalance(db, ACC.inventory)).toBe(500);
    // الصندوق دائن، فرصيده الطبيعي المدين يصبح سالبًا.
    expect(accountBalance(db, ACC.cash)).toBe(-500);
    expect(accountBalance(db, ACC.payables)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الشراء الآجل: مدين المخزون، دائن الموردون", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
    });
    expect(accountBalance(db, ACC.inventory)).toBe(500);
    expect(accountBalance(db, ACC.payables)).toBe(500);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الشراء الجزئي يوزّع الدائن بين الصندوق والمورد", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "partial",
        paid: 200,
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
    });
    expect(accountBalance(db, ACC.inventory)).toBe(500);
    expect(accountBalance(db, ACC.cash)).toBe(-200);
    expect(accountBalance(db, ACC.payables)).toBe(300);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("قيد البيع", () => {
  beforeEach(() => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      });
    });
  });

  it("البيع النقدي يولّد قيد إيراد وقيد تكلفة", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] }));
    // الإيراد 400، والتكلفة 4×50 = 200.
    expect(accountBalance(db, ACC.sales)).toBe(400);
    expect(accountBalance(db, ACC.cogs)).toBe(200);
    // المخزون: 1000 شراءً ناقص 200 تكلفة خروج.
    expect(accountBalance(db, ACC.inventory)).toBe(800);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("البيع الآجل يحمّل ذمم العملاء لا الصندوق", () => {
    run(d => {
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 3, price: 100 }],
      });
    });
    expect(accountBalance(db, ACC.receivables)).toBe(300);
    expect(accountBalance(db, ACC.sales)).toBe(300);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("قيد المصروف والتحصيل", () => {
  it("المصروف: مدين المصروفات، دائن الصندوق", () => {
    run(d =>
      addExpense(d, { category: "rent", description: "إيجار", amount: 150 })
    );
    expect(accountBalance(db, ACC.expenses)).toBe(150);
    expect(accountBalance(db, ACC.cash)).toBe(-150);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("التحصيل ينقل الرصيد من ذمم العملاء إلى الصندوق", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      });
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 5, price: 100 }],
      });
    });
    expect(accountBalance(db, ACC.receivables)).toBe(500);

    run(d => collectFromCustomer(d, 1, 300));
    expect(accountBalance(db, ACC.receivables)).toBe(200);
    // الصندوق: -1000 شراءً + 300 تحصيلًا.
    expect(accountBalance(db, ACC.cash)).toBe(-700);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("دورة كاملة", () => {
  it("الميزان يبقى متوازنًا بعد شراء وبيع ومصروف وتحصيل", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 30, unitCost: 50 }],
      });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 10, price: 120 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 5, price: 120 }] });
      addExpense(d, { category: "rent", description: "إيجار", amount: 200 });
      collectFromCustomer(d, 1, 400);
    });

    const tb = postedTrialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // تحقق من الأرقام المحورية.
    expect(accountBalance(db, ACC.sales)).toBe(1800);
    expect(accountBalance(db, ACC.cogs)).toBe(750);
    expect(accountBalance(db, ACC.payables)).toBe(1500);
    expect(accountBalance(db, ACC.receivables)).toBe(800);
  });

  it("كل قيد مولّد آليًا متوازن بذاته", () => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "partial",
        paid: 100,
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 2, price: 90 }] });
      addExpense(d, { category: "other", description: "نقل", amount: 30 });
    });

    expect(db.journal.length).toBeGreaterThan(0);
    db.journal.forEach(j => {
      const debit = j.lines.reduce((s, l) => s + l.debit, 0);
      const credit = j.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(debit - credit)).toBeLessThan(0.01);
    });
  });
});
