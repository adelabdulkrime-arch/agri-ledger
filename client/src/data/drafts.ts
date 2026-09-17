// Design: «سوق الحقل» — مستندات ما قبل البيع: عرض سعر، أمر بيع، سند تسليم،
// وفاتورة معلّقة.
//
// حدٌّ يجب أن يبقى واضحًا: هذه المستندات لا تمسّ المخزون ولا التكلفة ولا
// الدفاتر إطلاقًا. عرض السعر وعدٌ بسعر، وأمر البيع اتفاق على توريد،
// والفاتورة المعلّقة سلة محفوظة. لا شيء يتحرك محاسبيًا حتى تتحول إلى
// فاتورة بيع عبر postSale، وعندها فقط يُخصم المخزون وتُثبَّت التكلفة.
//
// سند التسليم استثناء مقصود: يوثّق تسليم بضاعة فاتورةٍ قائمة، فلا يخصم
// شيئًا لأن الفاتورة خصمته أصلًا. لا نخصم مرتين.
import type {
  DbState,
  Draft,
  DraftKind,
  DraftLine,
  DraftStatus,
  Product,
} from "./types";
import { OperationError, findUnit, round2, unitPrice } from "./operations";
import { nextNumber } from "./store";
import { releaseForDraft, reserveForDraft } from "./reservations";

function fail(message: string): never {
  throw new OperationError(message);
}

/** بذرة ترقيم مستقلة لكل نوع، فلا تختلط الأرقام بين المستندات. */
const SEEDS: Record<DraftKind, number> = {
  quotation: 1999,
  order: 2999,
  delivery: 3999,
  parked: 5999,
};

export const DRAFT_LABELS: Record<DraftKind, string> = {
  quotation: "عرض سعر",
  order: "أمر بيع",
  delivery: "سند تسليم",
  parked: "فاتورة معلّقة",
};

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  open: "مفتوح",
  converted: "حُوِّل إلى فاتورة",
  cancelled: "ملغى",
};

/** صلاحية عرض السعر الافتراضية؛ السعر لا يبقى مضمونًا إلى الأبد. */
export const DEFAULT_VALID_DAYS = 14;

export type DraftInput = {
  kind: DraftKind;
  customer?: string;
  customerId?: number;
  at?: string;
  /** تاريخ انتهاء صلاحية العرض؛ لعروض الأسعار أساسًا. */
  validUntil?: string;
  note?: string;
  /** الفاتورة المرتبطة في سند التسليم. */
  saleNo?: number;
  lines: {
    productId: number;
    qty: number;
    /** سعر الوحدة المختارة؛ يُؤخذ من الصنف عند غيابه. */
    price?: number;
    unitName?: string;
    discount?: number;
    tax?: number;
  }[];
  invoiceDiscount?: number;
  /** المخزن الذي يُحجز منه في أمر البيع. */
  warehouseId?: number;
};

function buildLines(state: DbState, input: DraftInput): DraftLine[] {
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  return input.lines.map(raw => {
    const product: Product | undefined = state.products.find(
      p => p.id === raw.productId
    );
    if (!product) fail("أحد الأصناف غير موجود");

    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);

    const unit = findUnit(product, raw.unitName);
    const price =
      raw.price !== undefined && Number.isFinite(Number(raw.price))
        ? round2(Number(raw.price))
        : unitPrice(product, unit.name);

    const discount = round2(Number(raw.discount || 0));
    const tax = round2(Number(raw.tax || 0));
    if (discount < 0 || tax < 0)
      fail(`الخصم والضريبة لا يصح أن تكون سالبة: ${product.name}`);

    const gross = round2(price * qty);
    if (discount > gross) fail(`الخصم أكبر من قيمة الصنف: ${product.name}`);

    return {
      productId: product.id,
      name: product.name,
      unitName: unit.name,
      qty,
      price,
      discount,
      tax,
      total: round2(gross - discount + tax),
    };
  });
}

/**
 * ينشئ مستندًا غير مرحَّل.
 *
 * لا نتحقق من الرصيد هنا: عرض السعر قد يسبق وصول البضاعة، ومنعه بحجة
 * نفاد المخزون يمنع بيعًا مشروعًا. التحقق مكانه postSale عند التحويل.
 */
export function createDraft(state: DbState, input: DraftInput): Draft {
  if (!state.drafts) state.drafts = [];
  if (!DRAFT_LABELS[input.kind]) fail("نوع المستند غير معروف");

  const lines = buildLines(state, input);
  const subtotal = round2(lines.reduce((sum, l) => sum + l.price * l.qty, 0));
  const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount, 0));
  const invoiceDiscount = round2(Number(input.invoiceDiscount || 0));
  const tax = round2(lines.reduce((sum, l) => sum + l.tax, 0));
  const total = round2(subtotal - lineDiscounts - invoiceDiscount + tax);
  if (total < 0) fail("الخصم أكبر من قيمة المستند");

  const customerRecord = input.customerId
    ? state.customers.find(c => c.id === input.customerId)
    : undefined;
  if (input.customerId && !customerRecord) fail("العميل غير موجود");

  if (input.kind === "delivery") {
    if (!input.saleNo) fail("سند التسليم يحتاج رقم فاتورة");
    if (!state.sales.some(s => s.no === input.saleNo))
      fail("الفاتورة غير موجودة");
  }

  const at = input.at || new Date().toISOString();
  const draft: Draft = {
    no: nextNumber(
      (state.drafts || []).filter(d => d.kind === input.kind),
      SEEDS[input.kind]
    ),
    kind: input.kind,
    at,
    customer:
      customerRecord?.name || (input.customer || "").trim() || "عميل نقدي",
    customerId: customerRecord?.id,
    lines,
    subtotal,
    discount: round2(lineDiscounts + invoiceDiscount),
    tax,
    total,
    status: "open",
    note: (input.note || "").trim(),
    saleNo: input.saleNo,
    validUntil:
      input.validUntil ||
      (input.kind === "quotation"
        ? new Date(
            new Date(at).getTime() + DEFAULT_VALID_DAYS * 86400000
          ).toISOString()
        : undefined),
  };

  state.drafts.unshift(draft);

  // أمر البيع وحده يحجز: العرض وعدٌ بسعر لا التزام بكمية، والمعلّقة سلة
  // لم تُعتمد بعد، وسند التسليم لفاتورة خصمت أصلًا.
  if (input.kind === "order")
    reserveForDraft(
      state,
      draft.no,
      lines.map(l => ({ productId: l.productId, qty: l.qty })),
      input.warehouseId
    );

  return draft;
}

