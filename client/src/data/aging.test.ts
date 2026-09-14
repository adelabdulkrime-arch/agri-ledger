// اختبارات أعمار الديون: توزيع الشرائح، إطفاء الأقدم أولًا، ومخصص التحصيل.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import {
  ageInDays,
  bucketOf,
  doubtfulAllowance,
  payablesAging,
  receivablesAging,
} from "./aging";
import type { DbState } from "./types";

let db: DbState;

/** تاريخ قبل n يومًا من اللحظة المرجعية، لتثبيت الأعمار في الاختبار. */
const ASOF = new Date("2026-06-30T12:00:00.000Z");
function daysAgo(n: number) {
  return new Date(ASOF.getTime() - n * 86400000).toISOString();
}

function addCustomer(id: number, name: string) {
  db.customers.push({
    id,
    name,
    phone: "0500",
    address: "",
    taxNumber: "",
    notes: "",
    terms: "credit",
    creditLimit: 0,
    status: "active",
    createdAt: daysAgo(400),
  });
}

function charge(customerId: number, refNo: number, amount: number, days: number) {
  db.customerLedger.push({
    id: db.customerLedger.length + 1,
    customerId,
    at: daysAgo(days),
    type: "فاتورة بيع",
    refNo,
    debit: amount,
    credit: 0,
    note: "",
  });
}

function collect(customerId: number, amount: number, days: number) {
  db.customerLedger.push({
    id: db.customerLedger.length + 1,
    customerId,
    at: daysAgo(days),
    type: "تحصيل",
    refNo: 0,
    debit: 0,
    credit: amount,
    note: "",
  });
}

beforeEach(() => {
  db = emptyState();
});

describe("حساب العمر والشريحة", () => {
  it("يحسب الأيام الكاملة ويعتبر المستقبل صفرًا", () => {
    expect(ageInDays(daysAgo(45), ASOF)).toBe(45);
    expect(ageInDays(new Date(ASOF.getTime() + 86400000).toISOString(), ASOF)).toBe(0);
  });

  it("يضع كل عمر في شريحته", () => {
    expect(bucketOf(0)).toBe("d0");
    expect(bucketOf(30)).toBe("d0");
    expect(bucketOf(31)).toBe("d31");
    expect(bucketOf(60)).toBe("d31");
    expect(bucketOf(61)).toBe("d61");
    expect(bucketOf(90)).toBe("d61");
    expect(bucketOf(91)).toBe("d90");
    expect(bucketOf(900)).toBe("d90");
  });
});

describe("أعمار ذمم العملاء", () => {
  it("يوزع الفواتير على الشرائح حسب عمرها", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 100, 10);
    charge(1, 102, 200, 45);
    charge(1, 103, 300, 75);
    charge(1, 104, 400, 200);

    const r = receivablesAging(db, ASOF);
    expect(r.total).toBe(1000);
    expect(r.totals.d0).toBe(100);
    expect(r.totals.d31).toBe(200);
    expect(r.totals.d61).toBe(300);
    expect(r.totals.d90).toBe(400);
    expect(r.overdue90).toBe(400);
  });

  it("يطفئ الأقدم أولًا عند التحصيل", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 100, 200);
    charge(1, 102, 100, 10);
    // دفعة تكفي أقدم فاتورة بالضبط.
    collect(1, 100, 5);

    const r = receivablesAging(db, ASOF);
    expect(r.total).toBe(100);
    // القديمة أُطفئت، فلم يبق إلا الحديثة.
    expect(r.totals.d90).toBe(0);
    expect(r.totals.d0).toBe(100);
    expect(r.rows[0].documents).toHaveLength(1);
    expect(r.rows[0].documents[0].refNo).toBe(102);
  });

  it("يترك الباقي من فاتورة سُددت جزئيًا", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 500, 100);
    collect(1, 200, 5);

    const r = receivablesAging(db, ASOF);
    expect(r.total).toBe(300);
    const doc = r.rows[0].documents[0];
    expect(doc.original).toBe(500);
    expect(doc.remaining).toBe(300);
    expect(doc.bucket).toBe("d90");
  });

  it("يستبعد العميل المسدَّد بالكامل", () => {
    addCustomer(1, "عمار");
    addCustomer(2, "سالم");
    charge(1, 101, 250, 40);
    collect(1, 250, 1);
    charge(2, 102, 90, 40);

    const r = receivablesAging(db, ASOF);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe("سالم");
    expect(r.total).toBe(90);
  });

  it("المرتجع ينقص الدين كالتحصيل", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 400, 50);
    db.customerLedger.push({
      id: 99,
      customerId: 1,
      at: daysAgo(3),
      type: "مرتجع بيع",
      refNo: 101,
      debit: 0,
      credit: 150,
      note: "",
    });

    expect(receivablesAging(db, ASOF).total).toBe(250);
  });

  it("يرتب الأكثر تعثرًا أولًا", () => {
    addCustomer(1, "حديث");
    addCustomer(2, "متعثر");
    charge(1, 101, 900, 5);
    charge(2, 102, 100, 300);

    const r = receivablesAging(db, ASOF);
    // الأقدم أولًا ولو كان مبلغه أصغر، فهو ما يحتاج قرارًا.
    expect(r.rows[0].name).toBe("متعثر");
    expect(r.rows[0].oldestDays).toBe(300);
  });

  it("يتجاهل ما وقع بعد تاريخ التقرير", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 100, 10);
    db.customerLedger.push({
      id: 50,
      customerId: 1,
      at: new Date(ASOF.getTime() + 5 * 86400000).toISOString(),
      type: "فاتورة بيع",
      refNo: 102,
      debit: 700,
      credit: 0,
      note: "",
    });

    // التقرير بتاريخ معين لا يرى المستقبل.
    expect(receivablesAging(db, ASOF).total).toBe(100);
  });
});

