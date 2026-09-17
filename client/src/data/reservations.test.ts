// اختبارات حجز الكميات.
// الغرض الأهم: لا يبيع النظام بضاعة موعودة لعميل آخر.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { createSupplier, postPurchase, postSale } from "./operations";
import { cancelDraft, createDraft, draftToSaleInput, markConverted, removeDraft } from "./drafts";
import {
  activeReservations,
  availableQty,
  releaseForDraft,
  reservationSummary,
  reservedQty,
} from "./reservations";
import { createWarehouse } from "./warehouses";
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
  db.products = [product(1), product(2)];
  run(d => {
    createSupplier(d, { name: "الوادي" });
    postPurchase(d, {
      supplierId: 1,
      paymentMethod: "cash",
      lines: [
        { productId: 1, qty: 100, unitCost: 60 },
        { productId: 2, qty: 50, unitCost: 30 },
      ],
    });
  });
});

describe("الحجز ينقص المتاح لا الفعلي", () => {
  it("أمر البيع يحجز ولا يمسّ رصيد المخزن", () => {
    run(d =>
      createDraft(d, {
        kind: "order",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 30 }],
      })
    );

    // البضاعة ما زالت في المخزن.
    expect(db.products[0].stock).toBe(100);
    // لكنها لم تعد متاحة للبيع.
    expect(reservedQty(db, 1)).toBe(30);
    expect(availableQty(db, 1)).toBe(70);
  });

  it("عرض السعر لا يحجز شيئًا", () => {
    run(d =>
      createDraft(d, {
        kind: "quotation",
        lines: [{ productId: 1, qty: 40 }],
      })
    );
    expect(reservedQty(db, 1)).toBe(0);
    expect(availableQty(db, 1)).toBe(100);
  });

  it("الفاتورة المعلّقة لا تحجز", () => {
    run(d =>
      createDraft(d, { kind: "parked", lines: [{ productId: 1, qty: 20 }] })
    );
    expect(reservedQty(db, 1)).toBe(0);
  });
});

describe("المحجوز لا يُباع لغيره", () => {
  beforeEach(() => {
    run(d =>
      createDraft(d, {
        kind: "order",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 90 }],
      })
    );
  });

  it("يمنع بيع ما تجاوز المتاح", () => {
    // الفعلي 100 والمحجوز 90، فالمتاح 10 فقط.
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 20, price: 100 }] }))
    ).toThrow(/المتاح|الرصيد/);
    expect(db.sales).toHaveLength(0);
  });

  it("يسمح ببيع ما دون المتاح", () => {
    expect(() =>
      run(d => postSale(d, { lines: [{ productId: 1, qty: 10, price: 100 }] }))
    ).not.toThrow();
    expect(db.sales).toHaveLength(1);
  });

  it("أمران لا يحجزان نفس البضاعة", () => {
    expect(() =>
      run(d =>
        createDraft(d, {
          kind: "order",
          customer: "سالم",
          lines: [{ productId: 1, qty: 20 }],
        })
      )
    ).toThrow(/محجوز|المتاح/);
  });
});

describe("تحرير الحجز", () => {
  beforeEach(() => {
    run(d =>
      createDraft(d, {
        kind: "order",
        customer: "أحمد",
        lines: [{ productId: 1, qty: 40 }],
      })
    );
  });

  it("التحويل لفاتورة يحرّر الحجز", () => {
    const order = db.drafts!.find(d => d.kind === "order")!;
    run(d => {
      const sale = postSale(d, {
        ...draftToSaleInput(order),
        fromDraftNo: order.no,
      });
      markConverted(d, "order", order.no, sale.no);
      return sale;
    });

    expect(activeReservations(db)).toHaveLength(0);
    // الحجز حُرّر لكن سجله باقٍ بسببه.
    expect(db.reservations![0].released).toBe(true);
    expect(db.reservations![0].releaseReason).toContain("فاتورة");
    // والمخزون نقص فعلًا الآن.
    expect(db.products[0].stock).toBe(60);
  });

  it("الأمر الجاري تحويله لا يحجز عن نفسه", () => {
    const order = db.drafts!.find(d => d.kind === "order")!;
    // لولا fromDraftNo لمنع الأمرُ نفسَه من التحويل.
    expect(() =>
      run(d =>
        postSale(d, { ...draftToSaleInput(order), fromDraftNo: order.no })
      )
    ).not.toThrow();
  });

  it("الإلغاء يعيد البضاعة متاحة", () => {
    const order = db.drafts!.find(d => d.kind === "order")!;
    run(d => cancelDraft(d, "order", order.no, "اعتذر العميل"));
    expect(availableQty(db, 1)).toBe(100);
    expect(activeReservations(db)).toHaveLength(0);
  });

  it("الحذف يحرّر الحجز فلا تبقى بضاعة مقفلة", () => {
    const order = db.drafts!.find(d => d.kind === "order")!;
    run(d => removeDraft(d, "order", order.no));
    expect(availableQty(db, 1)).toBe(100);
  });

  it("التحرير اليدوي يعمل ويُحصى", () => {
    const order = db.drafts!.find(d => d.kind === "order")!;
    const count = run(d => releaseForDraft(d, order.no, "تحرير يدوي"));
    expect(count).toBe(1);
    expect(availableQty(db, 1)).toBe(100);
  });
});

describe("الحجز لكل مخزن على حدة", () => {
  it("حجز فرع لا ينقص متاح فرع آخر", () => {
    const branch = run(d => createWarehouse(d, { name: "الفرع الثاني" }).id);
    run(d =>
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        warehouseId: branch,
        lines: [{ productId: 1, qty: 20, unitCost: 60 }],
      })
    );

    run(d =>
      createDraft(d, {
        kind: "order",
        customer: "أحمد",
        warehouseId: branch,
        lines: [{ productId: 1, qty: 15 }],
      })
    );

    // الفرع حُجز فيه 15 من 20.
    expect(availableQty(db, 1, branch)).toBe(5);
    // والمخزن الرئيسي لم يتأثر.
    expect(availableQty(db, 1, 1)).toBe(100);
  });
});

describe("ملخّص الحجوزات", () => {
  it("يجمع المحجوز لكل صنف", () => {
    run(d => {
      createDraft(d, {
        kind: "order",
        customer: "أحمد",
        lines: [
          { productId: 1, qty: 10 },
          { productId: 2, qty: 5 },
        ],
      });
      createDraft(d, {
        kind: "order",
        customer: "سالم",
        lines: [{ productId: 1, qty: 20 }],
      });
    });

    const rows = reservationSummary(db);
    const first = rows.find(r => r.productId === 1)!;
    expect(first.qty).toBe(30);
    expect(first.orders).toBe(2);
    expect(rows.find(r => r.productId === 2)!.qty).toBe(5);
  });
});
