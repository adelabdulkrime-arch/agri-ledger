// Design: «سوق الحقل» — طبقة تخزين واحدة بمعاملات ذرية وترقيات مخطط.
// الهدف: ألا يُكتب نصف تغيير أبدًا (فاتورة دون مخزون، أو مخزون دون فاتورة).
import type { DbState, Product } from "./types";

export const DB_KEY = "agri-db";
export const SCHEMA_VERSION = 10;

/** المفاتيح القديمة قبل توحيد التخزين؛ نقرأ منها مرة واحدة ثم نتركها كنسخة أمان. */
const LEGACY_PRODUCTS = "agri-products";
const LEGACY_SALES = "agri-sales";

export function emptyState(): DbState {
  return {
    version: SCHEMA_VERSION,
    products: [],
    sales: [],
    suppliers: [],
    purchases: [],
    stockMoves: [],
    supplierLedger: [],
    returns: [],
    expenses: [],
    customers: [],
    customerLedger: [],
    accounts: [],
    journal: [],
    closedPeriods: [],
  };
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * ترقيات المخطط. كل ترقية تضيف ما ينقص فقط ولا تحذف بيانات المستخدم.
 * تعمل تصاعديًا حتى تصل إلى SCHEMA_VERSION الحالي.
 */
export function migrate(input: any): DbState {
  const state: any = { ...emptyState(), ...(input || {}) };
  let version = toNumber(state.version, 1);

  // 1 -> 2: توحيد المفاتيح المنفصلة وإضافة حقول التكلفة للمنتجات وبنود البيع.
  if (version < 2) {
    state.products = (state.products || []).map((p: any) => ({
      ...p,
      avgCost: toNumber(p.avgCost, 0),
      lastCost: toNumber(p.lastCost, 0),
    }));
    state.sales = (state.sales || []).map((sale: any) => {
      const lines = (sale.lines || []).map((line: any) => ({
        ...line,
        // الفواتير القديمة لا تحمل تكلفة؛ نتركها صفرًا بدل اختراع رقم يزيّف الربح.
        unitCost: toNumber(line.unitCost, 0),
      }));
      return {
        ...sale,
        lines,
        cogs: toNumber(
          sale.cogs,
          lines.reduce(
            (sum: number, l: any) => sum + toNumber(l.unitCost) * toNumber(l.qty),
            0
          )
        ),
      };
    });
    version = 2;
  }

  // 2 -> 3: جداول الموردين والمشتريات وحركات المخزون وكشف الحساب.
  if (version < 3) {
    state.suppliers = state.suppliers || [];
    state.purchases = state.purchases || [];
    state.stockMoves = state.stockMoves || [];
    state.supplierLedger = state.supplierLedger || [];
    version = 3;
  }

  // 3 -> 4: المرتجعات (بيع وشراء).
  if (version < 4) {
    state.returns = state.returns || [];
    version = 4;
  }

  // 4 -> 5: المصروفات التشغيلية لحساب صافي الربح.
  if (version < 5) {
    state.expenses = state.expenses || [];
    version = 5;
  }

  // 5 -> 6: حد إعادة الطلب وتاريخ الصلاحية (اختياريان لكل صنف).
  if (version < 6) {
    state.products = (state.products || []).map((p: any) => ({
      ...p,
      // القيم الافتراضية غير مفروضة: الحد الافتراضي 8 هو ما يستخدمه النظام حاليًا.
      reorderLevel: typeof p.reorderLevel === "number" ? p.reorderLevel : 8,
      expiryDate: p.expiryDate || "",
    }));
    version = 6;
  }

  // 6 -> 7: وحدات بيع بديلة وباركودات إضافية (اختيارية لكل صنف).
  if (version < 7) {
    state.products = (state.products || []).map((p: any) => ({
      ...p,
      units: Array.isArray(p.units) ? p.units : [],
      altBarcodes: Array.isArray(p.altBarcodes) ? p.altBarcodes : [],
    }));
    version = 7;
  }

  // 7 -> 8: تصفير الأرصدة الابتدائية الوهمية.
  // أصناف الكتالوج كانت تُشحن برصيد وتكلفة صفر، فيخلط المتوسط المرجح
  // كميات مجانية مع مشتريات حقيقية ويظهر الربح أعلى من الواقع.
  // نصفّر فقط الأصناف التي لم تدخل في أي حركة مخزون، حتى لا نمسّ
  // بيانات مستخدم سجّل مشترياته فعلًا.
  if (version < 8) {
    const touched = new Set(
      (state.stockMoves || []).map((m: any) => m.productId)
    );
    state.products = (state.products || []).map((p: any) =>
      touched.has(p.id)
        ? p
        : { ...p, stock: 0, avgCost: 0, lastCost: 0 }
    );
    version = 8;
  }

  // 8 -> 9: سجل العملاء ودفتر أستاذهم (نقدي/آجل).
  if (version < 9) {
    state.customers = state.customers || [];
    state.customerLedger = state.customerLedger || [];
    version = 9;
  }

  // 9 -> 10: دليل الحسابات وقيود اليومية والفترات المقفلة.
  if (version < 10) {
    state.accounts = state.accounts || [];
    state.journal = state.journal || [];
    state.closedPeriods = state.closedPeriods || [];
    version = 10;
  }

  state.version = version;
  return state as DbState;
}

/** نتيجة القراءة مع بيان هل جرى تعافٍ من ملف تالف. */
export type LoadResult = { state: DbState; recovered: boolean };

function readKey(key: string): any {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // نتحقق من الشكل لا من صحة JSON فقط: ملف بلا products ليس حالتنا.
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.products)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** يقرأ الحالة، وينقل البيانات من المفاتيح القديمة عند أول تشغيل بعد التحديث. */
export function loadState(seedProducts: Product[] = []): DbState {
  return loadStateSafe(seedProducts).state;
}

/**
 * القراءة مع التعافي: إذا تلف الملف الأساسي نرجع لنسخة الأمان
 * بدل بدء المحل من الصفر وفقدان سجل كامل.
 */
export function loadStateSafe(seedProducts: Product[] = []): LoadResult {
  let raw: any = readKey(DB_KEY);
  let recovered = false;

  if (!raw) {
    const snapshot = readKey(SNAPSHOT_KEY);
    if (snapshot) {
      raw = snapshot;
      recovered = true;
    }
  }

  if (!raw) {
    // لا توجد قاعدة موحدة بعد: نجمع ما كان محفوظًا بالمفاتيح المنفصلة.
    let products: any[] = [];
    let sales: any[] = [];
    try {
      const p = JSON.parse(localStorage.getItem(LEGACY_PRODUCTS) || "null");
      if (Array.isArray(p)) products = p;
    } catch {
      /* تجاهل: نبدأ من الكتالوج */
    }
    try {
      const s = JSON.parse(localStorage.getItem(LEGACY_SALES) || "null");
      if (Array.isArray(s)) sales = s;
    } catch {
      /* تجاهل: نبدأ بسجل مبيعات فارغ */
    }
    raw = { version: 1, products, sales };
  }

  const state = migrate(raw);
  if (!state.products.length && seedProducts.length)
    state.products = seedProducts;
  return { state, recovered };
}

/** فشل الكتابة على القرص؛ يُميَّز عن أخطاء العمل لأن علاجه مختلف. */
export class StorageError extends Error {}

/** مفتاح نسخة الأمان الأخيرة الناجحة، للتعافي من ملف تالف. */
export const SNAPSHOT_KEY = "agri-db-snapshot";

export function saveState(state: DbState) {
  let payload: string;
  try {
    payload = JSON.stringify(state);
  } catch {
    throw new StorageError("تعذر تجهيز البيانات للحفظ");
  }

  try {
    localStorage.setItem(DB_KEY, payload);
  } catch (error: any) {
    // الامتلاء هو السبب الغالب؛ نميّزه برسالة تقول للمستخدم ماذا يفعل.
    const quota =
      error?.name === "QuotaExceededError" ||
      error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error?.code === 22;
    throw new StorageError(
      quota
        ? "ذاكرة الجهاز ممتلئة. صدّر نسخة احتياطية ثم احذف بيانات قديمة قبل المتابعة."
        : "تعذر الحفظ على هذا الجهاز. تأكد أن المتصفح يسمح بتخزين البيانات."
    );
  }
}

/**
 * يحفظ نسخة أمان من آخر حالة سليمة.
 * تُستخدم للتعافي إذا تلف الملف الأساسي، ونتجاهل فشلها لأنها رفاهية لا شرط.
 */
export function saveSnapshot(state: DbState) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state));
  } catch {
    // نسخة الأمان أول ما يُضحى به عند ضيق المساحة.
  }
}

