// Design: «OneMedia24 ERP» — أوامر الشراء: ما قبل الفاتورة.
//
// دورة الشراء في الوثيقة (§7): طلب ← أمر شراء ← استلام ← فاتورة.
// كنا نقفز من الاقتراح إلى الفاتورة مباشرة، فلا يبقى أثر لما طُلب ولم
// يصل، ولا يُعرف المتأخر من الموردين.
//
// حدٌّ يجب أن يبقى واضحًا: أمر الشراء لا يمسّ المخزون ولا الدفاتر. هو
// التزام تجاري لا حركة مالية. المخزون يتحرك عند الاستلام، والدفاتر عند
// الفاتورة — وكلاهما يتم عبر postPurchase القائم، فلا مسار ترحيل ثانٍ.
import type { DbState, PurchaseOrder, PurchaseOrderStatus } from "./types";
import { OperationError, round2 } from "./operations";
import { nextNumber } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "مسودة",
  approved: "معتمد",
  received: "استُلم",
  cancelled: "ملغى",
};

export type PurchaseOrderInput = {
  supplierId: number;
  expectedAt?: string;
  note?: string;
  warehouseId?: number;
  lines: { productId: number; qty: number; unitCost: number }[];
};

/**
 * ينشئ أمر شراء في حالة مسودة.
 *
 * المسودة قابلة للتعديل، والاعتماد يثبّتها. هذا هو نموذج الحالات الموحّد
 * في §15: لا أثر مالي ولا مخزني قبل الاعتماد، ولا تعديل مباشر بعده.
 */
export function createPurchaseOrder(
  state: DbState,
  input: PurchaseOrderInput
): PurchaseOrder {
  if (!state.purchaseOrders) state.purchaseOrders = [];

  const supplier = state.suppliers.find(s => s.id === input.supplierId);
  if (!supplier) fail("اختر موردًا للأمر");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  const lines = input.lines.map(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود");

    const qty = round2(Number(raw.qty));
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);

    const unitCost = round2(Number(raw.unitCost));
    if (!Number.isFinite(unitCost) || unitCost < 0)
      fail(`التكلفة لا تصح أن تكون سالبة: ${product.name}`);

    return {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      qty,
      unitCost,
      total: round2(qty * unitCost),
      /** ما استُلم فعلًا من هذا السطر؛ يسمح بالاستلام الجزئي. */
      receivedQty: 0,
    };
  });

  const order: PurchaseOrder = {
    no: nextNumber(state.purchaseOrders, 3999),
    at: new Date().toISOString(),
    supplierId: supplier.id,
    supplierName: supplier.name,
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.total, 0)),
    status: "draft",
    expectedAt: input.expectedAt,
    warehouseId: input.warehouseId,
    note: (input.note || "").trim(),
    createdBy:
      (state.users || []).find(u => u.id === state.currentUserId)?.name ||
      "غير محدد",
  };

  state.purchaseOrders.unshift(order);
  return order;
}

export function findPurchaseOrder(state: DbState, no: number) {
  return (state.purchaseOrders || []).find(o => o.no === no);
}

/** اعتماد الأمر يثبّته: لا تعديل بعده، ويصير جاهزًا للاستلام. */
export function approvePurchaseOrder(
  state: DbState,
  no: number
): PurchaseOrder {
  const order = findPurchaseOrder(state, no);
  if (!order) fail("أمر الشراء غير موجود");
  if (order.status !== "draft")
    fail(`لا يُعتمد أمر حالته ${PO_STATUS_LABELS[order.status]}`);

  order.status = "approved";
  order.approvedAt = new Date().toISOString();
  order.approvedBy =
    (state.users || []).find(u => u.id === state.currentUserId)?.name ||
    "غير محدد";
  return order;
}

