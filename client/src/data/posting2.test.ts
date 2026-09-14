// اختبارات ترحيل العمليات المتبقية: السداد، المرتجعات، الإلغاء، والجرد.
// كل عملية يجب أن تُبقي ميزان المراجعة المرحَّل متوازنًا.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createCustomer,
  createSupplier,
  payPurchase,
  postPurchase,
  postPurchaseReturn,
  postSale,
  postSaleReturn,
  postStockTake,
  voidPurchase,
} from "./operations";
import {
  ACC,
  accountBalance,
  balanceSheet,
  incomeStatement,
  postedTrialBalance,
} from "./ledger";
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
    barcode: `6288000000${id}`,
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

/** كل قيد في الدفتر متوازن بذاته. */
function everyEntryBalanced(state: DbState) {
  return state.journal.every(j => {
    const d = j.lines.reduce((s, l) => s + l.debit, 0);
    const c = j.lines.reduce((s, l) => s + l.credit, 0);
    return Math.abs(d - c) < 0.01;
  });
}

beforeEach(() => {
  db = emptyState();
  db.products = [product(1)];
  run(d => createSupplier(d, { name: "الوادي" }));
});

describe("قيد السداد للمورد", () => {
  it("ينقص الذمم الدائنة والصندوق معًا", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    expect(accountBalance(db, ACC.payables)).toBe(500);

    run(d => payPurchase(d, 5001, 200));
    expect(accountBalance(db, ACC.payables)).toBe(300);
    expect(accountBalance(db, ACC.cash)).toBe(-200);
    expect(postedTrialBalance(db).balanced).toBe(true);
    expect(everyEntryBalanced(db)).toBe(true);
  });
});

describe("قيد مرتجع البيع", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      })
    );
  });

  it("مرتجع نقدي: مردودات مدينة والصندوق دائن", () => {
    run(d => {
      postSale(d, { lines: [{ productId: 1, qty: 5, price: 100 }] });
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] });
    });
    // المرتجع 2×100 = 200
    expect(accountBalance(db, ACC.salesReturns)).toBe(200);
    // التكلفة المعادة 2×50 = 100، فتعود للمخزون.
    expect(accountBalance(db, ACC.cogs)).toBe(150);
    expect(postedTrialBalance(db).balanced).toBe(true);
    expect(everyEntryBalanced(db)).toBe(true);
  });

  it("مرتجع آجل يقلل ذمم العملاء لا الصندوق", () => {
    run(d => {
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 5, price: 100 }],
      });
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 2 }] });
    });
    // 500 مبيعات آجلة ناقص 200 مرتجع.
    expect(accountBalance(db, ACC.receivables)).toBe(300);
    expect(accountBalance(db, ACC.salesReturns)).toBe(200);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("قيد مرتجع الشراء", () => {
  it("يخرج المخزون ويقلل الالتزام للمورد", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      });
      postPurchaseReturn(d, {
        refNo: 5001,
        lines: [{ productId: 1, qty: 4 }],
      });
    });
    // 500 ناقص مرتجع 200
    expect(accountBalance(db, ACC.inventory)).toBe(300);
    expect(accountBalance(db, ACC.payables)).toBe(300);
    expect(postedTrialBalance(db).balanced).toBe(true);
    expect(everyEntryBalanced(db)).toBe(true);
  });
});

describe("إلغاء فاتورة الشراء", () => {
  it("يعكس قيودها فيعود الرصيد صفرًا", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    expect(accountBalance(db, ACC.inventory)).toBe(500);

    run(d => voidPurchase(d, 5001));
    expect(accountBalance(db, ACC.inventory)).toBe(0);
    expect(accountBalance(db, ACC.payables)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("لا يحذف القيد الأصلي بل يضيف قيدًا عكسيًا", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    const before = db.journal.length;
    run(d => voidPurchase(d, 5001));
    expect(db.journal.length).toBeGreaterThan(before);
    expect(db.journal.some(j => j.reversedBy)).toBe(true);
  });
});

describe("قيد الجرد", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
  });

  it("العجز يُحمَّل تسوية مخزون مدينة", () => {
    run(d => postStockTake(d, [{ productId: 1, countedQty: 8 }]));
    // نقص كيسين بتكلفة 50 = 100
    expect(accountBalance(db, ACC.inventoryAdjust)).toBe(100);
    expect(accountBalance(db, ACC.inventory)).toBe(400);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الزيادة تدخل المخزون مدينة", () => {
    run(d => postStockTake(d, [{ productId: 1, countedQty: 13 }]));
    expect(accountBalance(db, ACC.inventory)).toBe(650);
    expect(accountBalance(db, ACC.inventoryAdjust)).toBe(-150);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الجرد المطابق لا يولّد قيدًا", () => {
    const before = db.journal.length;
    run(d => postStockTake(d, [{ productId: 1, countedQty: 10 }]));
    expect(db.journal.length).toBe(before);
  });
});

describe("أثر المردودات على قائمة الدخل", () => {
  it("المرتجع يُنقص صافي الإيراد لا يزيده", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] });
    });
    const before = incomeStatement(db);
    expect(before.revenue).toBe(1000);

    run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 3 }] })
    );
    const after = incomeStatement(db);
    // 1000 مبيعات ناقص 300 مردودات = 700 صافي إيراد.
    expect(after.revenue).toBe(700);
    expect(after.revenue).toBeLessThan(before.revenue);
    // التكلفة تنقص أيضًا لأن البضاعة عادت: 500 ناقص 150.
    expect(after.expenses).toBe(350);
    expect(after.netIncome).toBe(350);
  });

  it("الميزانية تبقى متوازنة بعد المرتجع", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 20, unitCost: 50 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] });
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 3 }] });
    });
    expect(balanceSheet(db).balanced).toBe(true);
  });
});

describe("دورة شاملة بكل العمليات", () => {
  it("الميزان متوازن بعد شراء وبيع ومرتجعين وسداد وجرد", () => {
    run(d => {
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 40, unitCost: 50 }],
      });
      payPurchase(d, 5001, 500);
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 10, price: 120 }],
      });
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 3 }] });
      postPurchaseReturn(d, {
        refNo: 5001,
        lines: [{ productId: 1, qty: 5 }],
      });
      postStockTake(d, [{ productId: 1, countedQty: 27 }]);
    });

    const tb = postedTrialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(everyEntryBalanced(db)).toBe(true);
  });
});
