// Design: «سوق الحقل» — اقتراح إعادة الطلب: ماذا أشتري، وكم، ومن أين.
//
// المصدر هو بيعك الفعلي لا تقدير عام: نقيس متوسط الصرف اليومي من حركات
// البيع خلال مدة، فنعرف كم يكفيك رصيدك الحالي، وكم تحتاج لتغطية مدة
// التوريد ومخزون أمان.
//
// حدٌّ صريح: هذا اقتراح لا أمر شراء. صنف بيع مرة واحدة في موسم لا
// يُقاس بمتوسط يومي، ولهذا نعرض أساس الحساب (كم بيع وفي كم يومًا)
// ليحكم صاحب المحل بنفسه بدل أن يثق برقم لا يعرف من أين جاء.
import type { DbState, Product } from "./types";
import { reorderLevelOf, round2 } from "./operations";

/** المدة الافتراضية التي نقيس عليها الاستهلاك. */
export const DEFAULT_WINDOW_DAYS = 90;
/** مدة التوريد الافتراضية من المورد. */
export const DEFAULT_LEAD_DAYS = 14;
/** أيام مخزون أمان فوق مدة التوريد. */
export const DEFAULT_SAFETY_DAYS = 7;

export type ReorderRow = {
  productId: number;
  name: string;
  unit: string;
  stock: number;
  /** ما بيع خلال المدة المقاسة. */
  soldInWindow: number;
  /** متوسط الصرف اليومي. */
  dailyUse: number;
  /** كم يومًا يكفي الرصيد الحالي؛ Infinity إن لم يكن هناك بيع. */
  daysOfCover: number;
  /** الكمية المقترح شراؤها. */
  suggestedQty: number;
  /** تكلفة الشراء المتوقعة بآخر تكلفة معروفة. */
  estimatedCost: number;
  supplierId?: number;
  supplierName?: string;
  /** سبب الاقتراح بالعربية، ليعرف المستخدم لماذا ظهر الصنف. */
  reason: string;
};

/** آخر مورد اشترى منه هذا الصنف، لتجميع الاقتراح في طلب واحد. */
function lastSupplierOf(state: DbState, productId: number) {
  const purchase = (state.purchases || [])
    .filter(
      p =>
        p.status === "confirmed" &&
        p.lines.some(l => l.productId === productId)
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  return purchase
    ? { supplierId: purchase.supplierId, supplierName: purchase.supplierName }
    : {};
}

/** ما بيع من صنف خلال المدة، من حركات المخزون لا من الفواتير. */
function soldWithin(state: DbState, productId: number, since: Date) {
  return round2(
    (state.stockMoves || [])
      .filter(
        m =>
          m.productId === productId &&
          m.type === "SALE" &&
          new Date(m.at).getTime() >= since.getTime()
      )
      // حركة البيع سالبة؛ نقلبها لتصير كمية مبيعة.
      .reduce((sum, m) => sum + Math.abs(m.qty), 0)
  );
}

export type ReorderOptions = {
  windowDays?: number;
  leadDays?: number;
  safetyDays?: number;
  now?: Date;
};

/**
 * يقترح ما يحتاج شراءً: ما نفد، أو ما نزل تحت حد الطلب، أو ما لا
 * يكفي رصيده مدة التوريد حسب سرعة بيعه.
 */
export function reorderSuggestions(
  state: DbState,
  options: ReorderOptions = {}
): ReorderRow[] {
  const windowDays = options.windowDays || DEFAULT_WINDOW_DAYS;
  const leadDays = options.leadDays ?? DEFAULT_LEAD_DAYS;
  const safetyDays = options.safetyDays ?? DEFAULT_SAFETY_DAYS;
  const now = options.now || new Date();
  const since = new Date(now.getTime() - windowDays * 86400000);

  const rows: ReorderRow[] = [];

  state.products.forEach((product: Product) => {
    const sold = soldWithin(state, product.id, since);
    const dailyUse = round2(sold / windowDays);
    const level = reorderLevelOf(product);

    // الهدف: تغطية مدة التوريد زائد مخزون أمان.
    const targetDays = leadDays + safetyDays;
    const needed = round2(dailyUse * targetDays);
    const daysOfCover = dailyUse > 0 ? round2(product.stock / dailyUse) : Infinity;

    let reason = "";
    if (product.stock <= 0) reason = "نفد من المخزن";
    else if (dailyUse > 0 && daysOfCover <= targetDays)
      reason = `يكفي ${Math.floor(daysOfCover)} يومًا فقط`;
    else if (product.stock <= level)
      reason = `الرصيد تحت حد الطلب (${level})`;

    if (!reason) return;

    // نشتري ما يكمل الهدف، وبحد أدنى ما يعيد الرصيد لحد الطلب.
    const toTarget = Math.max(0, round2(needed - product.stock));
    const toLevel = Math.max(0, round2(level - product.stock));
    const suggested = round2(Math.max(toTarget, toLevel));
    if (suggested <= 0) return;

    const unitCost = product.lastCost || product.avgCost || 0;
    rows.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      soldInWindow: sold,
      dailyUse,
      daysOfCover,
      suggestedQty: suggested,
      estimatedCost: round2(suggested * unitCost),
      ...lastSupplierOf(state, product.id),
      reason,
    });
  });

  // الأشد إلحاحًا أولًا: ما نفد ثم الأقل تغطية.
  return rows.sort((a, b) => a.daysOfCover - b.daysOfCover);
}

/** تجميع الاقتراحات حسب المورد، ليصير كل مجموعة طلبًا واحدًا. */
export function groupBySupplier(rows: ReorderRow[]) {
  const map = new Map<
    number,
    { supplierId?: number; supplierName: string; rows: ReorderRow[]; total: number }
  >();

  rows.forEach(row => {
    const key = row.supplierId || 0;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
      existing.total = round2(existing.total + row.estimatedCost);
    } else {
      map.set(key, {
        supplierId: row.supplierId,
        supplierName: row.supplierName || "بلا مورد سابق",
        rows: [row],
        total: row.estimatedCost,
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}
