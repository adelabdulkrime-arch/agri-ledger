// اختبارات خصم وضريبة فاتورة البيع، وترحيل الضريبة كالتزام لا كإيراد.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState, migrate, SCHEMA_VERSION } from "./store";
import {
  createSupplier,
  postPurchase,
  postSale,
  postSaleReturn,
  profitSummary,
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
      paymentMethod: "cash",
      lines: [{ productId: 1, qty: 50, unitCost: 60 }],
    });
  });
});

describe("خصم السطر", () => {
  it("ينقص صافي السطر والإجمالي", () => {
    const sale = run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 5, price: 100, discount: 50 }],
      })
    );
    // 5×100 = 500 ناقص خصم 50
    expect(sale.subtotal).toBe(500);
    expect(sale.discount).toBe(50);
    expect(sale.total).toBe(450);
    expect(sale.lines[0].total).toBe(450);
  });

  it("يرفض الخصم السالب أو الأكبر من قيمة الصنف", () => {
    expect(() =>
      run(d =>
        postSale(d, {
          lines: [{ productId: 1, qty: 2, price: 100, discount: -5 }],
        })
      )
    ).toThrow(/سالبة/);
    expect(() =>
      run(d =>
        postSale(d, {
          lines: [{ productId: 1, qty: 2, price: 100, discount: 999 }],
        })
      )
    ).toThrow(/الخصم أكبر/);
    expect(db.sales).toHaveLength(0);
  });
});

describe("خصم الفاتورة", () => {
  it("يُضاف فوق خصومات السطور", () => {
    const sale = run(d =>
      postSale(d, {
        invoiceDiscount: 30,
        lines: [{ productId: 1, qty: 4, price: 100, discount: 20 }],
      })
    );
    // 400 ناقص 20 خصم سطر ناقص 30 خصم فاتورة
    expect(sale.subtotal).toBe(400);
    expect(sale.discount).toBe(50);
    expect(sale.total).toBe(350);
  });

  it("يُرفض إن تجاوز قيمة الفاتورة", () => {
    expect(() =>
      run(d =>
        postSale(d, {
          invoiceDiscount: 9999,
          lines: [{ productId: 1, qty: 2, price: 100 }],
        })
      )
    ).toThrow(/أكبر من قيمتها/);
  });
});

describe("الضريبة", () => {
  it("تُضاف للإجمالي وتُرحَّل التزامًا لا إيرادًا", () => {
    const sale = run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 4, price: 100, tax: 60 }],
      })
    );
    expect(sale.tax).toBe(60);
    expect(sale.total).toBe(460);

    // الإيراد بلا ضريبة، والضريبة في حسابها المستقل.
    expect(accountBalance(db, ACC.sales)).toBe(400);
    expect(accountBalance(db, ACC.vatPayable)).toBe(60);
    expect(accountBalance(db, ACC.cash)).toBe(460 - 3000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("بلا ضريبة لا يُنشأ سطر ضريبة في القيد", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] }));
    expect(accountBalance(db, ACC.vatPayable)).toBe(0);
    const saleEntry = db.journal.find(j => j.source === "sale");
    expect(saleEntry!.lines).toHaveLength(2);
  });

  it("الخصم والضريبة معًا يتوازنان في الميزان", () => {
    run(d =>
      postSale(d, {
        invoiceDiscount: 25,
        lines: [{ productId: 1, qty: 6, price: 100, discount: 40, tax: 45 }],
      })
    );
    // 600 - 40 - 25 + 45 = 580
    expect(db.sales[0].total).toBe(580);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("المرتجع يرد الصافي لا الإجمالي", () => {
  it("يحترم خصم السطر عند الإرجاع", () => {
    run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 10, price: 100, discount: 200 }],
      })
    );
    // الصافي 800 لعشر قطع، أي 80 للقطعة.
    const ret = run(d =>
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 4 }] })
    );
    // لولا الإصلاح لأعاد 400 بدل 320.
    expect(ret.total).toBe(320);
    expect(ret.lines[0].unitPrice).toBe(80);
  });

  it("الميزان يبقى متوازنًا بعد مرتجع على فاتورة مخصومة", () => {
    run(d => {
      postSale(d, {
        lines: [{ productId: 1, qty: 10, price: 100, discount: 200 }],
      });
      postSaleReturn(d, { refNo: 1049, lines: [{ productId: 1, qty: 4 }] });
    });
    expect(postedTrialBalance(db).balanced).toBe(true);
  });
});

describe("ترقية المخطط إلى 11", () => {
  it("تُبقي إجماليات الفواتير القديمة كما هي", () => {
    const legacy = {
      version: 10,
      products: [{ id: 1, name: "سماد", stock: 5, price: 100 }],
      sales: [
        {
          no: 1049,
          at: "2026-01-01",
          customer: "أحمد",
          total: 300,
          cogs: 150,
          lines: [
            { id: 1, name: "سماد", unit: "كيس", qty: 3, price: 100, unitCost: 50 },
          ],
        },
      ],
    };
    const out = migrate(legacy);
    expect(out.version).toBe(SCHEMA_VERSION);
    const sale = out.sales[0];
    // الإجمالي لم يتغير، والخصم والضريبة صفر.
    expect(sale.total).toBe(300);
    expect(sale.discount).toBe(0);
    expect(sale.tax).toBe(0);
    expect(sale.subtotal).toBe(300);
    expect(sale.lines[0].total).toBe(300);
  });

  it("الربح محسوب من الصافي بعد الخصم", () => {
    run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 5, price: 100, discount: 100 }],
      })
    );
    const p = profitSummary(db.sales);
    // مبيعات 400 بعد الخصم، تكلفة 5×60 = 300.
    expect(p.revenue).toBe(400);
    expect(p.cogs).toBe(300);
    expect(p.grossProfit).toBe(100);
  });
});
