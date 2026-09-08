// اختبارات صلابة التخزين: فشل الحفظ، التعافي من ملف تالف، وقياس السعة.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DB_KEY,
  SNAPSHOT_KEY,
  StorageError,
  emptyState,
  loadStateSafe,
  saveState,
  storageUsage,
  transact,
} from "./store";
import { createSupplier, postSale, postPurchase } from "./operations";
import type { DbState, Product } from "./types";

function product(id: number, stock = 100): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock,
    price: 100,
    color: "leaf",
    barcode: `628${id}`,
    avgCost: 60,
    lastCost: 60,
  };
}

/** localStorage وهمي يمكن جعله يفشل عند الطلب. */
function installStorage(failWith?: { name?: string; code?: number }) {
  const store: Record<string, string> = {};
  const mock = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      if (failWith) {
        const err: any = new Error("quota");
        err.name = failWith.name;
        err.code = failWith.code;
        throw err;
      }
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    _store: store,
    _fail: (v: typeof failWith) => {
      failWith = v;
    },
  };
  (globalThis as any).localStorage = mock;
  return mock;
}

let db: DbState;

beforeEach(() => {
  installStorage();
  db = emptyState();
  db.products = [product(1)];
});

describe("فشل الحفظ لا يفقد بيانات", () => {
  it("يرمي StorageError عند امتلاء الذاكرة برسالة مفهومة", () => {
    installStorage({ name: "QuotaExceededError" });
    expect(() => saveState(db)).toThrow(StorageError);
    expect(() => saveState(db)).toThrow(/ممتلئة/);
  });

  it("يميّز الرفض العام عن الامتلاء", () => {
    installStorage({ name: "SecurityError" });
    expect(() => saveState(db)).toThrow(/يسمح بتخزين/);
  });

  it("transact لا يعتمد التغيير عند فشل الكتابة", () => {
    const storage = installStorage();
    saveState(db);
    const before = storage._store[DB_KEY];

    storage._fail({ name: "QuotaExceededError" });
    expect(() =>
      transact(db, draft => {
        draft.products[0].stock = 0;
      })
    ).toThrow(StorageError);

    // لا الحالة الأصلية تغيّرت ولا الملف على القرص.
    expect(db.products[0].stock).toBe(100);
    expect(storage._store[DB_KEY]).toBe(before);
  });

  it("عملية البيع الفاشلة تخزينيًا لا تخصم المخزون", () => {
    const storage = installStorage();
    saveState(db);
    storage._fail({ name: "QuotaExceededError" });

    expect(() =>
      transact(db, draft => postSale(draft, { lines: [{ productId: 1, qty: 5, price: 100 }] }))
    ).toThrow(StorageError);

    expect(db.products[0].stock).toBe(100);
    expect(db.sales).toHaveLength(0);
  });
});

describe("التعافي من ملف تالف", () => {
  it("يرجع لنسخة الأمان عند تلف الملف الأساسي", () => {
    const storage = installStorage();
    const good = transact(db, draft => {
      createSupplier(draft, { name: "الوادي" });
      postPurchase(draft, {
        supplierId: 1,
        paymentMethod: "cash",
        lines: [{ productId: 1, qty: 5, unitCost: 50 }],
      });
    });
    expect(storage._store[SNAPSHOT_KEY]).toBeTruthy();

    // إتلاف الملف الأساسي فقط
    storage._store[DB_KEY] = "{ ليس JSON صالحًا";

    const result = loadStateSafe();
    expect(result.recovered).toBe(true);
    expect(result.state.suppliers).toHaveLength(1);
    expect(result.state.purchases).toHaveLength(1);
    expect(result.state.products[0].stock).toBe(good.products[0].stock);
  });

  it("يرفض ملفًا صالح JSON لكنه ليس بنية التطبيق", () => {
    const storage = installStorage();
    saveState(db);
    storage._store[DB_KEY] = JSON.stringify({ hello: "world" });
    storage._store[SNAPSHOT_KEY] = JSON.stringify({ also: "wrong" });

    const result = loadStateSafe([product(9)]);
    // لا نسخة صالحة: نبدأ من الكتالوج بدل الانهيار.
    expect(result.state.products[0].id).toBe(9);
  });

  it("لا يعلن تعافيًا عندما يكون الملف سليمًا", () => {
    installStorage();
    transact(db, draft => {
      draft.products[0].stock = 42;
    });
    const result = loadStateSafe();
    expect(result.recovered).toBe(false);
    expect(result.state.products[0].stock).toBe(42);
  });

  it("لا ينهار عند غياب أي بيانات", () => {
    installStorage();
    const result = loadStateSafe([product(5)]);
    expect(result.recovered).toBe(false);
    expect(result.state.products).toHaveLength(1);
  });
});

describe("قياس السعة", () => {
  it("يحسب النسبة من الحجم الفعلي", () => {
    installStorage();
    saveState(db);
    const usage = storageUsage();
    expect(usage.usedKb).toBeGreaterThanOrEqual(0);
    expect(usage.limitKb).toBe(5120);
    expect(usage.percent).toBeGreaterThanOrEqual(0);
    expect(usage.percent).toBeLessThanOrEqual(100);
  });

  it("لا ينهار عندما يكون التخزين ممنوعًا", () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(storageUsage()).toEqual({ usedKb: 0, limitKb: 5120, percent: 0 });
  });
});
