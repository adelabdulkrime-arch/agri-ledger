// Design: «سوق الحقل» — قوائم الأسعار ومراكز التكلفة.
//
// قائمة الأسعار لا تغيّر سعر الصنف الأصلي: هي تسعيرة بديلة لفئة عملاء
// (جملة، مزارع كبيرة)، تُقترح عند البيع لمن ارتبط بها. إبقاء السعر
// الأصلي كما هو يجعل الرجوع للتسعيرة العادية بلا خطوات.
import type { CostCenter, DbState, PriceList } from "./types";
import { OperationError, round2 } from "./operations";
import { nextId } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

// --------------------------------------------------------- قوائم الأسعار

export function createPriceList(
  state: DbState,
  input: { name: string; note?: string }
): PriceList {
  if (!state.priceLists) state.priceLists = [];

  const name = (input.name || "").trim();
  if (!name) fail("اسم القائمة مطلوب");
  if (
    state.priceLists.some(
      l => l.name.trim().toLowerCase() === name.toLowerCase()
    )
  )
    fail("توجد قائمة بنفس الاسم");

  const list: PriceList = {
    id: nextId(state.priceLists),
    name,
    note: (input.note || "").trim(),
    active: true,
    items: [],
    createdAt: new Date().toISOString(),
  };
  state.priceLists.push(list);
  return list;
}

export function updatePriceList(
  state: DbState,
  id: number,
  patch: Partial<Pick<PriceList, "name" | "note" | "active">>
): PriceList {
  const list = (state.priceLists || []).find(l => l.id === id);
  if (!list) fail("القائمة غير موجودة");

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم القائمة مطلوب");
    if (
      state.priceLists!.some(
        l => l.id !== id && l.name.trim().toLowerCase() === name.toLowerCase()
      )
    )
      fail("توجد قائمة بنفس الاسم");
    list.name = name;
  }
  if (patch.note !== undefined) list.note = patch.note.trim();
  if (patch.active !== undefined) list.active = patch.active;
  return list;
}

/** يضبط سعر صنف في قائمة؛ السعر صفرًا يزيله فيعود للسعر المعتاد. */
export function setListPrice(
  state: DbState,
  listId: number,
  productId: number,
  price: number
): PriceList {
  const list = (state.priceLists || []).find(l => l.id === listId);
  if (!list) fail("القائمة غير موجودة");
  if (!state.products.some(p => p.id === productId))
    fail("الصنف غير موجود");

  const value = round2(Number(price));
  if (!Number.isFinite(value) || value < 0)
    fail("السعر لا يصح أن يكون سالبًا");

  const existing = list.items.find(i => i.productId === productId);
  if (value === 0) {
    list.items = list.items.filter(i => i.productId !== productId);
    return list;
  }
  if (existing) existing.price = value;
  else list.items.push({ productId, price: value });
  return list;
}

/**
 * سعر الصنف في قائمة معينة، أو سعره المعتاد إن لم يُذكر فيها.
 * هذا ما يجعل القائمة استثناءً لا بديلًا كاملًا يجب ملؤه صنفًا صنفًا.
 */
export function priceFor(
  state: DbState,
  productId: number,
  listId?: number
): number {
  const product = state.products.find(p => p.id === productId);
  if (!product) return 0;
  if (!listId) return product.price;

  const list = (state.priceLists || []).find(
    l => l.id === listId && l.active
  );
  const item = list?.items.find(i => i.productId === productId);
  return item ? item.price : product.price;
}

/** كم صنفًا سُعِّر في القائمة، وكم متوسط الفرق عن السعر المعتاد. */
export function priceListSummary(state: DbState, listId: number) {
  const list = (state.priceLists || []).find(l => l.id === listId);
  if (!list) return { items: 0, avgDiff: 0 };

  let diff = 0;
  let counted = 0;
  list.items.forEach(item => {
    const product = state.products.find(p => p.id === item.productId);
    if (!product || !product.price) return;
    diff += ((item.price - product.price) / product.price) * 100;
    counted++;
  });

  return {
    items: list.items.length,
    avgDiff: counted ? round2(diff / counted) : 0,
  };
}

// -------------------------------------------------------- مراكز التكلفة

export function createCostCenter(
  state: DbState,
  input: { name: string; note?: string }
): CostCenter {
  if (!state.costCenters) state.costCenters = [];

  const name = (input.name || "").trim();
  if (!name) fail("اسم مركز التكلفة مطلوب");
  if (
    state.costCenters.some(
      c => c.name.trim().toLowerCase() === name.toLowerCase()
    )
  )
    fail("يوجد مركز بنفس الاسم");

  const center: CostCenter = {
    id: nextId(state.costCenters),
    name,
    note: (input.note || "").trim(),
    active: true,
  };
  state.costCenters.push(center);
  return center;
}

export function updateCostCenter(
  state: DbState,
  id: number,
  patch: Partial<Pick<CostCenter, "name" | "note" | "active">>
): CostCenter {
  const center = (state.costCenters || []).find(c => c.id === id);
  if (!center) fail("مركز التكلفة غير موجود");

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم مركز التكلفة مطلوب");
    if (
      state.costCenters!.some(
        c => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase()
      )
    )
      fail("يوجد مركز بنفس الاسم");
    center.name = name;
  }
  if (patch.note !== undefined) center.note = patch.note.trim();
  if (patch.active !== undefined) center.active = patch.active;
  return center;
}

/**
 * توزيع المصروفات على مراكز التكلفة خلال فترة.
 *
 * حدٌّ واضح: المصروفات وحدها ما يُنسب هنا، لا كل قيد في الدفاتر.
 * هذا ما يحتاجه المحل فعلًا — «كم أنفق كل فرع؟» — دون إثقال كل عملية
 * بيع وشراء بحقل إضافي يُنسى ملؤه فيصير التقرير ناقصًا بلا أن يُدرى.
 */
export function expensesByCostCenter(
  state: DbState,
  filter: { from?: Date; to?: Date } = {}
) {
  const rows = (state.expenses || []).filter(e => {
    const at = new Date(e.at);
    if (filter.from && at < filter.from) return false;
    if (filter.to && at > filter.to) return false;
    return true;
  });

  const centers = state.costCenters || [];
  const buckets = centers.map(c => ({
    id: c.id,
    name: c.name,
    total: 0,
    count: 0,
  }));
  // غير المنسوب يظهر مستقلًا بدل أن يختفي من المجموع.
  const unassigned = { id: 0, name: "غير منسوب", total: 0, count: 0 };

  rows.forEach(e => {
    const bucket =
      buckets.find(b => b.id === e.costCenterId) || unassigned;
    bucket.total = round2(bucket.total + e.amount);
    bucket.count++;
  });

  const all = [...buckets, unassigned].filter(b => b.count > 0);
  const total = round2(all.reduce((sum, b) => sum + b.total, 0));

  return {
    rows: all.sort((a, b) => b.total - a.total),
    total,
  };
}
