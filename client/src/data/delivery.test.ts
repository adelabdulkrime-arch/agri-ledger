// اختبارات سند التسليم الذي يُخرج المخزون قبل الفاتورة.
// الغرض الأهم: لا تُخصم البضاعة مرتين، ولا تبقى في الدفتر بعد خروجها.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { createSupplier, postPurchase, postSale } from "./operations";
import {
  createDraft,
  draftToSaleInput,
  linkDeliveryToSale,
  unbilledDeliveries,
  unbilledValue,
} from "./drafts";
import { availableQty } from "./reservations";
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
      lines: [{ productId: 1, qty: 100, unitCost: 60 }],
    });
  });
});

describe("سند التسليم المستقل يُخرج المخزون", () => {
  it("البضاعة تخرج يوم التسليم لا يوم الفاتورة", () => {
    run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 30 }],
      })
    );

    // خرجت فعلًا: الدفتر يطابق الرف.
    expect(db.products[0].stock).toBe(70);
    expect(db.drafts![0].stockIssued).toBe(true);

    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("DELIVERY");
    expect(move.qty).toBe(-30);
    expect(move.refType).toBe("delivery");
  });

  it("لا يُنشئ قيدًا محاسبيًا: لا إيراد قبل الفوترة", () => {
    const journalBefore = db.journal.length;
    run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 20 }],
      })
    );
    expect(db.journal).toHaveLength(journalBefore);
  });

  it("لا يُسلَّم أكثر من المتاح", () => {
    expect(() =>
      run(d =>
        createDraft(d, {
          kind: "delivery",
          customer: "أحمد",
          lines: [{ productId: 1, qty: 500 }],
        })
      )
    ).toThrow(/المتاح للتسليم/);
    expect(db.products[0].stock).toBe(100);
  });

  it("لا يُسلَّم ما هو محجوز لأمر بيع آخر", () => {
    run(d =>
      createDraft(d, {
        kind: "order",
        customer: "سالم",
        lines: [{ productId: 1, qty: 95 }],
      })
    );
    // المتاح 5 فقط بعد الحجز.
    expect(() =>
      run(d =>
        createDraft(d, {
          kind: "delivery",
          customer: "أحمد",
          lines: [{ productId: 1, qty: 10 }],
        })
      )
    ).toThrow(/المتاح للتسليم/);
  });
});

describe("الفاتورة لا تخصم مرتين", () => {
  beforeEach(() => {
    run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 30 }],
      })
    );
  });

  it("فوترة ما سُلّم تُثبت الإيراد بلا خصم ثانٍ", () => {
    const delivery = db.drafts!.find(d => d.kind === "delivery")!;
    const stockAfterDelivery = db.products[0].stock;

    const sale = run(d => {
      const s = postSale(d, {
        ...draftToSaleInput(delivery),
        fromDeliveryNo: delivery.no,
      });
      linkDeliveryToSale(d, delivery.no, s.no);
      return s;
    });

    // الإيراد أُثبت.
    expect(sale.total).toBe(3000);
    expect(db.sales).toHaveLength(1);
    // والمخزون لم ينقص مرة ثانية — هذا هو بيت القصيد.
    expect(db.products[0].stock).toBe(stockAfterDelivery);
    expect(db.products[0].stock).toBe(70);
  });

  it("السند يُربط بفاتورته فلا يُفوتر مرتين", () => {
    const delivery = db.drafts!.find(d => d.kind === "delivery")!;
    run(d => linkDeliveryToSale(d, delivery.no, 1049));

    const stored = db.drafts!.find(x => x.no === delivery.no)!;
    expect(stored.status).toBe("converted");
    expect(stored.saleNo).toBe(1049);

    expect(() => run(d => linkDeliveryToSale(d, delivery.no, 1050))).toThrow(
      /من قبل/
    );
  });

  it("فوترة بضاعة لم تُسلَّم تخصم عاديًا", () => {
    const stockBefore = db.products[0].stock;
    run(d => postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] }));
    // بلا fromDeliveryNo يُخصم المخزون كالمعتاد.
    expect(db.products[0].stock).toBe(stockBefore - 10);
  });
});

describe("سند تسليم مرتبط بفاتورة قائمة", () => {
  it("توثيق استلام فقط، بلا خصم", () => {
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

    // الفاتورة خصمت أصلًا؛ السند هنا توثيق لا حركة.
    expect(db.products[0].stock).toBe(stockAfterSale);
    const delivery = db.drafts!.find(d => d.kind === "delivery")!;
    expect(delivery.stockIssued).toBeUndefined();
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
});

describe("ما سُلّم ولم يُفوتر", () => {
  it("يُحصى بقيمته", () => {
    run(d => {
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 10 }],
      });
      createDraft(d, {
        kind: "delivery",
        customer: "سالم",
        lines: [{ productId: 1, qty: 5 }],
      });
    });

    expect(unbilledDeliveries(db)).toHaveLength(2);
    expect(unbilledValue(db)).toBe(1500);
  });

  it("المفوتر يخرج من القائمة", () => {
    const delivery = run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 10 }],
      })
    );
    run(d => linkDeliveryToSale(d, delivery.no, 1049));
    expect(unbilledDeliveries(db)).toHaveLength(0);
    expect(unbilledValue(db)).toBe(0);
  });

  it("المتاح يعكس ما خرج بالتسليم", () => {
    run(d =>
      createDraft(d, {
        kind: "delivery",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 40 }],
      })
    );
    // 100 ناقص 40 سُلّمت.
    expect(availableQty(db, 1)).toBe(60);
  });
});
