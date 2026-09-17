// Design: «سوق الحقل» — منطق دورة الشراء والمخزون والتكلفة والربحية.
// دوال نقية تعمل على الحالة، حتى يمكن اختبارها دون واجهة أو متصفح.
import type {
  DbState,
  PaymentMethod,
  Purchase,
  PurchaseLine,
  Sale,
  SaleLine,
  StockMove,
  StockMoveType,
  Supplier,
  Customer,
  CustomerLedgerEntry,
  PartyTerms,
  ReturnKind,
  ReturnLine,
  StockReturn,
  Expense,
  ExpenseCategory,
  PaymentInstrument,
  Product,
  ProductUnit,
  Voucher,
  VoucherKind,
} from "./types";
import { nextId, nextNumber } from "./store";
import { ACC, postJournal, reverseJournal } from "./ledger";
import { consumeFEFO, createBatch, restoreBatches } from "./batches";

/** خطأ عمل معروف؛ رسالته عربية جاهزة للعرض للمستخدم. */
export class OperationError extends Error {}

function fail(message: string): never {
  throw new OperationError(message);
}

/** تقريب لخانتين يمنع تراكم أخطاء الفاصلة العائمة في المبالغ. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** صلاحيات كل دور؛ معرَّفة هنا لأن users.ts يستورد من هذا الملف. */
const ROLE_RIGHTS: Record<string, string[]> = {
  owner: [
    "sell",
    "purchase",
    "voidInvoice",
    "editCost",
    "viewProfit",
    "manageUsers",
    "closePeriod",
    "stockTake",
    "backup",
  ],
  manager: [
    "sell",
    "purchase",
    "voidInvoice",
    "editCost",
    "viewProfit",
    "stockTake",
    "backup",
  ],
  cashier: ["sell"],
};

const RIGHT_NAMES: Record<string, string> = {
  sell: "البيع",
  purchase: "الشراء",
  voidInvoice: "إلغاء الفواتير",
  editCost: "تعديل التكلفة",
  viewProfit: "رؤية الأرباح",
  manageUsers: "إدارة المستخدمين",
  closePeriod: "إقفال الفترات",
  stockTake: "الجرد",
  backup: "النسخ والاستعادة",
};

/**
 * يمنع العملية على من لا يملك صلاحيتها، ويسجّلها في سجل التدقيق.
 *
 * بلا مستخدمين مسجّلين يُسمح بكل شيء: محل بمشغّل واحد لا يُجبَر على
 * تسجيل دخول لا يحتاجه. وبوجودهم، الدور هو ما يحكم.
 *
 * حدٌّ يجب أن يبقى واضحًا: هذا ضبط تشغيلي يمنع الخطأ ويثبّت المسؤولية،
 * لا حاجز أمني. البيانات في متصفح الجهاز، ومن يفتح أدوات المطور
 * يتجاوزه. الحماية الحقيقية تحتاج خادمًا يتحقق من كل طلب.
 */
function guard(state: DbState, right: string, description: string) {
  const users = state.users || [];
  if (users.length) {
    const user = users.find(u => u.id === state.currentUserId && u.active);
    if (!user) fail("سجّل الدخول أولًا");
    if (!(ROLE_RIGHTS[user.role] || []).includes(right))
      fail(`لا تملك صلاحية ${RIGHT_NAMES[right] || right}`);
  }

  if (!state.auditLog) state.auditLog = [];
  const actor = users.find(u => u.id === state.currentUserId);
  state.auditLog.push({
    id: nextId(state.auditLog),
    at: new Date().toISOString(),
    userId: actor?.id,
    userName: actor?.name || "غير محدد",
    action: right,
    description,
  });
  // السجل لا ينمو بلا حد على جهاز محدود المساحة.
  if (state.auditLog.length > 2000)
    state.auditLog = state.auditLog.slice(-2000);
}

export const INSTRUMENT_LABELS: Record<PaymentInstrument, string> = {
  cash: "نقدًا",
  bank: "تحويل بنكي",
  card: "شبكة / بطاقة",
  transfer: "حوالة",
  cheque: "شيك",
};

/**
 * الحساب الذي تمر عليه الحركة حسب أداتها.
 *
 * ما عدا النقد لا يدخل درج الصندوق، فيُرحَّل على البنك. هذا ما يجعل جرد
 * الوردية صادقًا: بيع الشبكة إيراد حقيقي لكنه ليس نقدًا في الدرج.
 */
export function instrumentAccount(instrument: PaymentInstrument = "cash") {
  return instrument === "cash" ? ACC.cash : ACC.bank;
}

/**
 * المخزن الافتراضي، معرَّفًا هنا لا في warehouses.ts.
 *
 * warehouses.ts يستورد recordMove من هذا الملف، فاستيراد العكس يصنع
 * حلقة. والدالة ثلاثة أسطر على state.warehouses، فتعريفها هنا أبسط من
 * كسر الحلقة بوسيط يُمرَّر في كل نداء.
 */
export function defaultWarehouseId(state: DbState): number | undefined {
  const list = state.warehouses || [];
  return (list.find(w => w.isDefault && w.active) || list.find(w => w.active))
    ?.id;
}

/**
 * رصيد صنف في مخزن.
 *
 * المخازن غير الافتراضية تُشتقّ من حركاتها وحدها. أما الافتراضي فيأخذ
 * الباقي: إجمالي الصنف ناقص ما هو موجود في المخازن الأخرى.
 *
 * السبب: رصيد قد يُسجَّل دون حركات — بذرة الكتالوج، والاستيراد من ملف،
 * وكل بيانات النسخ السابقة. لو اشتققنا الافتراضي من الحركات وحدها
 * لأصبح ذلك الرصيد الحقيقي صفرًا في نظر البيع، فيُمنع بيع بضاعة
 * موجودة فعلًا على الرف.
 */
export function warehouseStock(
  state: DbState,
  productId: number,
  warehouseId: number
) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return 0;

  const movedElsewhere = (state.stockMoves || [])
    .filter(
      m =>
        m.productId === productId &&
        m.warehouseId !== undefined &&
        m.warehouseId !== warehouseId
    )
    .reduce((sum, m) => sum + m.qty, 0);

  if (warehouseId === defaultWarehouseId(state))
    return round2(product.stock - movedElsewhere);

  return round2(
    (state.stockMoves || [])
      .filter(m => m.productId === productId && m.warehouseId === warehouseId)
      .reduce((sum, m) => sum + m.qty, 0)
  );
}

/**
 * يحرّر سند قبض أو صرف: مستند مرقّم يثبت من دفع ولمن وبأي أداة.
 *
 * السند مستقل عن القيد المحاسبي: القيد يحرّك الحسابات، والسند ورقة
 * يوقّعها الطرفان ويُرجع إليها عند الخلاف.
 */
export function createVoucher(
  state: DbState,
  input: {
    kind: VoucherKind;
    party: string;
    amount: number;
    instrument?: PaymentInstrument;
    customerId?: number;
    supplierId?: number;
    reference?: string;
    refType?: string;
    refNo?: number;
    note?: string;
    at?: string;
  }
): Voucher {
  if (!state.vouchers) state.vouchers = [];

  const voucher: Voucher = {
    // البذرة 8999 ليبدأ أول سند من 9000، كما تبدأ المشتريات من 5001.
    no: nextNumber(state.vouchers, 8999),
    kind: input.kind,
    at: input.at || new Date().toISOString(),
    party: input.party,
    customerId: input.customerId,
    supplierId: input.supplierId,
    amount: round2(input.amount),
    instrument: input.instrument || "cash",
    reference: (input.reference || "").trim(),
    refType: input.refType,
    refNo: input.refNo,
    note: (input.note || "").trim(),
    // اسم من حرّر السند إن كان هناك مستخدم نشط.
    issuedBy:
      (state.users || []).find(u => u.id === state.currentUserId)?.name ||
      "غير محدد",
  };
  state.vouchers.unshift(voucher);
  return voucher;
}

