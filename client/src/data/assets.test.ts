// اختبارات الأصول الثابتة وإهلاكها، والمصروفات المدفوعة مقدمًا،
// وقوائم الأسعار ومراكز التكلفة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { OperationError, addExpense } from "./operations";
import { ACC, accountBalance, postedTrialBalance } from "./ledger";
import {
  assetsSummary,
  bookValue,
  createAsset,
  createPrepaid,
  isFullyDepreciated,
  monthlyDepreciation,
  monthKey,
  postMonthlyAmortization,
  postMonthlyDepreciation,
  prepaidRemaining,
  prepaidSummary,
} from "./assets";
import {
  createCostCenter,
  createPriceList,
  expensesByCostCenter,
  priceFor,
  priceListSummary,
  setListPrice,
  updatePriceList,
} from "./pricing";
import type { DbState, Product } from "./types";

function product(id: number, price: number): Product {
  return {
    id,
    name: `صنف ${id}`,
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price,
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
  db.products = [product(1, 100), product(2, 50)];
});

describe("الأصول الثابتة", () => {
  /** ثلاجة بـ 12000، عمرها 5 سنوات، تخريد 0 → القسط 200 شهريًا. */
  function fridge(d: DbState) {
    return createAsset(d, {
      name: "ثلاجة عرض",
      cost: 12000,
      usefulLifeYears: 5,
      purchasedAt: new Date(2026, 0, 15).toISOString(),
    });
  }

  it("يحسب القسط الشهري بالقسط الثابت", () => {
    const a = run(fridge);
    expect(monthlyDepreciation(a)).toBe(200);
    expect(bookValue(a)).toBe(12000);
  });

  it("القيمة التخريدية تُستبعد من الإهلاك", () => {
    const a = run(d =>
      createAsset(d, {
        name: "سيارة",
        cost: 60000,
        salvageValue: 12000,
        usefulLifeYears: 4,
      })
    );
    // (60000 - 12000) ÷ 48 شهرًا
    expect(monthlyDepreciation(a)).toBe(1000);
  });

  it("يرفض المدخلات غير الصحيحة", () => {
    expect(() =>
      run(d => createAsset(d, { name: "", cost: 100, usefulLifeYears: 1 }))
    ).toThrow(/اسم الأصل/);
    expect(() =>
      run(d => createAsset(d, { name: "x", cost: 0, usefulLifeYears: 1 }))
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      run(d => createAsset(d, { name: "x", cost: 100, usefulLifeYears: 0 }))
    ).toThrow(/العمر الإنتاجي/);
    // التخريد لا يبلغ التكلفة وإلا فلا شيء يُهلك.
    expect(() =>
      run(d =>
        createAsset(d, {
          name: "x",
          cost: 100,
          salvageValue: 100,
          usefulLifeYears: 1,
        })
      )
    ).toThrow(/تقل عن التكلفة/);
  });

  it("الترحيل الشهري يقيّد المصروف ومجمع الإهلاك", () => {
    run(fridge);
    const out = run(d => postMonthlyDepreciation(d, new Date(2026, 1, 1)));

    expect(out.assets).toBe(1);
    expect(out.total).toBe(200);
    expect(accountBalance(db, ACC.depreciation)).toBe(200);
    // المجمع دائن الطبيعة، فرصيده يظهر موجبًا بمقدار ما أُهلك.
    expect(accountBalance(db, ACC.accumDepreciation)).toBe(200);
    expect(postedTrialBalance(db).balanced).toBe(true);
    expect(bookValue(db.fixedAssets![0])).toBe(11800);
  });

  it("لا يرحّل الشهر نفسه مرتين", () => {
    run(fridge);
    const month = new Date(2026, 1, 1);
    run(d => postMonthlyDepreciation(d, month));
    const again = run(d => postMonthlyDepreciation(d, month));

    expect(again.assets).toBe(0);
    expect(again.total).toBe(0);
    expect(accountBalance(db, ACC.depreciation)).toBe(200);
    expect(db.fixedAssets![0].lastPostedMonth).toBe(monthKey(month));
  });

  it("لا يرحّل قبل دخول الأصل الخدمة", () => {
    run(fridge);
    // الأصل اشتُري في يناير 2026؛ لا إهلاك في ديسمبر 2025.
    const out = run(d => postMonthlyDepreciation(d, new Date(2025, 11, 1)));
    expect(out.total).toBe(0);
  });

  it("القسط الأخير لا يتجاوز القيمة القابلة للإهلاك", () => {
    const a = run(d =>
      createAsset(d, {
        name: "طابعة",
        cost: 1000,
        salvageValue: 700,
        usefulLifeYears: 1,
        purchasedAt: new Date(2026, 0, 1).toISOString(),
      })
    );
    // القابل للإهلاك 300 على 12 شهرًا = 25.
    expect(monthlyDepreciation(a)).toBe(25);

    run(d => {
      for (let m = 0; m < 24; m++)
        postMonthlyDepreciation(d, new Date(2026, m, 1));
    });

    const stored = db.fixedAssets![0];
    // لا يتجاوز المجمع 300 مهما طال الزمن.
    expect(stored.accumulated).toBe(300);
    expect(bookValue(stored)).toBe(700);
    expect(isFullyDepreciated(stored)).toBe(true);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("الملخّص يجمع التكلفة والمجمع", () => {
    run(d => {
      fridge(d);
      createAsset(d, {
        name: "رفوف",
        cost: 3000,
        usefulLifeYears: 10,
        // تاريخ صريح: الأصل لا يُهلك قبل دخوله الخدمة، والافتراضي «اليوم».
        purchasedAt: new Date(2026, 0, 20).toISOString(),
      });
    });
    run(d => postMonthlyDepreciation(d, new Date(2026, 5, 1)));

    const s = assetsSummary(db);
    expect(s.count).toBe(2);
    expect(s.cost).toBe(15000);
    // 200 للثلاجة و25 للرفوف.
    expect(s.accumulated).toBe(225);
    expect(s.bookValue).toBe(14775);
  });
});

describe("المصروفات المدفوعة مقدمًا", () => {
  /** إيجار سنة بـ 24000 → 2000 شهريًا. */
  function rent(d: DbState) {
    return createPrepaid(d, {
      description: "إيجار سنة",
      amount: 24000,
      months: 12,
      category: "rent",
      startAt: new Date(2026, 0, 1).toISOString(),
    });
  }

  it("الدفع يدخل أصلًا لا مصروفًا", () => {
    run(rent);
    // المنفعة لم تُستهلك بعد، فالمبلغ أصل.
    expect(accountBalance(db, ACC.prepaid)).toBe(24000);
    expect(accountBalance(db, ACC.expenses)).toBe(0);
    expect(accountBalance(db, ACC.cash)).toBe(-24000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("كل شهر يأخذ نصيبه من الأصل إلى المصروف", () => {
    run(rent);
    const out = run(d => postMonthlyAmortization(d, new Date(2026, 1, 1)));

    expect(out.entries).toBe(1);
    expect(out.total).toBe(2000);
    expect(accountBalance(db, ACC.expenses)).toBe(2000);
    expect(accountBalance(db, ACC.prepaid)).toBe(22000);
    expect(prepaidRemaining(db.prepaidExpenses![0])).toBe(22000);
  });

  it("لا يستهلك الشهر نفسه مرتين", () => {
    run(rent);
    const month = new Date(2026, 1, 1);
    run(d => postMonthlyAmortization(d, month));
    const again = run(d => postMonthlyAmortization(d, month));
    expect(again.total).toBe(0);
    expect(accountBalance(db, ACC.expenses)).toBe(2000);
  });

  it("لا يتجاوز الاستهلاك المبلغ المدفوع", () => {
    run(rent);
    run(d => {
      for (let m = 0; m < 20; m++)
        postMonthlyAmortization(d, new Date(2026, m, 1));
    });

    const entry = db.prepaidExpenses![0];
    expect(entry.amortized).toBe(24000);
    expect(prepaidRemaining(entry)).toBe(0);
    // الأصل استُهلك بالكامل فصار صفرًا.
    expect(accountBalance(db, ACC.prepaid)).toBe(0);
    expect(accountBalance(db, ACC.expenses)).toBe(24000);
    expect(postedTrialBalance(db).balanced).toBe(true);
  });

  it("يرفض المدخلات غير الصحيحة", () => {
    expect(() =>
      run(d =>
        createPrepaid(d, {
          description: "",
          amount: 100,
          months: 1,
          category: "rent",
        })
      )
    ).toThrow(/وصف المصروف/);
    expect(() =>
      run(d =>
        createPrepaid(d, {
          description: "x",
          amount: 100,
          months: 0,
          category: "rent",
        })
      )
    ).toThrow(/عدد الأشهر/);
  });

  it("الملخّص يبيّن المتبقي", () => {
    run(rent);
    run(d => postMonthlyAmortization(d, new Date(2026, 1, 1)));
    const s = prepaidSummary(db);
    expect(s.paid).toBe(24000);
    expect(s.amortized).toBe(2000);
    expect(s.remaining).toBe(22000);
  });
});

describe("قوائم الأسعار", () => {
  beforeEach(() => {
    run(d => createPriceList(d, { name: "أسعار الجملة" }));
  });

  it("الصنف غير المسعّر يبقى بسعره المعتاد", () => {
    // القائمة استثناء لا بديل يجب ملؤه صنفًا صنفًا.
    expect(priceFor(db, 1, 1)).toBe(100);
    expect(priceFor(db, 1)).toBe(100);
  });

  it("السعر المخصص يسبق السعر المعتاد", () => {
    run(d => setListPrice(d, 1, 1, 85));
    expect(priceFor(db, 1, 1)).toBe(85);
    // السعر الأصلي لم يتغير.
    expect(db.products[0].price).toBe(100);
    expect(priceFor(db, 1)).toBe(100);
  });

  it("السعر صفرًا يزيل التخصيص", () => {
    run(d => setListPrice(d, 1, 1, 85));
    run(d => setListPrice(d, 1, 1, 0));
    expect(db.priceLists![0].items).toHaveLength(0);
    expect(priceFor(db, 1, 1)).toBe(100);
  });

  it("القائمة المعطّلة لا تُطبَّق", () => {
    run(d => setListPrice(d, 1, 1, 85));
    run(d => updatePriceList(d, 1, { active: false }));
    expect(priceFor(db, 1, 1)).toBe(100);
  });

  it("يرفض الاسم المكرر والسعر السالب", () => {
    expect(() =>
      run(d => createPriceList(d, { name: "أسعار الجملة" }))
    ).toThrow(/نفس الاسم/);
    expect(() => run(d => setListPrice(d, 1, 1, -5))).toThrow(/سالبًا/);
    expect(() => run(d => setListPrice(d, 99, 1, 10))).toThrow(
      OperationError
    );
  });

  it("الملخّص يحسب متوسط الفرق", () => {
    run(d => {
      setListPrice(d, 1, 1, 90); // -10%
      setListPrice(d, 1, 2, 40); // -20%
    });
    const s = priceListSummary(db, 1);
    expect(s.items).toBe(2);
    expect(s.avgDiff).toBe(-15);
  });
});

describe("مراكز التكلفة", () => {
  beforeEach(() => {
    run(d => {
      createCostCenter(d, { name: "الفرع الرئيسي" });
      createCostCenter(d, { name: "الفرع الثاني" });
    });
  });

  it("يوزّع المصروفات على المراكز", () => {
    run(d => {
      addExpense(d, {
        category: "rent",
        description: "إيجار الرئيسي",
        amount: 3000,
        costCenterId: 1,
      });
      addExpense(d, {
        category: "utilities",
        description: "كهرباء الثاني",
        amount: 700,
        costCenterId: 2,
      });
      addExpense(d, {
        category: "rent",
        description: "إيجار الثاني",
        amount: 1800,
        costCenterId: 2,
      });
    });

    const report = expensesByCostCenter(db);
    expect(report.total).toBe(5500);
    // الأكثر إنفاقًا أولًا.
    expect(report.rows[0].name).toBe("الفرع الرئيسي");
    expect(report.rows[0].total).toBe(3000);
    expect(report.rows[1].total).toBe(2500);
    expect(report.rows[1].count).toBe(2);
  });

  it("غير المنسوب يظهر مستقلًا ولا يختفي", () => {
    run(d => {
      addExpense(d, {
        category: "other",
        description: "بلا مركز",
        amount: 400,
      });
      addExpense(d, {
        category: "rent",
        description: "إيجار",
        amount: 600,
        costCenterId: 1,
      });
    });

    const report = expensesByCostCenter(db);
    expect(report.total).toBe(1000);
    const unassigned = report.rows.find(r => r.id === 0);
    expect(unassigned).toBeTruthy();
    expect(unassigned!.total).toBe(400);
  });

  it("يصفّي بالفترة", () => {
    run(d => {
      addExpense(d, {
        category: "rent",
        description: "قديم",
        amount: 100,
        costCenterId: 1,
        at: new Date(2025, 0, 1).toISOString(),
      });
      addExpense(d, {
        category: "rent",
        description: "حديث",
        amount: 900,
        costCenterId: 1,
        at: new Date(2026, 5, 1).toISOString(),
      });
    });

    const report = expensesByCostCenter(db, {
      from: new Date(2026, 0, 1),
      to: new Date(2026, 11, 31),
    });
    expect(report.total).toBe(900);
  });

  it("يرفض الاسم المكرر", () => {
    expect(() =>
      run(d => createCostCenter(d, { name: "الفرع الثاني" }))
    ).toThrow(/نفس الاسم/);
  });
});
