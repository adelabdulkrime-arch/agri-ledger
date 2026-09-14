// اختبارات الإقرار الضريبي: المخرجات، المدخلات، والفرق المستحق للهيئة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createSupplier,
  postPurchase,
  postPurchaseReturn,
  postSale,
} from "./operations";
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
import { monthPeriod, quarterPeriod, vatReturn } from "./vat";
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

/** فترة واسعة تلتقط كل ما سُجّل في الاختبار. */
function wide() {
  return { from: new Date(2000, 0, 1), to: new Date(2100, 0, 1) };
}

beforeEach(() => {
  db = emptyState();
  db.products = [product(1)];
  run(d => createSupplier(d, { name: "الوادي" }));
});

describe("محل غير مسجَّل في الضريبة", () => {
  beforeEach(() => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50, tax: 75 }],
      })
    );
  });

  it("ضريبة الشراء تبقى في تكلفة المخزون كما كانت", () => {
    // 500 + 75 ضريبة = 575 على عشر وحدات.
    expect(db.products[0].avgCost).toBe(57.5);
    expect(accountBalance(db, ACC.inventory)).toBe(575);
    expect(accountBalance(db, ACC.vatInput)).toBe(0);
  });

  it("الإقرار يعرض المخرجات فقط بلا خصم مدخلات", () => {
    run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 2, price: 100, tax: 30 }] })
    );
    const r = vatReturn(db, wide());
    expect(r.registered).toBe(false);
    expect(r.outputVat).toBe(30);
    // غير المسجَّل لا يخصم ما دفعه للمورد.
    expect(r.inputVat).toBe(0);
    expect(r.net).toBe(30);
  });
});

describe("محل مسجَّل في الضريبة", () => {
  beforeEach(() => {
    db.settings = { ...db.settings!, vatRegistered: true, vatRate: 15 };
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50, tax: 75 }],
      })
    );
  });

  it("تُفصل ضريبة المدخلات عن تكلفة المخزون", () => {
    // التكلفة صافية: 500 على عشر وحدات.
    expect(db.products[0].avgCost).toBe(50);
    expect(accountBalance(db, ACC.inventory)).toBe(500);
    expect(accountBalance(db, ACC.vatInput)).toBe(75);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الإقرار يخصم المدخلات من المخرجات", () => {
    run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100, tax: 60 }] })
    );
    const r = vatReturn(db, wide());
    expect(r.registered).toBe(true);
    expect(r.outputVat).toBe(60);
    expect(r.inputVat).toBe(75);
    // المدخلات أكبر، فالرصيد مسترد لا مستحق.
    expect(r.net).toBe(-15);
  });

  it("وعاء الضريبة هو القيمة قبل الضريبة", () => {
    run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100, tax: 60 }] })
    );
    const r = vatReturn(db, wide());
    // المبيعات 400 + 60 ضريبة = 460 إجمالًا، والوعاء 400.
    expect(r.sales.base).toBe(400);
    expect(r.sales.vat).toBe(60);
    expect(r.purchases.base).toBe(500);
    expect(r.purchases.vat).toBe(75);
  });

  it("مرتجع الشراء يرد ضريبة المدخلات للهيئة", () => {
    run(d =>
      postPurchaseReturn(d, {
        refNo: 5001,
        lines: [{ productId: 1, qty: 4 }],
      })
    );
    // أُرجع 4 من 10: ضريبة 30 من أصل 75.
    expect(accountBalance(db, ACC.vatInput)).toBe(45);
    const r = vatReturn(db, wide());
    expect(r.purchaseReturns.vat).toBe(30);
    expect(r.inputVat).toBe(45);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("حدود الفترة", () => {
  beforeEach(() => {
    db.settings = { ...db.settings!, vatRegistered: true };
    // رصيد افتتاحي قديم حتى لا يفشل البيع بنفاد المخزون.
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        at: new Date(2025, 0, 1).toISOString(),
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 100, unitCost: 50 }],
      })
    );
  });

  it("يستبعد ما وقع خارج الشهر", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        at: new Date(2026, 2, 15).toISOString(),
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50, tax: 75 }],
      })
    );
    run(d =>
      postSale(d, {
        at: new Date(2026, 2, 20).toISOString(),
        lines: [{ productId: 1, qty: 2, price: 100, tax: 30 }],
      })
    );

    const march = vatReturn(db, monthPeriod(2026, 2));
    expect(march.outputVat).toBe(30);
    expect(march.inputVat).toBe(75);
    // شراء مارس وبيعه فقط؛ شراء 2025 خارج الفترة.
    expect(march.invoiceCount).toBe(2);

    // أبريل خالٍ تمامًا.
    const april = vatReturn(db, monthPeriod(2026, 3));
    expect(april.outputVat).toBe(0);
    expect(april.inputVat).toBe(0);
    expect(april.net).toBe(0);
    expect(april.invoiceCount).toBe(0);
  });

  it("الربع يشمل شهوره الثلاثة", () => {
    run(d =>
      postSale(d, {
        at: new Date(2026, 0, 5).toISOString(),
        lines: [{ productId: 1, qty: 1, price: 100, tax: 15 }],
      })
    );
    run(d =>
      postSale(d, {
        at: new Date(2026, 2, 28).toISOString(),
        lines: [{ productId: 1, qty: 1, price: 100, tax: 15 }],
      })
    );
    // الربع الأول: يناير إلى مارس.
    expect(vatReturn(db, quarterPeriod(2026, 1)).outputVat).toBe(30);
    expect(vatReturn(db, quarterPeriod(2026, 2)).outputVat).toBe(0);
  });
});

describe("بلا حركات", () => {
  it("إقرار صفري متوازن", () => {
    const r = vatReturn(db, wide());
    expect(r.outputVat).toBe(0);
    expect(r.inputVat).toBe(0);
    expect(r.net).toBe(0);
    expect(r.invoiceCount).toBe(0);
  });
});
