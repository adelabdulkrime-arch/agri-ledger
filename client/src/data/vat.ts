// Design: «سوق الحقل» — الإقرار الضريبي: ما حُصّل، وما دُفع، وما يُسدَّد للهيئة.
//
// حدٌّ يجب أن يبقى واضحًا: هذا التقرير يقرأ ما رُحّل فعلًا في الدفاتر،
// ولا يُقدَّم للهيئة تلقائيًا. المحل غير المسجَّل في ضريبة القيمة المضافة
// لا يخصم ضريبة مدخلات، فيظهر الإقرار له بضريبة مخرجات فقط مع بيان السبب.
import type { DbState, Purchase, Sale } from "./types";
import { round2 } from "./operations";

/** فترة الإقرار: من تاريخ إلى تاريخ، شاملة الطرفين. */
export type VatPeriod = { from: Date; to: Date };

export type VatLine = {
  label: string;
  /** الوعاء: قيمة المبيعات أو المشتريات قبل الضريبة. */
  base: number;
  vat: number;
};

export type VatReturn = {
  from: string;
  to: string;
  /** ضريبة محصَّلة من العملاء على المبيعات. */
  outputVat: number;
  /** ضريبة مدفوعة للموردين، قابلة للخصم عند التسجيل فقط. */
  inputVat: number;
  /** المستحق للهيئة؛ سالب يعني رصيدًا مستردًا. */
  net: number;
  sales: VatLine;
  salesReturns: VatLine;
  purchases: VatLine;
  purchaseReturns: VatLine;
  /** هل المحل مسجَّل؛ غير المسجَّل لا يخصم مدخلاته. */
  registered: boolean;
  /** عدد الفواتير الداخلة في الإقرار، للمراجعة. */
  invoiceCount: number;
};

function within(at: string, period: VatPeriod) {
  const t = new Date(at).getTime();
  return t >= period.from.getTime() && t <= period.to.getTime();
}

/** حدود شهر ميلادي كامل، وهي الفترة الشائعة للإقرار. */
export function monthPeriod(year: number, month: number): VatPeriod {
  return {
    from: new Date(year, month, 1, 0, 0, 0, 0),
    to: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
}

/** حدود ربع سنة؛ كثير من المنشآت الصغيرة تُقر ربعيًا. */
export function quarterPeriod(year: number, quarter: number): VatPeriod {
  const start = (quarter - 1) * 3;
  return {
    from: new Date(year, start, 1, 0, 0, 0, 0),
    to: new Date(year, start + 3, 0, 23, 59, 59, 999),
  };
}

/**
 * يبني الإقرار من الفواتير المرحَّلة في الفترة.
 *
 * نقرأ من الفواتير لا من أرصدة الحسابات، لأن رصيد الحساب تراكمي بينما
 * الإقرار يخص فترة بعينها.
 */
export function vatReturn(state: DbState, period: VatPeriod): VatReturn {
  const registered = state.settings?.vatRegistered === true;

  const sales: Sale[] = (state.sales || []).filter(s => within(s.at, period));
  const purchases: Purchase[] = (state.purchases || []).filter(
    p => p.status === "confirmed" && within(p.at, period)
  );

  const salesVat = round2(sales.reduce((sum, s) => sum + (s.tax || 0), 0));
  const salesBase = round2(
    sales.reduce((sum, s) => sum + (s.total - (s.tax || 0)), 0)
  );

  const purchasesVat = round2(
    purchases.reduce((sum, p) => sum + (p.tax || 0), 0)
  );
  const purchasesBase = round2(
    purchases.reduce((sum, p) => sum + (p.total - (p.tax || 0)), 0)
  );

  // المرتجعات تقلل الوعاء والضريبة معًا في الفترة التي وقعت فيها.
  const returns = (state.returns || []).filter(r => within(r.at, period));

  const saleReturnBase = round2(
    returns.filter(r => r.kind === "sale").reduce((sum, r) => sum + r.total, 0)
  );
  const purchaseReturnRows = returns.filter(r => r.kind === "purchase");
  const purchaseReturnBase = round2(
    purchaseReturnRows.reduce((sum, r) => sum + r.total, 0)
  );
  // فرق سعر الوحدة عن تكلفتها في مرتجع الشراء هو الضريبة المردودة.
  const purchaseReturnVat = round2(
    purchaseReturnRows.reduce(
      (sum, r) =>
        sum +
        r.lines.reduce(
          (acc, l) => acc + round2((l.unitPrice - l.unitCost) * l.qty),
          0
        ),
      0
    )
  );

  const outputVat = round2(salesVat);
  // غير المسجَّل لا يسترد مدخلاته، فهي جزء من تكلفته لا خصم له.
  const inputVat = registered
    ? round2(purchasesVat - purchaseReturnVat)
    : 0;

  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    outputVat,
    inputVat,
    net: round2(outputVat - inputVat),
    sales: { label: "المبيعات", base: salesBase, vat: salesVat },
    salesReturns: {
      label: "مردودات المبيعات",
      base: saleReturnBase,
      vat: 0,
    },
    purchases: {
      label: "المشتريات",
      base: purchasesBase,
      vat: purchasesVat,
    },
    purchaseReturns: {
      label: "مردودات المشتريات",
      base: purchaseReturnBase,
      vat: purchaseReturnVat,
    },
    registered,
    invoiceCount: sales.length + purchases.length,
  };
}