export function findDraft(state: DbState, kind: DraftKind, no: number) {
  return (state.drafts || []).find(d => d.kind === kind && d.no === no);
}

/** هل انتهت صلاحية العرض؟ العرض المنتهي لا يُلزم المحل بسعره. */
export function isExpired(draft: Draft, now = new Date()) {
  if (!draft.validUntil || draft.status !== "open") return false;
  return new Date(draft.validUntil).getTime() < now.getTime();
}

/**
 * يحوّل المستند إلى مدخلات فاتورة بيع جاهزة لـ postSale.
 *
 * لا يُرحّل شيئًا بنفسه: المستدعي هو من ينادي postSale داخل نفس المعاملة،
 * ثم يستدعي markConverted. هذا يُبقي كل التحقق من الرصيد والتكلفة في
 * مكان واحد بدل تكراره هنا.
 */
export function draftToSaleInput(draft: Draft) {
  return {
    customer: draft.customer,
    customerId: draft.customerId,
    invoiceDiscount: round2(
      draft.discount - draft.lines.reduce((sum, l) => sum + l.discount, 0)
    ),
    lines: draft.lines.map(l => ({
      productId: l.productId,
      qty: l.qty,
      price: l.price,
      unitName: l.unitName,
      discount: l.discount,
      tax: l.tax,
    })),
  };
}

/** يثبّت أن المستند صار فاتورة، فلا يُحوَّل مرتين. */
export function markConverted(
  state: DbState,
  kind: DraftKind,
  no: number,
  saleNo: number
): Draft {
  const draft = findDraft(state, kind, no);
  if (!draft) fail("المستند غير موجود");
  if (draft.status === "converted")
    fail(`${DRAFT_LABELS[kind]} حُوِّل إلى فاتورة #${draft.saleNo} من قبل`);
  if (draft.status === "cancelled") fail("المستند ملغى");

  draft.status = "converted";
  draft.saleNo = saleNo;
  draft.convertedAt = new Date().toISOString();
  // صارت البضاعة فاتورة وخرجت فعلًا؛ الحجز لم يعد له معنى.
  releaseForDraft(state, no, `تحويل إلى فاتورة #${saleNo}`);
  return draft;
}

export function cancelDraft(
  state: DbState,
  kind: DraftKind,
  no: number,
  reason = ""
): Draft {
  const draft = findDraft(state, kind, no);
  if (!draft) fail("المستند غير موجود");
  if (draft.status === "converted")
    fail("لا يمكن إلغاء مستند صار فاتورة؛ استخدم مرتجع البيع");

  draft.status = "cancelled";
  const note = reason.trim();
  if (note) draft.note = draft.note ? `${draft.note} · ${note}` : note;
  // الأمر أُلغي فتعود بضاعته متاحة للبيع فورًا.
  releaseForDraft(state, no, note || "إلغاء الأمر");
  return draft;
}

/** يحذف فاتورة معلّقة نهائيًا؛ السلة المحفوظة لا قيمة لها بعد استعادتها. */
export function removeDraft(state: DbState, kind: DraftKind, no: number) {
  const index = (state.drafts || []).findIndex(
    d => d.kind === kind && d.no === no
  );
  if (index < 0) fail("المستند غير موجود");
  if (state.drafts![index].status === "converted")
    fail("لا يُحذف مستند صار فاتورة");
  // الحذف يحرّر الحجز، وإلا بقيت البضاعة مقفلة لأمر لم يعد موجودًا.
  releaseForDraft(state, no, "حذف المستند");
  state.drafts!.splice(index, 1);
}

/** مستندات نوع معيّن، من الأحدث، مع تصفية اختيارية بالحالة. */
export function draftsOf(
  state: DbState,
  kind?: DraftKind,
  status?: DraftStatus
) {
  return (state.drafts || [])
    .filter(d => (!kind || d.kind === kind) && (!status || d.status === status))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** ملخّص لكل نوع: كم مفتوح وكم قيمته، لبطاقات الشاشة. */
export function draftSummary(state: DbState, kind: DraftKind) {
  const rows = draftsOf(state, kind);
  const open = rows.filter(d => d.status === "open");
  return {
    total: rows.length,
    open: open.length,
    openValue: round2(open.reduce((sum, d) => sum + d.total, 0)),
    converted: rows.filter(d => d.status === "converted").length,
    expired: open.filter(d => isExpired(d)).length,
  };
}
