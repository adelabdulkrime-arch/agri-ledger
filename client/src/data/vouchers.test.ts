// اختبارات أدوات الدفع وسندات القبض والصرف.
// الغرض الأهم: ما لا يدخل الدرج لا يُحسب في جرد الوردية.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  collectFromCustomer,
  createCustomer,
  createSupplier,
  createVoucher,
  addExpense,
  instrumentAccount,
  payPurchase,
  postPurchase,
  postSale,
  vouchersOf,
} from "./operations";
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
import {
  closeCashSession,
  expectedCash,
  openCashSession,
  sessionCashFlow,
} from "./session";
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

describe("توجيه أداة الدفع", () => {
  it("النقد للصندوق وما عداه للبنك", () => {
    expect(instrumentAccount("cash")).toBe(ACC.cash);
    expect(instrumentAccount("card")).toBe(ACC.bank);
    expect(instrumentAccount("transfer")).toBe(ACC.bank);
    expect(instrumentAccount("cheque")).toBe(ACC.bank);
    expect(instrumentAccount("bank")).toBe(ACC.bank);
    // الغياب يعني نقدًا، فلا يتغير سلوك النسخ السابقة.
    expect(instrumentAccount()).toBe(ACC.cash);
  });

  it("البيع بالشبكة يدخل البنك لا الصندوق", () => {
    run(d =>
      postSale(d, {
        instrument: "card",
        lines: [{ productId: 1, qty: 2, price: 100 }],
      })
    );
    expect(accountBalance(db, ACC.bank)).toBe(200);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("البيع النقدي يبقى في الصندوق", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] }));
    expect(accountBalance(db, ACC.cash)).toBe(200);
    expect(accountBalance(db, ACC.bank)).toBe(0);
  });

  it("المصروف بحوالة يخرج من البنك", () => {
    run(d =>
      addExpense(d, {
        category: "rent",
        description: "إيجار",
        amount: 300,
        instrument: "transfer",
      })
    );
    expect(accountBalance(db, ACC.bank)).toBe(-300);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(db.expenses[0].instrument).toBe("transfer");
  });

  it("سداد المورد بشيك يخرج من البنك", () => {
    run(d => payPurchase(d, 5001, 1000, { instrument: "cheque", reference: "ش-12" }));
    expect(accountBalance(db, ACC.bank)).toBe(-1000);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("جرد الوردية لا يتأثر بغير النقد", () => {
  beforeEach(() => {
    run(d => openCashSession(d, { openingFloat: 500 }));
  });

  it("بيع الشبكة لا يزيد المتوقع في الدرج", () => {
    run(d =>
      postSale(d, {
        instrument: "card",
        lines: [{ productId: 1, qty: 3, price: 100 }],
      })
    );
    const session = db.cashSessions[0];
    // الإيراد حقيقي لكنه ليس نقدًا في الدرج.
    expect(sessionCashFlow(db, session).inflow).toBe(0);
    expect(expectedCash(db, session)).toBe(500);
  });

  it("البيع النقدي يزيد المتوقع", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 3, price: 100 }] }));
    const session = db.cashSessions[0];
    expect(sessionCashFlow(db, session).inflow).toBe(300);
    expect(expectedCash(db, session)).toBe(800);
  });

  it("إقفال الوردية يوازن رغم وجود مبيعات شبكة", () => {
    run(d => {
      postSale(d, {
        instrument: "card",
        lines: [{ productId: 1, qty: 2, price: 100 }],
      });
      postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] });
    });
    // المعدود 600 = 500 بداية + 100 نقدًا، والشبكة خارج الدرج.
    const closed = run(d => closeCashSession(d, { countedCash: 600 }));
    expect(closed.expectedCash).toBe(600);
    expect(closed.variance).toBe(0);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("سندات القبض والصرف", () => {
  beforeEach(() => {
    run(d => {
      createCustomer(d, { name: "أحمد", terms: "credit" });
      postSale(d, {
        customerId: 1,
        terms: "credit",
        lines: [{ productId: 1, qty: 5, price: 100 }],
      });
    });
  });

  it("التحصيل يحرّر سند قبض مرقّمًا من 9000", () => {
    run(d => collectFromCustomer(d, 1, 200, "تحصيل", { instrument: "cash" }));
    const receipts = vouchersOf(db, { kind: "receipt" });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].no).toBe(9000);
    expect(receipts[0].party).toBe("أحمد");
    expect(receipts[0].amount).toBe(200);
    expect(receipts[0].customerId).toBe(1);
  });

  it("السداد يحرّر سند صرف بمرجعه", () => {
    run(d =>
      payPurchase(d, 5001, 500, { instrument: "cheque", reference: "ش-77" })
    );
    const payments = vouchersOf(db, { kind: "payment" });
    expect(payments).toHaveLength(1);
    expect(payments[0].kind).toBe("payment");
    expect(payments[0].instrument).toBe("cheque");
    expect(payments[0].reference).toBe("ش-77");
    expect(payments[0].refNo).toBe(5001);
  });

  it("التحصيل بالتحويل يدخل البنك ويُسجَّل في السند", () => {
    run(d =>
      collectFromCustomer(d, 1, 300, "تحصيل", { instrument: "transfer" })
    );
    expect(accountBalance(db, ACC.bank)).toBe(300);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(vouchersOf(db, { kind: "receipt" })[0].instrument).toBe("transfer");
  });

  it("الترقيم يتسلسل ويصفّي حسب الطرف", () => {
    run(d => {
      collectFromCustomer(d, 1, 100);
      collectFromCustomer(d, 1, 100);
      payPurchase(d, 5001, 100);
    });
    expect(vouchersOf(db)).toHaveLength(3);
    expect(vouchersOf(db, { customerId: 1 })).toHaveLength(2);
    expect(vouchersOf(db, { supplierId: 1 })).toHaveLength(1);
    const numbers = db.vouchers!.map(v => v.no).sort((a, b) => a - b);
    expect(numbers).toEqual([9000, 9001, 9002]);
  });

  it("يسجّل محرّر السند من المستخدم النشط", () => {
    db.users = [
      {
        id: 1,
        name: "عمار",
        role: "owner",
        pin: "1111",
        active: true,
        createdAt: new Date().toISOString(),
      },
    ];
    db.currentUserId = 1;
    run(d => createVoucher(d, { kind: "receipt", party: "أحمد", amount: 50 }));
    expect(db.vouchers![0].issuedBy).toBe("عمار");
  });

  it("بلا مستخدم نشط يبقى المحرّر غير محدد", () => {
    run(d => createVoucher(d, { kind: "payment", party: "الوادي", amount: 50 }));
    expect(db.vouchers![0].issuedBy).toBe("غير محدد");
  });
});
