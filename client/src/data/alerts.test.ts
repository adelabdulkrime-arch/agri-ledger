// اختبارات تنبيهات المخزون: حد إعادة الطلب وانتهاء الصلاحية.
import { describe, it, expect } from "vitest";
import { emptyState, migrate, SCHEMA_VERSION } from "./store";
import {
  DEFAULT_REORDER_LEVEL,
  daysUntil,
  reorderLevelOf,
  stockAlerts,
} from "./operations";
import type { DbState, Product } from "./types";

const NOW = new Date("2026-09-07T10:00:00Z");

function product(over: Partial<Product> & { id: number }): Product {
  return {
    name: `صنف ${over.id}`,
    category: "مبيدات",
    unit: "عبوة",
    stock: 50,
    price: 100,
    color: "leaf",
    barcode: `628${over.id}`,
    avgCost: 40,
    lastCost: 40,
    ...over,
  };
}

function withProducts(products: Product[]): DbState {
  const db = emptyState();
  db.products = products;
  return db;
}

/** تاريخ بعد عدد أيام من لحظة الاختبار الثابتة. */
function inDays(days: number) {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("حد إعادة الطلب", () => {
  it("يستخدم الحد الافتراضي عند غيابه", () => {
    expect(reorderLevelOf(product({ id: 1 }))).toBe(DEFAULT_REORDER_LEVEL);
    expect(reorderLevelOf(product({ id: 1, reorderLevel: 25 }))).toBe(25);
    // الصفر قيمة صريحة، لا يجوز استبدالها بالافتراضي.
    expect(reorderLevelOf(product({ id: 1, reorderLevel: 0 }))).toBe(0);
  });

  it("ينبه عند بلوغ الحد لا قبله", () => {
    const db = withProducts([
      product({ id: 1, stock: 11, reorderLevel: 10 }),
      product({ id: 2, stock: 10, reorderLevel: 10 }),
    ]);
    const alerts = stockAlerts(db, NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].productId).toBe(2);
    expect(alerts[0].kind).toBe("low");
  });

  it("يميز النافد عن الناقص", () => {
    const db = withProducts([
      product({ id: 1, stock: 0 }),
      product({ id: 2, stock: 3 }),
    ]);
    const alerts = stockAlerts(db, NOW);
    expect(alerts.find(a => a.productId === 1)!.kind).toBe("out");
    expect(alerts.find(a => a.productId === 2)!.kind).toBe("low");
  });

  it("لا ينبه على صنف وافر", () => {
    const db = withProducts([product({ id: 1, stock: 500 })]);
    expect(stockAlerts(db, NOW)).toHaveLength(0);
  });
});

describe("انتهاء الصلاحية", () => {
  it("يحسب الأيام المتبقية بدقة", () => {
    expect(daysUntil(inDays(30), NOW)).toBe(30);
    expect(daysUntil(inDays(-5), NOW)).toBe(-5);
    expect(daysUntil(undefined, NOW)).toBeNull();
    expect(daysUntil("نص غير صالح", NOW)).toBeNull();
  });

  it("ينبه على المنتهي وعلى المقترب خلال 60 يومًا", () => {
    const db = withProducts([
      product({ id: 1, stock: 20, expiryDate: inDays(-3) }),
      product({ id: 2, stock: 20, expiryDate: inDays(30) }),
      product({ id: 3, stock: 20, expiryDate: inDays(200) }),
    ]);
    const alerts = stockAlerts(db, NOW);
    expect(alerts.find(a => a.productId === 1)!.kind).toBe("expired");
    expect(alerts.find(a => a.productId === 2)!.kind).toBe("expiring");
    expect(alerts.find(a => a.productId === 3)).toBeUndefined();
  });

  it("لا ينبه على صلاحية صنف رصيده صفر", () => {
    const db = withProducts([
      product({ id: 1, stock: 0, expiryDate: inDays(-10) }),
    ]);
    const alerts = stockAlerts(db, NOW);
    // ينفد فقط، فلا معنى لتنبيه صلاحية بضاعة غير موجودة.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("out");
  });

  it("يرتب المنتهي أولًا ثم النافد ثم المقترب ثم الناقص", () => {
    const db = withProducts([
      product({ id: 1, stock: 5 }),
      product({ id: 2, stock: 0 }),
      product({ id: 3, stock: 20, expiryDate: inDays(10) }),
      product({ id: 4, stock: 20, expiryDate: inDays(-1) }),
    ]);
    expect(stockAlerts(db, NOW).map(a => a.kind)).toEqual([
      "expired",
      "out",
      "expiring",
      "low",
    ]);
  });

  it("يجمع تنبيهين لصنف ناقص ومنتهٍ معًا", () => {
    const db = withProducts([
      product({ id: 1, stock: 2, expiryDate: inDays(-1) }),
    ]);
    const alerts = stockAlerts(db, NOW);
    expect(alerts.map(a => a.kind).sort()).toEqual(["expired", "low"]);
  });
});

describe("ترقية المخطط إلى 6", () => {
  it("تضيف حد الطلب والصلاحية دون فقد بيانات", () => {
    const out = migrate({
      version: 5,
      products: [{ id: 1, name: "سماد", stock: 4, price: 10 }],
    });
    expect(out.version).toBe(SCHEMA_VERSION);
    expect(out.products[0].reorderLevel).toBe(DEFAULT_REORDER_LEVEL);
    expect(out.products[0].expiryDate).toBe("");
    expect(out.products[0].name).toBe("سماد");
  });

  it("لا تُبطل حدًا خصصه المستخدم", () => {
    const out = migrate({
      version: 5,
      products: [{ id: 1, name: "سماد", stock: 4, price: 10, reorderLevel: 3 }],
    });
    expect(out.products[0].reorderLevel).toBe(3);
  });
});
