// Design: «سوق الحقل» — المخازن والفروع: رصيد مستقل لكل مكان.
//
// كيف يتوزع الرصيد:
//   product.stock  = الإجمالي في كل المخازن (ما تراه التقارير والتنبيهات)
//   رصيد المخزن    = مشتق من حركات المخزون، وهو المرجع عند البيع والصرف
//
// التكلفة تبقى متوسطًا مرجحًا واحدًا للصنف مهما تعددت المخازن، وهو العرف
// المحاسبي: لو اختلفت التكلفة بين مخزن وآخر لولّد التحويل بينهما ربحًا
// أو خسارة وهميين من غير بيع.
import type { DbState, Transfer, Warehouse } from "./types";
import {
  OperationError,
  defaultWarehouseId,
  recordMove,
  round2,
  warehouseStock,
} from "./operations";
import { nextId, nextNumber } from "./store";
import { requirePermission } from "./users";

function fail(message: string): never {
  throw new OperationError(message);
}

/** المخزن الافتراضي؛ يُنشأ تلقائيًا فلا يبقى النظام بلا مكان. */
export function defaultWarehouse(state: DbState): Warehouse | undefined {
  const list = state.warehouses || [];
  return list.find(w => w.isDefault && w.active) || list.find(w => w.active);
}

export { defaultWarehouseId };

