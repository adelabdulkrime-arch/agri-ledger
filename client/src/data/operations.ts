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
  ReturnKind,
  ReturnLine,
  StockReturn,
} from "./types";
import { nextId, nextNumber } from "./store";

/** خطأ عمل معروف؛ رسالته عربية جاهزة للعرض للمستخدم. */
export class OperationError extends Error {}

function fail(message: string): never {
  throw new OperationError(message);
}

/** تقريب لخانتين يمنع تراكم أخطاء الفاصلة العائمة في المبالغ. */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

function recordMove(
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
  }[];
  paymentMethod: PaymentMethod;
  paid?: number;
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

  applyPurchaseToInventory(state, purchase);

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

  return purchase;
}

/** يزيد المخزون ويحدّث متوسط التكلفة لكل بند في الفاتورة. */
function applyPurchaseToInventory(state: DbState, purchase: Purchase) {
  purchase.lines.forEach(line => {
    const product = state.products.find(p => p.id === line.productId);
    if (!product) fail(`الصنف غير موجود: ${line.name}`);

    // التكلفة الفعلية للوحدة تشمل الخصم والضريبة الموزعين على السطر.
    const effectiveUnitCost = round2(line.total / line.qty);
    product.avgCost = weightedAverage(
      product.stock,
      product.avgCost,
      line.qty,
      effectiveUnitCost
    );
    product.lastCost = effectiveUnitCost;

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
    });
  });
}

/**
 * يلغي فاتورة شراء: يعكس المخزون ويصفّر أثرها على حساب المورد.
 * نستخدم الإلغاء بدل الحذف حتى يبقى أثر العملية في السجل.
 */
export function voidPurchase(state: DbState, no: number): Purchase {
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
      unitCost: round2(line.total / line.qty),
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
  amount: number
): Purchase {
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
  return purchase;
}

// ------------------------------------------------------------- البيع

export type SaleInput = {
  customer?: string;
  at?: string;
  lines: { productId: number; qty: number; price: number }[];
};

/**
 * يحفظ فاتورة البيع ويخصم المخزون ويثبّت تكلفة الوحدة وقت البيع.
 * تثبيت التكلفة هو ما يجعل أرباح الماضي غير قابلة للتغير لاحقًا.
 */
export function postSale(state: DbState, input: SaleInput): Sale {
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  const at = input.at || new Date().toISOString();
  const no = nextNumber(state.sales, 1048);
  const lines: SaleLine[] = [];

  input.lines.forEach(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود");
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);
    if (qty > product.stock)
      fail(`الرصيد المتاح من ${product.name} هو ${product.stock}`);

    lines.push({
      id: product.id,
      name: product.name,
      unit: product.unit,
      qty,
      price: Number(raw.price),
      unitCost: product.avgCost,
    });
  });

  lines.forEach(line => {
    recordMove(state, {
      productId: line.id,
      productName: line.name,
      type: "SALE",
      qty: -line.qty,
      unitCost: line.unitCost,
      refType: "sale",
      refNo: no,
      at,
      note: "بيع",
    });
  });

  const sale: Sale = {
    no,
    at,
    customer: (input.customer || "").trim() || "عميل نقدي",
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.price * l.qty, 0)),
    cogs: round2(lines.reduce((sum, l) => sum + l.unitCost * l.qty, 0)),
  };
  state.sales.unshift(sale);
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
      unitPrice: original.price,
      // التكلفة من الفاتورة الأصلية، لا من متوسط اليوم.
      unitCost: original.unitCost || 0,
      total: round2(qty * original.price),
    };
  });

  lines.forEach(line => {
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

    const unitCost = round2(original.total / original.qty);
    return {
      productId: original.productId,
      name: original.name,
      unit: original.unit,
      qty,
      unitPrice: unitCost,
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

export const MOVE_LABELS: Record<StockMoveType, string> = {
  PURCHASE: "شراء",
  SALE: "بيع",
  PURCHASE_RETURN: "مرتجع شراء",
  SALE_RETURN: "مرتجع بيع",
  ADJUSTMENT: "تسوية",
  PURCHASE_VOID: "إلغاء شراء",
};
