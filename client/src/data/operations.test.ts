// اختبارات دورة الشراء والمخزون والتكلفة والربحية.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState, migrate, transact, SCHEMA_VERSION } from "./store";
import {
  OperationError,
  buildPurchaseDraft,
  createSupplier,
  editPurchase,
  inventoryValue,
  payPurchase,
  payablesTotal,
  postPurchase,
  postSale,
  profitSummary,
  purchasesTotal,
  supplierStatement,
  supplierTotals,
  updateSupplier,
  voidPurchase,
  weightedAverage,
} from "./operations";
import type { DbState, Product } from "./types";

function product(id: number, name: string, stock = 0, price = 100): Product {
  return {
    id,
    name,
    category: "أسمدة",
    unit: "كيس",
    stock,
    price,
    color: "leaf",
    barcode: `62800000000${id}`,
    avgCost: 0,
    lastCost: 0,
  };
}

let db: DbState;

beforeEach(() => {
  db = emptyState();
  db.products = [product(1, "سماد NPK", 0, 100), product(2, "مبيد فطري", 0, 80)];
});

/** يشغّل عملية دون المرور على localStorage (غير متاح في بيئة node). */
function run<T>(fn: (draft: DbState) => T): T {
  let out!: T;
  const draft: DbState = JSON.parse(JSON.stringify(db));
  out = fn(draft);
  db = draft;
  return out;
}

describe("1. الموردون", () => {
  it("ينشئ موردًا ببيانات كاملة", () => {
    const s = run(d =>
      createSupplier(d, {
        name: "شركة الوادي",
        phone: "770000000",
        email: "a@b.c",
        address: "صنعاء",
        taxNumber: "TX1",
        notes: "مورد أسمدة",
      })
    );
    expect(s.id).toBe(1);
    expect(s.name).toBe("شركة الوادي");
    expect(s.status).toBe("active");
    expect(db.suppliers).toHaveLength(1);
  });

  it("يرفض مورداً بلا اسم أو باسم مكرر", () => {
    run(d => createSupplier(d, { name: "الوادي" }));
    expect(() => run(d => createSupplier(d, { name: "  " }))).toThrow(
      OperationError
    );
    expect(() => run(d => createSupplier(d, { name: "الوادي" }))).toThrow(
      /نفس الاسم/
    );
  });

  it("يعدّل المورد ويحدّث اسمه داخل الفواتير", () => {
    run(d => createSupplier(d, { name: "الوادي" }));
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 5, unitCost: 50 }],
      })
    );
    run(d => updateSupplier(d, 1, { name: "الوادي الأخضر", phone: "771" }));
    expect(db.suppliers[0].phone).toBe("771");
    expect(db.purchases[0].supplierName).toBe("الوادي الأخضر");
  });
});

describe("2-5. فاتورة الشراء والمخزون والتكلفة", () => {
  beforeEach(() => {
    run(d => createSupplier(d, { name: "الوادي" }));
  });

  it("ينشئ فاتورة شراء ويحسب الإجمالي", () => {
    const p = run(d =>
      postPurchase(d, {
        supplierId: 1,
        supplierInvoiceNo: "INV-77",
        paymentMethod: "cash",
        lines: [
          { productId: 1, qty: 10, unitCost: 50 },
          { productId: 2, qty: 5, unitCost: 20, discount: 10, tax: 5 },
        ],
      })
    );
    // 10×50 = 500، و 5×20 = 100 ناقص خصم 10 زائد ضريبة 5 = 95
    expect(p.subtotal).toBe(600);
    expect(p.discount).toBe(10);
    expect(p.tax).toBe(5);
    expect(p.total).toBe(595);
    expect(p.no).toBe(5001);
  });

  it("يزيد المخزون بعد الشراء", () => {
    db.products[0].stock = 10;
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 5, unitCost: 50 }],
      })
    );
    expect(db.products[0].stock).toBe(15);
  });

  it("يسجل تكلفة الشراء في المنتج وحركة المخزون", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    expect(db.products[0].lastCost).toBe(50);
    expect(db.products[0].avgCost).toBe(50);
    const move = db.stockMoves[0];
    expect(move.type).toBe("PURCHASE");
    expect(move.qtyBefore).toBe(0);
    expect(move.qtyAfter).toBe(10);
    expect(move.unitCost).toBe(50);
    expect(move.refNo).toBe(5001);
  });

  it("يحسب متوسط التكلفة المرجح", () => {
    expect(weightedAverage(10, 50, 10, 60)).toBe(55);
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 60 }],
      })
    );
    expect(db.products[0].avgCost).toBe(55);
    expect(db.products[0].lastCost).toBe(60);
    expect(db.products[0].stock).toBe(20);
  });
});