/** حجم البيانات المحفوظة بالكيلوبايت، لعرض مؤشر الامتلاء. */
export function storageUsage() {
  try {
    const main = localStorage.getItem(DB_KEY)?.length || 0;
    const snap = localStorage.getItem(SNAPSHOT_KEY)?.length || 0;
    // المتصفحات تحسب الحرف بـ2 بايت (UTF-16).
    const usedKb = Math.round(((main + snap) * 2) / 1024);
    // الحد الشائع 5 ميجابايت؛ نحذّر قبل بلوغه بوقت كافٍ.
    const limitKb = 5120;
    return {
      usedKb,
      limitKb,
      percent: Math.min(100, Math.round((usedKb / limitKb) * 100)),
    };
  } catch {
    return { usedKb: 0, limitKb: 5120, percent: 0 };
  }
}

/**
 * ينفذ تغييرًا على نسخة من الحالة ويحفظها دفعة واحدة.
 * إذا رمى `mutator` خطأ لا يُحفظ شيء، فتبقى البيانات كما كانت قبل العملية.
 */
export function transact(
  state: DbState,
  mutator: (draft: DbState) => void
): DbState {
  const draft: DbState = JSON.parse(JSON.stringify(state));
  mutator(draft);
  // الحفظ قد يفشل (ذاكرة ممتلئة)؛ عندها يُرمى الخطأ ولا تُعتمد النسخة الجديدة،
  // فتبقى الحالة السابقة سليمة في الذاكرة وعلى القرص معًا.
  saveState(draft);
  // بعد نجاح الكتابة فقط نحدّث نسخة الأمان.
  saveSnapshot(draft);
  return draft;
}

/** رقم تسلسلي لا يتكرر، مشتق من أعلى رقم موجود. */
export function nextNumber(items: { no: number }[], start: number) {
  return items.reduce((max, item) => Math.max(max, item.no), start) + 1;
}

export function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
