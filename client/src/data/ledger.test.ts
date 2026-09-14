// اختبارات محرك القيد المزدوج: الترحيل، التوازن، الأستاذ، والقوائم المالية.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { OperationError } from "./operations";
import {
  ACC,
  accountBalance,
  balanceSheet,
  closePeriod,
  createAccount,
  defaultChart,
  ensureChart,
  findAccount,
  generalLedger,
  incomeStatement,
  isClosed,
  postJournal,
  postedTrialBalance,
  reverseJournal,
} from "./ledger";
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
  run(d => ensureChart(d));
});

describe("دليل الحسابات", () => {
  it("يهيّئ الدليل الافتراضي مرة واحدة", () => {
    expect(db.accounts.length).toBe(defaultChart().length);
    const added = run(d => ensureChart(d));
    expect(added).toBe(0);
    expect(db.accounts.length).toBe(defaultChart().length);
  });

  it("يضبط طبيعة الرصيد حسب نوع الحساب", () => {
    expect(findAccount(db, ACC.cash)!.normalSide).toBe("debit");
    expect(findAccount(db, ACC.inventory)!.normalSide).toBe("debit");
    expect(findAccount(db, ACC.cogs)!.normalSide).toBe("debit");
    expect(findAccount(db, ACC.sales)!.normalSide).toBe("credit");
    expect(findAccount(db, ACC.payables)!.normalSide).toBe("credit");
    expect(findAccount(db, ACC.capital)!.normalSide).toBe("credit");
  });

  it("يضيف حسابًا فرعيًا ويرفض المكرر", () => {
    run(d =>
      createAccount(d, {
        code: "5210",
        name: "إيجار",
        type: "expense",
        parent: "5000",
      })
    );
    expect(findAccount(db, "5210")!.normalSide).toBe("debit");
    expect(findAccount(db, "5210")!.system).toBe(false);
    expect(() =>
      run(d => createAccount(d, { code: "5210", name: "x", type: "expense" }))
    ).toThrow(/موجود بالفعل/);
    expect(() =>
      run(d =>
        createAccount(d, {
          code: "9999",
          name: "y",
          type: "expense",
          parent: "8888",
        })
      )
    ).toThrow(/الأب غير موجود/);
  });
});

describe("ترحيل القيود", () => {
  it("يرحّل قيدًا متوازنًا", () => {
    const j = run(d =>
      postJournal(d, {
        source: "manual",
        sourceNo: 1,
        description: "رأس مال افتتاحي",
        lines: [
          { accountCode: ACC.cash, debit: 10000 },
          { accountCode: ACC.capital, credit: 10000 },
        ],
      })
    );
    expect(j.no).toBe(1001);
    expect(j.lines).toHaveLength(2);
    expect(accountBalance(db, ACC.cash)).toBe(10000);
    expect(accountBalance(db, ACC.capital)).toBe(10000);
  });

  it("يرفض القيد غير المتوازن", () => {
    expect(() =>
      run(d =>
        postJournal(d, {
          source: "manual",
          sourceNo: 1,
          description: "خطأ",
          lines: [
            { accountCode: ACC.cash, debit: 100 },
            { accountCode: ACC.capital, credit: 90 },
          ],
        })
      )
    ).toThrow(/غير متوازن/);
    expect(db.journal).toHaveLength(0);
  });

  it("يرفض السطر المدين والدائن معًا والقيم السالبة", () => {
    expect(() =>
      run(d =>
        postJournal(d, {
          source: "manual",
          sourceNo: 1,
          description: "x",
          lines: [{ accountCode: ACC.cash, debit: 50, credit: 50 }],
        })
      )
    ).toThrow(/مدينًا ودائنًا معًا/);
    expect(() =>
      run(d =>
        postJournal(d, {
          source: "manual",
          sourceNo: 1,
          description: "x",
          lines: [
            { accountCode: ACC.cash, debit: -5 },
            { accountCode: ACC.capital, credit: -5 },
          ],
        })
      )
    ).toThrow(/سالبة/);
  });

  it("يرفض حسابًا غير موجود وقيدًا بلا سطور", () => {
    expect(() =>
      run(d =>
        postJournal(d, {
          source: "manual",
          sourceNo: 1,
          description: "x",
          lines: [
            { accountCode: "8888", debit: 10 },
            { accountCode: ACC.cash, credit: 10 },
          ],
        })
      )
    ).toThrow(/غير موجود في الدليل/);
    expect(() =>
      run(d =>
        postJournal(d, {
          source: "manual",
          sourceNo: 1,
          description: "x",
          lines: [],
        })
      )
    ).toThrow(/بلا سطور/);
  });

  it("يعكس القيد بقيد مضاد بدل الحذف", () => {
    run(d =>
      postJournal(d, {
        source: "manual",
        sourceNo: 1,
        description: "قيد",
        lines: [
          { accountCode: ACC.cash, debit: 500 },
          { accountCode: ACC.sales, credit: 500 },
        ],
      })
    );
    run(d => reverseJournal(d, 1001));
    // القيد الأصلي باقٍ، والرصيد صار صفرًا.
    expect(db.journal).toHaveLength(2);
    expect(db.journal[0].reversedBy).toBe(1002);
    expect(accountBalance(db, ACC.cash)).toBe(0);
    expect(() => run(d => reverseJournal(d, 1001))).toThrow(/معكوس بالفعل/);
  });
});

