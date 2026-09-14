// Design: «سوق الحقل» — أعمار الديون: كم مضى على كل دين، ومتى يصير متعثرًا.
//
// حدٌّ يجب أن يبقى واضحًا: الفواتير في هذا النظام لا تحمل تاريخ استحقاق،
// ولا يسجّل العميل مهلة سداد بالأيام. لذلك نحسب العمر من تاريخ الفاتورة
// نفسها لا من تاريخ استحقاق لا وجود له، ونطفئ الفواتير بالأقدم أولًا.
// هذا هو العرف المحاسبي حين لا تُسجَّل المهلة، وهو تقدير صادق لا رقم
// مخترع: الدين الذي مضى عليه 95 يومًا يحتاج متابعة سواء اتُّفق على
// شهر أو شهرين.
import type { CustomerLedgerEntry, DbState, SupplierLedgerEntry } from "./types";
import { round2 } from "./operations";

/** شرائح العمر بالأيام؛ الحد الأعلى مفتوح في الأخيرة. */
export const AGING_BUCKETS = [
  { id: "d0", label: "0 - 30 يومًا", from: 0, to: 30 },
  { id: "d31", label: "31 - 60 يومًا", from: 31, to: 60 },
  { id: "d61", label: "61 - 90 يومًا", from: 61, to: 90 },
  { id: "d90", label: "أكثر من 90 يومًا", from: 91, to: Infinity },
] as const;

export type BucketId = (typeof AGING_BUCKETS)[number]["id"];

/** فاتورة لم تُسدَّد بالكامل، بما بقي منها وعمرها. */
export type OpenDocument = {
  refNo: number;
  at: string;
  type: string;
  original: number;
  /** ما بقي بعد توزيع الدفعات بالأقدم أولًا. */
  remaining: number;
  ageDays: number;
  bucket: BucketId;
};

export type PartyAging = {
  id: number;
  name: string;
  phone: string;
  total: number;
  buckets: Record<BucketId, number>;
  documents: OpenDocument[];
  /** أقدم دين قائم؛ هو ما يحدد خطورة الحساب. */
  oldestDays: number;
};

export type AgingReport = {
  rows: PartyAging[];
  totals: Record<BucketId, number>;
  total: number;
  /** ما مضى عليه أكثر من 90 يومًا؛ المرشح الأول لمخصص الديون المشكوك فيها. */
  overdue90: number;
  asOf: string;
};

function emptyBuckets(): Record<BucketId, number> {
  return { d0: 0, d31: 0, d61: 0, d90: 0 };
}

/** الفارق بالأيام الكاملة بين تاريخين، صفر للمستقبل. */
export function ageInDays(at: string, asOf: Date) {
  const diff = asOf.getTime() - new Date(at).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / 86400000);
}

export function bucketOf(days: number): BucketId {
  const found = AGING_BUCKETS.find(b => days >= b.from && days <= b.to);
  return (found?.id || "d90") as BucketId;
}

/**
 * توزيع الدفعات على الفواتير بالأقدم أولًا.
 *
 * `charges` فواتير تزيد الدين، و`credits` دفعات ومرتجعات تنقصه. نطفئ
 * الأقدم أولًا لأن العميل حين يدفع بلا تخصيص يُفترض أنه يسدد أقدم ما
 * عليه؛ العكس يجعل الدين القديم خالدًا في التقرير.
 */
function applyOldestFirst(
  charges: { refNo: number; at: string; type: string; amount: number }[],
  creditTotal: number,
  asOf: Date
): OpenDocument[] {
  let left = round2(creditTotal);
  const open: OpenDocument[] = [];

  for (const charge of charges) {
    let remaining = charge.amount;
    if (left > 0) {
      const used = Math.min(left, remaining);
      remaining = round2(remaining - used);
      left = round2(left - used);
    }
    // الفاتورة المسدَّدة بالكامل لا مكان لها في تقرير الديون القائمة.
    if (remaining <= 0.009) continue;

    const ageDays = ageInDays(charge.at, asOf);
    open.push({
      refNo: charge.refNo,
      at: charge.at,
      type: charge.type,
      original: charge.amount,
      remaining,
      ageDays,
      bucket: bucketOf(ageDays),
    });
  }

  return open;
}