/** سندات طرف بعينه، من الأحدث. */
export function vouchersOf(
  state: DbState,
  filter: { kind?: VoucherKind; customerId?: number; supplierId?: number } = {}
) {
  return (state.vouchers || [])
    .filter(v => {
      if (filter.kind && v.kind !== filter.kind) return false;
      if (filter.customerId && v.customerId !== filter.customerId) return false;
      if (filter.supplierId && v.supplierId !== filter.supplierId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

// ---------------------------------------------------------------- الموردون

export function createSupplier(
  state: DbState,
  input: Partial<Supplier> & { name: string }
): Supplier {
  const name = (input.name || "").trim();
  if (!name) fail("اسم المورد مطلوب");
  const duplicate = state.suppliers.some(
    s => s.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) fail("يوجد مورد بنفس الاسم");

  const supplier: Supplier = {
    id: nextId(state.suppliers),
    name,
    phone: (input.phone || "").trim(),
    email: (input.email || "").trim(),
    address: (input.address || "").trim(),
    taxNumber: (input.taxNumber || "").trim(),
    notes: (input.notes || "").trim(),
    status: input.status || "active",
    createdAt: new Date().toISOString(),
  };
  state.suppliers.push(supplier);
  return supplier;
}

export function updateSupplier(
  state: DbState,
  id: number,
  patch: Partial<Supplier>
): Supplier {
  const supplier = state.suppliers.find(s => s.id === id);
  if (!supplier) fail("المورد غير موجود");
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم المورد مطلوب");
    const clash = state.suppliers.some(
      s => s.id !== id && s.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (clash) fail("يوجد مورد بنفس الاسم");
    supplier.name = name;
  }
  for (const key of [
    "phone",
    "email",
    "address",
    "taxNumber",
    "notes",
    "status",
  ] as const) {
    if (patch[key] !== undefined) (supplier as any)[key] = patch[key];
  }
  // اسم المورد مكرر داخل الفواتير للعرض السريع، فنبقيه متسقًا بعد التعديل.
  state.purchases.forEach(p => {
    if (p.supplierId === id) p.supplierName = supplier.name;
  });
  return supplier;
}

/** رصيد المورد = ما علينا له، مشتقًا من كشف الحساب لا من رقم محفوظ منفصل. */
export function supplierBalance(state: DbState, supplierId: number) {
  return round2(
    state.supplierLedger
      .filter(entry => entry.supplierId === supplierId)
      .reduce((sum, entry) => sum + entry.credit - entry.debit, 0)
  );
}

export function supplierTotals(state: DbState, supplierId: number) {
  const purchases = state.purchases.filter(
    p => p.supplierId === supplierId && p.status === "confirmed"
  );
  const total = round2(purchases.reduce((sum, p) => sum + p.total, 0));
  const paid = round2(purchases.reduce((sum, p) => sum + p.paid, 0));
  return {
    count: purchases.length,
    total,
    paid,
    remaining: round2(total - paid),
    balance: supplierBalance(state, supplierId),
  };
}

/** كشف حساب مرتب زمنيًا مع رصيد تراكمي جاهز للطباعة. */
export function supplierStatement(
  state: DbState,
  supplierId: number,
  from?: Date,
  to?: Date
) {
  const entries = state.supplierLedger
    .filter(entry => entry.supplierId === supplierId)
    .filter(entry => {
      const at = new Date(entry.at);
      if (from && at < from) return false;
      if (to && at > to) return false;
      return true;
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let running = 0;
  return entries.map(entry => {
    running = round2(running + entry.credit - entry.debit);
    return { ...entry, balance: running };
  });
}

// ------------------------------------------------------- حركات المخزون

/**
 * نقطة الكتابة الوحيدة على رصيد الصنف.
 *
 * product.stock هو الإجمالي في كل المخازن، وwarehouseId يقيّد الحركة
 * بمكانها فيُشتق منه رصيد كل مخزن. التحويل بين مخزنين حركتان متعاكستان
 * فلا يتغير الإجمالي، وهو الصحيح: البضاعة لم تدخل ولم تخرج من المحل.
 */
export function recordMove(
  state: DbState,
  move: Omit<StockMove, "id" | "qtyBefore" | "qtyAfter" | "at"> & {
    at?: string;
  }
): StockMove {
  const product = state.products.find(p => p.id === move.productId);
  if (!product) fail(`الصنف غير موجود: ${move.productName}`);

  const qtyBefore = product.stock;
  const qtyAfter = round2(qtyBefore + move.qty);
  product.stock = qtyAfter;

  const entry: StockMove = {
    id: nextId(state.stockMoves),
    productId: move.productId,
    productName: product.name,
    type: move.type,
    qty: move.qty,
    qtyBefore,
    qtyAfter,
    unitCost: move.unitCost,
    refType: move.refType,
    refNo: move.refNo,
    at: move.at || new Date().toISOString(),
    note: move.note,
    // غياب المخزن يعني الافتراضي؛ هكذا تبقى الحركات القديمة صحيحة.
    warehouseId: move.warehouseId,
  };
  state.stockMoves.push(entry);
  return entry;
}

/**
 * متوسط التكلفة المرجح: (قيمة المخزون الحالية + قيمة الوارد) ÷ (الكمية الكلية).
 * يُستدعى قبل تحديث الرصيد لأنه يحتاج الكمية السابقة.
 */
export function weightedAverage(
  currentQty: number,
  currentAvg: number,
  incomingQty: number,
  incomingCost: number
) {
  const totalQty = currentQty + incomingQty;
  if (totalQty <= 0) return incomingCost;
  // الكمية السالبة (بيع بالسالب) لا يُبنى عليها متوسط سليم؛ نأخذ تكلفة الوارد.
  const base = currentQty > 0 ? currentQty * currentAvg : 0;
  const qtyBase = currentQty > 0 ? currentQty : 0;
  return round2((base + incomingQty * incomingCost) / (qtyBase + incomingQty));
}

// --------------------------------------------------------- فاتورة الشراء

export type PurchaseInput = {
  supplierId: number;
  supplierInvoiceNo?: string;
  at?: string;
  notes?: string;
  lines: {
    productId: number;
    qty: number;
    unitCost: number;
    discount?: number;
    tax?: number;
    /** رقم التشغيلة المطبوع على العبوة؛ يُنشئ دفعة عند تعبئته. */
    lotNo?: string;
    /** صلاحية هذه الدفعة تحديدًا. */
    expiryDate?: string;
  }[];
  paymentMethod: PaymentMethod;
  paid?: number;
  /** أداة الدفع؛ افتراضها نقد كما في النسخ السابقة. */
  instrument?: PaymentInstrument;
  /** المخزن المستقبِل للبضاعة؛ افتراضه المخزن الافتراضي. */
  warehouseId?: number;
};

/** يتحقق من المدخلات ويحسب الإجماليات؛ يرمي OperationError عند أي خلل. */
export function buildPurchaseDraft(state: DbState, input: PurchaseInput) {
  const supplier = state.suppliers.find(s => s.id === input.supplierId);
  if (!supplier) fail("اختر موردًا للفاتورة");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  const supplierInvoiceNo = (input.supplierInvoiceNo || "").trim();
  if (supplierInvoiceNo) {
    const clash = state.purchases.some(
      p =>
        p.status === "confirmed" &&
        p.supplierId === input.supplierId &&
        p.supplierInvoiceNo &&
        p.supplierInvoiceNo.toLowerCase() === supplierInvoiceNo.toLowerCase()
    );
    if (clash) fail("رقم فاتورة المورد مسجل من قبل لهذا المورد");
  }

  const lines: PurchaseLine[] = input.lines.map(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود في الكتالوج");
    const qty = Number(raw.qty);
    const unitCost = Number(raw.unitCost);
    const discount = Number(raw.discount || 0);
    const tax = Number(raw.tax || 0);

    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);
    if (!Number.isFinite(unitCost) || unitCost < 0)
      fail(`سعر الشراء لا يصح أن يكون سالبًا: ${product.name}`);
    if (discount < 0 || tax < 0)
      fail(`الخصم والضريبة لا يصح أن تكون سالبة: ${product.name}`);

    const gross = qty * unitCost;
    if (discount > gross)
      fail(`الخصم أكبر من قيمة الصنف: ${product.name}`);

    return {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      barcode: product.barcode,
      qty,
      unitCost,
      discount,
      tax,
      total: round2(gross - discount + tax),
      lotNo: (raw.lotNo || "").trim() || undefined,
      expiryDate: raw.expiryDate || undefined,
    };
  });

  const subtotal = round2(
    lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0)
  );
  const discount = round2(lines.reduce((sum, line) => sum + line.discount, 0));
  const tax = round2(lines.reduce((sum, line) => sum + line.tax, 0));
  const total = round2(subtotal - discount + tax);

  // التحقق من تطابق الإجمالي مع البنود، حتى لا تُحفظ فاتورة بمجموع مغلوط.
  const linesTotal = round2(lines.reduce((sum, line) => sum + line.total, 0));
  if (Math.abs(linesTotal - total) > 0.01)
    fail("الإجمالي لا يطابق مجموع البنود");

  let paid: number;
  if (input.paymentMethod === "cash") paid = total;
  else if (input.paymentMethod === "credit") paid = 0;
  else {
    paid = round2(Number(input.paid || 0));
    if (!Number.isFinite(paid) || paid < 0) fail("المبلغ المدفوع غير صحيح");
    if (paid > total) fail("المبلغ المدفوع أكبر من إجمالي الفاتورة");
  }

  return {
    supplier,
    supplierInvoiceNo,
    lines,
    subtotal,
    discount,
    tax,
    total,
    paid,
    balance: round2(total - paid),
  };
}

/**
 * يحفظ فاتورة الشراء ويحدّث المخزون والتكلفة وحساب المورد معًا.
 * يجب استدعاؤها داخل transact حتى تكون العملية كلها أو لا شيء.
 */
export function postPurchase(state: DbState, input: PurchaseInput): Purchase {
  guard(state, "purchase", "تسجيل فاتورة شراء");
  const draft = buildPurchaseDraft(state, input);
  const at = input.at || new Date().toISOString();
  const no = nextNumber(state.purchases, 5000);

  const purchase: Purchase = {
    no,
    supplierInvoiceNo: draft.supplierInvoiceNo,
    supplierId: draft.supplier.id,
    supplierName: draft.supplier.name,
    at,
    notes: (input.notes || "").trim(),
    lines: draft.lines,
    subtotal: draft.subtotal,
    discount: draft.discount,
    tax: draft.tax,
    total: draft.total,
    paymentMethod: input.paymentMethod,
    paid: draft.paid,
    balance: draft.balance,
    status: "confirmed",
  };

  applyPurchaseToInventory(state, purchase, input.warehouseId);

  state.purchases.unshift(purchase);
  state.supplierLedger.push({
    id: nextId(state.supplierLedger),
    supplierId: purchase.supplierId,
    at,
    type: "فاتورة شراء",
    refNo: no,
    debit: 0,
    credit: purchase.total,
    note: purchase.supplierInvoiceNo
      ? `فاتورة المورد ${purchase.supplierInvoiceNo}`
      : "",
  });
  if (purchase.paid > 0) {
    state.supplierLedger.push({
      id: nextId(state.supplierLedger),
      supplierId: purchase.supplierId,
      at,
      type: "دفعة",
      refNo: no,
      debit: purchase.paid,
      credit: 0,
      note: purchase.paymentMethod === "cash" ? "سداد نقدي" : "دفعة جزئية",
    });
  }

  // قيد الشراء: المخزون مدين بالكامل، والدائن موزّع بين ما دُفع نقدًا
  // وما بقي في ذمة المورد.
  // ضريبة المدخلات أصل يُسترد من الهيئة، فلا تُحمَّل على المخزون.
  const inputVat = recoversInputVat(state) ? purchase.tax : 0;
  const credited: {
    accountCode: string;
    debit?: number;
    credit?: number;
    memo?: string;
  }[] = [
    {
      accountCode: ACC.inventory,
      debit: round2(purchase.total - inputVat),
      memo: "بضاعة واردة",
    },
  ];
  if (inputVat > 0)
    credited.push({
      accountCode: ACC.vatInput,
      debit: inputVat,
      memo: "ضريبة مدخلات",
    });
  if (purchase.paid > 0)
    credited.push({
      accountCode: instrumentAccount(input.instrument),
      credit: purchase.paid,
      memo: INSTRUMENT_LABELS[input.instrument || "cash"],
    });
  if (purchase.balance > 0)
    credited.push({
      accountCode: ACC.payables,
      credit: purchase.balance,
      memo: purchase.supplierName,
    });

  postJournal(state, {
    at,
    source: "purchase",
    sourceNo: no,
    description: `فاتورة شراء #${no} — ${purchase.supplierName}`,
    lines: credited,
  });

  return purchase;
}

/**
 * هل تُفصل ضريبة المدخلات عن التكلفة؟
 *
 * المحل المسجَّل في ضريبة القيمة المضافة يستردها من الهيئة، فهي أصل لا
 * تكلفة. وغير المسجَّل لا يستردها، فتبقى جزءًا من ثمن البضاعة كما كانت.
 * لهذا يبقى سلوك النسخ القائمة كما هو ما لم يُفعّل التسجيل من الإعدادات.
 */
export function recoversInputVat(state: DbState) {
  return state.settings?.vatRegistered === true;
}

/** تكلفة السطر الداخلة في المخزون: بلا ضريبة عند استردادها. */
function lineCostBase(state: DbState, line: { total: number; tax: number }) {
  return recoversInputVat(state) ? round2(line.total - line.tax) : line.total;
}

/** يزيد المخزون ويحدّث متوسط التكلفة لكل بند في الفاتورة. */
function applyPurchaseToInventory(
  state: DbState,
  purchase: Purchase,
  warehouseId?: number
) {
  purchase.lines.forEach(line => {
    const product = state.products.find(p => p.id === line.productId);
    if (!product) fail(`الصنف غير موجود: ${line.name}`);

    // التكلفة الفعلية للوحدة تشمل الخصم، وتشمل الضريبة فقط حين لا تُسترد.
    const effectiveUnitCost = round2(lineCostBase(state, line) / line.qty);
    product.avgCost = weightedAverage(
      product.stock,
      product.avgCost,
      line.qty,
      effectiveUnitCost
    );
    product.lastCost = effectiveUnitCost;

    // رقم التشغيلة يُنشئ دفعة مستقلة بصلاحيتها، فالصنف الواحد قد يصل
    // بصلاحيات مختلفة ولا يصح خلطها.
    if (line.lotNo)
      createBatch(state, {
        productId: line.productId,
        productName: line.name,
        lotNo: line.lotNo,
        expiryDate: line.expiryDate,
        qty: line.qty,
        unitCost: effectiveUnitCost,
        purchaseNo: purchase.no,
        supplierName: purchase.supplierName,
        at: purchase.at,
        warehouseId: warehouseId ?? defaultWarehouseId(state),
      });

    recordMove(state, {
      productId: line.productId,
      productName: line.name,
      type: "PURCHASE",
      qty: line.qty,
      unitCost: effectiveUnitCost,
      refType: "purchase",
      refNo: purchase.no,
      at: purchase.at,
      note: `شراء من ${purchase.supplierName}`,
      warehouseId: warehouseId ?? defaultWarehouseId(state),
    });
  });
}

/**
 * يلغي فاتورة شراء: يعكس المخزون ويصفّر أثرها على حساب المورد.
 * نستخدم الإلغاء بدل الحذف حتى يبقى أثر العملية في السجل.
 */
export function voidPurchase(state: DbState, no: number): Purchase {
  guard(state, "voidInvoice", `إلغاء فاتورة شراء #${no}`);
  const purchase = state.purchases.find(p => p.no === no);
  if (!purchase) fail("الفاتورة غير موجودة");
  if (purchase.status === "void") fail("الفاتورة ملغاة بالفعل");

  // نمنع الإلغاء إذا كان سيؤدي إلى رصيد سالب لأي صنف.
  purchase.lines.forEach(line => {
    const product = state.products.find(p => p.id === line.productId);
    if (!product) fail(`الصنف غير موجود: ${line.name}`);
    if (product.stock - line.qty < 0)
      fail(
        `لا يمكن الإلغاء: الرصيد الحالي من ${line.name} أقل من كمية الفاتورة (بيعت بالفعل)`
      );
  });

  const at = new Date().toISOString();
  purchase.lines.forEach(line => {
    recordMove(state, {
      productId: line.productId,
      productName: line.name,
      type: "PURCHASE_VOID",
      qty: -line.qty,
      unitCost: round2(lineCostBase(state, line) / line.qty),
      refType: "purchase",
      refNo: purchase.no,
      at,
      note: `إلغاء فاتورة شراء #${purchase.no}`,
    });
  });

  purchase.status = "void";
  purchase.voidedAt = at;

  // قيود عكسية تُبقي كشف الحساب متوازنًا دون حذف التاريخ.
  state.supplierLedger.push({
    id: nextId(state.supplierLedger),
    supplierId: purchase.supplierId,
    at,
    type: "إلغاء فاتورة",
    refNo: purchase.no,
    debit: purchase.total,
    credit: 0,
    note: `عكس فاتورة شراء #${purchase.no}`,
  });
  if (purchase.paid > 0) {
    state.supplierLedger.push({
      id: nextId(state.supplierLedger),
      supplierId: purchase.supplierId,
      at,
      type: "استرداد دفعة",
      refNo: purchase.no,
      debit: 0,
      credit: purchase.paid,
      note: `عكس دفعة فاتورة #${purchase.no}`,
    });
  }

  // الإلغاء يعكس قيود الفاتورة الأصلية، فلا تُحذف من الدفتر أبدًا.
  state.journal
    .filter(
      j =>
        j.source === "purchase" &&
        j.sourceNo === purchase.no &&
        !j.reversedBy
    )
    // نسخة ثابتة لأن العكس يضيف قيودًا جديدة أثناء المرور.
    .slice()
    .forEach(j => reverseJournal(state, j.no, "إلغاء فاتورة شراء"));

  return purchase;
}

/**
 * تعديل فاتورة شراء: نعكس القديمة ثم ننشئ الجديدة.
 * هذا يضمن وصول المخزون إلى النتيجة الصحيحة دون حساب فروق يدوية.
 */
export function editPurchase(
  state: DbState,
  no: number,
  input: PurchaseInput
): Purchase {
  const existing = state.purchases.find(p => p.no === no);
  if (!existing) fail("الفاتورة غير موجودة");
  if (existing.status === "void") fail("لا يمكن تعديل فاتورة ملغاة");

  // نتحقق من صحة الجديدة أولًا: إن فشلت لا نلمس القديمة إطلاقًا.
  buildPurchaseDraft(state, input);
  voidPurchase(state, no);
  const replacement = postPurchase(state, {
    ...input,
    notes: input.notes ?? existing.notes,
  });
  replacement.notes = replacement.notes
    ? `${replacement.notes} (تعديل للفاتورة #${no})`
    : `تعديل للفاتورة #${no}`;
  return replacement;
}

/** تسجيل دفعة لاحقة لمورد على فاتورة آجلة أو جزئية. */
export function payPurchase(
  state: DbState,
  no: number,
  amount: number,
  options: { instrument?: PaymentInstrument; reference?: string } = {}
): Purchase {
  guard(state, "purchase", `سداد دفعة على فاتورة #${no}`);
  const purchase = state.purchases.find(p => p.no === no);
  if (!purchase) fail("الفاتورة غير موجودة");
  if (purchase.status === "void") fail("الفاتورة ملغاة");
  const value = round2(Number(amount));
  if (!Number.isFinite(value) || value <= 0) fail("قيمة الدفعة غير صحيحة");
  if (value > purchase.balance) fail("الدفعة أكبر من المبلغ المتبقي");

  purchase.paid = round2(purchase.paid + value);
  purchase.balance = round2(purchase.total - purchase.paid);
  if (purchase.balance === 0) purchase.paymentMethod = "cash";
  else purchase.paymentMethod = "partial";

  state.supplierLedger.push({
    id: nextId(state.supplierLedger),
    supplierId: purchase.supplierId,
    at: new Date().toISOString(),
    type: "دفعة",
    refNo: no,
    debit: value,
    credit: 0,
    note: `سداد على فاتورة #${no}`,
  });

  // سند صرف يثبت الدفعة كمستند مستقل عن القيد.
  createVoucher(state, {
    kind: "payment",
    party: purchase.supplierName,
    supplierId: purchase.supplierId,
    amount: value,
    instrument: options.instrument,
    reference: options.reference,
    refType: "purchase",
    refNo: no,
    note: `سداد على فاتورة #${no}`,
  });

  // قيد السداد: ينقص ما علينا للمورد وينقص الصندوق أو البنك حسب الأداة.
  postJournal(state, {
    source: "payment",
    sourceNo: no,
    description: `سداد لـ${purchase.supplierName} — فاتورة #${no}`,
    lines: [
      { accountCode: ACC.payables, debit: value, memo: purchase.supplierName },
      {
        accountCode: instrumentAccount(options.instrument),
        credit: value,
        memo: INSTRUMENT_LABELS[options.instrument || "cash"],
      },
    ],
  });

  return purchase;
}

// ------------------------------------------------------------- البيع

export type SaleInput = {
  customer?: string;
  /** العميل المسجل؛ مطلوب للبيع الآجل ليُقيَّد على حسابه. */
  customerId?: number;
  terms?: PartyTerms;
  at?: string;
  lines: {
    productId: number;
    qty: number;
    price: number;
    /** وحدة البيع المختارة؛ تُترك فارغة للوحدة الأساسية. */
    unitName?: string;
    /** خصم السطر بالقيمة. */
    discount?: number;
    /** ضريبة السطر بالقيمة. */
    tax?: number;
  }[];
  /** خصم إضافي على إجمالي الفاتورة. */
  invoiceDiscount?: number;
  /** أداة القبض في البيع النقدي؛ افتراضها نقد فلا يتغير سلوك النسخ السابقة. */
  instrument?: PaymentInstrument;
  /** المخزن الذي تخرج منه البضاعة؛ افتراضه المخزن الافتراضي. */
  warehouseId?: number;
  /**
   * رقم أمر البيع الذي تُحوَّل منه هذه الفاتورة.
   * حجوزات هذا الأمر لا تُحسب ضدّه، وإلا منع الأمرُ نفسَه من التحويل.
   */
  fromDraftNo?: number;
};

/**
 * يحفظ فاتورة البيع ويخصم المخزون ويثبّت تكلفة الوحدة وقت البيع.
 * تثبيت التكلفة هو ما يجعل أرباح الماضي غير قابلة للتغير لاحقًا.
 */
export function postSale(state: DbState, input: SaleInput): Sale {
  guard(state, "sell", "تسجيل فاتورة بيع");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  const at = input.at || new Date().toISOString();
  const no = nextNumber(state.sales, 1048);
  const lines: SaleLine[] = [];
  const sellingWarehouse = input.warehouseId ?? defaultWarehouseId(state);

  // العميل اختياري: البيع النقدي العابر لا يحتاج سجلًا، لكن الآجل يحتاجه
  // ليُقيَّد على حسابه ويظهر في كشف الحساب.
  const customerRecord = input.customerId
    ? state.customers.find(c => c.id === input.customerId)
    : undefined;
  if (input.customerId && !customerRecord) fail("العميل غير موجود");
  const terms: PartyTerms = input.terms || customerRecord?.terms || "cash";
  const customerName =
    customerRecord?.name || (input.customer || "").trim() || "عميل نقدي";
  if (terms === "credit" && !customerRecord)
    fail("البيع الآجل يحتاج عميلًا مسجلًا");

  input.lines.forEach(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود");
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);

    // نحوّل إلى الوحدة الأساسية فورًا: المخزون والتكلفة يُحسبان بها دائمًا.
    const unit = findUnit(product, raw.unitName);
    const baseQty = round2(qty * unit.factor);
    // الرصيد المعتبر هو رصيد المخزن البائع لا إجمالي المحل: الفرع لا
    // يبيع ما ليس عنده ولو كان موجودًا في فرع آخر. ويُطرح منه المحجوز
    // لأوامر بيع أخرى، فالموعود لعميل ليس متاحًا لغيره.
    const physical = sellingWarehouse
      ? warehouseStock(state, product.id, sellingWarehouse)
      : product.stock;
    const heldForOthers = (state.reservations || [])
      .filter(
        r =>
          !r.released &&
          r.productId === product.id &&
          // الأمر الجاري تحويله لا يحجز عن نفسه.
          r.draftNo !== input.fromDraftNo &&
          (sellingWarehouse === undefined ||
            (r.warehouseId ?? defaultWarehouseId(state)) === sellingWarehouse)
      )
      .reduce((sum, r) => sum + r.qty, 0);
    const available = round2(physical - heldForOthers);
    if (baseQty > available)
      fail(
        `الرصيد المتاح من ${product.name} هو ${round2(available / unit.factor)} ${unit.name}`
      );

    // السعر المرسل يخص وحدة البيع. نحتفظ به غير مقرَّب لأن التقريب هنا
    // يضيع كسورًا تظهر في الإجمالي (110 ÷ 12 مثلًا).
    const linePrice = Number(raw.price) / unit.factor;

    const lineDiscount = round2(Number(raw.discount || 0));
    const lineTax = round2(Number(raw.tax || 0));
    if (lineDiscount < 0 || lineTax < 0)
      fail(`الخصم والضريبة لا يصح أن تكون سالبة: ${product.name}`);

    const gross = round2(linePrice * baseQty);
    if (lineDiscount > gross)
      fail(`الخصم أكبر من قيمة الصنف: ${product.name}`);

    lines.push({
      id: product.id,
      name: product.name,
      unit: product.unit,
      qty: baseQty,
      price: linePrice,
      unitCost: product.avgCost,
      soldUnit: unit.factor === 1 ? undefined : unit.name,
      soldQty: unit.factor === 1 ? undefined : qty,
      discount: lineDiscount,
      tax: lineTax,
      total: round2(gross - lineDiscount + lineTax),
    });
  });

  lines.forEach(line => {
    // الصرف بقاعدة الأقرب انتهاءً أولًا، وتُسجَّل الدفعات في السطر
    // ليمكن تتبّع من اشترى أي تشغيلة عند الحاجة لسحبها.
    const consumed = consumeFEFO(state, line.id, line.qty, sellingWarehouse);
    if (consumed.length) line.batches = consumed;

    recordMove(state, {
      productId: line.id,
      productName: line.name,
      type: "SALE",
      qty: -line.qty,
      unitCost: line.unitCost,
      refType: "sale",
      refNo: no,
      at,
      note: consumed.length
        ? `بيع · تشغيلة ${consumed.map(c => c.lotNo).join("، ")}`
        : "بيع",
      warehouseId: sellingWarehouse,
    });
  });

  const subtotal = round2(
    lines.reduce((sum, l) => sum + l.price * l.qty, 0)
  );
  const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount, 0));
  const taxTotal = round2(lines.reduce((sum, l) => sum + l.tax, 0));

  // خصم الفاتورة يُضاف فوق خصومات السطور، ولا يصح أن يتجاوز الصافي.
  const invoiceDiscount = round2(Number(input.invoiceDiscount || 0));
  if (invoiceDiscount < 0) fail("خصم الفاتورة لا يصح أن يكون سالبًا");
  const afterLines = round2(subtotal - lineDiscounts);
  if (invoiceDiscount > afterLines)
    fail("خصم الفاتورة أكبر من قيمتها");

  const discount = round2(lineDiscounts + invoiceDiscount);
  const total = round2(subtotal - discount + taxTotal);

  const sale: Sale = {
    no,
    at,
    customer: customerName,
    customerId: customerRecord?.id,
    terms,
    lines,
    subtotal,
    discount,
    tax: taxTotal,
    total,
    cogs: round2(lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0)),
  };
  state.sales.unshift(sale);

  // البيع الآجل دين على العميل، فيُقيَّد مدينًا في دفتر أستاذه.
  if (terms === "credit" && customerRecord) {
    const owed = customerBalance(state, customerRecord.id);
    if (
      customerRecord.creditLimit > 0 &&
      owed + sale.total > customerRecord.creditLimit
    )
      fail(
        `يتجاوز حد ائتمان ${customerRecord.name} البالغ ${customerRecord.creditLimit}`
      );
    state.customerLedger.push({
      id: nextId(state.customerLedger),
      customerId: customerRecord.id,
      at,
      type: "فاتورة بيع",
      refNo: no,
      debit: sale.total,
      credit: 0,
      note: "بيع آجل",
    });
  }

  // قيدا البيع: الإيراد ثم التكلفة.
  // الآجل يُحمَّل على ذمم العملاء، والنقدي على الصندوق.
  postJournal(state, {
    at,
    source: "sale",
    sourceNo: no,
    description: `فاتورة بيع #${no} — ${sale.customer}`,
    lines: [
      {
        accountCode:
          terms === "credit"
            ? ACC.receivables
            : instrumentAccount(input.instrument),
        debit: sale.total,
        memo: sale.customer,
      },
      {
        accountCode: ACC.sales,
        credit: round2(sale.total - sale.tax),
        memo: "مبيعات",
      },
      // الضريبة المحصَّلة التزام على المحل لا إيرادًا له.
      ...(sale.tax > 0
        ? [
            {
              accountCode: ACC.vatPayable,
              credit: sale.tax,
              memo: "ضريبة مستحقة",
            },
          ]
        : []),
    ],
  });

  // تكلفة البضاعة المباعة تخرج من المخزون إلى المصروف.
  if (sale.cogs > 0)
    postJournal(state, {
      at,
      source: "sale",
      sourceNo: no,
      description: `تكلفة المبيع — فاتورة #${no}`,
      lines: [
        { accountCode: ACC.cogs, debit: sale.cogs, memo: "تكلفة المبيع" },
        { accountCode: ACC.inventory, credit: sale.cogs, memo: "خروج مخزون" },
      ],
    });

  return sale;
}

