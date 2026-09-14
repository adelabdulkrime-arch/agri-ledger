// Design: «سوق الحقل» — الأصول الثابتة وإهلاكها، والمصروفات المدفوعة مقدمًا.
//
// المبدأ الواحد خلف الاثنين: ما دفعتَه اليوم ولم تستهلكه بعد ليس مصروف
// اليوم. الثلاجة تخدمك خمس سنوات، وإيجار السنة يغطي اثني عشر شهرًا،
// فتحميل قيمتهما كاملة على شهر الشراء يشوّه ربح ذلك الشهر ويجمّل ما
// بعده. لذلك يدخلان أصلًا، ثم يُحمَّل كل شهر نصيبه.
import type { DbState, ExpenseCategory, FixedAsset, PrepaidExpense } from "./types";
import { OperationError, round2 } from "./operations";
import { ACC, postJournal } from "./ledger";
import { nextId } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** مفتاح الشهر بصيغة YYYY-MM؛ به نمنع ترحيل الشهر مرتين. */
export function monthKey(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** عدد الأشهر الكاملة بين تاريخين؛ سالب يعني أن البداية في المستقبل. */
function monthsBetween(from: Date, to: Date) {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

// ------------------------------------------------------- الأصول الثابتة

export function createAsset(
  state: DbState,
  input: {
    name: string;
    cost: number;
    purchasedAt?: string;
    usefulLifeYears: number;
    salvageValue?: number;
    note?: string;
  }
): FixedAsset {
  if (!state.fixedAssets) state.fixedAssets = [];

  const name = (input.name || "").trim();
  if (!name) fail("اسم الأصل مطلوب");

  const cost = round2(Number(input.cost));
  if (!Number.isFinite(cost) || cost <= 0)
    fail("تكلفة الأصل يجب أن تكون أكبر من صفر");

  const years = Number(input.usefulLifeYears);
  if (!Number.isFinite(years) || years <= 0)
    fail("العمر الإنتاجي يجب أن يكون أكبر من صفر");

  const salvage = round2(Number(input.salvageValue || 0));
  if (!Number.isFinite(salvage) || salvage < 0)
    fail("القيمة التخريدية لا تصح أن تكون سالبة");
  if (salvage >= cost) fail("القيمة التخريدية يجب أن تقل عن التكلفة");

  const asset: FixedAsset = {
    id: nextId(state.fixedAssets),
    name,
    cost,
    purchasedAt: input.purchasedAt || new Date().toISOString(),
    usefulLifeYears: years,
    salvageValue: salvage,
    accumulated: 0,
    note: (input.note || "").trim(),
    active: true,
  };
  state.fixedAssets.push(asset);
  return asset;
}

/** قسط الإهلاك الشهري بالقسط الثابت. */
export function monthlyDepreciation(asset: FixedAsset) {
  return round2(
    (asset.cost - asset.salvageValue) / (asset.usefulLifeYears * 12)
  );
}

/** القيمة الدفترية: التكلفة ناقص ما أُهلك. */
export function bookValue(asset: FixedAsset) {
  return round2(asset.cost - asset.accumulated);
}

/** هل اكتمل إهلاك الأصل؟ عندها يتوقف الترحيل عند القيمة التخريدية. */
export function isFullyDepreciated(asset: FixedAsset) {
  return asset.accumulated >= round2(asset.cost - asset.salvageValue) - 0.01;
}

/**
 * يرحّل إهلاك شهر واحد لكل أصل لم يُرحَّل له بعد.
 *
 * لا نرحّل أكثر من القيمة القابلة للإهلاك مهما طال الزمن: الأصل لا
 * تنزل قيمته تحت قيمته التخريدية، وإلا ظهر في الدفاتر بقيمة سالبة.
 */
export function postMonthlyDepreciation(
  state: DbState,
  forMonth = new Date()
): { assets: number; total: number } {
  const key = monthKey(forMonth);
  const assets = (state.fixedAssets || []).filter(a => a.active);

  let total = 0;
  let count = 0;

  assets.forEach(asset => {
    if (asset.lastPostedMonth === key) return;
    if (isFullyDepreciated(asset)) return;
    // لا إهلاك قبل دخول الأصل الخدمة.
    if (monthsBetween(new Date(asset.purchasedAt), forMonth) < 0) return;

    const monthly = monthlyDepreciation(asset);
    const remaining = round2(
      asset.cost - asset.salvageValue - asset.accumulated
    );
    // القسط الأخير يأخذ ما تبقى فقط، فلا يتجاوز المجمع حدّه.
    const amount = Math.min(monthly, remaining);
    if (amount <= 0.009) return;

    asset.accumulated = round2(asset.accumulated + amount);
    asset.lastPostedMonth = key;
    total = round2(total + amount);
    count++;
  });

  if (total > 0.009)
    postJournal(state, {
      at: forMonth.toISOString(),
      source: "depreciation",
      sourceNo: 0,
      description: `إهلاك أصول ثابتة — ${key}`,
      lines: [
        { accountCode: ACC.depreciation, debit: total, memo: "قسط الشهر" },
        {
          accountCode: ACC.accumDepreciation,
          credit: total,
          memo: "مجمع الإهلاك",
        },
      ],
    });

  return { assets: count, total };
}

/** ملخّص الأصول: التكلفة والمجمع والقيمة الدفترية. */
export function assetsSummary(state: DbState) {
  const rows = (state.fixedAssets || []).filter(a => a.active);
  const cost = round2(rows.reduce((sum, a) => sum + a.cost, 0));
  const accumulated = round2(rows.reduce((sum, a) => sum + a.accumulated, 0));
  return {
    count: rows.length,
    cost,
    accumulated,
    bookValue: round2(cost - accumulated),
  };
}

// ------------------------------------------------- المصروفات المقدمة

export function createPrepaid(
  state: DbState,
  input: {
    description: string;
    amount: number;
    months: number;
    category: ExpenseCategory;
    startAt?: string;
    note?: string;
  }
): PrepaidExpense {
  if (!state.prepaidExpenses) state.prepaidExpenses = [];

  const description = (input.description || "").trim();
  if (!description) fail("وصف المصروف مطلوب");

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0)
    fail("المبلغ يجب أن يكون أكبر من صفر");

  const months = Number(input.months);
  if (!Number.isFinite(months) || months <= 0)
    fail("عدد الأشهر يجب أن يكون أكبر من صفر");

  const entry: PrepaidExpense = {
    id: nextId(state.prepaidExpenses),
    description,
    amount,
    startAt: input.startAt || new Date().toISOString(),
    months: Math.round(months),
    category: input.category,
    amortized: 0,
    note: (input.note || "").trim(),
  };
  state.prepaidExpenses.push(entry);

  // الدفع أصل لا مصروف: خرج النقد وبقيت المنفعة.
  postJournal(state, {
    at: entry.startAt,
    source: "prepaid",
    sourceNo: entry.id,
    description: `مصروف مقدم: ${description}`,
    lines: [
      { accountCode: ACC.prepaid, debit: amount, memo: description },
      { accountCode: ACC.cash, credit: amount, memo: "دفع مقدم" },
    ],
  });

  return entry;
}

export function monthlyAmortization(entry: PrepaidExpense) {
  return round2(entry.amount / entry.months);
}

export function prepaidRemaining(entry: PrepaidExpense) {
  return round2(entry.amount - entry.amortized);
}

/**
 * يحمّل نصيب الشهر من المصروفات المقدمة على المصروف الفعلي.
 * القسط الأخير يأخذ ما تبقى، فلا يبقى كسر عالق في الأصل.
 */
export function postMonthlyAmortization(
  state: DbState,
  forMonth = new Date()
): { entries: number; total: number } {
  const key = monthKey(forMonth);
  let total = 0;
  let count = 0;

  (state.prepaidExpenses || []).forEach(entry => {
    if (entry.lastPostedMonth === key) return;
    if (prepaidRemaining(entry) <= 0.009) return;
    if (monthsBetween(new Date(entry.startAt), forMonth) < 0) return;

    const share = Math.min(monthlyAmortization(entry), prepaidRemaining(entry));
    if (share <= 0.009) return;

    entry.amortized = round2(entry.amortized + share);
    entry.lastPostedMonth = key;
    total = round2(total + share);
    count++;
  });

  if (total > 0.009)
    postJournal(state, {
      at: forMonth.toISOString(),
      source: "prepaid_amortization",
      sourceNo: 0,
      description: `استهلاك مصروفات مقدمة — ${key}`,
      lines: [
        { accountCode: ACC.expenses, debit: total, memo: "نصيب الشهر" },
        { accountCode: ACC.prepaid, credit: total, memo: "إطفاء مقدم" },
      ],
    });

  return { entries: count, total };
}

export function prepaidSummary(state: DbState) {
  const rows = state.prepaidExpenses || [];
  const paid = round2(rows.reduce((sum, e) => sum + e.amount, 0));
  const amortized = round2(rows.reduce((sum, e) => sum + e.amortized, 0));
  return {
    count: rows.length,
    paid,
    amortized,
    remaining: round2(paid - amortized),
  };
}