/** يجمع قيود الطرف إلى فواتير قائمة، مهما اختلفت أسماء الحركات. */
function buildDocuments(
  entries: { at: string; type: string; refNo: number; charge: number; credit: number }[],
  asOf: Date
): OpenDocument[] {
  const within = entries.filter(e => new Date(e.at).getTime() <= asOf.getTime());

  const charges = within
    .filter(e => e.charge > 0)
    .map(e => ({
      refNo: e.refNo,
      at: e.at,
      type: e.type,
      amount: round2(e.charge),
    }))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const creditTotal = round2(
    within.reduce((sum, e) => sum + e.credit, 0)
  );

  return applyOldestFirst(charges, creditTotal, asOf);
}

function summarise(
  id: number,
  name: string,
  phone: string,
  documents: OpenDocument[]
): PartyAging {
  const buckets = emptyBuckets();
  documents.forEach(d => {
    buckets[d.bucket] = round2(buckets[d.bucket] + d.remaining);
  });

  return {
    id,
    name,
    phone,
    total: round2(documents.reduce((sum, d) => sum + d.remaining, 0)),
    buckets,
    documents: documents.sort((a, b) => b.ageDays - a.ageDays),
    oldestDays: documents.reduce((max, d) => Math.max(max, d.ageDays), 0),
  };
}

function report(rows: PartyAging[], asOf: Date): AgingReport {
  const totals = emptyBuckets();
  rows.forEach(r => {
    (Object.keys(totals) as BucketId[]).forEach(k => {
      totals[k] = round2(totals[k] + r.buckets[k]);
    });
  });

  return {
    // الأكثر تعثرًا أولًا: أقدم دين ثم أكبر مبلغ.
    rows: rows
      .filter(r => r.total > 0.009)
      .sort((a, b) =>
        b.oldestDays !== a.oldestDays
          ? b.oldestDays - a.oldestDays
          : b.total - a.total
      ),
    totals,
    total: round2(rows.reduce((sum, r) => sum + r.total, 0)),
    overdue90: totals.d90,
    asOf: asOf.toISOString(),
  };
}

/** أعمار ديون العملاء: ما لنا عندهم، موزعًا على شرائح العمر. */
export function receivablesAging(state: DbState, asOf = new Date()): AgingReport {
  const rows = state.customers.map(customer => {
    const entries = (state.customerLedger as CustomerLedgerEntry[])
      .filter(e => e.customerId === customer.id)
      // مدين العميل فاتورة عليه، ودائنه تحصيل أو مرتجع ينقص دينه.
      .map(e => ({
        at: e.at,
        type: e.type,
        refNo: e.refNo,
        charge: e.debit,
        credit: e.credit,
      }));

    return summarise(
      customer.id,
      customer.name,
      customer.phone,
      buildDocuments(entries, asOf)
    );
  });

  return report(rows, asOf);
}

/** أعمار ديون الموردين: ما علينا لهم، بنفس المنطق معكوس الإشارة. */
export function payablesAging(state: DbState, asOf = new Date()): AgingReport {
  const rows = state.suppliers.map(supplier => {
    const entries = (state.supplierLedger as SupplierLedgerEntry[])
      .filter(e => e.supplierId === supplier.id)
      // دائن المورد فاتورة علينا، ومدينه سداد أو مرتجع ينقص التزامنا.
      .map(e => ({
        at: e.at,
        type: e.type,
        refNo: e.refNo,
        charge: e.credit,
        credit: e.debit,
      }));

    return summarise(
      supplier.id,
      supplier.name,
      supplier.phone,
      buildDocuments(entries, asOf)
    );
  });

  return report(rows, asOf);
}

/**
 * مخصص الديون المشكوك في تحصيلها بنسب متدرجة حسب العمر.
 *
 * النسب تقدير إداري لا قاعدة مُلزِمة؛ المعيار يطلب تقديرًا معقولًا
 * للخسائر المتوقعة، ويترك النسبة لتجربة المنشأة مع عملائها.
 */
export const DOUBTFUL_RATES: Record<BucketId, number> = {
  d0: 0,
  d31: 0.05,
  d61: 0.15,
  d90: 0.5,
};

export function doubtfulAllowance(report: AgingReport) {
  const lines = AGING_BUCKETS.map(b => {
    const base = report.totals[b.id as BucketId];
    const rate = DOUBTFUL_RATES[b.id as BucketId];
    return {
      bucket: b.id as BucketId,
      label: b.label,
      base,
      rate,
      allowance: round2(base * rate),
    };
  });

  return {
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.allowance, 0)),
  };
}