// ----------------------------------------------------------- الربحية

/** ملخص ربحية لفترة: المبيعات والتكلفة والربح والهامش. */
export function profitSummary(sales: Sale[]) {
  const revenue = round2(sales.reduce((sum, sale) => sum + sale.total, 0));
  const cogs = round2(sales.reduce((sum, sale) => sum + (sale.cogs || 0), 0));
  const grossProfit = round2(revenue - cogs);
  return {
    revenue,
    cogs,
    grossProfit,
    // الهامش بلا مبيعات غير معرّف؛ نعيد صفرًا بدل قسمة على صفر.
    margin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
  };
}

/** قيمة المخزون بالتكلفة لا بسعر البيع. */
export function inventoryValue(state: DbState) {
  return round2(
    state.products.reduce((sum, p) => sum + p.stock * p.avgCost, 0)
  );
}

export function purchasesTotal(purchases: Purchase[]) {
  return round2(
    purchases
      .filter(p => p.status === "confirmed")
      .reduce((sum, p) => sum + p.total, 0)
  );
}

/** إجمالي ما هو مستحق لكل الموردين. */
export function payablesTotal(state: DbState) {
  return round2(
    state.purchases
      .filter(p => p.status === "confirmed")
      .reduce((sum, p) => sum + p.balance, 0)
  );
}


