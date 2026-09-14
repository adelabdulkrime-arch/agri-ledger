// اختبارات المستخدمين والصلاحيات وسجل التدقيق.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { OperationError } from "./operations";
import {
  auditTrail,
  can,
  createUser,
  currentUser,
  login,
  logout,
  permissionsOf,
  recordAudit,
  requirePermission,
  updateUser,
} from "./users";
import type { DbState } from "./types";

let db: DbState;

function run<T>(fn: (draft: DbState) => T): T {
  const draft: DbState = JSON.parse(JSON.stringify(db));
  const out = fn(draft);
  db = draft;
  return out;
}

beforeEach(() => {
  db = emptyState();
});

describe("إنشاء المستخدمين", () => {
  it("أول مستخدم يكون مالكًا مهما طُلب", () => {
    const u = run(d =>
      createUser(d, { name: "عمار", role: "cashier", pin: "1234" })
    );
    // لو صار أول مستخدم بائعًا لأُغلق النظام على الجميع.
    expect(u.role).toBe("owner");
    expect(u.active).toBe(true);
  });

  it("يقبل الأدوار التالية كما طُلبت", () => {
    run(d => createUser(d, { name: "المالك", role: "owner", pin: "1111" }));
    const c = run(d =>
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" })
    );
    expect(c.role).toBe("cashier");
  });

  it("يرفض الاسم المكرر والفارغ", () => {
    run(d => createUser(d, { name: "عمار", role: "owner", pin: "1111" }));
    expect(() =>
      run(d => createUser(d, { name: "عمار", role: "cashier", pin: "2222" }))
    ).toThrow(/نفس الاسم/);
    expect(() =>
      run(d => createUser(d, { name: "  ", role: "cashier", pin: "3333" }))
    ).toThrow(/مطلوب/);
  });

  it("يفرض رمز دخول من 4 إلى 6 أرقام وغير مكرر", () => {
    run(d => createUser(d, { name: "عمار", role: "owner", pin: "1234" }));
    expect(() =>
      run(d => createUser(d, { name: "سالم", role: "cashier", pin: "12" }))
    ).toThrow(/4 إلى 6 أرقام/);
    expect(() =>
      run(d => createUser(d, { name: "سالم", role: "cashier", pin: "abcd" }))
    ).toThrow(/4 إلى 6 أرقام/);
    expect(() =>
      run(d => createUser(d, { name: "سالم", role: "cashier", pin: "1234" }))
    ).toThrow(/مستخدم؛ اختر رمزًا مختلفًا/);
  });
});

describe("الصلاحيات حسب الدور", () => {
  it("المالك يملك كل شيء والبائع يبيع فقط", () => {
    expect(permissionsOf("owner")).toContain("manageUsers");
    expect(permissionsOf("owner")).toContain("viewProfit");
    expect(permissionsOf("cashier")).toEqual(["sell"]);
    expect(permissionsOf("cashier")).not.toContain("viewProfit");
    expect(permissionsOf("cashier")).not.toContain("voidInvoice");
  });

  it("المدير يدير لكن لا يضيف مستخدمين ولا يقفل فترات", () => {
    const m = permissionsOf("manager");
    expect(m).toContain("voidInvoice");
    expect(m).toContain("viewProfit");
    expect(m).not.toContain("manageUsers");
    expect(m).not.toContain("closePeriod");
  });

  it("بلا مستخدمين مسجّلين يُسمح بكل شيء", () => {
    // محل بمشغّل واحد لا يُجبَر على تسجيل دخول لا يحتاجه.
    expect(can(db, "viewProfit")).toBe(true);
    expect(can(db, "manageUsers")).toBe(true);
  });

  it("بوجود مستخدمين وبلا دخول يُمنع كل شيء", () => {
    run(d => createUser(d, { name: "عمار", role: "owner", pin: "1111" }));
    expect(can(db, "sell")).toBe(false);
    expect(() => requirePermission(db, "sell")).toThrow(/لا تملك صلاحية/);
  });

  it("البائع بعد الدخول يبيع ولا يرى الأرباح", () => {
    run(d => {
      createUser(d, { name: "المالك", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
      login(d, "2222");
    });
    expect(currentUser(db)!.name).toBe("سالم");
    expect(can(db, "sell")).toBe(true);
    expect(can(db, "viewProfit")).toBe(false);
    expect(() => requirePermission(db, "voidInvoice")).toThrow(
      /إلغاء الفواتير/
    );
  });
});

describe("الدخول والخروج", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      createUser(d, { name: "سالم", role: "cashier", pin: "2222" });
    });
  });

  it("الدخول برمز صحيح", () => {
    const u = run(d => login(d, "2222"));
    expect(u.name).toBe("سالم");
    expect(db.currentUserId).toBe(u.id);
  });

  it("يرفض الرمز الخاطئ", () => {
    expect(() => run(d => login(d, "9999"))).toThrow(/غير صحيح/);
    expect(db.currentUserId).toBeUndefined();
  });

  it("يرفض دخول مستخدم معطّل", () => {
    run(d => updateUser(d, 2, { active: false }));
    expect(() => run(d => login(d, "2222"))).toThrow(/غير صحيح/);
  });

  it("الخروج يلغي الجلسة", () => {
    run(d => login(d, "1111"));
    run(d => logout(d));
    expect(db.currentUserId).toBeUndefined();
    expect(currentUser(db)).toBeUndefined();
  });
});

