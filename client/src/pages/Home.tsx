// Design: «سوق الحقل» — Neo-brutalist utility UI بلمسة زراعية محلية، ألوان تربة عاجية/أخضر حقل/أصفر ذهبي، أزرار مباشرة وأرقام كبيرة، مع شعار الحقوق المرفق في بطاقة الاعتماد.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Calculator,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  CloudOff,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  FolderOpen,
  HandCoins,
  HelpCircle,
  LayoutDashboard,
  Lock,
  Menu,
  PackagePlus,
  Plus,
  Printer,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sprout,
  Store,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { catalogProducts } from "../catalog";
import { useDb } from "../data/useDb";
import {
  MOVE_LABELS,
  OperationError,
  EXPENSE_LABELS,
  addAltBarcode,
  addProductUnit,
  daysUntil,
  findByBarcode,
  removeAltBarcode,
  removeProductUnit,
  findUnit,
  stockAlerts,
  stockInUnit,
  unitPrice,
  unitsOf,
  addExpense,
  collectFromCustomer,
  createCustomer,
  customerBalance,
  postStockTake,
  resetOpeningBalances,
  updateCustomer,
  createSupplier,
  deleteExpense,
  expensesTotal,
  netIncome,
  editPurchase,
  inventoryValue,
  netProfitSummary,
  payPurchase,
  payablesTotal,
  postPurchase,
  postPurchaseReturn,
  postSale,
  postSaleReturn,
  profitSummary,
  purchasesTotal,
  round2,
  supplierStatement,
  supplierTotals,
  updateSupplier,
  voidPurchase,
} from "../data/operations";
import {
  StorageError,
  emptyState,
  migrate,
  storageUsage,
} from "../data/store";
import { importCsv, type ImportKind } from "../data/importer";
import {
  closePeriod,
  postOpeningBalance,
} from "../data/ledger";
import type {
  Customer,
  DbState,
  Expense,
  ExpenseCategory,
  ReturnKind,
  PaymentMethod,
  Product,
  Purchase,
  Sale,
  Supplier,
} from "../data/types";
const BarcodeScanner = lazy(() => import("../components/BarcodeScanner"));
const PurchaseDialog = lazy(() => import("../components/PurchaseDialog"));
import SuppliersBoard from "../components/SuppliersBoard";
import PurchasesBoard from "../components/PurchasesBoard";
import PaymentDialog from "../components/PaymentDialog";
import ReturnDialog from "../components/ReturnDialog";
import ExpensesBoard from "../components/ExpensesBoard";
import CustomersBoardNew from "../components/CustomersBoard";
import DataToolsBoard from "../components/DataToolsBoard";
import TrialBalanceBoard from "../components/TrialBalanceBoard";
import LedgerBoard from "../components/LedgerBoard";
import ProductUnitsDialog from "../components/ProductUnitsDialog";
import { useUsbScanner } from "../hooks/useUsbScanner";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { usePersistFn } from "../hooks/usePersistFn";

const assetBase = import.meta.env.BASE_URL || "/";
const logoUrl = `${assetBase}brand/agri-mark.svg`;

type CartLine = Product & {
  /** الكمية بوحدة البيع المختارة، لا بالوحدة الأساسية. */
  qty: number;
  /** اسم وحدة البيع؛ الوحدة الأساسية عند عدم الاختيار. */
  unitName: string;
  /** خصم السطر بالقيمة. */
  lineDiscount: number;
  /** ضريبة السطر بالقيمة. */
  lineTax: number;
};

const seedProducts: Product[] = [
  {
    id: 1,
    name: "سماد NPK متوازن",
    category: "أسمدة",
    unit: "كيس",
    stock: 0,
    price: 185,
    color: "leaf",
    barcode: "628100000001",
    avgCost: 0,
    lastCost: 0,
  },
  {
    id: 2,
    name: "مبيد حشري عضوي",
    category: "مبيدات",
    unit: "عبوة",
    stock: 0,
    price: 72,
    color: "gold",
    barcode: "628100000002",
    avgCost: 0,
    lastCost: 0,
  },
  {
    id: 3,
    name: "خرطوم ري ½ بوصة",
    category: "معدات ري",
    unit: "متر",
    stock: 0,
    price: 12.5,
    color: "blue",
    barcode: "628100000003",
    avgCost: 0,
    lastCost: 0,
  },
  {
    id: 4,
    name: "بذور طماطم هجين",
    category: "بذور",
    unit: "ظرف",
    stock: 0,
    price: 28,
    color: "orange",
    barcode: "628100000004",
    avgCost: 0,
    lastCost: 0,
  },
  {
    id: 5,
    name: "مرش ظهر 16 لتر",
    category: "معدات",
    unit: "قطعة",
    stock: 0,
    price: 650,
    color: "navy",
    barcode: "628100000005",
    avgCost: 0,
    lastCost: 0,
  },
];

const menu = [
  { id: "home", label: "الرئيسية", icon: LayoutDashboard },
  { id: "operations", label: "العمليات", icon: ArrowLeftRight },
  { id: "sales", label: "المبيعات والفواتير", icon: ShoppingCart },
  { id: "inventory", label: "المخزون والمنتجات", icon: Boxes },
  { id: "purchases", label: "المشتريات", icon: ShoppingBag },
  { id: "suppliers", label: "الموردون", icon: Truck },
  { id: "customers", label: "العملاء", icon: UsersRound },
  { id: "expenses", label: "المصروفات", icon: WalletCards },
  { id: "accounts", label: "الحسابات", icon: Calculator },
  { id: "ledger", label: "الدفاتر المحاسبية", icon: BookOpen },
  { id: "trialbalance", label: "ميزان المراجعة", icon: Scale },
  { id: "datatools", label: "الجرد والاستيراد", icon: ClipboardList },
  { id: "reports", label: "التقارير", icon: BarChart3 },
];

/** لون تاريخ الصلاحية: أحمر للمنتهي وبرتقالي للمقترب. */
function expiryTone(date?: string) {
  const days = daysUntil(date);
  if (days === null) return "";
  if (days < 0) return "danger-text";
  if (days <= 60) return "warn-text";
  return "good-text";
}

/** وقت مختصر بالعربية: «منذ ١٢ دقيقة» بدل تاريخ كامل يصعب قراءته سريعًا. */
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return new Date(iso).toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
  });
}

function money(value: number) {
  return (
    new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value) +
    " ر.ي"
  );
}