// ------------------------------------------------------------ المرتجعات

export type ReturnInput = {
  refNo: number;
  at?: string;
  reason?: string;
  lines: { productId: number; qty: number }[];
  /** أداة رد المبلغ في مرتجع البيع النقدي؛ افتراضها نقد. */
  instrument?: PaymentInstrument;
};

/** الكميات المرتجعة سابقًا من فاتورة معينة، لمنع تجاوز الكمية الأصلية. */
export function returnedQuantities(
  state: DbState,
  kind: ReturnKind,
  refNo: number
) {
  const map = new Map<number, number>();
  state.returns
    .filter(r => r.kind === kind && r.refNo === refNo)
    .forEach(r =>
      r.lines.forEach(line =>
        map.set(line.productId, (map.get(line.productId) || 0) + line.qty)
      )
    );
  return map;
}

/**
 * مرتجع بيع: البضاعة تعود للمخزن، ونعكس تكلفتها من COGS.
 * نستخدم نفس تكلفة الوحدة المثبتة في الفاتورة الأصلية حتى يبقى الربح صحيحًا.
 */
/**
 * سعر الوحدة الصافي في سطر بيع: بعد الخصم والضريبة.
 * الفواتير السابقة للإصدار 11 لا تحمل total، فنرجع لسعرها الأصلي.
 */