describe("حماية المالك الأخير", () => {
  it("يمنع تغيير دور المالك الوحيد أو تعطيله", () => {
    run(d => createUser(d, { name: "عمار", role: "owner", pin: "1111" }));
    expect(() => run(d => updateUser(d, 1, { role: "cashier" }))).toThrow(
      /المالك الوحيد/
    );
    expect(() => run(d => updateUser(d, 1, { active: false }))).toThrow(
      /المالك الوحيد/
    );
  });

  it("يسمح بذلك عند وجود مالك آخر", () => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      createUser(d, { name: "مالك ثانٍ", role: "owner", pin: "2222" });
    });
    run(d => updateUser(d, 1, { role: "manager" }));
    expect(db.users[0].role).toBe("manager");
  });

  it("يرفض تعديل مستخدم غير موجود", () => {
    expect(() => run(d => updateUser(d, 99, { name: "x" }))).toThrow(
      OperationError
    );
  });
});

describe("سجل التدقيق", () => {
  beforeEach(() => {
    run(d => {
      createUser(d, { name: "عمار", role: "owner", pin: "1111" });
      login(d, "1111");
    });
  });

  it("يسجّل من فعل ماذا ومتى", () => {
    run(d =>
      recordAudit(d, {
        action: "voidPurchase",
        description: "إلغاء فاتورة شراء #5001",
        refType: "purchase",
        refNo: 5001,
      })
    );
    const e = db.auditLog[0];
    expect(e.userName).toBe("عمار");
    expect(e.action).toBe("voidPurchase");
    expect(e.refNo).toBe(5001);
    expect(new Date(e.at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("يسجّل بلا مستخدم نشط باسم غير محدد", () => {
    run(d => logout(d));
    run(d => recordAudit(d, { action: "x", description: "y" }));
    expect(db.auditLog.at(-1)!.userName).toBe("غير محدد");
  });

  it("يعرض السجل من الأحدث ويصفّيه", () => {
    run(d => {
      recordAudit(d, { action: "sale", description: "بيع 1" });
      recordAudit(d, { action: "void", description: "إلغاء" });
      recordAudit(d, { action: "sale", description: "بيع 2" });
    });
    const all = auditTrail(db);
    expect(all).toHaveLength(3);
    expect(all[0].description).toBe("بيع 2");
    expect(auditTrail(db, { action: "sale" })).toHaveLength(2);
    expect(auditTrail(db, { userId: 1 })).toHaveLength(3);
    expect(auditTrail(db, { userId: 99 })).toHaveLength(0);
  });

  it("لا ينمو السجل بلا حد", () => {
    run(d => {
      for (let i = 0; i < 2050; i++)
        recordAudit(d, { action: "x", description: `حركة ${i}` });
    });
    // يُحتفظ بالأحدث فقط على جهاز محدود المساحة.
    expect(db.auditLog.length).toBeLessThanOrEqual(2000);
    expect(db.auditLog.at(-1)!.description).toBe("حركة 2049");
  });
});
