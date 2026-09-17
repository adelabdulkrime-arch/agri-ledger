// اختبارات مستندات ما قبل البيع.
// الغرض الأهم: لا شيء يتحرك محاسبيًا قبل التحويل إلى فاتورة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  OperationError,
  createSupplier,
  postPurchase,
  postSale,
} from "./operations";
import { ACC, accountBalance } from "./ledger";
import {
  DEFAULT_VALID_DAYS,
  cancelDraft,
  createDraft,
  draftSummary,
  draftToSaleInput,
  draftsOf,
  findDraft,
  isExpired,
  markConverted,
  removeDraft,
} from "./drafts";
import type { DbState, Product } from "./types";

function product(id: number, price = 100): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price,
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
  db.products = [product(1), product(2, 50)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "cash",
      lines: [
        { productId: 1, qty: 100, unitCost: 60 },
        { productId: 2, qty: 100, unitCost: 30 },
      ],
    });
  });
});

describe("المستند لا يمسّ المخزون ولا الدفاتر", () => {
  it("عرض السعر لا يخصم شيئًا", () => {
    const stockBefore = db.products[0].stock;
    const journalBefore = db.journal.length;
    const inventoryBefore = accountBalance(db, ACC.inventory);

    run(d =>
      createDraft(d, {
        kind: "quotation",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 10 }],
      })
    );

    expect(db.products[0].stock).toBe(stockBefore);
    expect(db.journal).toHaveLength(journalBefore);
    expect(accountBalance(db, ACC.inventory)).toBe(inventoryBefore);
    expect(db.sales).toHaveLength(0);
  });

  it("يسمح بعرض سعر لكمية أكبر من الرصيد", () => {
    // العرض قد يسبق وصول البضاعة؛ منعه يمنع بيعًا مشروعًا.
    const draft = run(d =>
      createDraft(d, {
        kind: "quotation",
        lines: [{ productId: 1, qty: 5000 }],
      })
    );
    expect(draft.total).toBe(500000);
  });

  it("يحسب الإجماليات بالخصم والضريبة", () => {
    const draft = run(d =>
      createDraft(d, {
        kind: "order",
        invoiceDiscount: 30,
        lines: [
          { productId: 1, qty: 4, discount: 20, tax: 15 },
          { productId: 2, qty: 2 },
        ],
      })
    );
    // 400 + 100 = 500 وعاءً، ناقص 20 سطرًا و30 مستندًا، زائد 15 ضريبة.
    expect(draft.subtotal).toBe(500);
    expect(draft.discount).toBe(50);
    expect(draft.tax).toBe(15);
    expect(draft.total).toBe(465);
  });

  it("يرفض الكمية والخصم غير الصحيحين", () => {
    expect(() =>
      run(d => createDraft(d, { kind: "order", lines: [{ productId: 1, qty: 0 }] }))
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      run(d =>
        createDraft(d, {
          kind: "order",
          lines: [{ productId: 1, qty: 1, discount: 9999 }],
        })
      )
    ).toThrow(/الخصم أكبر/);
    expect(() =>
      run(d => createDraft(d, { kind: "order", lines: [] }))
    ).toThrow(/صنفًا واحدًا/);
  });
});

describe("الترقيم المستقل لكل نوع", () => {
  it("لكل نوع سلسلته", () => {
    const q = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] })
    );
    const o = run(d =>
      createDraft(d, { kind: "order", lines: [{ productId: 1, qty: 1 }] })
    );
    const p = run(d =>
      createDraft(d, { kind: "parked", lines: [{ productId: 1, qty: 1 }] })
    );
    expect(q.no).toBe(2000);
    expect(o.no).toBe(3000);
    expect(p.no).toBe(6000);

    const q2 = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] })
    );
    // ترقيم عرض السعر لا يتأثر بوجود أمر بيع.
    expect(q2.no).toBe(2001);
  });
});

describe("صلاحية عرض السعر", () => {
  it("يضبط صلاحية افتراضية للعرض وحده", () => {
    const q = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] })
    );
    const o = run(d =>
      createDraft(d, { kind: "order", lines: [{ productId: 1, qty: 1 }] })
    );
    expect(q.validUntil).toBeTruthy();
    expect(o.validUntil).toBeUndefined();

    const days = Math.round(
      (new Date(q.validUntil!).getTime() - new Date(q.at).getTime()) / 86400000
    );
    expect(days).toBe(DEFAULT_VALID_DAYS);
  });

  it("يكشف العرض المنتهي", () => {
    const q = run(d =>
      createDraft(d, {
        kind: "quotation",
        validUntil: new Date(Date.now() - 86400000).toISOString(),
        lines: [{ productId: 1, qty: 1 }],
      })
    );
    expect(isExpired(q)).toBe(true);
    // المحوَّل لا يُوصف بالانتهاء.
    q.status = "converted";
    expect(isExpired(q)).toBe(false);
  });
});