function netUnitPrice(line: SaleLine) {
  if (!line.qty) return 0;
  const net = typeof line.total === "number" ? line.total : line.price * line.qty;
  return round2(net / line.qty);
}

export function postSaleReturn(
  state: DbState,
  input: ReturnInput
): StockReturn {
  const sale = state.sales.find(s => s.no === input.refNo);
  if (!sale) fail("فاتورة البيع غير موجودة");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل للمرتجع");

  const already = returnedQuantities(state, "sale", sale.no);
  const at = input.at || new Date().toISOString();
  const lines: ReturnLine[] = input.lines.map(raw => {
    const original = sale.lines.find(l => l.id === raw.productId);
    if (!original) fail("هذا الصنف ليس ضمن الفاتورة الأصلية");
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${original.name}`);

    const remaining = original.qty - (already.get(raw.productId) || 0);
    if (qty > remaining)
      fail(
        `الكمية المتاحة للإرجاع من ${original.name} هي ${remaining} فقط`
      );

    return {
      productId: original.id,
      name: original.name,
      unit: original.unit,
      qty,
      unitPrice: netUnitPrice(original),
      // التكلفة من الفاتورة الأصلية، لا من متوسط اليوم.
      unitCost: original.unitCost || 0,
      total: round2(qty * netUnitPrice(original)),
    };
  });

  lines.forEach(line => {
    // البضاعة تعود إلى دفعاتها الأصلية بعكس ترتيب الصرف.
    const original = sale.lines.find(l => l.id === line.productId);
    restoreBatches(state, original?.batches, line.qty);

    recordMove(state, {
      productId: line.productId,
      productName: line.name,
      type: "SALE_RETURN",
      qty: line.qty,
      unitCost: line.unitCost,
      refType: "sale_return",
      refNo: sale.no,
      at,
      note: `مرتجع بيع من فاتورة #${sale.no}`,
    });
  });

  const entry: StockReturn = {
    no: nextNumber(state.returns, 8000),
    kind: "sale",
    refNo: sale.no,
    at,
    party: sale.customer,
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.total, 0)),
    cogs: round2(lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0)),
    reason: (input.reason || "").trim(),
  };
  state.returns.unshift(entry);

  // إن كانت الفاتورة آجلة على عميل مسجل، فالمرتجع يقلل دينه.
  if (sale.terms === "credit" && sale.customerId) {
    state.customerLedger.push({
      id: nextId(state.customerLedger),
      customerId: sale.customerId,
      at,
      type: "مرتجع بيع",
      refNo: sale.no,
      debit: 0,
      credit: entry.total,
      note: `مرتجع من فاتورة #${sale.no}`,
    });
  }

  // قيد المرتجع: مردودات المبيعات مدينة، ويُرد المقابل للعميل أو الصندوق.
  postJournal(state, {
    at,
    source: "sale_return",
    sourceNo: sale.no,
    description: `مرتجع بيع من فاتورة #${sale.no}`,
    lines: [
      {
        accountCode: ACC.salesReturns,
        debit: entry.total,
        memo: "مردودات مبيعات",
      },
      {
        accountCode:
          sale.terms === "credit" && sale.customerId
            ? ACC.receivables
            : instrumentAccount(input.instrument),
        credit: entry.total,
        memo: sale.customer,
      },
    ],
  });

  // البضاعة تعود للمخزون بتكلفتها الأصلية، فتُعكس تكلفة المبيع.
  if (entry.cogs > 0)
    postJournal(state, {
      at,
      source: "sale_return",
      sourceNo: sale.no,
      description: `إعادة تكلفة مرتجع #${sale.no}`,
      lines: [
        { accountCode: ACC.inventory, debit: entry.cogs, memo: "بضاعة عائدة" },
        { accountCode: ACC.cogs, credit: entry.cogs, memo: "عكس التكلفة" },
      ],
    });

  return entry;
}

/**
 * مرتجع شراء: البضاعة تعود للمورد، فينقص المخزون وينقص ما علينا له.
 */
