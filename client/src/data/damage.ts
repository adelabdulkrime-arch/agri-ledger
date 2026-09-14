// Design: «سوق الحقل» — إتلاف البضاعة: خروجها من المخزون بلا بيع.
//
// مفصول عن تسوية الجرد عمدًا. الجرد يصحّح خطأ في العدّ، والإتلاف قرار
// واعٍ بخسارة بضاعة: مبيد انتهت صلاحيته، كيس تمزّق، بضاعة سُرقت.
// خلطهما في حساب واحد يخفي كم يخسر المحل من التلف وحده، وهو رقم
// يحتاج صاحب المحل أن يراه ليقرر: هل أشتري كميات أصغر؟ هل أراجع
// التخزين؟
import type { DamageReason, DamageRecord, DbState } from "./types";
import {
  OperationError,
  defaultWarehouseId,
  recordMove,
  round2,
  warehouseStock,
} from "./operations";
import { ACC, postJournal } from "./ledger";
import { nextNumber } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

export const DAMAGE_REASON_LABELS: Record<DamageReason, string> = {
  expired: "منتهي الصلاحية",
  broken: "تالف أو مكسور",
  theft: "فقد أو سرقة",
  other: "أخرى",
};

export type DamageInput = {
  productId: number;
  qty: number;
  reason: DamageReason;
  warehouseId?: number;
  /** الدفعة المتلَفة إن كان التلف في تشغيلة بعينها. */
  batchId?: number;
  note?: string;
  at?: string;
};

/**
 * يتلف كمية من صنف: يخرجها من المخزون ويحمّل تكلفتها خسارة.
 *
 * التحقق من رصيد المخزن لا الإجمالي: لا يصح إتلاف بضاعة من فرع لا
 * تملكها، وإلا صار رصيد الفرعين كذبًا.
 */
export function recordDamage(
  state: DbState,
  input: DamageInput
): DamageRecord {
  if (!state.damages) state.damages = [];

  const product = state.products.find(p => p.id === input.productId);
  if (!product) fail("الصنف غير موجود");
  if (!DAMAGE_REASON_LABELS[input.reason]) fail("اختر سبب الإتلاف");

  const qty = round2(Number(input.qty));
  if (!Number.isFinite(qty) || qty <= 0)
    fail("الكمية يجب أن تكون أكبر من صفر");

  const warehouseId = input.warehouseId ?? defaultWarehouseId(state);
  const available = warehouseId
    ? warehouseStock(state, product.id, warehouseId)
    : product.stock;
  if (qty > available)
    fail(`الرصيد المتاح من ${product.name} هو ${available} ${product.unit}`);

  // الدفعة تُنقص بعينها حتى يبقى تتبّع التشغيلات صادقًا.
  let lotNo: string | undefined;
  if (input.batchId !== undefined) {
    const batch = (state.batches || []).find(b => b.id === input.batchId);
    if (!batch) fail("الدفعة غير موجودة");
    if (batch.productId !== product.id)
      fail("هذه الدفعة ليست من هذا الصنف");
    if (batch.qtyRemaining < qty)
      fail(`المتبقي في التشغيلة ${batch.lotNo} هو ${batch.qtyRemaining} فقط`);
    batch.qtyRemaining = round2(batch.qtyRemaining - qty);
    lotNo = batch.lotNo;
  }

  const at = input.at || new Date().toISOString();
  const unitCost = round2(product.avgCost);
  const total = round2(qty * unitCost);
  // رقم واحد يحمله المستند وحركة المخزون معًا، فيربطهما التتبّع.
  // البذرة 10999 لتبدأ السندات من 11000 ولا تختلط بسلسلة سندات
  // القبض والصرف التي تبدأ من 9000.
  const no = nextNumber(state.damages, 10999);

  recordMove(state, {
    productId: product.id,
    productName: product.name,
    type: "DAMAGE",
    qty: -qty,
    unitCost,
    refType: "damage",
    refNo: no,
    at,
    note: `${DAMAGE_REASON_LABELS[input.reason]}${lotNo ? ` · تشغيلة ${lotNo}` : ""}`,
    warehouseId,
  });

  const record: DamageRecord = {
    no,
    at,
    productId: product.id,
    productName: product.name,
    qty,
    unitCost,
    total,
    reason: input.reason,
    warehouseId,
    batchId: input.batchId,
    lotNo,
    note: (input.note || "").trim(),
    recordedBy:
      (state.users || []).find(u => u.id === state.currentUserId)?.name ||
      "غير محدد",
  };
  state.damages.unshift(record);

  // الخسارة مصروف مستقل، لا تسوية جرد: المخزون ينقص وتظهر الخسارة باسمها.
  if (total > 0.009)
    postJournal(state, {
      at,
      source: "damage",
      sourceNo: record.no,
      description: `إتلاف ${product.name} — ${DAMAGE_REASON_LABELS[input.reason]}`,
      lines: [
        { accountCode: ACC.damageLoss, debit: total, memo: product.name },
        { accountCode: ACC.inventory, credit: total, memo: "بضاعة متلفة" },
      ],
    });

  return record;
}

/** سجل الإتلاف من الأحدث، مع تصفية بالسبب والفترة. */
export function damagesOf(
  state: DbState,
  filter: { reason?: DamageReason; from?: Date; to?: Date } = {}
) {
  return (state.damages || [])
    .filter(d => {
      if (filter.reason && d.reason !== filter.reason) return false;
      const at = new Date(d.at);
      if (filter.from && at < filter.from) return false;
      if (filter.to && at > filter.to) return false;
      return true;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** ملخّص الخسائر: الإجمالي وتوزيعه على الأسباب. */
export function damageSummary(
  state: DbState,
  filter: { from?: Date; to?: Date } = {}
) {
  const rows = damagesOf(state, filter);
  const byReason = (Object.keys(DAMAGE_REASON_LABELS) as DamageReason[]).map(
    reason => {
      const subset = rows.filter(d => d.reason === reason);
      return {
        reason,
        label: DAMAGE_REASON_LABELS[reason],
        count: subset.length,
        total: round2(subset.reduce((sum, d) => sum + d.total, 0)),
      };
    }
  );

  return {
    count: rows.length,
    total: round2(rows.reduce((sum, d) => sum + d.total, 0)),
    byReason: byReason.filter(r => r.count > 0),
  };
}
