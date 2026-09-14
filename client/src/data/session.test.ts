// اختبارات وردية الصندوق: الفتح، تتبع الحركة، الجرد، وكشف العجز والزيادة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  addExpense,
  createCustomer,
  createSupplier,
  collectFromCustomer,
  postPurchase,
  postSale,
} from "./operations";
import {
  ACC,
  accountBalance,
  ensureChart,
  postedTrialBalance,
} from "./ledger";
import {
  activeSession,
  closeCashSession,
  expectedCash,
  openCashSession,
  sessionCashFlow,
  sessionMovements,
  sessionSummary,
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
    barcode: `6290000000${id}`,
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
    ensureChart(d);
    createSupplier(d, { name: "الوادي" });
    // مخزون بتكلفة معروفة، ويُدفع نقدًا فيخرج من الصندوق.
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "credit",
      lines: [{ productId: 1, qty: 50, unitCost: 60 }],
    });
  });
});

describe("فتح الوردية", () => {
  it("يفتح وردية برصيد بداية", () => {
    const s = run(d => openCashSession(d, { openingFloat: 500, openedBy: "عمار" }));
    expect(s.no).toBe(701);
    expect(s.status).toBe("open");
    expect(s.openingFloat).toBe(500);
    expect(s.openedBy).toBe("عمار");
    expect(activeSession(db)!.no).toBe(701);
  });

  it("يمنع فتح ورديتين معًا", () => {
    run(d => openCashSession(d, { openingFloat: 100 }));
    expect(() => run(d => openCashSession(d, { openingFloat: 200 }))).toThrow(
      /وردية مفتوحة بالفعل/
    );
    expect(db.cashSessions).toHaveLength(1);
  });

  it("يرفض رصيد بداية سالبًا", () => {
    expect(() => run(d => openCashSession(d, { openingFloat: -50 }))).toThrow(
      /سالبًا/
    );
  });
});

describe("حركة النقد خلال الوردية", () => {
  beforeEach(() => {
    run(d => openCashSession(d, { openingFloat: 1000 }));
  });

  it("تلتقط البيع النقدي والمصروف", () => {
    run(d => {
      postSale(d, { lines: [{ productId: 1, qty: 3, price: 100 }] });
      addExpense(d, { category: "rent", description: "إيجار", amount: 200 });
    });
    const flow = sessionCashFlow(db, activeSession(db)!);
    expect(flow.inflow).toBe(300);
    expect(flow.outflow).toBe(200);
    expect(flow.net).toBe(100);
    // 1000 رصيد بداية + 100 صافي الحركة
    expect(expectedCash(db, activeSession(db)!)).toBe(1100);
  });

  it("تلتقط التحصيل من العملاء", () => {
    run(d => {
      createCustomer(d, { name: "مزرعة النخيل", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 5, price: 100 }],
      });
      collectFromCustomer(d, 1, 300);
    });
    const flow = sessionCashFlow(db, activeSession(db)!);
    // البيع الآجل لا يمس الصندوق، والتحصيل يمسه.
    expect(flow.inflow).toBe(300);
    expect(expectedCash(db, activeSession(db)!)).toBe(1300);
  });

  it("لا تحسب البيع الآجل ضمن النقد", () => {
    run(d => {
      createCustomer(d, { name: "أحمد", terms: "credit" });
      postSale(d, {
        customerId: 1,
        lines: [{ productId: 1, qty: 4, price: 100 }],
      });
    });
    expect(sessionCashFlow(db, activeSession(db)!).inflow).toBe(0);
    expect(expectedCash(db, activeSession(db)!)).toBe(1000);
  });

  it("تعرض تفاصيل الحركات مرتبة", () => {
    run(d => {
      postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] });
      addExpense(d, { category: "other", description: "نقل", amount: 50 });
    });
    const rows = sessionMovements(db, activeSession(db)!);
    expect(rows).toHaveLength(2);
    expect(rows[0].in).toBe(200);
    expect(rows[1].out).toBe(50);
  });
});

describe("إقفال الوردية", () => {
  beforeEach(() => {
    run(d => {
      openCashSession(d, { openingFloat: 500 });
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] });
    });
  });

  it("الجرد المطابق لا يولّد قيد تسوية", () => {
    const before = db.journal.length;
    const s = run(d => closeCashSession(d, { countedCash: 900 }));
    expect(s.status).toBe("closed");
    expect(s.expectedCash).toBe(900);
    expect(s.variance).toBe(0);
    expect(db.journal.length).toBe(before);
  });

  it("العجز يُقيَّد مصروفًا", () => {
    const s = run(d => closeCashSession(d, { countedCash: 850 }));
    expect(s.variance).toBe(-50);
    // العجز يزيد المصروفات وينقص الصندوق.
    expect(accountBalance(db, ACC.expenses)).toBe(50);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الزيادة تُقيَّد إيرادًا عارضًا", () => {
    const s = run(d => closeCashSession(d, { countedCash: 980 }));
    expect(s.variance).toBe(80);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يرفض الإقفال بلا وردية مفتوحة", () => {
    run(d => closeCashSession(d, { countedCash: 900 }));
    expect(() => run(d => closeCashSession(d, { countedCash: 100 }))).toThrow(
      /لا توجد وردية مفتوحة/
    );
  });

  it("يرفض نقدًا معدودًا سالبًا", () => {
    expect(() => run(d => closeCashSession(d, { countedCash: -5 }))).toThrow(
      /سالبًا/
    );
    expect(activeSession(db)).toBeDefined();
  });

  it("يسمح بفتح وردية جديدة بعد الإقفال", () => {
    run(d => closeCashSession(d, { countedCash: 900 }));
    expect(activeSession(db)).toBeUndefined();
    const next = run(d => openCashSession(d, { openingFloat: 900 }));
    expect(next.no).toBe(702);
  });
});

describe("ملخص الوردية", () => {
  it("يعرض الأرقام المحورية بعد الإقفال", () => {
    run(d => {
      openCashSession(d, { openingFloat: 300, openedBy: "عمار" });
      postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] });
      addExpense(d, { category: "other", description: "نقل", amount: 40 });
      closeCashSession(d, { countedCash: 455 });
    });
    const s = sessionSummary(db, db.cashSessions[0]);
    expect(s.openingFloat).toBe(300);
    expect(s.inflow).toBe(200);
    expect(s.outflow).toBe(40);
    // 300 + 200 - 40 = 460 متوقع، والمعدود 455 أي عجز 5
    expect(s.expected).toBe(460);
    expect(s.counted).toBe(455);
    expect(s.variance).toBe(-5);
    expect(s.status).toBe("closed");
  });
});
