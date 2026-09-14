// اختبارات الأرصدة الافتتاحية، القيود اليدوية، والتحويل بين الصندوق والبنك.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { OperationError } from "./operations";
import {
  ACC,
  accountBalance,
  ensureChart,
  postManualJournal,
  postOpeningBalance,
  postedTrialBalance,
  transferCash,
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

describe("الرصيد الافتتاحي", () => {
  it("يسجل نقدًا مقابل رأس المال", () => {
    run(d => postOpeningBalance(d, { cash: 10000 }));
    expect(accountBalance(db, ACC.cash)).toBe(10000);
    expect(accountBalance(db, ACC.capital)).toBe(10000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يوزّع بين الصندوق والبنك", () => {
    run(d => postOpeningBalance(d, { cash: 3000, bank: 7000 }));
    expect(accountBalance(db, ACC.cash)).toBe(3000);
    expect(accountBalance(db, ACC.bank)).toBe(7000);
    // رأس المال يساوي المجموع.
    expect(accountBalance(db, ACC.capital)).toBe(10000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يرفض الصفر والسالب", () => {
    expect(() => run(d => postOpeningBalance(d, {}))).toThrow(/أكبر من صفر/);
    expect(() => run(d => postOpeningBalance(d, { cash: 0, bank: 0 }))).toThrow(
      /أكبر من صفر/
    );
    expect(() => run(d => postOpeningBalance(d, { cash: -5 }))).toThrow(
      /سالبًا/
    );
    expect(db.journal).toHaveLength(0);
  });
});

describe("القيد اليدوي", () => {
  it("يرحّل قيدًا متوازنًا بوصف", () => {
    run(d =>
      postManualJournal(d, {
        description: "تسوية مصروف",
        lines: [
          { accountCode: ACC.expenses, debit: 250 },
          { accountCode: ACC.cash, credit: 250 },
        ],
      })
    );
    expect(db.journal).toHaveLength(1);
    expect(db.journal[0].source).toBe("manual");
    expect(accountBalance(db, ACC.expenses)).toBe(250);
  });

  it("يرفض القيد بلا وصف", () => {
    expect(() =>
      run(d =>
        postManualJournal(d, {
          description: "   ",
          lines: [
            { accountCode: ACC.cash, debit: 10 },
            { accountCode: ACC.capital, credit: 10 },
          ],
        })
      )
    ).toThrow(/بيانًا/);
  });

  it("يرفض القيد غير المتوازن كغيره", () => {
    expect(() =>
      run(d =>
        postManualJournal(d, {
          description: "خطأ",
          lines: [
            { accountCode: ACC.cash, debit: 100 },
            { accountCode: ACC.capital, credit: 60 },
          ],
        })
      )
    ).toThrow(/غير متوازن/);
  });
});

describe("التحويل بين الصندوق والبنك", () => {
  beforeEach(() => {
    run(d => postOpeningBalance(d, { cash: 5000 }));
  });

  it("الإيداع ينقل من الصندوق إلى البنك", () => {
    run(d => transferCash(d, { from: "cash", amount: 2000 }));
    expect(accountBalance(db, ACC.cash)).toBe(3000);
    expect(accountBalance(db, ACC.bank)).toBe(2000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("السحب يعيد المال للصندوق", () => {
    run(d => transferCash(d, { from: "cash", amount: 2000 }));
    run(d => transferCash(d, { from: "bank", amount: 500 }));
    expect(accountBalance(db, ACC.cash)).toBe(3500);
    expect(accountBalance(db, ACC.bank)).toBe(1500);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يمنع تحويل أكثر من الرصيد المتاح", () => {
    expect(() =>
      run(d => transferCash(d, { from: "cash", amount: 9999 }))
    ).toThrow(/الرصيد المتاح/);
    expect(() =>
      run(d => transferCash(d, { from: "bank", amount: 1 }))
    ).toThrow(/الرصيد المتاح/);
    expect(accountBalance(db, ACC.cash)).toBe(5000);
  });

  it("يرفض القيم غير الصحيحة", () => {
    expect(() =>
      run(d => transferCash(d, { from: "cash", amount: 0 }))
    ).toThrow(OperationError);
    expect(() =>
      run(d => transferCash(d, { from: "cash", amount: -10 }))
    ).toThrow(/غير صحيحة/);
  });
});
