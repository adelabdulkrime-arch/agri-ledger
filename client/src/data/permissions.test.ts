// اختبارات إنفاذ الصلاحيات وتسجيل التدقيق على العمليات الفعلية.
//
// الغرض: ألا تبقى الصلاحيات وعدًا على الشاشة. البائع يبيع ولا يلغي،
// وكل عملية تترك أثرًا باسم من نفّذها.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  addExpense,
  collectFromCustomer,
  createCustomer,
  createSupplier,
  payPurchase,
  postPurchase,
  postSale,
  postStockTake,
  voidPurchase,
} from "./operations";
import { createUser, login, logout } from "./users";
import { closePeriod } from "./ledger";
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

/** يجهّز مخزونًا قبل إنشاء المستخدمين، فلا تعترض الصلاحيات التهيئة. */
beforeEach(() => {
  db = emptyState();
  db.products = [product(1)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "credit",
      lines: [{ productId: 1, qty: 100, unitCost: 60 }],
    });
    createCustomer(d, { name: "أحمد", terms: "credit" });
  });
});

describe("بلا مستخدمين يُسمح بكل شيء", () => {
  it("محل بمشغّل واحد لا يُجبَر على تسجيل دخول", () => {
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] }))
    ).not.toThrow();
    expect(() => run(d => postStockTake(d, [{ productId: 1, countedQty: 5 }])))
      .not.toThrow();
  });
});

describe("البائع يبيع فقط", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
    });
  });

  it("يستطيع البيع والتحصيل", () => {
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] }))
    ).not.toThrow();
    run(d =>
      postSale(d, {
        customerId: 1,
        terms: "credit",
        lines: [{ productId: 1, qty: 2, price: 100 }],
      })
    );
    expect(() => run(d => collectFromCustomer(d, 1, 50))).not.toThrow();
  });

  it("يُمنع من إلغاء الفواتير", () => {
    expect(() => run(d => voidPurchase(d, 5001))).toThrow(/إلغاء الفواتير/);
    // الفاتورة لم تُلغَ فعلًا.
    expect(db.purchases[0].status).toBe("confirmed");
  });

  it("يُمنع من الجرد", () => {
    expect(() =>
      run(d => postStockTake(d, [{ productId: 1, countedQty: 5 }]))
    ).toThrow(/الجرد/);
    expect(db.products[0].stock).toBe(100);
  });

  it("يُمنع من الشراء وتسجيل المصروفات", () => {
    expect(() =>
      run(d =>
        postPurchase(d, {
          supplierId: 1,
          paymentMethod: "cash",
          lines: [{ productId: 1, qty: 1, unitCost: 60 }],
        })
      )
    ).toThrow(/الشراء/);
    expect(() =>
      run(d =>
        addExpense(d, { category: "rent", description: "إيجار", amount: 100 })
      )
    ).toThrow(/الشراء/);
    expect(() => run(d => payPurchase(d, 5001, 100))).toThrow(/الشراء/);
  });
});

describe("المالك يملك كل شيء", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      login(d, "1111");
    });
  });

  it("يلغي ويجرد ويشتري", () => {
    // الإلغاء أولًا: إنقاص الرصيد بالجرد يمنع إلغاء فاتورة وردت به.
    expect(() => run(d => voidPurchase(d, 5001))).not.toThrow();
    expect(() =>
      run(d => postStockTake(d, [{ productId: 1, countedQty: 0 }]))
    ).not.toThrow();
  });
});

describe("بوجود مستخدمين وبلا دخول", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      login(d, "1111");
      logout(d);
    });
  });

  it("يُمنع كل شيء حتى تسجيل الدخول", () => {
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] }))
    ).toThrow(/سجّل الدخول/);
  });
});

describe("إقفال الفترات للمالك وحده", () => {
  it("المدير يُمنع والمالك يُسمح له", () => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      createUser(d, { name: "خالد", role: "manager", pin: "3333" });
      login(d, "3333");
    });
    expect(() =>
      run(d => closePeriod(d, "2026-01-01", "2026-01-31", "إقفال يناير"))
    ).toThrow(/إقفال الفترات/);

    run(d => login(d, "1111"));
    expect(() =>
      run(d => closePeriod(d, "2026-01-01", "2026-01-31", "إقفال يناير"))
    ).not.toThrow();
    expect(db.closedPeriods).toHaveLength(1);
  });
});

describe("سجل التدقيق يمتلئ من العمليات الحقيقية", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      login(d, "1111");
    });
  });

  it("كل عملية تترك أثرًا باسم منفّذها", () => {
    const before = (db.auditLog || []).length;
    run(d => postSale(d, { lines: [{ productId: 1, qty: 1, price: 100 }] }));

    const log = db.auditLog!;
    expect(log.length).toBeGreaterThan(before);
    const last = log.at(-1)!;
    expect(last.userName).toBe("عمار");
    expect(last.action).toBe("sell");
    expect(last.description).toContain("بيع");
  });

  it("يسجّل الشراء والجرد بأسمائهما", () => {
    run(d => {
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 5, unitCost: 60 }],
      });
      postStockTake(d, [{ productId: 1, countedQty: 100 }]);
    });

    const actions = db.auditLog!.map(e => e.action);
    expect(actions).toContain("purchase");
    expect(actions).toContain("stockTake");
  });

  it("المحاولة الفاشلة لا تترك أثرًا زائفًا", () => {
    run(d => {
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
    });
    const before = db.auditLog!.length;
    expect(() => run(d => voidPurchase(d, 5001))).toThrow();
    // العملية رُفضت فلم تُحفظ الحالة أصلًا.
    expect(db.auditLog!.length).toBe(before);
  });
});
