// Design: «سوق الحقل» — دفعات الأصناف: أرقام تشغيلات وصلاحيات مستقلة،
// وصرف بقاعدة الأقرب انتهاءً أولًا (FEFO) كما يقتضي العمل بالمبيدات.
import type { Batch, BatchConsumption, DbState } from "./types";
import { OperationError, round2 } from "./operations";
import { nextId } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** دفعات صنف معيّن، مرتبة بالأقرب انتهاءً أولًا. */
export function batchesOf(state: DbState, productId: number) {
  return (state.batches || [])
    .filter(b => b.productId === productId && b.qtyRemaining > 0)
    .sort(byExpiryThenReceived);
}

/**
 * ترتيب الصرف: الأقرب انتهاءً أولًا، ومن بلا صلاحية يُصرف أخيرًا
 * لأنه لا يتلف بمرور الوقت فلا عجلة فيه.
 */
function byExpiryThenReceived(a: Batch, b: Batch) {
  if (a.expiryDate && b.expiryDate) {
    const diff =
      new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
    if (diff !== 0) return diff;
  } else if (a.expiryDate && !b.expiryDate) return -1;
  else if (!a.expiryDate && b.expiryDate) return 1;

  return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
}

/** إجمالي المتبقي في دفعات صنف؛ قد يقل عن رصيده إن دخل بعضه بلا دفعات. */
export function batchedQty(state: DbState, productId: number) {
  return round2(
    batchesOf(state, productId).reduce((sum, b) => sum + b.qtyRemaining, 0)
  );
}

export type BatchInput = {
  productId: number;
  productName: string;
  lotNo: string;
  expiryDate?: string;
  qty: number;
  unitCost: number;
  purchaseNo: number;
  supplierName: string;
  at?: string;
};

/** ينشئ دفعة عند ورود بضاعة برقم تشغيلة. */
export function createBatch(state: DbState, input: BatchInput): Batch {
  if (!state.batches) state.batches = [];

  const lotNo = (input.lotNo || "").trim();
  if (!lotNo) fail("رقم التشغيلة مطلوب لإنشاء دفعة");

  const qty = round2(Number(input.qty));
  if (!Number.isFinite(qty) || qty <= 0)
    fail(`كمية الدفعة يجب أن تكون أكبر من صفر: ${input.productName}`);

  if (input.expiryDate) {
    const d = new Date(input.expiryDate);
    if (Number.isNaN(d.getTime())) fail("تاريخ الصلاحية غير صحيح");
  }

  // نفس الصنف ونفس التشغيلة من نفس الفاتورة يُدمج بدل تكرار سطرين.
  const existing = (state.batches || []).find(
    b =>
      b.productId === input.productId &&
      b.lotNo === lotNo &&
      b.purchaseNo === input.purchaseNo
  );
  if (existing) {
    existing.qtyReceived = round2(existing.qtyReceived + qty);
    existing.qtyRemaining = round2(existing.qtyRemaining + qty);
    return existing;
  }

  const batch: Batch = {
    id: nextId(state.batches),
    productId: input.productId,
    productName: input.productName,
    lotNo,
    expiryDate: input.expiryDate,
    qtyReceived: qty,
    qtyRemaining: qty,
    unitCost: round2(input.unitCost),
    purchaseNo: input.purchaseNo,
    supplierName: input.supplierName,
    receivedAt: input.at || new Date().toISOString(),
  };
  state.batches.push(batch);
  return batch;
}

/**
 * يصرف كمية من دفعات الصنف بقاعدة الأقرب انتهاءً أولًا.
 *
 * لا يفشل إذا لم تكف الدفعات: الأصناف التي دخلت قبل تفعيل الدفعات
 * لا دفعات لها، فنصرف المتاح منها ونترك الباقي بلا تتبّع بدل منع البيع.
 */
export function consumeFEFO(
  state: DbState,
  productId: number,
  qty: number
): BatchConsumption[] {
  const needed = round2(Number(qty));
  if (!Number.isFinite(needed) || needed <= 0) return [];

  const taken: BatchConsumption[] = [];
  let remaining = needed;

  for (const batch of batchesOf(state, productId)) {
    if (remaining <= 0) break;
    const take = Math.min(batch.qtyRemaining, remaining);
    if (take <= 0) continue;

    batch.qtyRemaining = round2(batch.qtyRemaining - take);
    remaining = round2(remaining - take);
    taken.push({
      batchId: batch.id,
      lotNo: batch.lotNo,
      qty: take,
      expiryDate: batch.expiryDate,
    });
  }

  return taken;
}

/** يعيد كمية إلى دفعاتها عند المرتجع، بعكس ترتيب الصرف. */
export function restoreBatches(
  state: DbState,
  consumed: BatchConsumption[] | undefined,
  qty: number
) {
  if (!consumed?.length) return;
  let remaining = round2(qty);

  for (const entry of consumed) {
    if (remaining <= 0) break;
    const batch = (state.batches || []).find(b => b.id === entry.batchId);
    if (!batch) continue;
    const give = Math.min(entry.qty, remaining);
    batch.qtyRemaining = round2(batch.qtyRemaining + give);
    remaining = round2(remaining - give);
  }
}

/** الدفعات المنتهية أو القريبة من الانتهاء خلال مدة محددة. */
export function expiringBatches(state: DbState, withinDays = 90) {
  const now = Date.now();
  const limit = now + withinDays * 24 * 60 * 60 * 1000;

  return (state.batches || [])
    .filter(b => b.qtyRemaining > 0 && b.expiryDate)
    .map(b => {
      const t = new Date(b.expiryDate!).getTime();
      return {
        ...b,
        daysLeft: Math.ceil((t - now) / (24 * 60 * 60 * 1000)),
        expired: t < now,
      };
    })
    .filter(b => new Date(b.expiryDate!).getTime() <= limit)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * تتبّع دفعة: من اشترى منها ومتى.
 * هذا ما يجعل سحب تشغيلة معيبة ممكنًا بدل تحذير عام بلا فائدة.
 */
export function batchTrace(state: DbState, batchId: number) {
  const batch = (state.batches || []).find(b => b.id === batchId);
  if (!batch) return null;

  const buyers: {
    saleNo: number;
    at: string;
    customer: string;
    qty: number;
  }[] = [];

  (state.sales || []).forEach(sale => {
    sale.lines.forEach(line => {
      (line.batches || []).forEach(c => {
        if (c.batchId !== batchId) return;
        buyers.push({
          saleNo: sale.no,
          at: sale.at,
          customer: sale.customer,
          qty: c.qty,
        });
      });
    });
  });

  return {
    batch,
    buyers: buyers.sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    ),
    soldQty: round2(buyers.reduce((s, x) => s + x.qty, 0)),
  };
}