export function postPurchaseReturn(
  state: DbState,
  input: ReturnInput
): StockReturn {
  const purchase = state.purchases.find(p => p.no === input.refNo);
  if (!purchase) fail("فاتورة الشراء غير موجودة");
  if (purchase.status === "void") fail("الفاتورة ملغاة");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل للمرتجع");

  const already = returnedQuantities(state, "purchase", purchase.no);
  const at = input.at || new Date().toISOString();

  const lines: ReturnLine[] = input.lines.map(raw => {
    const original = purchase.lines.find(l => l.productId === raw.productId);
    if (!original) fail("هذا الصنف ليس ضمن فاتورة الشراء");
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${original.name}`);

    const remaining = original.qty - (already.get(raw.productId) || 0);
    if (qty > remaining)
      fail(`الكمية المتاحة للإرجاع من ${original.name} هي ${remaining} فقط`);

    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail(`الصنف غير موجود: ${original.name}`);
    // لا نرجع أكثر مما هو موجود فعليًا في المخزن.
    if (product.stock < qty)
      fail(
        `الرصيد الحالي من ${original.name} هو ${product.stock}، لا يكفي للإرجاع`
      );

    // تكلفة الإرجاع بنفس الأساس الذي دخل به الصنف المخزون.
    const unitCost = round2(lineCostBase(state, original) / original.qty);
    // نسبة الضريبة في السطر تُرد للهيئة مع المرتجع.
    const unitVat = recoversInputVat(state)
      ? round2(original.tax / original.qty)
      : 0;
    return {
      productId: original.productId,
      name: original.name,
      unit: original.unit,
      qty,
      unitPrice: round2(unitCost + unitVat),
      unitCost,
      total: round2(qty * unitCost),
    };
  });

  lines.forEach(line => {
    recordMove(state, {
      productId: line.productId,
      productName: line.name,
      type: "PURCHASE_RETURN",
      qty: -line.qty,
      unitCost: line.unitCost,
      refType: "purchase_return",
      refNo: purchase.no,
      at,
      note: `مرتجع شراء إلى ${purchase.supplierName}`,
    });
  });

  const total = round2(lines.reduce((sum, l) => sum + l.total, 0));
  const entry: StockReturn = {
    no: nextNumber(state.returns, 8000),
    kind: "purchase",
    refNo: purchase.no,
    at,
    party: purchase.supplierName,
    supplierId: purchase.supplierId,
    lines,
    total,
    cogs: 0,
    reason: (input.reason || "").trim(),
  };
  state.returns.unshift(entry);

  // قيمة المرتجع تقلل ما علينا للمورد.
  state.supplierLedger.push({
    id: nextId(state.supplierLedger),
    supplierId: purchase.supplierId,
    at,
    type: "مرتجع شراء",
    refNo: purchase.no,
    debit: total,
    credit: 0,
    note: `مرتجع من فاتورة #${purchase.no}`,
  });

  // نعكس أثر المرتجع على الفاتورة حتى يبقى الرصيد المتبقي صحيحًا.
  purchase.total = round2(purchase.total - total);
  purchase.balance = round2(Math.max(0, purchase.total - purchase.paid));

  // قيد مرتجع الشراء: يخرج المخزون ويقل الالتزام تجاه المورد.
  // ما رُدّ من ضريبة مدخلات يعود للهيئة، فيُعكس من حسابها لا من المخزون.
  const returnedVat = round2(
    lines.reduce(
      (sum, l) => sum + round2((l.unitPrice - l.unitCost) * l.qty),
      0
    )
  );
  postJournal(state, {
    at,
    source: "purchase_return",
    sourceNo: purchase.no,
    description: `مرتجع شراء إلى ${purchase.supplierName}`,
    lines: [
      {
        accountCode: ACC.payables,
        debit: round2(total + returnedVat),
        memo: purchase.supplierName,
      },
      { accountCode: ACC.inventory, credit: total, memo: "بضاعة مرتجعة" },
      ...(returnedVat > 0
        ? [
            {
              accountCode: ACC.vatInput,
              credit: returnedVat,
              memo: "عكس ضريبة مدخلات",
            },
          ]
        : []),
    ],
  });

  return entry;
}

/** صافي المبيعات والربح بعد خصم مرتجعات البيع. */
export function netProfitSummary(state: DbState, sales: Sale[]) {
  const gross = profitSummary(sales);
  const saleNumbers = new Set(sales.map(s => s.no));
  const related = state.returns.filter(
    r => r.kind === "sale" && saleNumbers.has(r.refNo)
  );
  const returnsTotal = round2(related.reduce((sum, r) => sum + r.total, 0));
  const returnsCogs = round2(related.reduce((sum, r) => sum + r.cogs, 0));

  const revenue = round2(gross.revenue - returnsTotal);
  const cogs = round2(gross.cogs - returnsCogs);
  const grossProfit = round2(revenue - cogs);
  return {
    revenue,
    cogs,
    grossProfit,
    returnsTotal,
    margin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
  };
}


// ------------------------------------------------------ المصروفات التشغيلية

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  rent: "إيجار",
  salaries: "رواتب وأجور",
  utilities: "كهرباء وماء واتصالات",
  transport: "نقل وشحن",
  maintenance: "صيانة",
  supplies: "مستلزمات تشغيل",
  government: "رسوم حكومية",
  other: "أخرى",
};

export type ExpenseInput = {
  category: ExpenseCategory;
  description: string;
  amount: number;
  at?: string;
  reference?: string;
  notes?: string;
  /** أداة الدفع؛ افتراضها نقد كما في النسخ السابقة. */
  instrument?: PaymentInstrument;
  /** مركز التكلفة الذي يُنسب إليه المصروف؛ اختياري. */
  costCenterId?: number;
};

export function addExpense(state: DbState, input: ExpenseInput): Expense {
  guard(state, "purchase", "تسجيل مصروف");
  const description = (input.description || "").trim();
  if (!description) fail("اكتب وصفًا للمصروف");

  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0)
    fail("قيمة المصروف يجب أن تكون أكبر من صفر");
  if (!EXPENSE_LABELS[input.category]) fail("اختر بند المصروف");

  const expense: Expense = {
    id: nextId(state.expenses),
    at: input.at || new Date().toISOString(),
    category: input.category,
    description,
    amount,
    reference: (input.reference || "").trim(),
    notes: (input.notes || "").trim(),
    instrument: input.instrument || "cash",
    costCenterId: input.costCenterId,
  };
  state.expenses.unshift(expense);

  // قيد المصروف: مدين المصروفات، دائن الصندوق.
  postJournal(state, {
    at: expense.at,
    source: "expense",
    sourceNo: expense.id,
    description: `مصروف: ${expense.description}`,
    lines: [
      {
        accountCode: ACC.expenses,
        debit: expense.amount,
        memo: EXPENSE_LABELS[expense.category],
      },
      {
        accountCode: instrumentAccount(expense.instrument),
        credit: expense.amount,
        memo: INSTRUMENT_LABELS[expense.instrument || "cash"],
      },
    ],
  });

  return expense;
}

export function deleteExpense(state: DbState, id: number) {
  const index = state.expenses.findIndex(e => e.id === id);
  if (index < 0) fail("المصروف غير موجود");
  state.expenses.splice(index, 1);
}

export function expensesTotal(expenses: Expense[]) {
  return round2(expenses.reduce((sum, e) => sum + e.amount, 0));
}

/** تجميع المصروفات حسب البند لعرضها في التقرير. */
export function expensesByCategory(expenses: Expense[]) {
  const map = new Map<ExpenseCategory, number>();
  expenses.forEach(e =>
    map.set(e.category, round2((map.get(e.category) || 0) + e.amount))
  );
  return Array.from(map.entries())
    .map(([category, total]) => ({
      category,
      label: EXPENSE_LABELS[category],
      total,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * صافي الربح = الربح الإجمالي (بعد المرتجعات) ناقص المصروفات التشغيلية.
 * هذا هو الرقم الذي يهم صاحب المحل فعليًا في نهاية الشهر.
 */
export function netIncome(state: DbState, sales: Sale[], expenses: Expense[]) {
  const gross = netProfitSummary(state, sales);
  const opex = expensesTotal(expenses);
  const net = round2(gross.grossProfit - opex);
  return {
    ...gross,
    expenses: opex,
    netProfit: net,
    netMargin: gross.revenue > 0 ? round2((net / gross.revenue) * 100) : 0,
  };
}


// -------------------------------------------------------- تنبيهات المخزون

/** الحد الافتراضي لإعادة الطلب عندما لا يحدده المستخدم لصنف معين. */
export const DEFAULT_REORDER_LEVEL = 8;
/** عدد الأيام التي نعتبر الصنف بعدها «قارب على الانتهاء». */
export const EXPIRY_WARNING_DAYS = 60;

export type StockAlert = {
  productId: number;
  name: string;
  unit: string;
  stock: number;
  kind: "out" | "low" | "expired" | "expiring";
  /** رسالة عربية جاهزة للعرض مباشرة. */
  message: string;
  /** الأيام المتبقية للصلاحية؛ سالبة إذا انتهت. */
  daysLeft?: number;
};

export function reorderLevelOf(product: Product) {
  return typeof product.reorderLevel === "number"
    ? product.reorderLevel
    : DEFAULT_REORDER_LEVEL;
}

/** أيام متبقية حتى تاريخ الصلاحية؛ null إذا لم يُسجل تاريخ. */
export function daysUntil(dateStr?: string, now = new Date()) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round(
    (startOfDay(target) - startOfDay(now)) / (1000 * 60 * 60 * 24)
  );
}

/**
 * تنبيهات المخزون مرتبة بالأهمية: المنتهي أولًا ثم النافد ثم الناقص.
 * تجمع نقص الرصيد وقرب انتهاء الصلاحية في قائمة واحدة يفهمها البائع.
 */
export function stockAlerts(state: DbState, now = new Date()): StockAlert[] {
  const alerts: StockAlert[] = [];

  state.products.forEach(product => {
    const level = reorderLevelOf(product);
    const days = daysUntil(product.expiryDate, now);

    // الصلاحية أهم من الرصيد: صنف منتهٍ لا يجوز بيعه أصلًا.
    if (days !== null && product.stock > 0) {
      if (days < 0)
        alerts.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          stock: product.stock,
          kind: "expired",
          daysLeft: days,
          message: `انتهت صلاحيته منذ ${Math.abs(days)} يومًا`,
        });
      else if (days <= EXPIRY_WARNING_DAYS)
        alerts.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          stock: product.stock,
          kind: "expiring",
          daysLeft: days,
          message:
            days === 0
              ? "تنتهي صلاحيته اليوم"
              : `تنتهي صلاحيته خلال ${days} يومًا`,
        });
    }

    if (product.stock <= 0) {
      alerts.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        stock: product.stock,
        kind: "out",
        message: "نفد من المخزن",
      });
    } else if (product.stock <= level) {
      alerts.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        stock: product.stock,
        kind: "low",
        message: `الرصيد ${product.stock} ${product.unit} · حد الطلب ${level}`,
      });
    }
  });

  const rank: Record<StockAlert["kind"], number> = {
    expired: 0,
    out: 1,
    expiring: 2,
    low: 3,
  };
  return alerts.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.stock - b.stock
  );
}