describe("6-9. البيع وCOGS والربح", () => {
  beforeEach(() => {
    run(d => createSupplier(d, { name: "الوادي" }));
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 60 }],
      })
    );
  });

  it("يبيع منتجًا بعد شرائه ويخصم المخزون", () => {
    run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] })
    );
    expect(db.products[0].stock).toBe(16);
    expect(db.sales[0].no).toBe(1049);
  });

  it("يثبّت تكلفة الوحدة وقت البيع ويحسب COGS", () => {
    const sale = run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] })
    );
    expect(sale.lines[0].unitCost).toBe(55);
    expect(sale.cogs).toBe(220);
    expect(sale.total).toBe(400);
  });

  it("لا تتغير أرباح الماضي بعد شراء جديد بسعر مختلف", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] }));
    const before = profitSummary(db.sales);
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 100, unitCost: 999 }],
      })
    );
    expect(profitSummary(db.sales)).toEqual(before);
  });

  it("يحسب إجمالي الربح وهامش الربح", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 4, price: 100 }] }));
    const s = profitSummary(db.sales);
    expect(s.revenue).toBe(400);
    expect(s.cogs).toBe(220);
    expect(s.grossProfit).toBe(180);
    expect(s.margin).toBe(45);
  });

  it("لا يقسم على صفر عند غياب المبيعات", () => {
    expect(profitSummary([]).margin).toBe(0);
  });

  it("يمنع البيع بأكثر من الرصيد", () => {
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 999, price: 100 }] }))
    ).toThrow(/الرصيد المتاح/);
  });
});

describe("10-12. طرق الدفع", () => {
  beforeEach(() => {
    run(d => createSupplier(d, { name: "الوادي" }));
  });

  const lines = [{ productId: 1, qty: 10, unitCost: 1000 }];

  it("فاتورة نقدية: المدفوع كامل والرصيد صفر", () => {
    const p = run(d =>
      postPurchase(d, { supplierId: 1, paymentMethod: "cash", lines })
    );
    expect(p.paid).toBe(10000);
    expect(p.balance).toBe(0);
    expect(supplierTotals(db, 1).balance).toBe(0);
  });

  it("فاتورة آجلة: المدفوع صفر والرصيد كامل", () => {
    const p = run(d =>
      postPurchase(d, { supplierId: 1, paymentMethod: "credit", lines })
    );
    expect(p.paid).toBe(0);
    expect(p.balance).toBe(10000);
    expect(supplierTotals(db, 1).balance).toBe(10000);
  });

  it("فاتورة جزئية: 10000 بدفع 4000 يتبقى 6000", () => {
    const p = run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "partial",
        paid: 4000,
        lines,
      })
    );
    expect(p.paid).toBe(4000);
    expect(p.balance).toBe(6000);
    expect(supplierTotals(db, 1).balance).toBe(6000);
  });

  it("يرفض مدفوعًا أكبر من الإجمالي", () => {
    expect(() =>
      run(d =>
        postPurchase(d, {
          supplierId: 1,
          paymentMethod: "partial",
          paid: 99999,
          lines,
        })
      )
    ).toThrow(/أكبر من إجمالي/);
  });

  it("يسجل دفعة لاحقة على فاتورة آجلة", () => {
    run(d => postPurchase(d, { supplierId: 1, paymentMethod: "credit", lines }));
    run(d => payPurchase(d, 5001, 4000));
    expect(db.purchases[0].paid).toBe(4000);
    expect(db.purchases[0].balance).toBe(6000);
    expect(supplierTotals(db, 1).balance).toBe(6000);
    expect(() => run(d => payPurchase(d, 5001, 99999))).toThrow(/أكبر من/);
  });
});