describe("أعمار ذمم الموردين", () => {
  beforeEach(() => {
    db.suppliers.push({
      id: 1,
      name: "مورد الحقل",
      phone: "0555",
      email: "",
      address: "",
      taxNumber: "",
      notes: "",
      status: "active",
      createdAt: daysAgo(400),
    });
  });

  it("فاتورة الشراء دائنة فتزيد ما علينا", () => {
    db.supplierLedger.push({
      id: 1,
      supplierId: 1,
      at: daysAgo(120),
      type: "فاتورة شراء",
      refNo: 5001,
      debit: 0,
      credit: 800,
      note: "",
    });

    const r = payablesAging(db, ASOF);
    expect(r.total).toBe(800);
    expect(r.totals.d90).toBe(800);
  });

  it("الدفعة مدينة فتنقصه بالأقدم أولًا", () => {
    db.supplierLedger.push(
      {
        id: 1,
        supplierId: 1,
        at: daysAgo(120),
        type: "فاتورة شراء",
        refNo: 5001,
        debit: 0,
        credit: 800,
        note: "",
      },
      {
        id: 2,
        supplierId: 1,
        at: daysAgo(10),
        type: "فاتورة شراء",
        refNo: 5002,
        debit: 0,
        credit: 200,
        note: "",
      },
      {
        id: 3,
        supplierId: 1,
        at: daysAgo(2),
        type: "دفعة",
        refNo: 5001,
        debit: 800,
        credit: 0,
        note: "",
      }
    );

    const r = payablesAging(db, ASOF);
    expect(r.total).toBe(200);
    expect(r.totals.d90).toBe(0);
    expect(r.totals.d0).toBe(200);
  });
});

describe("مخصص الديون المشكوك فيها", () => {
  it("يطبق نسبة كل شريحة", () => {
    addCustomer(1, "عمار");
    charge(1, 101, 1000, 10); // 0%
    charge(1, 102, 1000, 45); // 5%
    charge(1, 103, 1000, 75); // 15%
    charge(1, 104, 1000, 200); // 50%

    const allowance = doubtfulAllowance(receivablesAging(db, ASOF));
    expect(allowance.total).toBe(700);
    expect(allowance.lines.find(l => l.bucket === "d0")!.allowance).toBe(0);
    expect(allowance.lines.find(l => l.bucket === "d90")!.allowance).toBe(500);
  });

  it("بلا ديون لا مخصص", () => {
    expect(doubtfulAllowance(receivablesAging(db, ASOF)).total).toBe(0);
  });
});