export default function Home() {
  // القسم في عنوان الصفحة، حتى لا يعود المستخدم للرئيسية عند تحديث الصفحة.
  const [active, setActive] = useState(
    () => window.location.hash.replace("#", "") || "home"
  );
  useEffect(() => {
    window.location.hash = active;
  }, [active]);
  const catalogSeed = useMemo(
    () => [...seedProducts, ...catalogProducts],
    []
  );
  const { state, run, replace, recovered, bootError } = useDb(catalogSeed);
  const { products, sales, suppliers, purchases, stockMoves } = state;

  /** ينفذ عملية على البيانات ويعرض رسالة مفهومة عند الفشل. */
  const runSafe = usePersistFn(
    <T,>(mutator: (draft: DbState) => T, onDone?: (result: T) => void) => {
      try {
        const result = run(mutator);
        onDone?.(result);
        return true;
      } catch (error) {
        const known =
          error instanceof OperationError || error instanceof StorageError;
        toast.error(
          known
            ? (error as Error).message
            : "تعذر إتمام العملية؛ لم يتم حفظ أي تغيير"
        );
        return false;
      }
    }
  );

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("كل الأقسام");
  const [showSale, setShowSale] = useState(false);
  const [showProduct, setShowProduct] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  // يُحسب مع كل تغيير في البيانات ليعكس الحجم الفعلي لا تقديرًا.
  const usage = useMemo(() => storageUsage(), [state]);
  const [showInvoiceCapture, setShowInvoiceCapture] = useState(false);
  const [invoicePhoto, setInvoicePhoto] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleCustomer, setSaleCustomer] = useState("");
  const [invoiceDiscount, setInvoiceDiscount] = useState("");
  const [showPurchase, setShowPurchase] = useState(false);
  const [showSupplier, setShowSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const { canInstall, install } = useInstallPrompt();
  const [showExpense, setShowExpense] = useState(false);
  const [showOpening, setShowOpening] = useState(false);
  const [showClosePeriod, setShowClosePeriod] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [collecting, setCollecting] = useState<Customer | null>(null);
  const [unitsProduct, setUnitsProduct] = useState<Product | null>(null);
  const [payingPurchase, setPayingPurchase] = useState<Purchase | null>(null);
  const [returning, setReturning] = useState<{
    kind: ReturnKind;
    source: Sale | Purchase;
  } | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanFeedback, setScanFeedback] = useState("");
  const [notice, setNotice] = useState("آخر حفظ محلي منذ لحظات");
  const [lastBackup, setLastBackup] = useState(
    () => localStorage.getItem("agri-last-backup") || ""
  );

  /** نقطة واحدة تتعامل مع الباركود سواء جاء من الكاميرا أو من قارئ USB. */
  const handleBarcode = usePersistFn((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const hit = findByBarcode(state, code);
    if (hit) {
      addToCart(hit.product, hit.unitName);
      setScanFeedback(
        `تمت إضافة ${hit.product.name}${hit.unitName ? ` (${hit.unitName})` : ""}`
      );
      return;
    }
    setSearch(code);
    setScanFeedback(`لا يوجد صنف بالباركود ${code}`);
    toast.info("تم التقاط الباركود؛ لا يوجد صنف مسجل بهذا الرقم");
  });

  // قارئ USB يعمل دائمًا في شاشة البيع، دون الحاجة لفتح نافذة الكاميرا.
  useUsbScanner(handleBarcode, showSale || showScanner);

  // إذا تعافى النظام من ملف تالف، يجب أن يعرف المستخدم ليتحقق من بياناته.
  useEffect(() => {
    if (bootError) toast.error(bootError, { duration: 15000 });
  }, [bootError]);

  // تنبيه واضح عند تأخر النسخ الاحتياطي أو امتلاء المساحة، مرة عند الإقلاع.
  useEffect(() => {
    const overdue =
      !lastBackup ||
      Date.now() - new Date(lastBackup).getTime() > 30 * 24 * 60 * 60 * 1000;
    const hasData = state.sales.length > 0 || state.purchases.length > 0;
    if (!hasData) return;

    if (usage.percent >= 80) {
      toast.error(
        `مساحة البيانات ممتلئة ${usage.percent}%. صدّر نسخة احتياطية الآن.`,
        {
          duration: 15000,
          action: { label: "نسخة احتياطية", onClick: () => setShowBackup(true) },
        }
      );
      return;
    }
    if (overdue) {
      toast.warning(
        lastBackup
          ? "مضى أكثر من شهر على آخر نسخة احتياطية."
          : "لم تُنشئ نسخة احتياطية بعد. بياناتك على هذا الجهاز فقط.",
        {
          duration: 12000,
          action: { label: "صدّر الآن", onClick: () => setShowBackup(true) },
        }
      );
    }
    // مرة واحدة عند الإقلاع فقط؛ إزعاج المستخدم كل عملية يجعله يتجاهل التنبيه.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recovered)
      toast.warning(
        "تعذّرت قراءة الملف الأساسي؛ تم استرجاع آخر نسخة أمان. راجع آخر عملياتك.",
        { duration: 12000 }
      );
  }, [recovered]);

  // المخزن يحفظ فور كل عملية؛ هنا نعرض الحالة للمستخدم فقط.
  useEffect(() => {
    setNotice("تم الحفظ محليًا الآن");
  }, [state]);
  useEffect(() => {
    if (
      !lastBackup ||
      Date.now() - new Date(lastBackup).getTime() > 30 * 24 * 60 * 60 * 1000
    )
      setNotice("حان موعد النسخ الاحتياطي الشهري");
  }, [lastBackup]);
  const categories = useMemo(
    () =>
      Array.from(new Set(products.map(p => p.category))).sort((a, b) =>
        a.localeCompare(b, "ar")
      ),
    [products]
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      p =>
        (category === "كل الأقسام" || p.category === category) &&
        (!term ||
          p.name.toLowerCase().includes(term) ||
          p.category.toLowerCase().includes(term) ||
          (p.barcode || "").includes(term) ||
          // الباركودات الإضافية وباركودات العبوات تدخل البحث أيضًا.
          (p.altBarcodes || []).some(code => code.includes(term)) ||
          (p.units || []).some(u => (u.barcode || "").includes(term)))
    );
  }, [products, search, category]);
  // تنبيهات تجمع نقص الرصيد وقرب انتهاء الصلاحية.
  const alerts = useMemo(() => stockAlerts(state), [state]);
  const lowStock = products.filter(p => p.stock <= 8);

  /** إحصاءات اليوم مشتقة من الفواتير المحفوظة فعليًا، لا أرقام ثابتة. */
  const todayStats = useMemo(() => {
    const today = new Date().toDateString();
    const todaySales = sales.filter(
      sale => new Date(sale.at).toDateString() === today
    );
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const yesterdayTotal = sales
      .filter(sale => new Date(sale.at).toDateString() === yesterday)
      .reduce((sum, sale) => sum + sale.total, 0);
    const total = todaySales.reduce((sum, sale) => sum + sale.total, 0);
    return {
      total,
      count: todaySales.length,
      // نتفادى القسمة على صفر عندما لا يوجد بيع أمس.
      change: yesterdayTotal
        ? ((total - yesterdayTotal) / yesterdayTotal) * 100
        : null,
    };
  }, [sales]);

  // قيمة المخزون تُقاس بالتكلفة لا بسعر البيع، فهي رأس مال لا إيراد.
  const stockValue = useMemo(() => inventoryValue(state), [state]);
  const todayProfit = useMemo(() => {
    const today = new Date().toDateString();
    return netIncome(
      state,
      sales.filter(sale => new Date(sale.at).toDateString() === today),
      state.expenses.filter(e => new Date(e.at).toDateString() === today)
    );
  }, [sales, state]);
  const allTimeProfit = useMemo(() => profitSummary(sales), [sales]);
  const purchasesSum = useMemo(() => purchasesTotal(purchases), [purchases]);
  const payables = useMemo(() => payablesTotal(state), [state]);

  const exportBackup = () => {
    // النسخة تحمل كل الجداول: المنتجات والمبيعات والموردين والمشتريات والحركات.
    const payload = {
      app: "دفتر الزراعة",
      exportedAt: new Date().toISOString(),
      ...state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `دفتر-الزراعة-نسخة-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل النسخة الاحتياطية");
    const stamp = new Date().toISOString();
    localStorage.setItem("agri-last-backup", stamp);
    setLastBackup(stamp);
    setNotice("تم حفظ النسخة الاحتياطية لهذا الشهر");
  };

  const importBackup = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.products)) {
          toast.error("الملف لا يحتوي على بيانات صالحة");
          return;
        }
        // migrate يرفع النسخ القديمة إلى المخطط الحالي دون فقدان بيانات.
        const restored = migrate({ ...emptyState(), ...data });
        restored.products = restored.products.map((p, i) => ({
          ...p,
          barcode: p.barcode || `62810000${i + 1}`,
        }));

        // الاستعادة تمحو البيانات الحالية؛ نعرض المقارنة قبل التنفيذ
        // لأن استيراد ملف خاطئ يعني فقدان سجل شهور.
        const current = `الحالي: ${state.sales.length} فاتورة بيع · ${state.purchases.length} فاتورة شراء · ${state.expenses.length} مصروف`;
        const incoming = `الملف: ${restored.sales.length} فاتورة بيع · ${restored.purchases.length} فاتورة شراء · ${restored.expenses.length} مصروف`;
        const stamp = data.exportedAt
          ? `تاريخ النسخة: ${new Date(data.exportedAt).toLocaleString("ar-EG")}`
          : "الملف لا يحمل تاريخ تصدير";

        if (
          !window.confirm(
            `سيُستبدل كل ما في الجهاز ببيانات هذا الملف.\n\n${current}\n${incoming}\n${stamp}\n\nهل تريد المتابعة؟`
          )
        )
          return;

        replace(restored);
        toast.success(
          `تم استرجاع ${restored.products.length} صنفًا و${restored.sales.length} فاتورة بيع و${restored.purchases.length} فاتورة شراء و${restored.expenses.length} مصروفًا`
        );
      } catch {
        toast.error("تعذر قراءة الملف");
      }
    };
    reader.readAsText(file);
  };

  const captureInvoicePhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setInvoicePhoto(String(reader.result));
      toast.success("تم إرفاق صورة الفاتورة؛ راجع البيانات قبل اعتمادها");
    };
    reader.readAsDataURL(file);
  };
  const addProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const next: Product = {
      id: Date.now(),
      name: String(fd.get("name")),
      category: String(fd.get("category")),
      unit: String(fd.get("unit")),
      stock: Number(fd.get("stock")),
      price: Number(fd.get("price")),
      color: "leaf",
      barcode: String(
        fd.get("barcode") || `628${Date.now().toString().slice(-9)}`
      ),
      // تكلفة المنتج تتحدد من فاتورة الشراء، لا من إدخال يدوي هنا.
      avgCost: 0,
      lastCost: 0,
      reorderLevel: Number(fd.get("reorderLevel")) || 8,
      expiryDate: String(fd.get("expiryDate") || ""),
    };
    runSafe(
      draft => {
        draft.products.unshift(next);
      },
      () => {
        setShowProduct(false);
        toast.success("تمت إضافة المنتج");
      }
    );
  };
  const addToCart = (p: Product, unitName?: string) => {
    const chosen = unitName || p.unit;
    const available = stockInUnit(p, chosen);
    setCart(prev => {
      // نفس الصنف بوحدتين مختلفتين سطران منفصلان، فالسعر يختلف.
      const existing = prev.find(
        line => line.id === p.id && line.unitName === chosen
      );
      if (existing) {
        if (existing.qty + 1 > available) {
          toast.error(`لا يوجد أكثر من ${available} ${chosen} من هذا الصنف`);
          return prev;
        }
        return prev.map(line =>
          line === existing ? { ...line, qty: line.qty + 1 } : line
        );
      }
      if (available < 1) {
        toast.error(`لا يوجد رصيد كافٍ من ${p.name} بوحدة ${chosen}`);
        return prev;
      }
      return [
        ...prev,
        { ...p, qty: 1, unitName: chosen, lineDiscount: 0, lineTax: 0 },
      ];
    });
    toast.success(`أضيف ${p.name} إلى الفاتورة`);
  };
  /** تبديل وحدة سطر مع تعديل الكمية إن تجاوزت الرصيد بالوحدة الجديدة. */
  const switchCartUnit = (line: CartLine, nextUnit: string) =>
    setCart(prev =>
      prev.map(item => {
        if (item.id !== line.id || item.unitName !== line.unitName)
          return item;
        const available = stockInUnit(item, nextUnit);
        if (available < 1) {
          toast.error(`لا يوجد رصيد كافٍ بوحدة ${nextUnit}`);
          return item;
        }
        return {
          ...item,
          unitName: nextUnit,
          qty: Math.min(item.qty, Math.floor(available)) || 1,
        };
      })
    );

  /** إجماليات السلة بنفس منطق postSale، فيتطابق المعروض مع المحفوظ. */
  const cartTotals = useMemo(() => {
    const subtotal = round2(
      cart.reduce((a, l) => a + unitPrice(l, l.unitName) * l.qty, 0)
    );
    const lineDiscounts = round2(
      cart.reduce((a, l) => a + (l.lineDiscount || 0), 0)
    );
    const tax = round2(cart.reduce((a, l) => a + (l.lineTax || 0), 0));
    const invoice = round2(Number(invoiceDiscount || 0));
    return {
      subtotal,
      lineDiscounts,
      tax,
      invoice,
      total: round2(subtotal - lineDiscounts - invoice + tax),
    };
  }, [cart, invoiceDiscount]);

  /** تعديل خصم أو ضريبة سطر في السلة. */
  const setLineExtra = (
    id: number,
    unitName: string,
    field: "lineDiscount" | "lineTax",
    value: number
  ) =>
    setCart(prev =>
      prev.map(line =>
        line.id === id && line.unitName === unitName
          ? { ...line, [field]: Number.isFinite(value) && value >= 0 ? value : 0 }
          : line
      )
    );

  const changeQty = (id: number, unitName: string, delta: number) =>
    setCart(prev =>
      prev.flatMap(line => {
        if (line.id !== id || line.unitName !== unitName) return [line];
        const qty = line.qty + delta;
        if (qty <= 0) return [];
        const available = stockInUnit(line, line.unitName);
        if (qty > available) {
          toast.error(
            `الرصيد المتاح من ${line.name} هو ${available} ${line.unitName}`
          );
          return [line];
        }
        return [{ ...line, qty }];
      })
    );
  const confirmSale = () => {
    if (!cart.length) {
      toast.error("أضف صنفًا واحدًا على الأقل");
      return;
    }
    // البيع يخصم المخزون ويثبّت التكلفة ويحفظ الفاتورة في معاملة واحدة.
    runSafe(
      draft =>
        postSale(draft, {
          customer: saleCustomer,
          invoiceDiscount: Number(invoiceDiscount || 0),
          lines: cart.map(line => ({
            productId: line.id,
            qty: line.qty,
            price: unitPrice(line, line.unitName),
            unitName: line.unitName,
            discount: line.lineDiscount || 0,
            tax: line.lineTax || 0,
          })),
        }),
      sale => {
        printThermalReceipt(cart, `#${sale.no}`, sale.customer);
        setShowSale(false);
        setCart([]);
        setSaleCustomer("");
        setInvoiceDiscount("");
        toast.success(
          `تم حفظ الفاتورة #${sale.no} وخصم الكميات من المخزون`
        );
      }
    );
  };
  /** حفظ فاتورة شراء: يزيد المخزون ويحدّث التكلفة وحساب المورد معًا. */
  const submitPurchase = (input: Parameters<typeof postPurchase>[1]) => {
    runSafe(
      draft => postPurchase(draft, input),
      purchase => {
        setShowPurchase(false);
        toast.success(
          `تم حفظ فاتورة الشراء #${purchase.no} وتحديث المخزون والتكلفة`
        );
      }
    );
  };

  const submitSupplier = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") || ""),
      phone: String(fd.get("phone") || ""),
      email: String(fd.get("email") || ""),
      address: String(fd.get("address") || ""),
      taxNumber: String(fd.get("taxNumber") || ""),
      notes: String(fd.get("notes") || ""),
    };
    const target = editingSupplier;
    runSafe(
      draft =>
        target
          ? updateSupplier(draft, target.id, payload)
          : createSupplier(draft, payload),
      () => {
        setShowSupplier(false);
        setEditingSupplier(null);
        toast.success(target ? "تم تعديل بيانات المورد" : "تمت إضافة المورد");
      }
    );
  };

  const submitExpense = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    runSafe(
      draft =>
        addExpense(draft, {
          category: String(fd.get("category")) as ExpenseCategory,
          description: String(fd.get("description") || ""),
          amount: Number(fd.get("amount")),
          reference: String(fd.get("reference") || ""),
        }),
      () => {
        setShowExpense(false);
        toast.success("تم تسجيل المصروف");
      }
    );
  };

  const removeExpense = (expense: Expense) => {
    if (!window.confirm(`حذف مصروف «${expense.description}»؟`)) return;
    runSafe(
      draft => deleteExpense(draft, expense.id),
      () => toast.success("تم حذف المصروف")
    );
  };

  /** إدارة وحدات الصنف وباركوداته؛ كل تغيير معاملة مستقلة. */
  const productUnitActions = {
    addUnit: (unit: {
      name: string;
      factor: number;
      price: number;
      barcode: string;
    }) => {
      if (!unitsProduct) return;
      runSafe(
        draft => addProductUnit(draft, unitsProduct.id, unit),
        updated => {
          setUnitsProduct(updated);
          toast.success(`أضيفت وحدة ${unit.name}`);
        }
      );
    },
    removeUnit: (name: string) => {
      if (!unitsProduct) return;
      runSafe(
        draft => removeProductUnit(draft, unitsProduct.id, name),
        updated => {
          setUnitsProduct(updated);
          toast.success("تم حذف الوحدة");
        }
      );
    },
    addBarcode: (code: string) => {
      if (!unitsProduct) return;
      runSafe(
        draft => addAltBarcode(draft, unitsProduct.id, code),
        updated => {
          setUnitsProduct(updated);
          toast.success("تمت إضافة الباركود");
        }
      );
    },
    removeBarcode: (code: string) => {
      if (!unitsProduct) return;
      runSafe(
        draft => removeAltBarcode(draft, unitsProduct.id, code),
        updated => {
          setUnitsProduct(updated);
          toast.success("تم حذف الباركود");
        }
      );
    },
  };

  const submitCustomer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") || ""),
      phone: String(fd.get("phone") || ""),
      address: String(fd.get("address") || ""),
      taxNumber: String(fd.get("taxNumber") || ""),
      terms: (String(fd.get("terms") || "cash") === "credit"
        ? "credit"
        : "cash") as "cash" | "credit",
      creditLimit: Number(fd.get("creditLimit") || 0),
    };
    const target = editingCustomer;
    runSafe(
      draft =>
        target
          ? updateCustomer(draft, target.id, payload)
          : createCustomer(draft, payload),
      () => {
        setShowCustomer(false);
        setEditingCustomer(null);
        toast.success(target ? "تم تعديل بيانات العميل" : "تمت إضافة العميل");
      }
    );
  };

  const submitCollection = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!collecting) return;
    const amount = Number(new FormData(e.currentTarget).get("amount") || 0);
    runSafe(
      draft => collectFromCustomer(draft, collecting.id, amount),
      () => {
        setCollecting(null);
        toast.success("تم تسجيل التحصيل");
      }
    );
  };

  /** الجرد يضبط الأرصدة على الواقع ويترك أثرًا في سجل الحركات. */
  const submitStockTake = (
    lines: { productId: number; countedQty: number; unitCost?: number }[]
  ) => {
    runSafe(
      draft => postStockTake(draft, lines),
      moves =>
        toast.success(
          moves.length
            ? `تم الجرد: ${moves.length} صنفًا عُدّل رصيده`
            : "تم الجرد: الأرصدة مطابقة للواقع"
        )
    );
  };

  const submitResetOpening = () => {
    // تحذير صريح قبل عملية لا رجعة فيها على كل الأصناف.
    const warning = [
      "تصفير كل الأرصدة والتكاليف الابتدائية؟",
      "",
      "يبقى الأثر مسجلًا في حركات المخزون، ثم أدخل مخزونك الحقيقي",
      "عبر فواتير الشراء أو الاستيراد.",
    ].join("\n");
    if (!window.confirm(warning)) return;
    runSafe(
      draft => resetOpeningBalances(draft),
      count =>
        toast.success(
          count ? `تم تصفير ${count} صنفًا` : "الأرصدة مصفّرة أصلًا"
        )
    );
  };

  const submitImport = (kind: ImportKind, text: string) => {
    runSafe(
      draft => importCsv(draft, kind, text),
      r =>
        toast.success(
          `تم الاستيراد: ${r.added} جديد، ${r.updated} محدّث، ${r.skipped} متخطى`
        )
    );
  };

  const submitOpening = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    runSafe(
      draft =>
        postOpeningBalance(draft, {
          cash: Number(fd.get("cash") || 0),
          bank: Number(fd.get("bank") || 0),
          note: String(fd.get("note") || ""),
        }),
      () => {
        setShowOpening(false);
        toast.success("تم تسجيل الرصيد الافتتاحي");
      }
    );
  };

  const submitClosePeriod = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    runSafe(
      draft =>
        closePeriod(
          draft,
          String(fd.get("from") || ""),
          String(fd.get("to") || ""),
          String(fd.get("note") || "")
        ),
      () => {
        setShowClosePeriod(false);
        toast.success("تم إقفال الفترة؛ لن تقبل قيودًا جديدة");
      }
    );
  };

  const handlePay = (purchase: Purchase) => setPayingPurchase(purchase);

  const submitPayment = (amount: number) => {
    if (!payingPurchase) return;
    runSafe(
      draft => payPurchase(draft, payingPurchase.no, amount),
      () => {
        setPayingPurchase(null);
        toast.success("تم تسجيل الدفعة وتحديث حساب المورد");
      }
    );
  };

  /** مرتجع بيع أو شراء؛ كلاهما يعكس المخزون في معاملة واحدة. */
  const submitReturn = (input: {
    refNo: number;
    reason: string;
    lines: { productId: number; qty: number }[];
  }) => {
    const kind = returning?.kind;
    if (!kind) return;
    runSafe(
      draft =>
        kind === "sale"
          ? postSaleReturn(draft, input)
          : postPurchaseReturn(draft, input),
      () => {
        setReturning(null);
        toast.success(
          kind === "sale"
            ? "تم تسجيل مرتجع البيع وإعادة الكمية للمخزن"
            : "تم تسجيل مرتجع الشراء وتحديث حساب المورد"
        );
      }
    );
  };

  const handleVoid = (purchase: Purchase) => {
    if (
      !window.confirm(
        `إلغاء فاتورة الشراء #${purchase.no}؟ سيُعكس أثرها على المخزون وحساب المورد.`
      )
    )
      return;
    runSafe(
      draft => voidPurchase(draft, purchase.no),
      () => toast.success("تم إلغاء الفاتورة وعكس أثرها")
    );
  };

  const printThermalReceipt = (
    lines: CartLine[],
    invoiceNo: string,
    customer = "عميل نقدي"
  ) => {
    const subtotal = round2(
      lines.reduce((sum, line) => sum + unitPrice(line, line.unitName) * line.qty, 0)
    );
    const lineDiscounts = round2(
      lines.reduce((sum, line) => sum + (line.lineDiscount || 0), 0)
    );
    const taxTotal = round2(
      lines.reduce((sum, line) => sum + (line.lineTax || 0), 0)
    );
    const invoiceCut = round2(Number(invoiceDiscount || 0));
    const total = round2(subtotal - lineDiscounts - invoiceCut + taxTotal);
    const receipt = window.open("", "_blank", "width=380,height=700");
    if (!receipt) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة الفاتورة");
      return;
    }
    receipt.document.write(
      `<html dir="rtl"><head><title>فاتورة ${invoiceNo}</title><style>body{width:72mm;margin:0 auto;padding:5mm 3mm;font-family:Arial,sans-serif;color:#111;font-size:12px}h1{text-align:center;font-size:19px;margin:0 0 4px}p{text-align:center;margin:3px 0;color:#555;font-size:10px}.line{border-top:1px dashed #777;margin:8px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:7px 0}.row strong{font-size:11px}.total{font-size:16px;font-weight:bold;margin-top:12px}.thanks{text-align:center;font-size:11px;margin-top:18px}@media print{button{display:none}}</style></head><body><h1>دفتر الزراعة</h1><p>محل الواحة الزراعية</p><p>فاتورة بيع ${invoiceNo} · ${new Date().toLocaleString("ar-EG")}</p><p>العميل: ${customer}</p><div class="line"></div>${lines.map(line => `<div class="row"><span>${line.name} × ${line.qty} ${line.unitName}</span><strong>${money(round2(unitPrice(line, line.unitName) * line.qty - (line.lineDiscount || 0) + (line.lineTax || 0)))}</strong></div>`).join("")}<div class="line"></div>${lineDiscounts + invoiceCut > 0 ? `<div class="row"><span>الخصم</span><strong>(${money(round2(lineDiscounts + invoiceCut))})</strong></div>` : ""}${taxTotal > 0 ? `<div class="row"><span>الضريبة</span><strong>${money(taxTotal)}</strong></div>` : ""}<div class="row total"><span>الإجمالي</span><strong>${money(total)}</strong></div><p class="thanks">شكرًا لتعاملكم معنا</p><script>window.onload=function(){window.print();}</script></body></html>`
    );
    receipt.document.close();
  };

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={logoUrl} alt="دفتر الزراعة" />
          </div>
          <div className="brand-wordmark">
            <strong>دفتر الزراعة</strong>
            <span>إدارة أسهل… لمحصول أكبر</span>
            <i />
          </div>
        </div>
        <div className="offline-pill">
          <span className="pulse-dot" /> يعمل دون إنترنت
        </div>
        <nav className="nav-list">
          {menu.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? "active" : ""}`}
                onClick={() => setActive(item.id)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                {item.id === "inventory" && (
                  <b className="nav-count">{products.length}</b>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            onClick={() => toast.info("الإعدادات جاهزة للتخصيص")}
          >
            <Settings2 size={20} />
            <span>إعدادات المحل</span>
          </button>
          <button
            className="nav-item"
            onClick={() => toast.info("مركز المساعدة: اسألنا عن أي خطوة")}
          >
            <HelpCircle size={20} />
            <span>مساعدة مبسطة</span>
          </button>
        </div>
        <div className="rights-mini">
          <div className="rights-badge">M1</div>
          <div>
            <small>حقوق الهوية البصرية</small>
            <strong>Media One</strong>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <img src={logoUrl} alt="دفتر الزراعة" />
            <b>دفتر الزراعة</b>
            <i />
          </div>
          <div className="breadcrumb">
            <span>محل الواحة الزراعية</span>
            <ChevronLeft size={15} />
            <strong>
              {menu.find(x => x.id === active)?.label || "الرئيسية"}
            </strong>
          </div>
          <div className="top-actions">
            <div className="save-status">
              <ShieldCheck size={16} /> {notice}
            </div>
            {canInstall && (
              <button
                className="install-btn"
                onClick={async () => {
                  const done = await install();
                  if (done)
                    toast.success("تم تثبيت النظام على الجهاز");
                }}
                title="تثبيت النظام كتطبيق على هذا الجهاز"
              >
                <Download size={15} /> تثبيت التطبيق
              </button>
            )}
            <button
              className="icon-btn"
              onClick={() => toast.info("لا توجد تنبيهات جديدة")}
            >
              <Bell size={19} />
              <i />
            </button>
            <div className="user-chip">
              <div className="avatar">م</div>
              <span>محمد صاحب المحل</span>
            </div>
          </div>
          <button className="mobile-menu">
            <Menu />
          </button>
        </header>

        {active === "home" ? (
          <>
            <section className="welcome-row">
              <div>
                <div className="eyebrow">
                  <CalendarDays size={15} />{" "}
                  {new Date().toLocaleDateString("ar-EG", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <h1>
                  أهلًا عمار، <em>يومك مزدهر.</em>
                </h1>
                <p>
                  هذه صورة سريعة عن حركة المحل اليوم. كل شيء محفوظ عندك حتى بدون
                  إنترنت.
                </p>
              </div>
              <button className="primary-btn" onClick={() => setShowSale(true)}>
                <Plus size={20} /> فاتورة بيع جديدة
              </button>
            </section>
            <section className="hero-card">
              <div className="hero-copy">
                <span className="tag">ملخص اليوم</span>
                <h2>بيعك أسرع، وحسابك أوضح.</h2>
                <p>
                  تابع حركة الأصناف، اعرف ما يحتاج طلبًا، وسجّل الفواتير في
                  ثوانٍ.
                </p>
                <div className="hero-actions">
                  <button
                    className="yellow-btn"
                    onClick={() => setShowSale(true)}
                  >
                    <Zap size={18} /> ابدأ بيع سريع
                  </button>
                  <button
                    className="ghost-light"
                    onClick={() => setActive("reports")}
                  >
                    شاهد التقرير <ChevronLeft size={17} />
                  </button>
                </div>
              </div>
              <div className="hero-art">
                <img src={`${assetBase}brand/dashboard-art.svg`} alt="" />
              </div>
            </section>
            <section className="metrics">
              <Metric
                title="مبيعات اليوم"
                value={money(todayStats.total)}
                note={
                  todayStats.change === null
                    ? "لا توجد مبيعات أمس للمقارنة"
                    : `${todayStats.change >= 0 ? "+" : ""}${todayStats.change.toFixed(1)}% من أمس`
                }
                icon={<TrendingUp />}
                tone="green"
              />
              <Metric
                title="فواتير اليوم"
                value={String(todayStats.count)}
                note={`${sales.length} فاتورة إجمالًا`}
                icon={<FileText />}
                tone="yellow"
              />
              <Metric
                title="الأصناف في المخزون"
                value={String(products.length)}
                note={`ضمن ${categories.length} قسمًا`}
                icon={<Boxes />}
                tone="blue"
              />
              <Metric
                title="مستحق للموردين"
                value={money(payables)}
                note={
                  payables > 0 ? "مبالغ آجلة لم تُسدد" : "لا توجد مديونية"
                }
                icon={<Truck />}
                tone="orange"
              />
              <Metric
                title="تنبيهات المخزون"
                value={String(alerts.length)}
                note={
                  alerts.some(a => a.kind === "expired")
                    ? "تشمل أصنافًا منتهية الصلاحية"
                    : "نقص رصيد أو قرب انتهاء صلاحية"
                }
                icon={<PackagePlus />}
                tone="orange"
              />
            </section>
            <section className="content-grid">
              <div className="panel sales-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">آخر حركة</span>
                    <h3>الفواتير الأخيرة</h3>
                  </div>
                  <button
                    className="text-btn"
                    onClick={() => setActive("sales")}
                  >
                    عرض الكل <ChevronLeft size={16} />
                  </button>
                </div>
                <div className="invoice-list">
                  {sales.length ? (
                    sales
                      .slice(0, 4)
                      .map(sale => (
                        <Invoice
                          key={sale.no}
                          no={`#${sale.no}`}
                          customer={sale.customer}
                          time={relativeTime(sale.at)}
                          total={money(sale.total)}
                          status="مدفوعة"
                        />
                      ))
                  ) : (
                    <div className="empty-cart">
                      <FileText size={26} />
                      <span>لا توجد فواتير بعد — ابدأ بأول عملية بيع</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="panel alert-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">تحتاج انتباهك</span>
                    <h3>تنبيهات المخزون</h3>
                  </div>
                  <button
                    className="round-add"
                    onClick={() => setShowProduct(true)}
                  >
                    <Plus size={17} />
                  </button>
                </div>
                {alerts.length ? (
                  alerts.slice(0, 6).map(alert => (
                    <div
                      className="stock-row"
                      key={`${alert.productId}-${alert.kind}`}
                    >
                      <div className={`alert-thumb ${alert.kind}`}>
                        {alert.kind === "expired" ||
                        alert.kind === "expiring" ? (
                          <CalendarDays size={16} />
                        ) : (
                          <Sprout size={17} />
                        )}
                      </div>
                      <div className="stock-info">
                        <strong>{alert.name}</strong>
                        <span>{alert.message}</span>
                      </div>
                      <div className="stock-number">
                        <b>{alert.stock}</b>
                        <small>متبقي</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-cart">
                    <ShieldCheck size={26} />
                    <span>لا توجد تنبيهات — المخزون بحالة جيدة</span>
                  </div>
                )}
                <button
                  className="wide-soft-btn"
                  onClick={() => setActive("inventory")}
                >
                  إدارة المخزون <ChevronLeft size={16} />
                </button>
              </div>
            </section>
            <section className="quick-actions">
              <div>
                <span className="eyebrow">اختصارات ذكية</span>
                <h3>ماذا تريد أن تفعل؟</h3>
              </div>
              <button onClick={() => setShowSale(true)}>
                <div className="qa-icon green">
                  <ShoppingCart />
                </div>
                <span>
                  <b>بيع سريع</b>
                  <small>فاتورة في ثوانٍ</small>
                </span>
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setShowProduct(true)}>
                <div className="qa-icon yellow">
                  <PackagePlus />
                </div>
                <span>
                  <b>إضافة منتج</b>
                  <small>صنف جديد للمخزن</small>
                </span>
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setShowInvoiceCapture(true)}>
                <div className="qa-icon orange">
                  <Camera />
                </div>
                <span>
                  <b>تصوير فاتورة</b>
                  <small>إرفاق فاتورة شراء</small>
                </span>
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setShowOpening(true)}>
                <div className="qa-icon yellow">
                  <Scale />
                </div>
                <span>
                  <b>رصيد افتتاحي</b>
                  <small>ابدأ بنقدك الحالي</small>
                </span>
                <ChevronLeft size={18} />
              </button>
              <button onClick={() => setShowBackup(true)}>
                <div className="qa-icon blue">
                  <ShieldCheck />
                </div>
                <span>
                  <b>نسخة احتياطية</b>
                  <small>احفظ بياناتك بأمان</small>
                </span>
                <ChevronLeft size={18} />
              </button>
            </section>
          </>
        ) : (
          <ModuleView
            active={active}
            products={filtered}
            allProducts={products}
            sales={sales}
            search={search}
            setSearch={setSearch}
            category={category}
            setCategory={setCategory}
            categories={categories}
            addToCart={addToCart}
            onAdd={() => setShowProduct(true)}
            onSale={() => setShowSale(true)}
            state={state}
            money={money}
            onNewPurchase={() => setShowPurchase(true)}
            onAddSupplier={() => {
              setEditingSupplier(null);
              setShowSupplier(true);
            }}
            onEditSupplier={(supplier: Supplier) => {
              setEditingSupplier(supplier);
              setShowSupplier(true);
            }}
            onPayPurchase={handlePay}
            onVoidPurchase={handleVoid}
            onReturn={(kind: ReturnKind, source: Sale | Purchase) =>
              setReturning({ kind, source })
            }
            onAddExpense={() => setShowExpense(true)}
            onStockTake={submitStockTake}
            onResetOpening={submitResetOpening}
            onImport={submitImport}
            onAddCustomer={() => {
              setEditingCustomer(null);
              setShowCustomer(true);
            }}
            onEditCustomer={(c: Customer) => {
              setEditingCustomer(c);
              setShowCustomer(true);
            }}
            onCollectCustomer={(c: Customer) => setCollecting(c)}
            onClosePeriod={() => setShowClosePeriod(true)}
            onOpenUnits={(p: Product) => setUnitsProduct(p)}
            onDeleteExpense={removeExpense}
          />
        )}
        <footer className="footer">
          <span>دفتر الزراعة v1.0 · مصمم لمحل الواحة الزراعية</span>
          <span>
            <CloudOff size={14} /> بياناتك على جهازك أولاً
          </span>
        </footer>
      </main>

      {showSale && (
        <Modal title="فاتورة بيع جديدة" onClose={() => setShowSale(false)}>
          <div className="sale-layout">
            <div className="sale-products">
              <label className="field-label">بحث سريع بالاسم أو الباركود</label>
              <div className="sale-search-row">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={search}
                    placeholder="اكتب اسم المنتج أو امسح الرقم…"
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <button
                  className="camera-btn"
                  onClick={() => setShowScanner(true)}
                  title="مسح الباركود بالكاميرا"
                >
                  <Camera size={19} />
                </button>
              </div>
              <div className="search-hint">
                اكتب اسم الصنف أو رقم الباركود · قارئ USB يعمل تلقائيًا دون
                الحاجة لوضع المؤشر في الحقل
              </div>
              <div className="category-chips">
                <button
                  className={category === "كل الأقسام" ? "selected" : ""}
                  onClick={() => setCategory("كل الأقسام")}
                >
                  كل الأقسام <b>{products.length}</b>
                </button>
                {categories.map(item => (
                  <button
                    key={item}
                    className={category === item ? "selected" : ""}
                    onClick={() => setCategory(item)}
                  >
                    {item}{" "}
                    <b>{products.filter(p => p.category === item).length}</b>
                  </button>
                ))}
              </div>
              <div className="mini-products">
                {filtered.slice(0, 4).map(p => (
                  <button key={p.id} onClick={() => addToCart(p)}>
                    <div className={`product-thumb ${p.color}`}>
                      <Sprout size={16} />
                    </div>
                    <span>
                      <b>{p.name}</b>
                      <small>
                        {money(p.price)} · متوفر {p.stock} · {p.barcode}
                      </small>
                    </span>
                    <Plus size={17} />
                  </button>
                ))}
              </div>
            </div>
            <div className="cart-box">
              <div className="cart-title">
                <b>الفاتورة #1049</b>
                <span>اليوم، الآن</span>
              </div>
              {cart.length ? (
                cart.map((line, i) => {
                  const options = unitsOf(line);
                  const each = unitPrice(line, line.unitName);
                  return (
                    <div
                      className="cart-line"
                      key={`${line.id}-${line.unitName}-${i}`}
                    >
                      <span>
                        <b>{line.name}</b>
                        <small>
                          {money(each)} · {line.unitName}
                        </small>
                        {options.length > 1 && (
                          <select
                            className="unit-select"
                            value={line.unitName}
                            onChange={e =>
                              switchCartUnit(line, e.target.value)
                            }
                          >
                            {options.map(u => (
                              <option key={u.name} value={u.name}>
                                {u.name}
                                {u.factor > 1 ? ` (${u.factor} ${line.unit})` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                        <span className="qty-controls">
                          <button
                            onClick={() =>
                              changeQty(line.id, line.unitName, -1)
                            }
                          >
                            −
                          </button>
                          <b>{line.qty}</b>
                          <button
                            onClick={() => changeQty(line.id, line.unitName, 1)}
                          >
                            +
                          </button>
                        </span>
                        <span className="line-extras">
                          <label>
                            خصم
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={line.lineDiscount || ""}
                              placeholder="0"
                              onChange={e =>
                                setLineExtra(
                                  line.id,
                                  line.unitName,
                                  "lineDiscount",
                                  Number(e.target.value)
                                )
                              }
                            />
                          </label>
                          <label>
                            ضريبة
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={line.lineTax || ""}
                              placeholder="0"
                              onChange={e =>
                                setLineExtra(
                                  line.id,
                                  line.unitName,
                                  "lineTax",
                                  Number(e.target.value)
                                )
                              }
                            />
                          </label>
                        </span>
                      </span>
                      <strong>
                        {money(
                          round2(
                            each * line.qty -
                              (line.lineDiscount || 0) +
                              (line.lineTax || 0)
                          )
                        )}
                      </strong>
                    </div>
                  );
                })
              ) : (
                <div className="empty-cart">
                  <ShoppingCart size={28} />
                  <span>اختر صنفًا لإضافته</span>
                </div>
              )}
              <div className="cart-summary">
                <div>
                  <span>الإجمالي قبل الخصم</span>
                  <b>{money(cartTotals.subtotal)}</b>
                </div>
                {cartTotals.lineDiscounts > 0 && (
                  <div>
                    <span>خصم السطور</span>
                    <b>({money(cartTotals.lineDiscounts)})</b>
                  </div>
                )}
                <div className="cart-discount-row">
                  <span>خصم الفاتورة</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={invoiceDiscount}
                    placeholder="0"
                    onChange={e => setInvoiceDiscount(e.target.value)}
                  />
                </div>
                {cartTotals.tax > 0 && (
                  <div>
                    <span>الضريبة</span>
                    <b>{money(cartTotals.tax)}</b>
                  </div>
                )}
                <div className="grand">
                  <span>الصافي</span>
                  <b>{money(cartTotals.total)}</b>
                </div>
              </div>
              <input
                className="customer-input"
                value={saleCustomer}
                onChange={e => setSaleCustomer(e.target.value)}
                placeholder="اسم العميل (اختياري)"
              />
              <button className="primary-btn full" onClick={confirmSale}>
                تأكيد البيع وطباعة الفاتورة <Printer size={18} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showInvoiceCapture && (
        <Modal
          title="تصوير فاتورة شراء"
          onClose={() => setShowInvoiceCapture(false)}
        >
          <div className="invoice-capture">
            <div className="capture-guide">
              <Camera size={24} />
              <div>
                <h3>صوّر الفاتورة وراجعها</h3>
                <p>
                  الصورة تُحفظ كمرفق للمراجعة. لا نعتمد القراءة الآلية دون تأكيد
                  منك.
                </p>
              </div>
            </div>
            <label className="capture-drop">
              <Camera size={22} />
              <span>
                {invoicePhoto
                  ? "تغيير صورة الفاتورة"
                  : "التقاط صورة أو اختيارها"}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={e => captureInvoicePhoto(e.target.files?.[0])}
              />
            </label>
            {invoicePhoto && (
              <img
                className="invoice-preview"
                src={invoicePhoto}
                alt="معاينة صورة الفاتورة"
              />
            )}
            <div className="form-grid">
              <Field label="اسم المورد" name="supplier" placeholder="اختياري" />
              <Field
                label="رقم الفاتورة"
                name="invoiceNo"
                placeholder="اختياري"
              />
              <Field
                label="الإجمالي"
                name="invoiceTotal"
                placeholder="0.00"
                type="number"
              />
            </div>
            <button
              className="primary-btn full"
              onClick={() => {
                if (!invoicePhoto) {
                  toast.error("التقط صورة الفاتورة أولًا");
                  return;
                }
                localStorage.setItem("agri-last-invoice-photo", invoicePhoto);
                setShowInvoiceCapture(false);
                toast.success("تم حفظ صورة الفاتورة للمراجعة");
              }}
            >
              <FilePlus2 size={18} /> حفظ المرفق
            </button>
          </div>
        </Modal>
      )}
      {unitsProduct && (
        <Modal
          title="وحدات البيع والباركودات"
          onClose={() => setUnitsProduct(null)}
        >
          <ProductUnitsDialog
            product={unitsProduct}
            money={money}
            onAddUnit={productUnitActions.addUnit}
            onRemoveUnit={productUnitActions.removeUnit}
            onAddBarcode={productUnitActions.addBarcode}
            onRemoveBarcode={productUnitActions.removeBarcode}
          />
        </Modal>
      )}
      {showOpening && (
        <Modal title="الرصيد الافتتاحي" onClose={() => setShowOpening(false)}>
          <form className="product-form" onSubmit={submitOpening}>
            <div className="backup-reminder">
              <Scale size={18} />
              <span>
                يُسجَّل النقد الموجود لديك مقابل رأس المال، فيبدأ الميزان
                متوازنًا.
              </span>
            </div>
            <div className="form-grid">
              <SupplierField label="نقد في الصندوق" name="cash" placeholder="0" />
              <SupplierField label="رصيد البنك" name="bank" placeholder="0" />
            </div>
            <SupplierField label="ملاحظة" name="note" placeholder="رصيد افتتاحي" />
            <button className="primary-btn full" type="submit">
              <Check size={18} /> ترحيل الرصيد الافتتاحي
            </button>
          </form>
        </Modal>
      )}
      {showClosePeriod && (
        <Modal title="إقفال فترة محاسبية" onClose={() => setShowClosePeriod(false)}>
          <form className="product-form" onSubmit={submitClosePeriod}>
            <div className="reset-warn">
              <Lock size={18} />
              <div>
                <b>الإقفال لا رجعة فيه</b>
                <span>
                  لن تقبل الفترة أي قيد جديد بعد إقفالها، وهذا ما يحمي أرقامك
                  المعتمدة من التعديل بأثر رجعي.
                </span>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>من تاريخ</span>
                <input type="date" name="from" required />
              </label>
              <label className="field">
                <span>إلى تاريخ</span>
                <input type="date" name="to" required />
              </label>
            </div>
            <SupplierField label="ملاحظة" name="note" placeholder="إقفال الشهر" />
            <button className="primary-btn full" type="submit">
              <Lock size={18} /> إقفال الفترة
            </button>
          </form>
        </Modal>
      )}
      {showCustomer && (
        <Modal
          title={editingCustomer ? "تعديل عميل" : "إضافة عميل"}
          onClose={() => {
            setShowCustomer(false);
            setEditingCustomer(null);
          }}
        >
          <form className="product-form" onSubmit={submitCustomer}>
            <SupplierField
              label="اسم العميل"
              name="name"
              value={editingCustomer?.name}
              placeholder="مزرعة النخيل"
            />
            <div className="form-grid">
              <SupplierField
                label="رقم الهاتف"
                name="phone"
                value={editingCustomer?.phone}
                placeholder="7xxxxxxxx"
              />
              <label className="field">
                <span>نوع التعامل</span>
                <select
                  name="terms"
                  className="category-select"
                  defaultValue={editingCustomer?.terms || "cash"}
                >
                  <option value="cash">نقدي</option>
                  <option value="credit">آجل</option>
                </select>
              </label>
            </div>
            <div className="form-grid">
              <SupplierField
                label="حد الائتمان (صفر = بلا حد)"
                name="creditLimit"
                value={String(editingCustomer?.creditLimit ?? 0)}
                placeholder="0"
              />
              <SupplierField
                label="العنوان"
                name="address"
                value={editingCustomer?.address}
                placeholder="اختياري"
              />
            </div>
            <button className="primary-btn full" type="submit">
              <Check size={18} />{" "}
              {editingCustomer ? "حفظ التعديل" : "حفظ العميل"}
            </button>
          </form>
        </Modal>
      )}
      {collecting && (
        <Modal
          title={`تحصيل من ${collecting.name}`}
          onClose={() => setCollecting(null)}
        >
          <form className="product-form" onSubmit={submitCollection}>
            <div className="backup-reminder">
              <HandCoins size={18} />
              <span>المستحق على العميل</span>
              <b>{money(customerBalance(state, collecting.id))}</b>
            </div>
            <SupplierField
              label="قيمة التحصيل"
              name="amount"
              placeholder="0"
            />
            <button className="primary-btn full" type="submit">
              <Check size={18} /> تسجيل التحصيل
            </button>
          </form>
        </Modal>
      )}
      {showExpense && (
        <Modal title="تسجيل مصروف" onClose={() => setShowExpense(false)}>
          <form className="product-form" onSubmit={submitExpense}>
            <label className="field">
              <span>البند</span>
              <select name="category" className="category-select" required>
                {Object.entries(EXPENSE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <SupplierField
              label="الوصف"
              name="description"
              placeholder="إيجار شهر سبتمبر"
            />
            <div className="form-grid">
              <label className="field">
                <span>القيمة</span>
                <input name="amount" type="number" min="0" step="any" required />
              </label>
              <SupplierField
                label="المرجع"
                name="reference"
                placeholder="رقم الإيصال (اختياري)"
              />
            </div>
            <button className="primary-btn full" type="submit">
              <Check size={18} /> حفظ المصروف
            </button>
          </form>
        </Modal>
      )}
      {payingPurchase && (
        <Modal
          title={`تسجيل دفعة — فاتورة #${payingPurchase.no}`}
          onClose={() => setPayingPurchase(null)}
        >
          <PaymentDialog
            purchase={payingPurchase}
            money={money}
            onSubmit={submitPayment}
          />
        </Modal>
      )}
      {returning && (
        <Modal
          title={returning.kind === "sale" ? "مرتجع بيع" : "مرتجع شراء"}
          onClose={() => setReturning(null)}
        >
          <ReturnDialog
            state={state}
            kind={returning.kind}
            source={returning.source}
            money={money}
            onSubmit={submitReturn}
          />
        </Modal>
      )}
      {showPurchase && (
        <Modal
          title="فاتورة شراء جديدة"
          onClose={() => setShowPurchase(false)}
        >
          <Suspense
            fallback={<div className="scanner-loading">جارٍ التحضير…</div>}
          >
            <PurchaseDialog
              products={products}
              suppliers={suppliers.filter(x => x.status === "active")}
              money={money}
              onSubmit={submitPurchase}
              onAddSupplier={() => {
                setShowPurchase(false);
                setEditingSupplier(null);
                setShowSupplier(true);
              }}
            />
          </Suspense>
        </Modal>
      )}
      {showSupplier && (
        <Modal
          title={editingSupplier ? "تعديل مورد" : "إضافة مورد"}
          onClose={() => {
            setShowSupplier(false);
            setEditingSupplier(null);
          }}
        >
          <form className="product-form" onSubmit={submitSupplier}>
            <SupplierField
              label="اسم المورد"
              name="name"
              value={editingSupplier?.name}
              placeholder="شركة الوادي للأسمدة"
            />
            <div className="form-grid">
              <SupplierField
                label="رقم الهاتف"
                name="phone"
                value={editingSupplier?.phone}
                placeholder="7xxxxxxxx"
              />
              <SupplierField
                label="البريد الإلكتروني"
                name="email"
                value={editingSupplier?.email}
                placeholder="اختياري"
              />
            </div>
            <div className="form-grid">
              <SupplierField
                label="العنوان"
                name="address"
                value={editingSupplier?.address}
                placeholder="اختياري"
              />
              <SupplierField
                label="الرقم الضريبي"
                name="taxNumber"
                value={editingSupplier?.taxNumber}
                placeholder="اختياري"
              />
            </div>
            <SupplierField
              label="ملاحظات"
              name="notes"
              value={editingSupplier?.notes}
              placeholder="اختياري"
            />
            <button className="primary-btn full" type="submit">
              <Check size={18} />{" "}
              {editingSupplier ? "حفظ التعديل" : "حفظ المورد"}
            </button>
          </form>
        </Modal>
      )}
      {showProduct && (
        <Modal title="إضافة منتج جديد" onClose={() => setShowProduct(false)}>
          <form className="product-form" onSubmit={addProduct}>
            <div className="form-grid">
              <Field
                label="اسم المنتج"
                name="name"
                placeholder="مثال: سماد عضوي"
              />
              <Field label="القسم" name="category" placeholder="أسمدة، بذور…" />
              <Field label="الوحدة" name="unit" placeholder="كيس، قطعة…" />
              <Field
                label="الكمية الحالية"
                name="stock"
                placeholder="0"
                type="number"
              />
              <Field
                label="سعر البيع"
                name="price"
                placeholder="0.00"
                type="number"
              />
              <Field
                label="الباركود (اختياري)"
                name="barcode"
                placeholder="امسح أو اكتب الرقم"
              />
            </div>
            <div className="form-grid">
              <label className="field">
                <span>حد إعادة الطلب</span>
                <input
                  name="reorderLevel"
                  type="number"
                  min="0"
                  defaultValue={8}
                />
              </label>
              <label className="field">
                <span>تاريخ الصلاحية</span>
                <input name="expiryDate" type="date" />
              </label>
            </div>
            <button className="primary-btn full" type="submit">
              <PackagePlus size={18} /> حفظ المنتج
            </button>
          </form>
        </Modal>
      )}
      {showScanner && (
        <Modal
          title="مسح الباركود"
          onClose={() => {
            setShowScanner(false);
            setScanFeedback("");
          }}
        >
          <Suspense
            fallback={<div className="scanner-loading">جارٍ تحضير الماسح…</div>}
          >
            <BarcodeScanner
              onDetected={handleBarcode}
              lastResult={scanFeedback}
              onClose={() => {
                setShowScanner(false);
                setScanFeedback("");
              }}
            />
          </Suspense>
        </Modal>
      )}
      {showBackup && (
        <Modal title="النسخ والاستعادة" onClose={() => setShowBackup(false)}>
          <div className="backup-reminder">
            <ShieldCheck size={18} />
            <span>
              {lastBackup
                ? `آخر نسخة: ${new Date(lastBackup).toLocaleDateString("ar-EG")}`
                : "لم يتم إنشاء نسخة احتياطية بعد"}
            </span>
            <b>
              {!lastBackup ||
              Date.now() - new Date(lastBackup).getTime() >
                30 * 24 * 60 * 60 * 1000
                ? "مطلوبة هذا الشهر"
                : "محدّثة"}
            </b>
          </div>

          <div className="storage-meter">
            <div className="storage-head">
              <span>مساحة البيانات على الجهاز</span>
              <b className={usage.percent >= 80 ? "danger-text" : ""}>
                {usage.usedKb} من {usage.limitKb} كيلوبايت ({usage.percent}%)
              </b>
            </div>
            <div className="storage-bar">
              <i
                className={
                  usage.percent >= 80
                    ? "critical"
                    : usage.percent >= 60
                      ? "warn"
                      : ""
                }
                style={{ width: `${Math.max(2, usage.percent)}%` }}
              />
            </div>
            <small>
              {usage.percent >= 80
                ? "المساحة شارفت على الامتلاء. صدّر نسخة واحذف بيانات قديمة."
                : "تكفي عادةً لأكثر من سنة تشغيل. صدّر نسخة شهريًا للأمان."}
            </small>
          </div>
          <div className="backup-grid">
            <div className="backup-card">
              <div className="backup-icon green">
                <Download />
              </div>
              <h3>تنزيل نسخة احتياطية</h3>
              <p>ملف واحد يحفظ منتجاتك وبيانات التشغيل على جهازك.</p>
              <button className="primary-btn" onClick={exportBackup}>
                <Download size={17} /> تنزيل JSON
              </button>
            </div>
            <div className="backup-card">
              <div className="backup-icon blue">
                <Upload />
              </div>
              <h3>استعادة نسخة</h3>
              <p>اختر ملفًا سابقًا لإعادة بياناتك بسرعة.</p>
              <label className="outline-btn">
                <Upload size={17} /> اختيار ملف
                <input
                  type="file"
                  accept=".json"
                  hidden
                  onChange={e => {
                    importBackup(e.target.files?.[0]);
                    setShowBackup(false);
                  }}
                />
              </label>
            </div>
          </div>
          <div className="share-note">
            <ShieldCheck size={18} />
            <span>
              يمكن مشاركة ملف النسخة عبر واتساب، البريد، USB أو أي وسيلة تناسبك.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Metric({ title, value, note, icon, tone }: any) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <em className={tone === "green" ? "positive" : ""}>{note}</em>
      </div>
    </div>
  );
}
function Invoice({ no, customer, time, total, status, late }: any) {
  return (
    <div className="invoice-row">
      <div className="invoice-mark">
        <FileText size={18} />
      </div>
      <div className="invoice-main">
        <strong>
          {no} · {customer}
        </strong>
        <span>{time}</span>
      </div>
      <b>{total}</b>
      <span className={`status ${late ? "late" : "paid"}`}>{status}</span>
      <button className="row-more">
        <ChevronLeft size={16} />
      </button>
    </div>
  );
}
function Field({ label, name, placeholder, type = "text" }: any) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input required name={name} type={type} placeholder={placeholder} />
    </label>
  );
}
function Modal({ title, onClose, children }: any) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function ModuleView({
  active,
  products,
  allProducts,
  sales,
  state,
  money: moneyFn,
  onNewPurchase,
  onAddSupplier,
  onEditSupplier,
  onPayPurchase,
  onVoidPurchase,
  onReturn,
  onAddExpense,
  onOpenUnits,
  onStockTake,
  onResetOpening,
  onImport,
  onAddCustomer,
  onEditCustomer,
  onCollectCustomer,
  onClosePeriod,
  onDeleteExpense,
  search,
  setSearch,
  category,
  setCategory,
  categories,
  addToCart,
  onAdd,
  onSale,
}: any) {
  const titles: any = {
    sales: [
      "المبيعات والفواتير",
      "أنشئ فاتورة، تابع التحصيل، وارجع لأي عملية.",
    ],
    inventory: [
      "المخزون والمنتجات",
      "كل صنف في مكانه، والناقص يظهر قبل أن يفاجئك.",
    ],
    customers: ["العملاء", "كشوف حسابات، بيع آجل، وتحصيل."],
    ledger: [
      "الدفاتر المحاسبية",
      "دليل الحسابات، دفتر الأستاذ، القيود، والقوائم المالية.",
    ],
    trialbalance: [
      "ميزان المراجعة",
      "مدين ودائن لكل حساب، ويجب أن يتوازن الجانبان.",
    ],
    datatools: [
      "الجرد والاستيراد",
      "اضبط الأرصدة على الواقع، أو استورد بياناتك من ملف.",
    ],
    purchases: [
      "المشتريات",
      "سجّل فواتير الموردين لتعرف تكلفتك الحقيقية وربحك.",
    ],
    suppliers: [
      "الموردون",
      "بيانات الموردين وكشوف الحسابات والمبالغ المستحقة.",
    ],
    accounts: ["الحسابات", "صورة أوضح للدخل والتكلفة وصافي الربح."],
    expenses: [
      "المصروفات",
      "الإيجار والرواتب والكهرباء؛ بها يصبح صافي الربح دقيقًا.",
    ],
    reports: ["التقارير", "ملخصات تساعدك على اتخاذ قرارك التالي."],
  };
  const [title, desc] = titles[active] || titles.inventory;
  return (
    <section className="module-view">
      <div className="module-head">
        <div>
          <div className="eyebrow">دفتر الزراعة / {title}</div>
          <h1>{title}</h1>
          <p>{desc}</p>
        </div>
        {active === "sales" ? (
          <button className="primary-btn" onClick={onSale}>
            <Plus size={19} /> فاتورة جديدة
          </button>
        ) : active === "inventory" ? (
          <button className="primary-btn" onClick={onAdd}>
            <Plus size={19} /> إضافة منتج
          </button>
        ) : (
          <button className="primary-btn" onClick={onSale}>
            <ShoppingCart size={19} /> بيع سريع
          </button>
        )}
      </div>
      {active === "sales" && sales.length ? (
        <div className="panel table-panel" style={{ marginBottom: 17 }}>
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              الفواتير المحفوظة ({sales.length})
            </b>
          </div>
          <div className="ledger-list">
            {sales.slice(0, 12).map((sale: Sale) => (
              <div className="ledger-row" key={sale.no}>
                <div className="ledger-mark">
                  <FileText size={17} />
                </div>
                <div className="ledger-main">
                  <strong>
                    #{sale.no} · {sale.customer}
                  </strong>
                  <span>
                    {relativeTime(sale.at)} ·{" "}
                    {sale.lines.reduce((n, l) => n + l.qty, 0)} قطعة
                  </span>
                </div>
                <div className="ledger-total">{money(sale.total)}</div>
                <button
                  className="row-more"
                  onClick={() => onReturn("sale", sale)}
                  title="مرتجع من هذه الفاتورة"
                >
                  مرتجع
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {active === "inventory" || active === "sales" ? (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث في المنتجات…"
              />
            </div>
            <select
              className="category-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="كل الأقسام">كل الأقسام ({products.length})</option>
              {categories.map((item: string) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              className="outline-btn"
              onClick={() =>
                toast.info(`يعرض النظام ${products.length} صنفًا في هذا القسم`)
              }
            >
              تصفية <ChevronLeft size={16} />
            </button>
          </div>
          <div className="data-table">
            <div className="table-row table-head">
              <span>الصنف</span>
              <span>القسم</span>
              <span>الوحدة</span>
              <span>المخزون</span>
              <span>التكلفة</span>
              <span>سعر البيع</span>
              <span>الصلاحية</span>
              <span>إجراء</span>
            </div>
            {products.map((p: Product) => (
              <div className="table-row" key={p.id}>
                <span className="product-cell">
                  <i className={`product-thumb ${p.color}`}>
                    <Sprout size={16} />
                  </i>
                  <b>{p.name}</b>
                </span>
                <span>{p.category}</span>
                <span>{p.unit}</span>
                <span className={p.stock <= 8 ? "danger-text" : "good-text"}>
                  {p.stock} {p.unit}
                </span>
                <span>{p.avgCost > 0 ? money(p.avgCost) : "—"}</span>
                <span>{money(p.price)}</span>
                <span className={expiryTone(p.expiryDate)}>
                  {p.expiryDate
                    ? new Date(p.expiryDate).toLocaleDateString("ar-EG")
                    : "—"}
                </span>
                <button
                  className="small-add"
                  onClick={() =>
                    active === "sales" ? addToCart(p) : onOpenUnits(p)
                  }
                >
                  {active === "sales" ? (
                    <>
                      <Plus size={15} /> أضف للفاتورة
                    </>
                  ) : (
                    "الوحدات"
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : active === "operations" ? (
        <div className="operations-board">
          <div className="operations-intro">
            <div className="operation-badge">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h2>مركز العمليات</h2>
              <p>اختر العملية المطلوبة. كل إجراء واضح بخطوة واحدة.</p>
            </div>
          </div>
          <div className="operation-grid">
            <button className="operation-card sale" onClick={onSale}>
              <span className="operation-icon">
                <ShoppingCart />
              </span>
              <strong>بيع جديد</strong>
              <small>إنشاء فاتورة بيع</small>
              <ChevronLeft />
            </button>
            <button className="operation-card buy" onClick={onAdd}>
              <span className="operation-icon">
                <ArrowDownToLine />
              </span>
              <strong>شراء بضاعة</strong>
              <small>إضافة كميات للمخزون</small>
              <ChevronLeft />
            </button>
            <button
              className="operation-card return"
              onClick={() =>
                toast.info("سيتم تفعيل المرتجعات في الخطوة التالية")
              }
            >
              <span className="operation-icon">
                <ArrowUpFromLine />
              </span>
              <strong>مرتجع بيع</strong>
              <small>إرجاع صنف للفاتورة</small>
              <ChevronLeft />
            </button>
            <button
              className="operation-card receive"
              onClick={() =>
                toast.info("سيتم تفعيل سند القبض في الخطوة التالية")
              }
            >
              <span className="operation-icon">
                <CircleDollarSign />
              </span>
              <strong>قبض من عميل</strong>
              <small>تسجيل دفعة مستحقة</small>
              <ChevronLeft />
            </button>
            <button
              className="operation-card expense"
              onClick={() =>
                toast.info("سيتم تفعيل سند الصرف في الخطوة التالية")
              }
            >
              <span className="operation-icon">
                <WalletCards />
              </span>
              <strong>صرف مصروف</strong>
              <small>تسجيل مصروف المحل</small>
              <ChevronLeft />
            </button>
            <button
              className="operation-card count"
              onClick={() => setSearch("")}
            >
              <span className="operation-icon">
                <Boxes />
              </span>
              <strong>جرد المخزون</strong>
              <small>مراجعة الأرصدة الحالية</small>
              <ChevronLeft />
            </button>
          </div>
          <div className="operations-tip">
            <ShieldCheck size={18} />
            <span>
              <b>اختصار الكاشير:</b> ابدأ ببيع جديد، اختر الأصناف، عدّل الكمية،
              ثم أكد البيع لطباعة الإيصال وخصم المخزون تلقائيًا.
            </span>
          </div>
        </div>
      ) : active === "purchases" ? (
        <PurchasesBoard
          state={state}
          money={moneyFn}
          onNew={onNewPurchase}
          onPay={onPayPurchase}
          onVoid={onVoidPurchase}
          onReturn={p => onReturn("purchase", p)}
        />
      ) : active === "suppliers" ? (
        <SuppliersBoard
          state={state}
          money={moneyFn}
          onAdd={onAddSupplier}
          onEdit={onEditSupplier}
        />
      ) : active === "expenses" ? (
        <ExpensesBoard
          state={state}
          money={moneyFn}
          onAdd={onAddExpense}
          onDelete={onDeleteExpense}
        />
      ) : active === "reports" ? (
        <ReportsBoard state={state} />
      ) : active === "ledger" ? (
        <LedgerBoard
          state={state}
          money={moneyFn}
          onClosePeriod={onClosePeriod}
        />
      ) : active === "trialbalance" ? (
        <TrialBalanceBoard state={state} money={moneyFn} />
      ) : active === "datatools" ? (
        <DataToolsBoard
          state={state}
          money={moneyFn}
          onStockTake={onStockTake}
          onResetOpening={onResetOpening}
          onImport={onImport}
        />
      ) : active === "customers" ? (
        <CustomersBoardNew
          state={state}
          money={moneyFn}
          onAdd={onAddCustomer}
          onEdit={onEditCustomer}
          onCollect={onCollectCustomer}
        />
      ) : active === "accounts" ? (
        <AccountsBoard state={state} />
      ) : (
        <div className="empty-module">
          <div className="empty-illustration">
            <ClipboardList />
          </div>
          <h2>هذه المساحة جاهزة لك</h2>
          <p>سنضيف لها سجلات {title} مع إبقاء كل شيء بسيطًا وواضحًا.</p>
          <button className="primary-btn" onClick={onAdd}>
            <Plus size={18} /> إضافة أول سجل
          </button>
        </div>
      )}
    </section>
  );
}

/** فترات جاهزة تغطي أسئلة صاحب المحل اليومية دون إدخال تواريخ يدويًا. */
const periods: { id: string; label: string; days: number | null }[] = [
  { id: "today", label: "اليوم", days: 0 },
  { id: "week", label: "آخر ٧ أيام", days: 7 },
  { id: "month", label: "آخر ٣٠ يومًا", days: 30 },
  { id: "year", label: "آخر سنة", days: 365 },
  { id: "all", label: "كل الفترات", days: null },
];

function ReportsBoard({ state }: { state: DbState }) {
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState<
    "sales" | "purchases" | "costs" | "profit" | "expenses"
  >("profit");

  const range = useMemo(() => {
    const found = periods.find(p => p.id === period);
    if (!found || found.days === null) return null;
    const start = new Date();
    if (found.days === 0) start.setHours(0, 0, 0, 0);
    else start.setDate(start.getDate() - found.days);
    return start;
  }, [period]);

  const inRange = usePersistFn((iso: string) =>
    range ? new Date(iso) >= range : true
  );

  const scopedSales = useMemo(
    () => state.sales.filter(sale => inRange(sale.at)),
    [state.sales, inRange]
  );
  const scopedPurchases = useMemo(
    () =>
      state.purchases.filter(p => p.status === "confirmed" && inRange(p.at)),
    [state.purchases, inRange]
  );

  // الربح بعد خصم مرتجعات البيع، لا الربح الإجمالي فقط.
  const scopedExpenses = useMemo(
    () => state.expenses.filter(e => inRange(e.at)),
    [state.expenses, inRange]
  );
  // صافي الربح: بعد المرتجعات والتكلفة والمصروفات التشغيلية.
  const profit = useMemo(
    () => netIncome(state, scopedSales, scopedExpenses),
    [state, scopedSales, scopedExpenses]
  );
  const purchasesSum = purchasesTotal(scopedPurchases);
  const stockValue = inventoryValue(state);
  const payables = payablesTotal(state);
  const periodLabel = periods.find(p => p.id === period)?.label || "";

  /** أفضل الأصناف بالإيراد مع ربحها الفعلي بعد التكلفة. */
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; revenue: number; cost: number }
    >();
    scopedSales.forEach(sale =>
      sale.lines.forEach(line => {
        const entry = map.get(line.name) || {
          name: line.name,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
        entry.qty += line.qty;
        entry.revenue += line.qty * line.price;
        entry.cost += line.qty * (line.unitCost || 0);
        map.set(line.name, entry);
      })
    );
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [scopedSales]);

  /** المشتريات مجمّعة حسب المورد. */
  const bySupplier = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    scopedPurchases.forEach(p => {
      const entry = map.get(p.supplierName) || {
        name: p.supplierName,
        count: 0,
        total: 0,
      };
      entry.count += 1;
      entry.total += p.total;
      map.set(p.supplierName, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [scopedPurchases]);

  /** تقرير تكلفة الأصناف: المتوسط وآخر تكلفة وقيمة المخزون. */
  const costRows = useMemo(
    () =>
      state.products
        .filter(p => p.stock > 0 || p.avgCost > 0)
        .map(p => ({
          name: p.name,
          unit: p.unit,
          stock: p.stock,
          avgCost: p.avgCost,
          lastCost: p.lastCost,
          value: round2(p.stock * p.avgCost),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 40),
    [state.products]
  );

  const download = (rows: string[][], name: string) => {
    if (rows.length < 2) {
      toast.error("لا توجد بيانات في هذه الفترة");
      return;
    }
    const csv = rows
      .map(row => row.map(cell => JSON.stringify(cell)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل ملف التقرير");
  };

  const exportCsv = () => {
    if (tab === "purchases")
      return download(
        [
          ["رقم الفاتورة", "فاتورة المورد", "المورد", "التاريخ", "الإجمالي", "المدفوع", "المتبقي"],
          ...scopedPurchases.map(p => [
            String(p.no),
            p.supplierInvoiceNo || "",
            p.supplierName,
            new Date(p.at).toLocaleString("ar-EG"),
            String(p.total),
            String(p.paid),
            String(p.balance),
          ]),
        ],
        "تقرير-المشتريات"
      );
    if (tab === "costs")
      return download(
        [
          ["الصنف", "الوحدة", "الكمية", "متوسط التكلفة", "آخر تكلفة", "قيمة المخزون"],
          ...costRows.map(r => [
            r.name,
            r.unit,
            String(r.stock),
            String(r.avgCost),
            String(r.lastCost),
            String(r.value),
          ]),
        ],
        "تقرير-تكلفة-الأصناف"
      );
    if (tab === "expenses")
      return download(
        [
          ["التاريخ", "البند", "الوصف", "القيمة", "المرجع"],
          ...scopedExpenses.map(e => [
            new Date(e.at).toLocaleString("ar-EG"),
            EXPENSE_LABELS[e.category],
            e.description,
            String(e.amount),
            e.reference,
          ]),
        ],
        "تقرير-المصروفات"
      );
    if (tab === "profit")
      return download(
        [
          ["الصنف", "الكمية", "المبيعات", "التكلفة", "الربح"],
          ...topProducts.map(p => [
            p.name,
            String(p.qty),
            String(round2(p.revenue)),
            String(round2(p.cost)),
            String(round2(p.revenue - p.cost)),
          ]),
        ],
        "تقرير-الربح"
      );
    return download(
      [
        ["رقم الفاتورة", "التاريخ", "العميل", "الصنف", "الكمية", "السعر", "التكلفة", "الإجمالي"],
        ...scopedSales.flatMap(sale =>
          sale.lines.map(line => [
            String(sale.no),
            new Date(sale.at).toLocaleString("ar-EG"),
            sale.customer,
            line.name,
            String(line.qty),
            String(line.price),
            String(line.unitCost || 0),
            String(round2(line.qty * line.price)),
          ])
        ),
      ],
      "تقرير-المبيعات"
    );
  };

  const printReport = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة لطباعة التقرير");
      return;
    }
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 16px;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f2f6f2}.sum{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.sum div{border:1px solid #ddd;border-radius:8px;padding:10px 14px;font-size:12px;color:#666}.sum b{display:block;font-size:17px;color:#16352d;margin-top:3px}";
    const rows = topProducts
      .map(
        p =>
          `<tr><td>${p.name}</td><td>${p.qty}</td><td>${money(p.revenue)}</td><td>${money(p.cost)}</td><td>${money(p.revenue - p.cost)}</td></tr>`
      )
      .join("");
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>تقرير الربحية</title><style>${styles}</style></head><body><h1>دفتر الزراعة — تقرير الربحية</h1><p>الفترة: ${periodLabel} · طُبع في ${new Date().toLocaleString("ar-EG")}</p><div class="sum"><div>المبيعات<b>${money(profit.revenue)}</b></div><div>تكلفة البضاعة المباعة<b>${money(profit.cogs)}</b></div><div>إجمالي الربح<b>${money(profit.grossProfit)}</b></div><div>هامش الربح<b>${profit.margin}%</b></div><div>المصروفات<b>${money(profit.expenses)}</b></div><div>صافي الربح<b>${money(profit.netProfit)}</b></div><div>المشتريات<b>${money(purchasesSum)}</b></div><div>مستحق للموردين<b>${money(payables)}</b></div></div><table><thead><tr><th>الصنف</th><th>الكمية</th><th>المبيعات</th><th>التكلفة</th><th>الربح</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  const tabs: [typeof tab, string][] = [
    ["profit", "الربحية"],
    ["sales", "المبيعات"],
    ["purchases", "المشتريات"],
    ["costs", "تكلفة الأصناف"],
    ["expenses", "المصروفات"],
  ];

  return (
    <div className="report-board">
      <div className="report-summary">
        <div>
          <span className="eyebrow">مركز التقارير</span>
          <h2>قرار أوضح من أرقام مرتبة</h2>
          <p>كل الأرقام محسوبة من فواتيرك المحفوظة على هذا الجهاز.</p>
        </div>
        <div className="report-tools">
          <select
            className="category-select"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button className="outline-btn" onClick={printReport}>
            <Printer size={17} /> طباعة
          </button>
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={17} /> تصدير CSV
          </button>
        </div>
      </div>

      <div className="report-kpis">
        <div className="report-kpi sales-kpi">
          <div className="report-kpi-icon">
            <TrendingUp />
          </div>
          <span>المبيعات</span>
          <strong>{money(profit.revenue)}</strong>
          <em>
            {scopedSales.length} فاتورة خلال {periodLabel}
          </em>
        </div>
        <div className="report-kpi alert-kpi">
          <div className="report-kpi-icon">
            <ShoppingBag />
          </div>
          <span>تكلفة البضاعة المباعة</span>
          <strong>{money(profit.cogs)}</strong>
          <em>
            {profit.returnsTotal > 0
              ? `بعد مرتجعات ${money(profit.returnsTotal)}`
              : "محسوبة من تكلفة كل صنف وقت بيعه"}
          </em>
        </div>
        <div className="report-kpi profit-kpi">
          <div className="report-kpi-icon">
            <CircleDollarSign />
          </div>
          <span>إجمالي الربح</span>
          <strong>{money(profit.grossProfit)}</strong>
          <em>هامش {profit.margin}%</em>
        </div>
        <div
          className={
            profit.netProfit >= 0
              ? "report-kpi stock-kpi"
              : "report-kpi alert-kpi"
          }
        >
          <div className="report-kpi-icon">
            <Calculator />
          </div>
          <span>صافي الربح</span>
          <strong>{money(profit.netProfit)}</strong>
          <em>بعد مصروفات {money(profit.expenses)}</em>
        </div>
        <div className="report-kpi stock-kpi">
          <div className="report-kpi-icon">
            <Boxes />
          </div>
          <span>قيمة المخزون بالتكلفة</span>
          <strong>{money(stockValue)}</strong>
          <em>مستحق للموردين {money(payables)}</em>
        </div>
      </div>

      <div className="report-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profit" && (
        <ReportTable
          empty="لا توجد مبيعات في هذه الفترة"
          head={["الصنف", "الكمية", "المبيعات", "التكلفة", "الربح"]}
          rows={topProducts.map(p => [
            p.name,
            String(p.qty),
            money(p.revenue),
            money(p.cost),
            money(round2(p.revenue - p.cost)),
          ])}
        />
      )}
      {tab === "sales" && (
        <ReportTable
          empty="لا توجد مبيعات في هذه الفترة"
          head={["الفاتورة", "التاريخ", "العميل", "الإجمالي", "التكلفة", "الربح"]}
          rows={scopedSales
            .slice(0, 60)
            .map(sale => [
              `#${sale.no}`,
              new Date(sale.at).toLocaleDateString("ar-EG"),
              sale.customer,
              money(sale.total),
              money(sale.cogs || 0),
              money(round2(sale.total - (sale.cogs || 0))),
            ])}
        />
      )}
      {tab === "purchases" && (
        <>
          <ReportTable
            empty="لا توجد مشتريات في هذه الفترة"
            head={["الفاتورة", "المورد", "التاريخ", "الإجمالي", "المدفوع", "المتبقي"]}
            rows={scopedPurchases
              .slice(0, 60)
              .map(p => [
                `#${p.no}`,
                p.supplierName,
                new Date(p.at).toLocaleDateString("ar-EG"),
                money(p.total),
                money(p.paid),
                money(p.balance),
              ])}
          />
          {bySupplier.length > 0 && (
            <>
              <div className="report-section-label">
                <span className="eyebrow">حسب المورد</span>
                <b>إجمالي المشتريات لكل مورد</b>
              </div>
              <ReportTable
                empty=""
                head={["المورد", "عدد الفواتير", "الإجمالي"]}
                rows={bySupplier.map(s => [
                  s.name,
                  String(s.count),
                  money(s.total),
                ])}
              />
            </>
          )}
        </>
      )}
      {tab === "expenses" && (
        <ReportTable
          empty="لا توجد مصروفات في هذه الفترة"
          head={["التاريخ", "البند", "الوصف", "القيمة"]}
          rows={scopedExpenses.map(e => [
            new Date(e.at).toLocaleDateString("ar-EG"),
            EXPENSE_LABELS[e.category],
            e.description,
            money(e.amount),
          ])}
        />
      )}
      {tab === "costs" && (
        <ReportTable
          empty="لم تُسجل تكلفة لأي صنف بعد — سجّل فاتورة شراء"
          head={["الصنف", "الكمية", "متوسط التكلفة", "آخر تكلفة", "قيمة المخزون"]}
          rows={costRows.map(r => [
            r.name,
            `${r.stock} ${r.unit}`,
            money(r.avgCost),
            money(r.lastCost),
            money(r.value),
          ])}
        />
      )}
    </div>
  );
}

/** جدول تقرير موحّد الشكل مع حالة فارغة واضحة. */
function ReportTable({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: string[][];
  empty: string;
}) {
  if (!rows.length)
    return empty ? (
      <div className="empty-module">
        <div className="empty-illustration">
          <BarChart3 />
        </div>
        <h2>{empty}</h2>
        <p>ستظهر الأرقام هنا تلقائيًا بمجرد تسجيل العمليات.</p>
      </div>
    ) : null;

  return (
    <div className="panel table-panel">
      <div className="data-table">
        <table className="data-table">
          <thead>
            <tr>
              {head.map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersBoard({ sales }: { sales: Sale[] }) {
  const customers = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; total: number; last: string }
    >();
    sales.forEach(sale => {
      const entry = map.get(sale.customer) || {
        name: sale.customer,
        count: 0,
        total: 0,
        last: sale.at,
      };
      entry.count += 1;
      entry.total += sale.total;
      // الفواتير مرتبة من الأحدث، لذلك نحتفظ بأول تاريخ نراه لكل عميل.
      if (new Date(sale.at) > new Date(entry.last)) entry.last = sale.at;
      map.set(sale.customer, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [sales]);

  if (!customers.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <UsersRound />
        </div>
        <h2>لا يوجد عملاء بعد</h2>
        <p>اكتب اسم العميل عند تأكيد البيع وسيظهر سجله هنا تلقائيًا.</p>
      </div>
    );

  return (
    <div className="panel table-panel">
      <div className="ledger-list">
        {customers.map(customer => (
          <div className="ledger-row" key={customer.name}>
            <div className="ledger-mark">
              <UserRound size={18} />
            </div>
            <div className="ledger-main">
              <strong>{customer.name}</strong>
              <span>
                {customer.count} فاتورة · آخر تعامل{" "}
                {relativeTime(customer.last)}
              </span>
            </div>
            <div className="ledger-total">{money(customer.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** ملخص نقدي بسيط: ما دخل من البيع مقابل قيمة ما زال في المخزن. */
function AccountsBoard({ state }: { state: DbState }) {
  const now = new Date();
  const thisMonthSales = state.sales.filter(sale => {
    const date = new Date(sale.at);
    return (
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  });
  const all = netIncome(state, state.sales, state.expenses);
  const monthExpenses = state.expenses.filter(e => {
    const date = new Date(e.at);
    return (
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  });
  const month = netIncome(state, thisMonthSales, monthExpenses);
  const purchasesSum = purchasesTotal(state.purchases);
  const stockValue = inventoryValue(state);
  const payables = payablesTotal(state);

  return (
    <>
      <div className="report-kpis">
        <div className="report-kpi sales-kpi">
          <div className="report-kpi-icon">
            <TrendingUp />
          </div>
          <span>إجمالي المبيعات</span>
          <strong>{money(all.revenue)}</strong>
          <em>من {state.sales.length} فاتورة</em>
        </div>
        <div className="report-kpi alert-kpi">
          <div className="report-kpi-icon">
            <ShoppingBag />
          </div>
          <span>تكلفة البضاعة المباعة</span>
          <strong>{money(all.cogs)}</strong>
          <em>
            {all.returnsTotal > 0
              ? `بعد مرتجعات ${money(all.returnsTotal)}`
              : "مثبتة وقت كل عملية بيع"}
          </em>
        </div>
        <div className="report-kpi profit-kpi">
          <div className="report-kpi-icon">
            <CircleDollarSign />
          </div>
          <span>إجمالي الربح</span>
          <strong>{money(all.grossProfit)}</strong>
          <em>هامش {all.margin}%</em>
        </div>
        <div className="report-kpi alert-kpi">
          <div className="report-kpi-icon">
            <WalletCards />
          </div>
          <span>المصروفات التشغيلية</span>
          <strong>{money(all.expenses)}</strong>
          <em>{state.expenses.length} مصروف مسجل</em>
        </div>
        <div
          className={
            all.netProfit >= 0
              ? "report-kpi profit-kpi"
              : "report-kpi alert-kpi"
          }
        >
          <div className="report-kpi-icon">
            <Calculator />
          </div>
          <span>صافي الربح</span>
          <strong>{money(all.netProfit)}</strong>
          <em>
            {all.netProfit >= 0
              ? `هامش صافٍ ${all.netMargin}%`
              : "خسارة — راجع المصروفات"}
          </em>
        </div>
        <div className="report-kpi sales-kpi">
          <div className="report-kpi-icon">
            <CalendarDays />
          </div>
          <span>صافي ربح هذا الشهر</span>
          <strong>{money(month.netProfit)}</strong>
          <em>من مبيعات {money(month.revenue)}</em>
        </div>
        <div className="report-kpi stock-kpi">
          <div className="report-kpi-icon">
            <Boxes />
          </div>
          <span>قيمة المخزون بالتكلفة</span>
          <strong>{money(stockValue)}</strong>
          <em>{state.products.length} صنف</em>
        </div>
        <div className="report-kpi alert-kpi">
          <div className="report-kpi-icon">
            <Truck />
          </div>
          <span>مستحق للموردين</span>
          <strong>{money(payables)}</strong>
          <em>إجمالي مشتريات {money(purchasesSum)}</em>
        </div>
      </div>

      <div className="report-section-label">
        <span className="eyebrow">آخر حركات المخزون</span>
        <b>سجل لا يمكن تعديله يدويًا</b>
      </div>
      {state.stockMoves.length ? (
        <div className="panel table-panel">
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الصنف</th>
                  <th>الحركة</th>
                  <th>الكمية</th>
                  <th>قبل</th>
                  <th>بعد</th>
                  <th>التكلفة</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {state.stockMoves
                  .slice()
                  .reverse()
                  .slice(0, 40)
                  .map(move => (
                    <tr key={move.id}>
                      <td>{new Date(move.at).toLocaleDateString("ar-EG")}</td>
                      <td>{move.productName}</td>
                      <td>{MOVE_LABELS[move.type] || move.type}</td>
                      <td className={move.qty >= 0 ? "good-text" : "danger-text"}>
                        {move.qty > 0 ? `+${move.qty}` : move.qty}
                      </td>
                      <td>{move.qtyBefore}</td>
                      <td>{move.qtyAfter}</td>
                      <td>{money(move.unitCost)}</td>
                      <td>#{move.refNo}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel">
          <p style={{ margin: 0, fontSize: 13, color: "#7d8d84", lineHeight: 2 }}>
            لا توجد حركات مخزون بعد. كل عملية شراء أو بيع تسجل حركة تلقائيًا مع
            الكمية قبلها وبعدها وتكلفتها.
          </p>
        </div>
      )}


    </>
  );
}

function SupplierField({
  label,
  name,
  value,
  placeholder,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} defaultValue={value} placeholder={placeholder} />
    </label>
  );
}