describe("13-15. التعديل والإلغاء وعكس المخزون", () => {
  beforeEach(() => {
    run(d => createSupplier(d, { name: "الوادي" }));
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
  });

  it("يعدّل الفاتورة فيعكس القديمة ويطبق الجديدة", () => {
    expect(db.products[0].stock).toBe(10);
    run(d =>
      editPurchase(d, 5001, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 7, unitCost: 50 }],
      })
    );
    expect(db.products[0].stock).toBe(7);
    expect(db.purchases.find(p => p.no === 5001)!.status).toBe("void");
    expect(db.purchases.find(p => p.status === "confirmed")!.lines[0].qty).toBe(
      7
    );
  });

  it("يلغي الفاتورة ويعكس المخزون", () => {
    run(d => voidHelper(d));
    expect(db.products[0].stock).toBe(0);
    expect(db.purchases[0].status).toBe("void");
    const reversal = db.stockMoves.find(m => m.type === "PURCHASE_VOID");
    expect(reversal?.qty).toBe(-10);
    expect(reversal?.qtyAfter).toBe(0);
  });

  it("يمنع الإلغاء إذا بيعت الكمية", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 6, price: 100 }] }));
    expect(() => run(d => voidHelper(d))).toThrow(/لا يمكن الإلغاء/);
    // المخزون يبقى كما هو بعد فشل الإلغاء.
    expect(db.products[0].stock).toBe(4);
  });

  it("يصفّر أثر الفاتورة الملغاة على حساب المورد", () => {
    run(d => voidHelper(d));
    expect(supplierTotals(db, 1).balance).toBe(0);
  });
});

function voidHelper(d: DbState) {
  return voidPurchase(d, 5001);
}

describe("16. كشف حساب المورد", () => {
  it("يعرض مدين ودائن ورصيدًا تراكميًا صحيحًا", () => {
    run(d => createSupplier(d, { name: "الوادي" }));
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "partial",
        paid: 4000,
        lines: [{ productId: 1, qty: 10, unitCost: 1000 }],
      })
    );
    const rows = supplierStatement(db, 1);
    expect(rows).toHaveLength(2);
    expect(rows[0].credit).toBe(10000);
    expect(rows[0].balance).toBe(10000);
    expect(rows[1].debit).toBe(4000);
    expect(rows[1].balance).toBe(6000);
  });
});

describe("17-18. المخطط والنسخ الاحتياطي", () => {
  it("يرقّي بيانات قديمة دون فقدانها", () => {
    const legacy = {
      version: 1,
      products: [{ id: 1, name: "سماد", stock: 5, price: 100 }],
      sales: [
        { no: 1049, at: "2026-01-01", customer: "أحمد", total: 100, lines: [] },
      ],
    };
    const out = migrate(legacy);
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.products[0].avgCost).toBe(0);
    expect(out.sales[0].cogs).toBe(0);
    expect(out.suppliers).toEqual([]);
    expect(out.purchases).toEqual([]);
    expect(out.stockMoves).toEqual([]);
  });

  it("يحافظ على كل الجداول بعد تصدير واستيراد", () => {
    run(d => createSupplier(d, { name: "الوادي" }));
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    run(d => postSale(d, { lines: [{ productId: 1, qty: 2, price: 100 }] }));

    const exported = JSON.parse(JSON.stringify(db));
    const restored = migrate(exported);
    expect(restored.suppliers).toHaveLength(1);
    expect(restored.purchases).toHaveLength(1);
    expect(restored.sales).toHaveLength(1);
    expect(restored.stockMoves).toHaveLength(2);
    expect(restored.supplierLedger).toHaveLength(1);
    expect(restored.products[0].avgCost).toBe(50);
    expect(profitSummary(restored.sales).grossProfit).toBe(100);
  });
});

