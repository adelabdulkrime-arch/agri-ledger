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
  /** حد إعادة الطلب؛ عند بلوغه يظهر الصنف في التنبيهات. */
  reorderLevel?: number;
  /** تاريخ انتهاء الصلاحية، مهم للمبيدات والأدوية الزراعية. */
  expiryDate?: string;
  /**
   * وحدات بيع بديلة (كرتون، شوال…) محسوبة كمضاعفات للوحدة الأساسية.
   * المخزون والتكلفة يبقيان دائمًا بالوحدة الأساسية حتى لا تختلط الحسابات.
   */
  units?: ProductUnit[];
  /** باركودات إضافية للصنف نفسه؛ عبوات المورّدين تختلف أرقامها. */
  altBarcodes?: string[];
};

/** وحدة بيع بديلة: كرتون = 12 عبوة، شوال = 50 كيلو، وهكذا. */
export type ProductUnit = {
  /** اسم الوحدة كما يراه البائع: «كرتون». */
  name: string;
  /** كم وحدة أساسية داخل هذه الوحدة. */
  factor: number;
  /** سعر بيع الوحدة كاملة؛ صفر يعني احسبه من سعر الوحدة الأساسية. */
  price?: number;
  /** باركود خاص بهذه العبوة إن وُجد. */
  barcode?: string;
};

export type SaleLine = {
  id: number;
  name: string;
  /** الوحدة الأساسية للصنف؛ الكمية والتكلفة محسوبتان بها دائمًا. */
  unit: string;
  /** الكمية بالوحدة الأساسية — هي ما يُخصم من المخزون. */
  qty: number;
  /** سعر الوحدة الأساسية وقت البيع. */
  price: number;
  /** تكلفة الوحدة وقت البيع — مثبتة حتى لا تتغير أرباح الماضي. */
  unitCost: number;
  /** الوحدة التي اختارها البائع (كرتون مثلًا)، للعرض في الفاتورة. */
  soldUnit?: string;
  /** الكمية بوحدة البيع المختارة؛ 2 كرتون بدل 24 عبوة. */
  soldQty?: number;
  /** الدفعات التي خرجت منها هذه الكمية، للتتبع عند السحب. */
  batches?: BatchConsumption[];
  /** خصم على مستوى السطر بالقيمة لا بالنسبة. */
  discount: number;
  /** ضريبة السطر بالقيمة؛ صفر عندما لا يستخدم المحل الضريبة. */
  tax: number;
  /** صافي السطر بعد الخصم والضريبة. */
  total: number;
};

