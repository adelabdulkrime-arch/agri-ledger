// اختبارات الوحدات المتعددة والباركودات الإضافية.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState, migrate, SCHEMA_VERSION } from "./store";
import {
  addAltBarcode,
  addProductUnit,
  createSupplier,
  findByBarcode,
  findUnit,
  postPurchase,
  postSale,
  profitSummary,
  removeAltBarcode,
  removeProductUnit,
  stockInUnit,
  toBaseQty,
  unitPrice,
  unitsOf,
} from "./operations";
import type { DbState, Product } from "./types";

function product(over: Partial<Product> & { id: number }): Product {
  return {
    name: `صنف ${over.id}`,
    category: "أسمدة",
    unit: "عبوة",
    stock: 240,
    price: 10,
    color: "leaf",
    barcode: `628000${over.id}`,
    avgCost: 6,
    lastCost: 6,
    ...over,
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
  db.products = [
    product({
      id: 1,
      // كرتون = 12 عبوة بسعر 110 بدل 120 (خصم الجملة)
      units: [{ name: "كرتون", factor: 12, price: 110, barcode: "CARTON-1" }],
      altBarcodes: ["ALT-1"],
    }),
    product({ id: 2, name: "مبيد", unit: "لتر", stock: 50, price: 80 }),
  ];
});

describe("تعريف الوحدات", () => {
  it("يعرض الوحدة الأساسية أولًا ثم البدائل", () => {
    const units = unitsOf(db.products[0]);
    expect(units.map(u => u.name)).toEqual(["عبوة", "كرتون"]);
    expect(units[0].factor).toBe(1);
    expect(units[1].factor).toBe(12);
  });

  it("يتجاهل الوحدات غير الصالحة", () => {
    const p = product({
      id: 9,
      units: [
        { name: "  ", factor: 5 },
        { name: "سليمة", factor: 3 },
        { name: "سالبة", factor: -2 },
      ],
    });
    expect(unitsOf(p).map(u => u.name)).toEqual(["عبوة", "سليمة"]);
  });

  it("يعيد الوحدة الأساسية عند اسم غير معروف", () => {
    expect(findUnit(db.products[0], "غير موجود").factor).toBe(1);
    expect(findUnit(db.products[0], undefined).name).toBe("عبوة");
  });

  it("يضيف وحدة جديدة ويرفض المكرر وغير الصالح", () => {
    run(d => addProductUnit(d, 1, { name: "شوال", factor: 50 }));
    expect(unitsOf(db.products[0]).map(u => u.name)).toContain("شوال");

    expect(() =>
      run(d => addProductUnit(d, 1, { name: "كرتون", factor: 6 }))
    ).toThrow(/نفس الاسم/);
    expect(() =>
      run(d => addProductUnit(d, 1, { name: "عبوة", factor: 4 }))
    ).toThrow(/الوحدة الأساسية/);
    expect(() =>
      run(d => addProductUnit(d, 1, { name: "س", factor: 0 }))
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      run(d => addProductUnit(d, 1, { name: "س", factor: 1 }))
    ).toThrow(/معامل 1/);
  });

  it("يحذف وحدة", () => {
    run(d => removeProductUnit(d, 1, "كرتون"));
    expect(unitsOf(db.products[0])).toHaveLength(1);
  });
});

describe("التحويل والتسعير", () => {
  it("يحوّل الكمية إلى الوحدة الأساسية", () => {
    expect(toBaseQty(db.products[0], 2, "كرتون")).toBe(24);
    expect(toBaseQty(db.products[0], 5, "عبوة")).toBe(5);
    expect(toBaseQty(db.products[0], 3)).toBe(3);
  });

  it("يعرض الرصيد بالوحدة المطلوبة", () => {
    // 240 عبوة = 20 كرتون
    expect(stockInUnit(db.products[0], "كرتون")).toBe(20);
    expect(stockInUnit(db.products[0], "عبوة")).toBe(240);
  });

  it("يستخدم السعر الصريح للوحدة عند وجوده", () => {
    expect(unitPrice(db.products[0], "كرتون")).toBe(110);
    expect(unitPrice(db.products[0], "عبوة")).toBe(10);
  });

  it("يحسب السعر من المعامل عند غياب سعر صريح", () => {
    run(d => addProductUnit(d, 1, { name: "نصف كرتون", factor: 6 }));
    // 6 × 10 = 60
    expect(unitPrice(db.products[0], "نصف كرتون")).toBe(60);
  });
});