describe("سند التسليم", () => {
  it("يُقبل بلا فاتورة: تسليم قبل الفوترة يُخرج المخزون", () => {
    // صار السند نوعين: مستقل يُخرج البضاعة، ومرتبط بفاتورة يوثّق فقط.
    const stockBefore = db.products[0].stock;
    run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 1 }],
      })
    );
    expect(db.products[0].stock).toBe(stockBefore - 1);
  });

  it("يرفض الربط بفاتورة غير موجودة", () => {
    expect(() =>
      run(d =>
        createDraft(d, {
          kind: "delivery",
          saleNo: 9999,
          lines: [{ productId: 1, qty: 1 }],
        })
      )
    ).toThrow(/الفاتورة غير موجودة/);
  });

  it("لا يخصم المخزون مرة ثانية", () => {
    const sale = run(d =>
      postSale(d, { lines: [{ productId: 1, qty: 5, price: 100 }] })
    );
    const stockAfterSale = db.products[0].stock;

    run(d =>
      createDraft(d, {
        kind: "delivery",
        saleNo: sale.no,
        lines: [{ productId: 1, qty: 5 }],
      })
    );
    // الفاتورة خصمت أصلًا؛ السند توثيق تسليم لا حركة مخزون.
    expect(db.products[0].stock).toBe(stockAfterSale);
  });
});

describe("التحويل إلى فاتورة", () => {
  it("يحوّل العرض إلى فاتورة بيع حقيقية", () => {
    const q = run(d =>
      createDraft(d, {
        kind: "quotation",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 3, tax: 45 }],
      })
    );

    const sale = run(d => {
      const created = postSale(d, draftToSaleInput(q));
      markConverted(d, "quotation", q.no, created.no);
      return created;
    });

    expect(sale.total).toBe(345);
    expect(sale.tax).toBe(45);
    // الآن فقط تحرك المخزون.
    expect(db.products[0].stock).toBe(97);

    const stored = findDraft(db, "quotation", q.no)!;
    expect(stored.status).toBe("converted");
    expect(stored.saleNo).toBe(sale.no);
    expect(stored.convertedAt).toBeTruthy();
  });

  it("يحافظ على خصم المستند عند التحويل", () => {
    const q = run(d =>
      createDraft(d, {
        kind: "order",
        invoiceDiscount: 50,
        lines: [{ productId: 1, qty: 4, discount: 20 }],
      })
    );
    const input = draftToSaleInput(q);
    expect(input.invoiceDiscount).toBe(50);

    const sale = run(d => postSale(d, input));
    // 400 ناقص 20 سطرًا ناقص 50 مستندًا.
    expect(sale.total).toBe(330);
  });

  it("يمنع التحويل مرتين", () => {
    const q = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 2 }] })
    );
    run(d => markConverted(d, "quotation", q.no, 1049));
    expect(() =>
      run(d => markConverted(d, "quotation", q.no, 1050))
    ).toThrow(/من قبل/);
  });

  it("يمنع تحويل الملغى", () => {
    const q = run(d =>
      createDraft(d, { kind: "order", lines: [{ productId: 1, qty: 2 }] })
    );
    run(d => cancelDraft(d, "order", q.no, "اعتذر العميل"));
    expect(() => run(d => markConverted(d, "order", q.no, 1049))).toThrow(
      /ملغى/
    );
  });
});

describe("الإلغاء والحذف", () => {
  it("الإلغاء يحفظ السبب ولا يحذف المستند", () => {
    const q = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] })
    );
    run(d => cancelDraft(d, "quotation", q.no, "سعر أفضل من منافس"));
    const stored = findDraft(db, "quotation", q.no)!;
    expect(stored.status).toBe("cancelled");
    expect(stored.note).toContain("منافس");
  });

  it("لا يُلغى ولا يُحذف ما صار فاتورة", () => {
    const q = run(d =>
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] })
    );
    run(d => markConverted(d, "quotation", q.no, 1049));
    expect(() => run(d => cancelDraft(d, "quotation", q.no))).toThrow(
      /مرتجع البيع/
    );
    expect(() => run(d => removeDraft(d, "quotation", q.no))).toThrow(
      /صار فاتورة/
    );
  });

  it("الفاتورة المعلّقة تُحذف بعد استعادتها", () => {
    const p = run(d =>
      createDraft(d, { kind: "parked", lines: [{ productId: 1, qty: 2 }] })
    );
    run(d => removeDraft(d, "parked", p.no));
    expect(draftsOf(db, "parked")).toHaveLength(0);
    expect(() => run(d => removeDraft(d, "parked", p.no))).toThrow(
      OperationError
    );
  });
});

describe("التصفية والملخّص", () => {
  beforeEach(() => {
    run(d => {
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 1 }] });
      createDraft(d, { kind: "quotation", lines: [{ productId: 1, qty: 2 }] });
      createDraft(d, { kind: "order", lines: [{ productId: 2, qty: 4 }] });
    });
  });

  it("يصفّي بالنوع والحالة", () => {
    expect(draftsOf(db)).toHaveLength(3);
    expect(draftsOf(db, "quotation")).toHaveLength(2);
    expect(draftsOf(db, "order")).toHaveLength(1);
    expect(draftsOf(db, "quotation", "open")).toHaveLength(2);
    expect(draftsOf(db, "quotation", "converted")).toHaveLength(0);
  });

  it("الملخّص يعدّ المفتوح وقيمته", () => {
    const s = draftSummary(db, "quotation");
    expect(s.total).toBe(2);
    expect(s.open).toBe(2);
    // 100 + 200
    expect(s.openValue).toBe(300);
    expect(s.converted).toBe(0);
  });

  it("الملخّص يتابع التحويل", () => {
    const first = draftsOf(db, "quotation")[0];
    run(d => markConverted(d, "quotation", first.no, 1049));
    const s = draftSummary(db, "quotation");
    expect(s.converted).toBe(1);
    expect(s.open).toBe(1);
  });
});