export function cancelPurchaseOrder(
  state: DbState,
  no: number,
  reason = ""
): PurchaseOrder {
  const order = findPurchaseOrder(state, no);
  if (!order) fail("أمر الشراء غير موجود");
  if (order.status === "received")
    fail("لا يُلغى أمر استُلمت بضاعته؛ استخدم مرتجع الشراء");

  order.status = "cancelled";
  const note = reason.trim();
  if (note) order.note = order.note ? `${order.note} · ${note}` : note;
  return order;
}

/** مدخلات فاتورة شراء جاهزة من الأمر المعتمد. */
export function orderToPurchaseInput(order: PurchaseOrder) {
  return {
    supplierId: order.supplierId,
    warehouseId: order.warehouseId,
    lines: order.lines
      // ما استُلم كاملًا لا يُعاد طلبه.
      .filter(l => l.qty > l.receivedQty)
      .map(l => ({
        productId: l.productId,
        qty: round2(l.qty - l.receivedQty),
        unitCost: l.unitCost,
      })),
  };
}

/**
 * يثبّت استلام الأمر بعد إنشاء فاتورته.
 *
 * يقبل الاستلام الجزئي: ما وصل يُسجَّل، ويبقى الأمر مفتوحًا حتى يكتمل،
 * فيُعرف المتأخر عند كل مورد بدل أن يُقفل الأمر بأول شحنة.
 */
export function markReceived(
  state: DbState,
  no: number,
  purchaseNo: number,
  received?: { productId: number; qty: number }[]
): PurchaseOrder {
  const order = findPurchaseOrder(state, no);
  if (!order) fail("أمر الشراء غير موجود");
  if (order.status === "cancelled") fail("الأمر ملغى");
  if (order.status === "received") fail("الأمر استُلم بالكامل من قبل");
  if (order.status === "draft") fail("اعتمد الأمر قبل استلامه");

  // بلا قائمة يُعتبر كل المتبقي مستلَمًا. ومع قائمة صريحة، ما لم يُذكر
  // فيها لم يصل: اعتباره مستلَمًا يُقفل أمرًا لم تصل بضاعته، فيضيع
  // المتأخر عند المورد بلا أن يُدرى.
  order.lines.forEach(line => {
    const hit = received?.find(r => r.productId === line.productId);
    const qty = received
      ? hit
        ? round2(Number(hit.qty))
        : 0
      : round2(line.qty - line.receivedQty);
    if (qty < 0) fail("الكمية المستلمة لا تصح أن تكون سالبة");
    if (line.receivedQty + qty > line.qty)
      fail(`المستلم من ${line.name} يتجاوز المطلوب`);
    line.receivedQty = round2(line.receivedQty + qty);
  });

  if (!order.purchaseNos) order.purchaseNos = [];
  order.purchaseNos.push(purchaseNo);

  const complete = order.lines.every(l => l.receivedQty >= l.qty - 0.009);
  if (complete) {
    order.status = "received";
    order.receivedAt = new Date().toISOString();
  }
  return order;
}

/** أوامر الشراء من الأحدث، بتصفية اختيارية. */
export function purchaseOrdersOf(
  state: DbState,
  filter: { status?: PurchaseOrderStatus; supplierId?: number } = {}
) {
  return (state.purchaseOrders || [])
    .filter(o => {
      if (filter.status && o.status !== filter.status) return false;
      if (filter.supplierId && o.supplierId !== filter.supplierId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** ملخّص: كم أمرًا معلّقًا وكم قيمته وكم تأخر. */
export function purchaseOrderSummary(state: DbState, now = new Date()) {
  const rows = purchaseOrdersOf(state);
  const open = rows.filter(
    o => o.status === "draft" || o.status === "approved"
  );
  const late = open.filter(
    o => o.expectedAt && new Date(o.expectedAt).getTime() < now.getTime()
  );
  return {
    total: rows.length,
    open: open.length,
    openValue: round2(open.reduce((sum, o) => sum + o.total, 0)),
    late: late.length,
    received: rows.filter(o => o.status === "received").length,
  };
}