// ------------------------------------------------- الوحدات والباركودات

/** الوحدة الأساسية للصنف؛ معاملها 1 دائمًا وهي مرجع كل التحويلات. */
export function baseUnit(product: Product): ProductUnit {
  return { name: product.unit, factor: 1, price: product.price };
}

/** كل وحدات البيع المتاحة للصنف: الأساسية أولًا ثم البدائل الصحيحة. */
export function unitsOf(product: Product): ProductUnit[] {
  const extra = (product.units || []).filter(
    u => u && u.name?.trim() && Number(u.factor) > 0
  );
  return [baseUnit(product), ...extra];
}

/** يبحث عن وحدة بالاسم؛ يعيد الأساسية عند عدم التطابق. */
export function findUnit(product: Product, name?: string): ProductUnit {
  if (!name) return baseUnit(product);
  return (
    unitsOf(product).find(u => u.name.trim() === name.trim()) ||
    baseUnit(product)
  );
}

/** يحوّل كمية من وحدة معينة إلى الوحدة الأساسية للمخزون. */
export function toBaseQty(product: Product, qty: number, unitName?: string) {
  return round2(qty * findUnit(product, unitName).factor);
}

/**
 * سعر بيع الوحدة: السعر الصريح إن حُدد، وإلا سعر الوحدة الأساسية × المعامل.
 * هذا يسمح بتسعير الكرتون أرخص من مجموع عبواته دون كسر الحساب.
 */
export function unitPrice(product: Product, unitName?: string) {
  const unit = findUnit(product, unitName);
  if (typeof unit.price === "number" && unit.price > 0) return unit.price;
  return round2(product.price * unit.factor);
}

/** الرصيد المتاح معبّرًا عنه بالوحدة المطلوبة، لا بالوحدة الأساسية. */
export function stockInUnit(product: Product, unitName?: string) {
  const unit = findUnit(product, unitName);
  if (unit.factor <= 0) return 0;
  return round2(product.stock / unit.factor);
}

/** يتحقق من صحة وحدة قبل حفظها في المنتج. */
export function validateUnit(product: Product, unit: ProductUnit) {
  const name = (unit.name || "").trim();
  if (!name) fail("اسم الوحدة مطلوب");
  if (name === product.unit) fail("هذا هو اسم الوحدة الأساسية للصنف");

  const factor = Number(unit.factor);
  if (!Number.isFinite(factor) || factor <= 0)
    fail("معامل التحويل يجب أن يكون أكبر من صفر");
  if (factor === 1) fail("معامل 1 يساوي الوحدة الأساسية؛ استخدم رقمًا مختلفًا");

  const exists = (product.units || []).some(
    u => u.name.trim() === name && u !== unit
  );
  if (exists) fail("توجد وحدة بنفس الاسم لهذا الصنف");

  const price = Number(unit.price || 0);
  if (price < 0) fail("سعر الوحدة لا يصح أن يكون سالبًا");
  return { name, factor: round2(factor), price: round2(price) };
}

export function addProductUnit(
  state: DbState,
  productId: number,
  unit: ProductUnit
): Product {
  const product = state.products.find(p => p.id === productId);
  if (!product) fail("الصنف غير موجود");
  const clean = validateUnit(product, unit);

  const barcode = (unit.barcode || "").trim();
  if (barcode) assertBarcodeFree(state, barcode, productId);

  product.units = [...(product.units || []), { ...clean, barcode }];
  return product;
}

export function removeProductUnit(
  state: DbState,
  productId: number,
  unitName: string
): Product {
  const product = state.products.find(p => p.id === productId);
  if (!product) fail("الصنف غير موجود");
  product.units = (product.units || []).filter(
    u => u.name.trim() !== unitName.trim()
  );
  return product;
}

/** يمنع إسناد باركود مستخدَم لصنف آخر، وإلا اختلط المسح بين صنفين. */
function assertBarcodeFree(state: DbState, code: string, exceptId?: number) {
  const owner = findByBarcode(state, code);
  if (owner && owner.product.id !== exceptId)
    fail(`الباركود ${code} مستخدم بالفعل للصنف ${owner.product.name}`);
}

export function addAltBarcode(
  state: DbState,
  productId: number,
  code: string
): Product {
  const product = state.products.find(p => p.id === productId);
  if (!product) fail("الصنف غير موجود");
  const barcode = (code || "").trim();
  if (!barcode) fail("أدخل رقم الباركود");
  assertBarcodeFree(state, barcode, productId);
  if (product.barcode === barcode || (product.altBarcodes || []).includes(barcode))
    fail("هذا الباركود مسجل لنفس الصنف");

  product.altBarcodes = [...(product.altBarcodes || []), barcode];
  return product;
}

export function removeAltBarcode(
  state: DbState,
  productId: number,
  code: string
): Product {
  const product = state.products.find(p => p.id === productId);
  if (!product) fail("الصنف غير موجود");
  product.altBarcodes = (product.altBarcodes || []).filter(b => b !== code);
  return product;
}

/**
 * يبحث عن صنف بأي باركود: الأساسي أو الإضافي أو باركود وحدة.
 * عند مطابقة باركود وحدة نعيد اسمها ليُضاف السطر بالوحدة الصحيحة مباشرة.
 */
export function findByBarcode(
  state: DbState,
  code: string
): { product: Product; unitName?: string } | null {
  const target = (code || "").trim();
  if (!target) return null;

  for (const product of state.products) {
    if (product.barcode === target) return { product };
    if ((product.altBarcodes || []).includes(target)) return { product };
    const unit = (product.units || []).find(
      u => (u.barcode || "").trim() === target
    );
    if (unit) return { product, unitName: unit.name };
  }
  return null;
}


// ---------------------------------------------------------------- العملاء

export function createCustomer(
  state: DbState,
  input: Partial<Customer> & { name: string }
): Customer {
  const name = (input.name || "").trim();
  if (!name) fail("اسم العميل مطلوب");
  const duplicate = state.customers.some(
    c => c.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) fail("يوجد عميل بنفس الاسم");

  const creditLimit = Number(input.creditLimit || 0);
  if (!Number.isFinite(creditLimit) || creditLimit < 0)
    fail("حد الائتمان لا يصح أن يكون سالبًا");

  const customer: Customer = {
    id: nextId(state.customers),
    name,
    phone: (input.phone || "").trim(),
    address: (input.address || "").trim(),
    taxNumber: (input.taxNumber || "").trim(),
    notes: (input.notes || "").trim(),
    terms: input.terms || "cash",
    creditLimit: round2(creditLimit),
    status: input.status || "active",
    createdAt: new Date().toISOString(),
  };
  state.customers.push(customer);
  return customer;
}

export function updateCustomer(
  state: DbState,
  id: number,
  patch: Partial<Customer>
): Customer {
  const customer = state.customers.find(c => c.id === id);
  if (!customer) fail("العميل غير موجود");
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم العميل مطلوب");
    const clash = state.customers.some(
      c => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (clash) fail("يوجد عميل بنفس الاسم");
    customer.name = name;
  }
  if (patch.creditLimit !== undefined) {
    const limit = Number(patch.creditLimit);
    if (!Number.isFinite(limit) || limit < 0)
      fail("حد الائتمان لا يصح أن يكون سالبًا");
    customer.creditLimit = round2(limit);
  }
  for (const key of [
    "phone",
    "address",
    "taxNumber",
    "notes",
    "terms",
    "status",
  ] as const) {
    if (patch[key] !== undefined) (customer as any)[key] = patch[key];
  }
  return customer;
}

/** رصيد العميل = ما علينا له سالبًا وما له علينا موجبًا، من دفتر الأستاذ. */
export function customerBalance(state: DbState, customerId: number) {
  return round2(
    state.customerLedger
      .filter(e => e.customerId === customerId)
      .reduce((sum, e) => sum + e.debit - e.credit, 0)
  );
}

export function customerTotals(state: DbState, customerId: number) {
  const customer = state.customers.find(c => c.id === customerId);
  const sales = state.sales.filter(s => s.customerId === customerId);
  const total = round2(sales.reduce((sum, s) => sum + s.total, 0));
  const balance = customerBalance(state, customerId);
  return {
    count: sales.length,
    total,
    balance,
    collected: round2(total - balance),
    creditLimit: customer?.creditLimit || 0,
  };
}

