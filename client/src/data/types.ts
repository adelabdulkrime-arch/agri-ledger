// Design: «سوق الحقل» — نموذج بيانات دورة الشراء والمخزون والتكلفة.
// كل الأنواع هنا تمثل ما يُحفظ فعليًا، لا ما تعرضه الشاشة.

export type Product = {
  id: number;
  name: string;
  category: string;
  unit: string;
  stock: number;
  /** سعر البيع للجمهور. */
  price: number;
  color: string;
  barcode: string;
  /** متوسط التكلفة المرجح؛ يتغير مع كل عملية شراء. */
  avgCost: number;
  /** آخر تكلفة شراء فعلية، مفيدة لتسعير الطلب القادم. */
  lastCost: number;
};

export type SaleLine = {
  id: number;
  name: string;
  unit: string;
  qty: number;
  price: number;
  /** تكلفة الوحدة وقت البيع — مثبتة حتى لا تتغير أرباح الماضي. */
  unitCost: number;
};

export type Sale = {
  no: number;
  at: string;
  customer: string;
  lines: SaleLine[];
  total: number;
  /** تكلفة البضاعة المباعة لهذه الفاتورة. */
  cogs: number;
};

export type SupplierStatus = "active" | "inactive";

export type Supplier = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  notes: string;
  status: SupplierStatus;
  createdAt: string;
};

export type PurchaseLine = {
  productId: number;
  name: string;
  unit: string;
  barcode: string;
  qty: number;
  /** تكلفة شراء الوحدة في هذه العملية تحديدًا. */
  unitCost: number;
  /** خصم على مستوى السطر بالقيمة لا بالنسبة. */
  discount: number;
  /** ضريبة السطر بالقيمة؛ صفر عندما لا يستخدم المحل الضريبة. */
  tax: number;
  total: number;
};

export type PaymentMethod = "cash" | "credit" | "partial";
export type PurchaseStatus = "confirmed" | "void";

export type Purchase = {
  no: number;
  /** رقم الفاتورة كما هو مطبوع من المورد. */
  supplierInvoiceNo: string;
  supplierId: number;
  supplierName: string;
  at: string;
  notes: string;
  lines: PurchaseLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod;
  paid: number;
  balance: number;
  status: PurchaseStatus;
  /** يُملأ عند الإلغاء فقط، ليبقى أثر العملية بدل حذفها. */
  voidedAt?: string;
};

export type StockMoveType =
  | "PURCHASE"
  | "SALE"
  | "PURCHASE_RETURN"
  | "SALE_RETURN"
  | "ADJUSTMENT"
  | "PURCHASE_VOID";

export type StockMove = {
  id: number;
  productId: number;
  productName: string;
  type: StockMoveType;
  /** موجب للوارد وسالب للمنصرف. */
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  unitCost: number;
  /** نوع المستند المرجعي، مثل purchase أو sale. */
  refType: string;
  refNo: number;
  at: string;
  note: string;
};

export type SupplierLedgerEntry = {
  id: number;
  supplierId: number;
  at: string;
  /** نوع الحركة بالعربية للعرض المباشر في كشف الحساب. */
  type: string;
  refNo: number;
  /** مدين: ما يقلل التزامنا تجاه المورد (الدفعات). */
  debit: number;
  /** دائن: ما يزيد التزامنا تجاهه (قيمة المشتريات). */
  credit: number;
  note: string;
};

/** الحالة الكاملة المحفوظة؛ كل ما يخص المحل في مكان واحد. */
export type DbState = {
  version: number;
  products: Product[];
  sales: Sale[];
  suppliers: Supplier[];
  purchases: Purchase[];
  stockMoves: StockMove[];
  supplierLedger: SupplierLedgerEntry[];
};