describe("19-22. التحقق والذرّية والمؤشرات", () => {
  beforeEach(() => {
    run(d => createSupplier(d, { name: "الوادي" }));
  });

  it("يرفض فاتورة بلا مورد أو بلا أصناف", () => {
    expect(() =>
      run(d =>
        postPurchase(d, { supplierId: 99, paymentMethod: "cash", lines: [] })
      )
    ).toThrow(/اختر موردًا/);
    expect(() =>
      run(d =>
        postPurchase(d, { supplierId: 1, paymentMethod: "cash", lines: [] })
      )
    ).toThrow(/صنفًا واحدًا/);
  });

  it("يرفض الكمية الصفرية أو السالبة والسعر السالب", () => {
    for (const bad of [0, -3]) {
      expect(() =>
        run(d =>
          postPurchase(d, {
            supplierId: 1,
            paymentMethod: "cash",
            lines: [{ productId: 1, qty: bad, unitCost: 50 }],
          })
        )
      ).toThrow(/الكمية/);
    }
    expect(() =>
      run(d =>
        postPurchase(d, {
          supplierId: 1,
          paymentMethod: "cash",
          lines: [{ productId: 1, qty: 1, unitCost: -5 }],
        })
      )
    ).toThrow(/سالب/);
  });

  it("يرفض رقم فاتورة مورد مكرر لنفس المورد", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        supplierInvoiceNo: "INV-1",
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 1, unitCost: 50 }],
      })
    );
    expect(() =>
      run(d =>
        postPurchase(d, {
          supplierId: 1,
          supplierInvoiceNo: "inv-1",
          paymentMethod: "cash",
          lines: [{ productId: 1, qty: 1, unitCost: 50 }],
        })
      )
    ).toThrow(/مسجل من قبل/);
  });

  it("لا يحدث المخزون مرتين لنفس الفاتورة", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    expect(db.products[0].stock).toBe(10);
    expect(db.stockMoves.filter(m => m.refNo === 5001)).toHaveLength(1);
  });

  it("لا ينشئ فاتورة جزئية عند فشل التحقق", () => {
    const before = JSON.parse(JSON.stringify(db));
    expect(() =>
      run(d =>
        postPurchase(d, {
          supplierId: 1,
          paymentMethod: "cash",
          lines: [
            { productId: 1, qty: 5, unitCost: 50 },
            { productId: 999, qty: 5, unitCost: 50 },
          ],
        })
      )
    ).toThrow();
    // الفشل قبل أي كتابة: لا فاتورة ولا حركة ولا تغير مخزون.
    expect(db.purchases).toEqual(before.purchases);
    expect(db.stockMoves).toEqual(before.stockMoves);
    expect(db.products[0].stock).toBe(before.products[0].stock);
  });

  it("transact لا يحفظ شيئًا عند رمي خطأ", () => {
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const start = emptyState();
    start.products = [product(1, "سماد", 5)];
    expect(() =>
      transact(start, draft => {
        draft.products[0].stock = 999;
        throw new OperationError("فشل");
      })
    ).toThrow();
    expect(store["agri-db"]).toBeUndefined();
    expect(start.products[0].stock).toBe(5);
  });

  it("يحسب مؤشرات المشتريات وقيمة المخزون والمستحقات", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 2, qty: 5, unitCost: 20 }],
      })
    );
    expect(purchasesTotal(db.purchases)).toBe(600);
    expect(inventoryValue(db)).toBe(600);
    expect(payablesTotal(db)).toBe(500);
  });

  it("يستبعد الفواتير الملغاة من المؤشرات", () => {
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "credit",
        lines: [{ productId: 1, qty: 10, unitCost: 50 }],
      })
    );
    run(d => voidHelper(d));
    expect(purchasesTotal(db.purchases)).toBe(0);
    expect(payablesTotal(db)).toBe(0);
  });
});

describe("تحقق إضافي: خصم أكبر من قيمة الصنف", () => {
  it("يرفض الخصم الزائد", () => {
    run(d => createSupplier(d, { name: "الوادي" }));
    expect(() =>
      run(d =>
        buildPurchaseDraft(d, {
          supplierId: 1,
          paymentMethod: "cash",
          lines: [{ productId: 1, qty: 2, unitCost: 10, discount: 999 }],
        })
      )
    ).toThrow(/الخصم أكبر/);
  });
});