describe("البيع بوحدات مختلفة", () => {
  beforeEach(() => {
    run(d => {
      createSupplier(d, { name: "الوادي" });
      postPurchase(d, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 240, unitCost: 6 }],
      });
    });
    // بعد الشراء: 480 عبوة، متوسط التكلفة 6
    db.products[0].stock = 240;
    db.products[0].avgCost = 6;
  });

  it("يخصم الكمية الأساسية عند البيع بالكرتون", () => {
    run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 2, price: 110, unitName: "كرتون" }],
      })
    );
    // 2 كرتون = 24 عبوة
    expect(db.products[0].stock).toBe(216);
    const line = db.sales[0].lines[0];
    expect(line.qty).toBe(24);
    expect(line.soldUnit).toBe("كرتون");
    expect(line.soldQty).toBe(2);
  });

  it("يحسب الإجمالي والتكلفة بالوحدة الأساسية بدقة", () => {
    run(d =>
      postSale(d, {
        lines: [{ productId: 1, qty: 2, price: 110, unitName: "كرتون" }],
      })
    );
    const sale = db.sales[0];
    // 2 كرتون × 110 = 220 إجمالًا، والتكلفة 24 × 6 = 144
    expect(sale.total).toBe(220);
    expect(sale.cogs).toBe(144);
    expect(profitSummary(db.sales).grossProfit).toBe(76);
  });

  it("لا يضع علامة وحدة عند البيع بالوحدة الأساسية", () => {
    run(d => postSale(d, { lines: [{ productId: 1, qty: 5, price: 10 }] }));
    const line = db.sales[0].lines[0];
    expect(line.qty).toBe(5);
    expect(line.soldUnit).toBeUndefined();
  });

  it("يمنع البيع بأكثر من الرصيد ويذكر الوحدة في الرسالة", () => {
    expect(() =>
      run(d =>
        postSale(d, {
          lines: [{ productId: 1, qty: 100, price: 110, unitName: "كرتون" }],
        })
      )
    ).toThrow(/20 كرتون/);
    expect(db.products[0].stock).toBe(240);
  });
});

describe("الباركودات المتعددة", () => {
  it("يجد الصنف بالباركود الأساسي والإضافي", () => {
    expect(findByBarcode(db, "6280001")!.product.id).toBe(1);
    expect(findByBarcode(db, "ALT-1")!.product.id).toBe(1);
    expect(findByBarcode(db, "لا يوجد")).toBeNull();
    expect(findByBarcode(db, "")).toBeNull();
  });

  it("يعيد اسم الوحدة عند مطابقة باركود عبوة", () => {
    const hit = findByBarcode(db, "CARTON-1")!;
    expect(hit.product.id).toBe(1);
    expect(hit.unitName).toBe("كرتون");
  });

  it("يضيف باركودًا إضافيًا ويرفض المكرر", () => {
    run(d => addAltBarcode(d, 1, "NEW-9"));
    expect(db.products[0].altBarcodes).toContain("NEW-9");

    expect(() => run(d => addAltBarcode(d, 1, "NEW-9"))).toThrow(/لنفس الصنف/);
    expect(() => run(d => addAltBarcode(d, 1, "  "))).toThrow(/أدخل رقم/);
    // باركود صنف آخر
    expect(() => run(d => addAltBarcode(d, 1, "6280002"))).toThrow(
      /مستخدم بالفعل/
    );
  });

  it("يحذف باركودًا إضافيًا", () => {
    run(d => removeAltBarcode(d, 1, "ALT-1"));
    expect(findByBarcode(db, "ALT-1")).toBeNull();
  });

  it("يمنع إسناد باركود وحدة مستخدَم لصنف آخر", () => {
    expect(() =>
      run(d =>
        addProductUnit(d, 2, { name: "كرتون", factor: 6, barcode: "CARTON-1" })
      )
    ).toThrow(/مستخدم بالفعل/);
  });
});

describe("ترقية المخطط إلى 7", () => {
  it("تضيف الوحدات والباركودات دون فقد بيانات", () => {
    const out = migrate({
      version: 6,
      products: [{ id: 1, name: "سماد", stock: 4, price: 10 }],
    });
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.products[0].units).toEqual([]);
    expect(out.products[0].altBarcodes).toEqual([]);
    expect(out.products[0].name).toBe("سماد");
  });

  it("لا تمسح وحدات موجودة", () => {
    const out = migrate({
      version: 6,
      products: [
        {
          id: 1,
          name: "سماد",
          stock: 4,
          price: 10,
          units: [{ name: "كرتون", factor: 12 }],
        },
      ],
    });
    expect(out.products[0].units).toHaveLength(1);
  });
});