/** كشف حساب العميل مرتبًا زمنيًا برصيد تراكمي. */
export function customerStatement(
  state: DbState,
  customerId: number,
  from?: Date,
  to?: Date
) {
  const entries = state.customerLedger
    .filter(e => e.customerId === customerId)
    .filter(e => {
      const at = new Date(e.at);
      if (from && at < from) return false;
      if (to && at > to) return false;
      return true;
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let running = 0;
  return entries.map(e => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });
}

/** تحصيل دفعة من عميل آجل؛ تُقيَّد دائنًا فتقلل ما عليه. */
export function collectFromCustomer(
  state: DbState,
  customerId: number,
  amount: number,
  note = "تحصيل نقدي",
  options: { instrument?: PaymentInstrument; reference?: string } = {}
): CustomerLedgerEntry {
  guard(state, "sell", "تحصيل من عميل");
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) fail("العميل غير موجود");
  const value = round2(Number(amount));
  if (!Number.isFinite(value) || value <= 0) fail("قيمة التحصيل غير صحيحة");

  const owed = customerBalance(state, customerId);
  if (value > owed) fail(`المبلغ المستحق على العميل هو ${owed} فقط`);

  const entry: CustomerLedgerEntry = {
    id: nextId(state.customerLedger),
    customerId,
    at: new Date().toISOString(),
    type: "تحصيل",
    refNo: 0,
    debit: 0,
    credit: value,
    note,
  };
  state.customerLedger.push(entry);

  // سند قبض يثبت التحصيل كمستند مستقل عن القيد.
  createVoucher(state, {
    kind: "receipt",
    party: customer.name,
    customerId,
    amount: value,
    instrument: options.instrument,
    reference: options.reference,
    at: entry.at,
    note,
  });

  // قيد التحصيل: مدين الصندوق أو البنك حسب الأداة، دائن ذمم العملاء.
  postJournal(state, {
    at: entry.at,
    source: "collection",
    sourceNo: entry.id,
    description: `تحصيل من ${customer.name}`,
    lines: [
      {
        accountCode: instrumentAccount(options.instrument),
        debit: value,
        memo: note,
      },
      { accountCode: ACC.receivables, credit: value, memo: customer.name },
    ],
  });

  return entry;
}

/** إجمالي ما على العملاء (الذمم المدينة). */
export function receivablesTotal(state: DbState) {
  return round2(
    state.customers.reduce((sum, c) => sum + customerBalance(state, c.id), 0)
  );
}

// ------------------------------------------------ الجرد والتسويات المخزنية

export type StockTakeLine = {
  productId: number;
  /** الكمية الفعلية الموجودة في المخزن عند الجرد. */
  countedQty: number;
  /** تكلفة الوحدة الحقيقية؛ تُستخدم لتصحيح متوسط التكلفة. */
  unitCost?: number;
};

/**
 * جرد فعلي: يضبط رصيد كل صنف على الكمية المعدودة ويسجل الفرق كحركة
 * ADJUSTMENT، فيبقى الأثر مرئيًا في تقرير حركة الأصناف.
 *
 * يعالج أيضًا مشكلة أرصدة البداية بتكلفة صفر: تمرير unitCost يصحّح
 * متوسط التكلفة فتصبح الأرباح حقيقية لا مبالغًا فيها.
 */
export function postStockTake(
  state: DbState,
  lines: StockTakeLine[],
  note = "جرد فعلي"
): StockMove[] {
  guard(state, "stockTake", note);
  if (!lines?.length) fail("أضف صنفًا واحدًا على الأقل للجرد");

  const at = new Date().toISOString();
  const refNo = nextNumber(
    state.stockMoves.filter(m => m.refType === "stocktake").map(m => ({ no: m.refNo })),
    9000
  );

  // نتحقق من كل السطور قبل أي كتابة، فلا يُطبَّق جرد نصفه صالح.
  const prepared = lines.map(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود");
    const counted = Number(raw.countedQty);
    if (!Number.isFinite(counted) || counted < 0)
      fail(`الكمية المعدودة لا تصح أن تكون سالبة: ${product.name}`);
    const cost = raw.unitCost === undefined ? undefined : Number(raw.unitCost);
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0))
      fail(`التكلفة لا تصح أن تكون سالبة: ${product.name}`);
    return { product, counted, cost };
  });

  const moves: StockMove[] = [];
  prepared.forEach(({ product, counted, cost }) => {
    // التكلفة تُصحَّح أولًا لأن الرصيد الجديد يُقيَّم بها.
    if (cost !== undefined) {
      product.avgCost = round2(cost);
      if (!product.lastCost) product.lastCost = round2(cost);
    }

    const diff = round2(counted - product.stock);
    if (diff === 0) return;

    moves.push(
      recordMove(state, {
        productId: product.id,
        productName: product.name,
        type: "ADJUSTMENT",
        qty: diff,
        unitCost: product.avgCost,
        refType: "stocktake",
        refNo,
        at,
        note: `${note} (${diff > 0 ? "زيادة" : "عجز"})`,
      })
    );
  });

  // فرق الجرد يُقيَّد: الزيادة تدخل المخزون، والعجز يُحمَّل مصروفًا.
  const delta = round2(
    moves.reduce((sum, m) => sum + m.qty * m.unitCost, 0)
  );
  if (Math.abs(delta) > 0.01)
    postJournal(state, {
      at,
      source: "stocktake",
      sourceNo: refNo,
      description: note,
      lines:
        delta > 0
          ? [
              { accountCode: ACC.inventory, debit: delta, memo: "زيادة جرد" },
              {
                accountCode: ACC.inventoryAdjust,
                credit: delta,
                memo: "تسوية",
              },
            ]
          : [
              {
                accountCode: ACC.inventoryAdjust,
                debit: Math.abs(delta),
                memo: "عجز جرد",
              },
              {
                accountCode: ACC.inventory,
                credit: Math.abs(delta),
                memo: "تسوية",
              },
            ],
    });

  return moves;
}

/** تصفير أرصدة كل الأصناف وتكاليفها، للبدء من سجل نظيف قبل التشغيل. */
export function resetOpeningBalances(state: DbState): number {
  guard(state, "stockTake", "تصفير أرصدة البداية");
  const lines = state.products
    .filter(p => p.stock !== 0 || p.avgCost !== 0)
    .map(p => ({ productId: p.id, countedQty: 0, unitCost: 0 }));
  if (!lines.length) return 0;
  postStockTake(state, lines, "تصفير أرصدة البداية");
  // التصفير يشمل التكلفة أيضًا حتى لا تبقى قيمة موروثة من الكتالوج.
  state.products.forEach(p => {
    p.avgCost = 0;
    p.lastCost = 0;
  });
  return lines.length;
}

// ------------------------------------------------------ ميزان المراجعة

export type TrialBalanceRow = {
  account: string;
  debit: number;
  credit: number;
};

/**
 * ميزان مراجعة مبسط بالقيد المزدوج.
 *
 * الحسابات المدينة: المخزون بالتكلفة، الذمم المدينة (على العملاء)،
 * تكلفة البضاعة المباعة، والمصروفات التشغيلية.
 * الحسابات الدائنة: المبيعات (بعد المرتجعات) والذمم الدائنة (للموردين).
 *
 * الفرق بين الجانبين يمثل حركة النقد والأرباح المحتجزة، ونعرضه صراحةً
 * بدل إخفائه حتى يبقى الميزان مفهومًا ومتوازنًا.
 */
export function trialBalance(state: DbState): {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
} {
  const inventory = inventoryValue(state);
  const receivables = receivablesTotal(state);
  const payables = payablesTotal(state);
  const profit = netProfitSummary(state, state.sales);
  const opex = expensesTotal(state.expenses);

  const rows: TrialBalanceRow[] = [
    { account: "المخزون آخر المدة", debit: inventory, credit: 0 },
    { account: "ذمم مدينة — العملاء", debit: receivables, credit: 0 },
    { account: "تكلفة البضاعة المباعة", debit: profit.cogs, credit: 0 },
    { account: "المصروفات التشغيلية", debit: opex, credit: 0 },
    { account: "المبيعات (بعد المرتجعات)", debit: 0, credit: profit.revenue },
    { account: "ذمم دائنة — الموردون", debit: 0, credit: payables },
  ];

  const totalDebit = round2(rows.reduce((sum, r) => sum + r.debit, 0));
  const totalCredit = round2(rows.reduce((sum, r) => sum + r.credit, 0));

  // الفرق = صافي النقد ورأس المال؛ نضيفه كسطر موازن ليقفل الميزان.
  const diff = round2(totalDebit - totalCredit);
  if (diff !== 0)
    rows.push({
      account: diff > 0 ? "رأس المال وحركة النقد" : "أرباح محتجزة",
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
    });

  const finalDebit = round2(rows.reduce((sum, r) => sum + r.debit, 0));
  const finalCredit = round2(rows.reduce((sum, r) => sum + r.credit, 0));

  return {
    rows,
    totalDebit: finalDebit,
    totalCredit: finalCredit,
    balanced: Math.abs(finalDebit - finalCredit) < 0.01,
  };
}

export const MOVE_LABELS: Record<StockMoveType, string> = {
  PURCHASE: "شراء",
  SALE: "بيع",
  PURCHASE_RETURN: "مرتجع شراء",
  SALE_RETURN: "مرتجع بيع",
  ADJUSTMENT: "تسوية",
  PURCHASE_VOID: "إلغاء شراء",
  DAMAGE: "إتلاف",
};