/** يضمن وجود مخزن واحد على الأقل، ويعيد معرّفه. */
export function ensureWarehouse(state: DbState): number {
  if (!state.warehouses) state.warehouses = [];
  const existing = defaultWarehouse(state);
  if (existing) return existing.id;

  const created: Warehouse = {
    id: nextId(state.warehouses),
    name: "المخزن الرئيسي",
    note: "أُنشئ تلقائيًا",
    isDefault: true,
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.warehouses.push(created);
  return created.id;
}

export function createWarehouse(
  state: DbState,
  input: { name: string; note?: string; isDefault?: boolean }
): Warehouse {
  if (!state.warehouses) state.warehouses = [];

  const name = (input.name || "").trim();
  if (!name) fail("اسم المخزن مطلوب");
  if (
    state.warehouses.some(
      w => w.name.trim().toLowerCase() === name.toLowerCase()
    )
  )
    fail("يوجد مخزن بنفس الاسم");

  // أول مخزن افتراضي دائمًا، وإلا بقيت العمليات بلا وجهة.
  const isDefault = state.warehouses.length === 0 || !!input.isDefault;
  if (isDefault) state.warehouses.forEach(w => (w.isDefault = false));

  const warehouse: Warehouse = {
    id: nextId(state.warehouses),
    name,
    note: (input.note || "").trim(),
    isDefault,
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.warehouses.push(warehouse);
  return warehouse;
}

export function updateWarehouse(
  state: DbState,
  id: number,
  patch: Partial<Pick<Warehouse, "name" | "note" | "isDefault" | "active">>
): Warehouse {
  const warehouse = (state.warehouses || []).find(w => w.id === id);
  if (!warehouse) fail("المخزن غير موجود");

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم المخزن مطلوب");
    if (
      state.warehouses!.some(
        w => w.id !== id && w.name.trim().toLowerCase() === name.toLowerCase()
      )
    )
      fail("يوجد مخزن بنفس الاسم");
    warehouse.name = name;
  }

  if (patch.note !== undefined) warehouse.note = patch.note.trim();

  if (patch.isDefault) {
    state.warehouses!.forEach(w => (w.isDefault = false));
    warehouse.isDefault = true;
  }

  if (patch.active === false) {
    const others = state.warehouses!.filter(w => w.id !== id && w.active);
    if (!others.length) fail("لا يمكن تعطيل المخزن الوحيد");
    // المخزن الذي فيه بضاعة لا يُعطَّل، فالرصيد لا يختفي بإخفاء مكانه.
    if (warehouseHasStock(state, id))
      fail("لا يمكن تعطيل مخزن به رصيد؛ حوّل بضاعته أولًا");
    warehouse.active = false;
    if (warehouse.isDefault) {
      warehouse.isDefault = false;
      others[0].isDefault = true;
    }
  } else if (patch.active === true) {
    warehouse.active = true;
  }

  return warehouse;
}

/**
 * رصيد صنف في مخزن معيّن، مشتقًا من حركات المخزون.
 *
 * نشتقّه ولا نخزّنه: الرقم المخزَّن يتعارض مع الحركات عند أي خلل، والمشتق
 * يبقى صادقًا دائمًا لأنه يُحسب من نفس السجل الذي يراه المستخدم.
 */
export function stockAt(
  state: DbState,
  productId: number,
  warehouseId: number
) {
  // تعريف واحد للرصيد في operations.ts، فلا يختلف ما يراه البيع عما
  // تراه الشاشة. الافتراضي يأخذ الباقي بعد ما نُقل لغيره، والبقية
  // تُشتقّ من حركاتها.
  return warehouseStock(state, productId, warehouseId);
}

/** توزيع رصيد صنف على كل المخازن. */
export function stockByWarehouse(state: DbState, productId: number) {
  return (state.warehouses || [])
    .filter(w => w.active)
    .map(w => ({
      warehouseId: w.id,
      name: w.name,
      qty: stockAt(state, productId, w.id),
    }));
}

/** هل في المخزن رصيد من أي صنف؟ */
export function warehouseHasStock(state: DbState, warehouseId: number) {
  return state.products.some(p => stockAt(state, p.id, warehouseId) > 0.009);
}

/** ملخّص مخزن: كم صنفًا فيه وكم قيمته بالتكلفة. */
export function warehouseSummary(state: DbState, warehouseId: number) {
  let items = 0;
  let value = 0;
  state.products.forEach(p => {
    const qty = stockAt(state, p.id, warehouseId);
    if (qty > 0.009) {
      items++;
      value += qty * p.avgCost;
    }
  });
  return { items, value: round2(value) };
}

export type TransferInput = {
  fromWarehouseId: number;
  toWarehouseId: number;
  lines: { productId: number; qty: number }[];
  note?: string;
  at?: string;
};

/**
 * تحويل بضاعة بين مخزنين.
 *
 * لا قيد محاسبي هنا: البضاعة لم تخرج من ملكية المحل ولم تتغير تكلفتها،
 * فحساب المخزون في الدفاتر يبقى كما هو. الحركتان المخزنيتان وحدهما ما
 * يتغير، وهما ما يجيب «كم عندي في هذا الفرع؟».
 */
export function transferStock(
  state: DbState,
  input: TransferInput
): Transfer {
  if (!state.transfers) state.transfers = [];
  // نقل البضاعة بين الفروع تصرّف في المخزون، فيتبع صلاحية الجرد.
  requirePermission(state, "stockTake");

  const from = (state.warehouses || []).find(
    w => w.id === input.fromWarehouseId
  );
  const to = (state.warehouses || []).find(w => w.id === input.toWarehouseId);
  if (!from) fail("المخزن المُرسِل غير موجود");
  if (!to) fail("المخزن المستقبِل غير موجود");
  if (from.id === to.id) fail("اختر مخزنين مختلفين");
  if (!input.lines?.length) fail("أضف صنفًا واحدًا على الأقل");

  // نتحقق من كل السطور قبل أي كتابة، فلا يُنفَّذ تحويل نصفه صالح.
  const prepared = input.lines.map(raw => {
    const product = state.products.find(p => p.id === raw.productId);
    if (!product) fail("أحد الأصناف غير موجود");
    const qty = round2(Number(raw.qty));
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);

    const available = stockAt(state, product.id, from.id);
    if (qty > available)
      fail(
        `الرصيد المتاح من ${product.name} في ${from.name} هو ${available} فقط`
      );

    return { product, qty };
  });

  const at = input.at || new Date().toISOString();
  // البذرة 6999 ليبدأ أول تحويل من 7000.
  const no = nextNumber(state.transfers, 6999);

  prepared.forEach(({ product, qty }) => {
    recordMove(state, {
      productId: product.id,
      productName: product.name,
      type: "ADJUSTMENT",
      qty: -qty,
      unitCost: product.avgCost,
      refType: "transfer",
      refNo: no,
      at,
      note: `تحويل إلى ${to.name}`,
      warehouseId: from.id,
    });
    recordMove(state, {
      productId: product.id,
      productName: product.name,
      type: "ADJUSTMENT",
      qty,
      unitCost: product.avgCost,
      refType: "transfer",
      refNo: no,
      at,
      note: `تحويل من ${from.name}`,
      warehouseId: to.id,
    });
  });

  const transfer: Transfer = {
    no,
    at,
    fromWarehouseId: from.id,
    toWarehouseId: to.id,
    fromName: from.name,
    toName: to.name,
    lines: prepared.map(({ product, qty }) => ({
      productId: product.id,
      name: product.name,
      qty,
      unitCost: product.avgCost,
    })),
    total: round2(
      prepared.reduce((sum, { product, qty }) => sum + qty * product.avgCost, 0)
    ),
    note: (input.note || "").trim(),
    issuedBy:
      (state.users || []).find(u => u.id === state.currentUserId)?.name ||
      "غير محدد",
  };

  state.transfers.unshift(transfer);
  return transfer;
}

/** التحويلات من الأحدث، مع تصفية اختيارية بمخزن. */
export function transfersOf(state: DbState, warehouseId?: number) {
  return (state.transfers || [])
    .filter(
      t =>
        !warehouseId ||
        t.fromWarehouseId === warehouseId ||
        t.toWarehouseId === warehouseId
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
