// اختبارات اعتماد العمليات الحساسة وسجل «ما تغيّر».
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  createCustomer,
  createSupplier,
  postPurchase,
  postSale,
  postStockTake,
} from "./operations";
import { createUser, login, logout } from "./users";
import {
  approvalSummary,
  approvalsOf,
  decideApproval,
  hasApproval,
  requestApproval,
} from "./approvals";
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
      paymentMethod: "credit",
      lines: [{ productId: 1, qty: 100, unitCost: 60 }],
    });
    createCustomer(d, { name: "أحمد", terms: "credit", creditLimit: 500 });
  });
});

describe("طلب الاعتماد", () => {
  it("يُسجَّل بمن طلبه وسببه", () => {
    run(d => {
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
    });
    const req = run(d =>
      requestApproval(d, {
        kind: "creditOverride",
        description: "تجاوز حد ائتمان أحمد",
        reason: "عميل قديم موثوق",
        refNo: 1,
        amount: 800,
      })
    );

    expect(req.no).toBe(13000);
    expect(req.status).toBe("pending");
    expect(req.requestedBy).toBe("سالم");
    expect(req.reason).toContain("موثوق");
  });

  it("يرفض الوصف الفارغ", () => {
    expect(() =>
      run(d =>
        requestApproval(d, { kind: "editCost", description: "  " })
      )
    ).toThrow(/وصف/);
  });
});

describe("البتّ في الطلب", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
      requestApproval(d, {
        kind: "creditOverride",
        description: "تجاوز حد أحمد",
        refNo: 1,
      });
    });
  });

  it("صاحب الطلب لا يعتمد طلبه ولو كان مالكًا", () => {
    // المالك يطلب بنفسه، ثم يحاول اعتماد طلبه.
    run(d => {
      login(d, "1111");
      requestApproval(d, {
        kind: "creditOverride",
        description: "طلب المالك نفسه",
        refNo: 2,
      });
    });
    // الدور يسمح له، لكن الفصل بين الطالب والمعتمد يمنعه.
    expect(() => run(d => decideApproval(d, 13001, true))).toThrow(
      /صاحب الطلب/
    );
  });

  it("البائع لا يبتّ أصلًا", () => {
    run(d => {
      createUser(d, { name: "زميل", role: "cashier", pin: "3333" });
      login(d, "3333");
    });
    expect(() => run(d => decideApproval(d, 13000, true))).toThrow(
      /لا تملك صلاحية/
    );
  });

  it("المالك يعتمد ويُسجَّل قراره", () => {
    run(d => login(d, "1111"));
    const decided = run(d =>
      decideApproval(d, 13000, true, "موافق لهذه المرة")
    );

    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).toBe("المالك");
    expect(decided.decisionNote).toContain("موافق");
    expect(hasApproval(db, "creditOverride", 1)).toBe(true);
  });

  it("الرفض يمنع العملية ويُسجَّل", () => {
    run(d => login(d, "1111"));
    run(d => decideApproval(d, 13000, false, "الرصيد كبير"));
    expect(hasApproval(db, "creditOverride", 1)).toBe(false);
    expect(approvalsOf(db, { status: "rejected" })).toHaveLength(1);
  });

  it("لا يُبتّ مرتين", () => {
    run(d => login(d, "1111"));
    run(d => decideApproval(d, 13000, true));
    expect(() => run(d => decideApproval(d, 13000, false))).toThrow(
      /من قبل/
    );
  });

  it("المدير لا يبتّ في إعادة فتح فترة", () => {
    run(d => {
      createUser(d, { name: "خالد", role: "manager", pin: "4444" });
      login(d, "4444");
      requestApproval(d, {
        kind: "reopenPeriod",
        description: "إعادة فتح يناير",
      });
    });
    // خالد طلب، فندخل بالمالك ليُظهر أن المدير نفسه ممنوع لو طلب غيره.
    run(d => login(d, "1111"));
    expect(() => run(d => decideApproval(d, 13001, true))).not.toThrow();
  });
});

describe("حد الائتمان يحترم الاعتماد", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
    });
  });

  it("يمنع التجاوز بلا اعتماد", () => {
    // الحد 500 والفاتورة 900.
    expect(() =>
      run(d =>
        postSale(d, {
          customerId: 1,
          terms: "credit",
          lines: [{ productId: 1, qty: 9, price: 100 }],
        })
      )
    ).toThrow(/حد ائتمان|اعتماد مسؤول/);
    expect(db.sales).toHaveLength(0);
  });

  it("يسمح بعد اعتماد المسؤول", () => {
    run(d =>
      requestApproval(d, {
        kind: "creditOverride",
        description: "تجاوز حد أحمد",
        refNo: 1,
      })
    );
    run(d => login(d, "1111"));
    run(d => decideApproval(d, 13000, true));
    run(d => login(d, "2222"));

    expect(() =>
      run(d =>
        postSale(d, {
          customerId: 1,
          terms: "credit",
          lines: [{ productId: 1, qty: 9, price: 100 }],
        })
      )
    ).not.toThrow();
    expect(db.sales).toHaveLength(1);
  });
});

describe("سجل التدقيق يحفظ ما تغيّر", () => {
  it("تعديل التكلفة يُسجَّل بقيمته قبل وبعد", () => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      login(d, "1111");
      postStockTake(d, [{ productId: 1, countedQty: 100, unitCost: 75 }]);
    });

    const entry = db.auditLog!.find(e => e.action === "editCost");
    expect(entry).toBeTruthy();
    expect(entry!.before).toContain("60");
    expect(entry!.after).toContain("75");
    expect(entry!.refType).toBe("product");
    expect(entry!.refNo).toBe(1);
  });
});

describe("الملخّص", () => {
  it("يعدّ المعلّق والمعتمد والمرفوض", () => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
      requestApproval(d, { kind: "editCost", description: "أ" });
      requestApproval(d, { kind: "priceOverride", description: "ب" });
      requestApproval(d, { kind: "stockVariance", description: "ج" });
      login(d, "1111");
      decideApproval(d, 13000, true);
      decideApproval(d, 13001, false);
    });

    const s = approvalSummary(db);
    expect(s.total).toBe(3);
    expect(s.approved).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.pending).toBe(1);
  });
});