describe("الأستاذ وميزان المراجعة", () => {
  beforeEach(() => {
    run(d => {
      postJournal(d, {
        source: "manual",
        sourceNo: 1,
        description: "رأس مال",
        lines: [
          { accountCode: ACC.cash, debit: 10000 },
          { accountCode: ACC.capital, credit: 10000 },
        ],
      });
      postJournal(d, {
        source: "sale",
        sourceNo: 1049,
        description: "بيع نقدي",
        lines: [
          { accountCode: ACC.cash, debit: 700, memo: "تحصيل" },
          { accountCode: ACC.sales, credit: 700, memo: "مبيعات" },
        ],
      });
      postJournal(d, {
        source: "sale",
        sourceNo: 1049,
        description: "تكلفة المبيع",
        lines: [
          { accountCode: ACC.cogs, debit: 400 },
          { accountCode: ACC.inventory, credit: 400 },
        ],
      });
    });
  });

  it("يعرض دفتر الأستاذ برصيد تراكمي", () => {
    const rows = generalLedger(db, ACC.cash);
    expect(rows).toHaveLength(2);
    expect(rows[0].balance).toBe(10000);
    expect(rows[1].balance).toBe(10700);
  });

  it("ميزان المراجعة المرحَّل متوازن", () => {
    const tb = postedTrialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    const cash = tb.rows.find(r => r.code === ACC.cash)!;
    expect(cash.debit).toBe(10700);
  });

  it("يحسب قائمة الدخل", () => {
    const inc = incomeStatement(db);
    expect(inc.revenue).toBe(700);
    expect(inc.expenses).toBe(400);
    expect(inc.netIncome).toBe(300);
  });

  it("الميزانية العمومية متوازنة", () => {
    const bs = balanceSheet(db);
    // الأصول: نقد 10700 ناقص مخزون 400 = 10300
    expect(bs.assets).toBe(10300);
    expect(bs.balanced).toBe(true);
  });
});

describe("إقفال الفترات", () => {
  it("يمنع الترحيل داخل فترة مقفلة", () => {
    run(d => closePeriod(d, "2026-01-01", "2026-01-31", "إقفال يناير"));
    expect(isClosed(db, "2026-01-15T10:00:00.000Z")).toBe(true);
    expect(isClosed(db, "2026-02-15T10:00:00.000Z")).toBe(false);

    expect(() =>
      run(d =>
        postJournal(d, {
          at: "2026-01-15T10:00:00.000Z",
          source: "manual",
          sourceNo: 1,
          description: "قيد متأخر",
          lines: [
            { accountCode: ACC.cash, debit: 100 },
            { accountCode: ACC.capital, credit: 100 },
          ],
        })
      )
    ).toThrow(/فترة محاسبية مقفلة/);
  });

  it("يقبل الترحيل خارج الفترة المقفلة", () => {
    run(d => closePeriod(d, "2026-01-01", "2026-01-31"));
    run(d =>
      postJournal(d, {
        at: "2026-02-01T10:00:00.000Z",
        source: "manual",
        sourceNo: 1,
        description: "قيد صالح",
        lines: [
          { accountCode: ACC.cash, debit: 100 },
          { accountCode: ACC.capital, credit: 100 },
        ],
      })
    );
    expect(db.journal).toHaveLength(1);
  });

  it("يرفض الفترات المتداخلة والتواريخ المقلوبة", () => {
    run(d => closePeriod(d, "2026-01-01", "2026-01-31"));
    expect(() =>
      run(d => closePeriod(d, "2026-01-15", "2026-02-15"))
    ).toThrow(/متداخلة/);
    expect(() =>
      run(d => closePeriod(d, "2026-05-01", "2026-04-01"))
    ).toThrow(/البداية بعد/);
    expect(() => run(d => closePeriod(d, "نص", "خطأ"))).toThrow(
      OperationError
    );
  });
});
