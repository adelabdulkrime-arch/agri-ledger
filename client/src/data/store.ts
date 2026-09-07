// Design: «سوق الحقل» — طبقة تخزين واحدة بمعاملات ذرية وترقيات مخطط.
// الهدف: ألا يُكتب نصف تغيير أبدًا (فاتورة دون مخزون، أو مخزون دون فاتورة).
import type { DbState, Product } from "./types";

export const DB_KEY = "agri-db";
export const SCHEMA_VERSION = 3;

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

  state.version = version;
  return state as DbState;
}

/** يقرأ الحالة، وينقل البيانات من المفاتيح القديمة عند أول تشغيل بعد التحديث. */
export function loadState(seedProducts: Product[] = []): DbState {
  let raw: any = null;
  try {
    raw = JSON.parse(localStorage.getItem(DB_KEY) || "null");
  } catch {
    raw = null;
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
  return state;
}

export function saveState(state: DbState) {
  localStorage.setItem(DB_KEY, JSON.stringify(state));
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
  saveState(draft);
  return draft;
}

/** رقم تسلسلي لا يتكرر، مشتق من أعلى رقم موجود. */
export function nextNumber(items: { no: number }[], start: number) {
  return items.reduce((max, item) => Math.max(max, item.no), start) + 1;
}

export function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}