export type Sale = {
  no: number;
  at: string;
  /** اسم العميل كما ظهر وقت البيع، يبقى حتى لو عُدّل سجل العميل. */
  customer: string;
  /** مرجع العميل المسجل؛ غيابه يعني بيعًا نقديًا عابرًا. */
  customerId?: number;
  /** نقدي يُحصَّل فورًا، وآجل يُقيَّد على حساب العميل. */
  terms?: PartyTerms;
  lines: SaleLine[];
  /** إجمالي السطور قبل الخصم والضريبة. */
  subtotal: number;
  /** مجموع الخصومات: خصم السطور زائد خصم الفاتورة. */
  discount: number;
  /** مجموع الضريبة على السطور. */
  tax: number;
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
  /** رقم التشغيلة المطبوع على العبوة؛ يُنشئ دفعة عند تعبئته. */
  lotNo?: string;
  /** صلاحية هذه الدفعة تحديدًا، لا صلاحية الصنف عمومًا. */
  expiryDate?: string;
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


export type ReturnKind = "sale" | "purchase";

export type ReturnLine = {
  productId: number;
  name: string;
  unit: string;
  qty: number;
  /** سعر الوحدة المسترد؛ سعر البيع للعميل أو تكلفة الشراء للمورد. */
  unitPrice: number;
  /** تكلفة الوحدة المستخدمة لعكس COGS في مرتجع البيع. */
  unitCost: number;
  total: number;
};

export type StockReturn = {
  no: number;
  kind: ReturnKind;
  /** رقم الفاتورة الأصلية التي يرتجع منها. */
  refNo: number;
  at: string;
  /** اسم العميل أو المورد حسب نوع المرتجع. */
  party: string;
  supplierId?: number;
  lines: ReturnLine[];
  total: number;
  /** تكلفة البضاعة العائدة، تُخصم من COGS الأصلي. */
  cogs: number;
  reason: string;
};


/** بنود المصروفات الشائعة في محل تجزئة؛ قابلة للتوسع من الإعدادات لاحقًا. */
export type ExpenseCategory =
  | "rent"
  | "salaries"
  | "utilities"
  | "transport"
  | "maintenance"
  | "supplies"
  | "government"
  | "other";

export type Expense = {
  id: number;
  at: string;
  category: ExpenseCategory;
  /** وصف مختصر يظهر في التقرير. */
  description: string;
  amount: number;
  /** مرجع اختياري: رقم إيصال أو فاتورة خارجية. */
  reference: string;
  notes: string;
};


/** تصنيف التعامل: نقدي يسدد فورًا، وآجل يُقيَّد على حسابه. */
export type PartyTerms = "cash" | "credit";

export type Customer = {
  id: number;
  name: string;
  phone: string;
  address: string;
  taxNumber: string;
  notes: string;
  terms: PartyTerms;
  /** حد الائتمان؛ صفر يعني بلا حد. */
  creditLimit: number;
  status: "active" | "inactive";
  createdAt: string;
};

/** قيد في دفتر أستاذ العميل: مدين يزيد ما له علينا، دائن يقلله. */
export type CustomerLedgerEntry = {
  id: number;
  customerId: number;
  at: string;
  type: string;
  refNo: number;
  /** مدين: قيمة المبيعات الآجلة (ما على العميل). */
  debit: number;
  /** دائن: التحصيل والمرتجعات. */
  credit: number;
  note: string;
};


/** تصنيف الحساب يحدد طبيعة رصيده ومكانه في القوائم المالية. */
export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

/** طبيعة الرصيد: مدين للأصول والمصروفات، دائن لغيرها. */
export type NormalSide = "debit" | "credit";

export type Account = {
  /** رقم الحساب في الدليل، مثل 1100 للصندوق. */
  code: string;
  name: string;
  type: AccountType;
  normalSide: NormalSide;
  /** الحساب الأب في الشجرة؛ فارغ للحسابات الرئيسية. */
  parent?: string;
  /** حسابات النظام لا تُحذف لأن القيود الآلية تعتمد عليها. */
  system: boolean;
  active: boolean;
};

/** سطر في قيد اليومية: إما مدين أو دائن، لا كلاهما. */
export type JournalLine = {
  accountCode: string;
  debit: number;
  credit: number;
  /** وصف السطر، يظهر في دفتر الأستاذ. */
  memo: string;
};

/** قيد يومية مرحَّل؛ مجموع المدين يساوي مجموع الدائن دائمًا. */
export type JournalEntry = {
  no: number;
  at: string;
  /** نوع المستند المصدر: sale, purchase, expense… */
  source: string;
  /** رقم المستند المصدر، للربط والتتبع. */
  sourceNo: number;
  description: string;
  lines: JournalLine[];
  /** القيود المرحَّلة لا تُعدّل؛ الإلغاء يكون بقيد عكسي. */
  reversedBy?: number;
};

/** فترة محاسبية مقفلة لا تقبل قيودًا جديدة. */
export type FiscalPeriod = {
  /** بداية الفترة المقفلة. */
  from: string;
  /** نهاية الفترة المقفلة؛ أي قيد قبلها مرفوض. */
  to: string;
  closedAt: string;
  note: string;
};


/** حالة الوردية: مفتوحة تقبل الحركات، ومقفلة لا تقبل. */
export type SessionStatus = "open" | "closed";

/**
 * وردية صندوق: فترة عمل بين فتح وإقفال، تُجرد نقديتها في نهايتها
 * فيظهر العجز أو الزيادة بدل أن يضيع بلا أثر.
 */
export type CashSession = {
  no: number;
  openedAt: string;
  /** النقد الموجود في الدرج عند الفتح. */
  openingFloat: number;
  openedBy: string;
  closedAt?: string;
  /** النقد المعدود فعليًا عند الإقفال. */
  countedCash?: number;
  /** ما يجب أن يكون في الدرج حسب الحركات المرحَّلة. */
  expectedCash?: number;
  /** المعدود ناقص المتوقع: سالب عجز وموجب زيادة. */
  variance?: number;
  status: SessionStatus;
  note: string;
};


/**
 * دفعة (تشغيلة) من صنف: كمية وصلت بتاريخ صلاحية وتكلفة محددة.
 * ضرورية للمبيدات والأسمدة، إذ يصل الصنف الواحد بصلاحيات مختلفة،
 * وعند سحب دفعة معيبة يجب معرفة من اشتراها.
 */
export type Batch = {
  id: number;
  productId: number;
  productName: string;
  /** رقم التشغيلة كما هو مطبوع على العبوة. */
  lotNo: string;
  expiryDate?: string;
  /** الكمية التي وصلت أصلًا. */
  qtyReceived: number;
  /** المتبقي منها بعد البيع والمرتجعات. */
  qtyRemaining: number;
  unitCost: number;
  /** رقم فاتورة الشراء التي أدخلتها. */
  purchaseNo: number;
  supplierName: string;
  receivedAt: string;
};

/** استهلاك دفعة في عملية بيع، لتتبّع من اشترى أي تشغيلة. */
export type BatchConsumption = {
  batchId: number;
  lotNo: string;
  qty: number;
  expiryDate?: string;
};


/**
 * دور المستخدم يحدد ما يراه وما يفعله.
 *
 * تنبيه صريح: هذه ضوابط تشغيلية لا حاجز أمني. البيانات محفوظة في
 * متصفح الجهاز، ومن يفتح أدوات المطور يستطيع تجاوزها. فائدتها منع
 * الأخطاء العابرة وتثبيت المسؤولية، لا حماية من عبث متعمّد.
 */
export type UserRole = "owner" | "manager" | "cashier";

/** الصلاحيات المتاحة، كل واحدة تحكم فعلًا محددًا. */
export type Permission =
  | "sell"
  | "purchase"
  | "voidInvoice"
  | "editCost"
  | "viewProfit"
  | "manageUsers"
  | "closePeriod"
  | "stockTake"
  | "backup";

export type User = {
  id: number;
  name: string;
  role: UserRole;
  /** رمز دخول قصير؛ ليس تشفيرًا بل تمييزًا بين الموظفين. */
  pin: string;
  active: boolean;
  createdAt: string;
};

/** قيد في سجل التدقيق: من فعل ماذا ومتى. */
export type AuditEntry = {
  id: number;
  at: string;
  userId?: number;
  userName: string;
  /** اسم العملية: postSale, voidPurchase… */
  action: string;
  /** وصف عربي مقروء لما جرى. */
  description: string;
  /** نوع المستند المتأثر ورقمه، للربط. */
  refType?: string;
  refNo?: number;
};

/**
 * بيانات المحل التي تظهر على الفاتورة النظامية وفي التقارير.
 * كانت مكتوبة داخل الكود، فلم يكن بوسع أحد تغييرها دون تعديل البرنامج.
 */
export type ShopSettings = {
  name: string;
  /** الاسم التجاري إن اختلف عن اسم المنشأة. */
  tradeName: string;
  /** رقم التسجيل في ضريبة القيمة المضافة؛ إلزامي في الفاتورة الضريبية. */
  taxNumber: string;
  /** رقم السجل التجاري. */
  crNumber: string;
  address: string;
  phone: string;
  /** النسبة الافتراضية المقترحة عند إدخال الضريبة. */
  vatRate: number;
  /**
   * هل المحل مسجَّل في ضريبة القيمة المضافة؟
   * غير المسجَّل لا يصدر فاتورة ضريبية ولا يخصم ضريبة مدخلات.
   */
  vatRegistered: boolean;
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
  returns: StockReturn[];
  expenses: Expense[];
  customers: Customer[];
  customerLedger: CustomerLedgerEntry[];
  accounts: Account[];
  journal: JournalEntry[];
  closedPeriods: FiscalPeriod[];
  cashSessions: CashSession[];
  batches: Batch[];
  users: User[];
  auditLog: AuditEntry[];
  /** معرّف المستخدم النشط في هذا الجهاز. */
  currentUserId?: number;
  /** بيانات المحل؛ اختيارية لأن النسخ القديمة لا تحملها. */
  settings?: ShopSettings;
};
