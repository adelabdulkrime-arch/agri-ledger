// Design: «OneMedia24 ERP» — حجز الكميات لأوامر البيع.
//
// المبدأ: الحجز ليس حركة مخزنية. البضاعة ما زالت في المخزن ولم تخرج،
// فرصيدها الفعلي وتكلفتها لا يتغيران. ما يتغير هو «المتاح للبيع»:
//
//   المتاح = الرصيد الفعلي − المحجوز لأوامر أخرى
//
// بدون هذا يبيع فرعان البضاعة نفسها لعميلين مختلفين، ولا يُكتشف
// العجز إلا عند التسليم — وحينها يكون المحل قد وعد بما لا يملك.
import type { DbState, Reservation } from "./types";
import { OperationError, defaultWarehouseId, round2, warehouseStock } from "./operations";
import { nextId } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** الحجوزات السارية لصنف، اختيارًا في مخزن بعينه. */
export function activeReservations(
  state: DbState,
  productId?: number,
  warehouseId?: number
) {
  const fallback = defaultWarehouseId(state);
  return (state.reservations || []).filter(r => {
    if (r.released) return false;
    if (productId !== undefined && r.productId !== productId) return false;
    if (warehouseId !== undefined) {
      // الحجوزات القديمة بلا مخزن تخصّ المخزن الافتراضي.
      if ((r.warehouseId ?? fallback) !== warehouseId) return false;
    }
    return true;
  });
}

/** إجمالي المحجوز من صنف في مخزن. */
export function reservedQty(
  state: DbState,
  productId: number,
  warehouseId?: number
) {
  return round2(
    activeReservations(state, productId, warehouseId).reduce(
      (sum, r) => sum + r.qty,
      0
    )
  );
}

/**
 * المتاح للبيع: الفعلي ناقص المحجوز.
 *
 * هذا هو الرقم الذي يجب أن يُقاس عليه البيع، لا الرصيد الفعلي، وإلا
 * بيعت بضاعة موعودة لعميل آخر.
 */
export function availableQty(
  state: DbState,
  productId: number,
  warehouseId?: number
) {
  const where = warehouseId ?? defaultWarehouseId(state);
  const physical = where
    ? warehouseStock(state, productId, where)
    : state.products.find(p => p.id === productId)?.stock || 0;
  return round2(physical - reservedQty(state, productId, where));
}

/**
 * يحجز كميات أمر بيع.
 *
 * يتحقق من المتاح لا الفعلي: أمران يحجزان نفس البضاعة مرفوض الثاني
 * منهما. والتحقق يسبق أي كتابة، فلا يُنفَّذ حجز نصفه صالح.
 */
export function reserveForDraft(
  state: DbState,
  draftNo: number,
  lines: { productId: number; qty: number }[],
  warehouseId?: number
): Reservation[] {
  if (!state.reservations) state.reservations = [];
  if (!lines?.length) fail("لا أصناف للحجز");

  const where = warehouseId ?? defaultWarehouseId(state);

  // التحقق أولًا لكل السطور، ثم الكتابة: لا حجز نصفه صالح.
  const prepared = lines.map(line => {
    const product = state.products.find(p => p.id === line.productId);
    if (!product) fail("الصنف غير موجود");
    const qty = round2(Number(line.qty));
    if (!Number.isFinite(qty) || qty <= 0)
      fail(`الكمية يجب أن تكون أكبر من صفر: ${product.name}`);

    const free = availableQty(state, product.id, where);
    if (qty > free)
      fail(
        `المتاح للبيع من ${product.name} هو ${free} ${product.unit} (الباقي محجوز لأوامر أخرى)`
      );
    return { product, qty };
  });

  const at = new Date().toISOString();
  return prepared.map(({ product, qty }) => {
    const reservation: Reservation = {
      id: nextId(state.reservations!),
      draftNo,
      productId: product.id,
      productName: product.name,
      qty,
      warehouseId: where,
      at,
      released: false,
    };
    state.reservations!.push(reservation);
    return reservation;
  });
}

/**
 * يحرّر حجوزات أمر بيع.
 *
 * التحرير لا يحذف السجل بل يعلّمه: يبقى أثر من حجز وكم ومتى ولماذا
 * تحرّر، فالحذف يمحو تاريخًا قد يُسأل عنه.
 */
export function releaseForDraft(
  state: DbState,
  draftNo: number,
  reason = "تحويل إلى فاتورة"
): number {
  const rows = (state.reservations || []).filter(
    r => r.draftNo === draftNo && !r.released
  );
  const at = new Date().toISOString();
  rows.forEach(r => {
    r.released = true;
    r.releasedAt = at;
    r.releaseReason = reason;
  });
  return rows.length;
}

/** ملخّص المحجوز لكل صنف، للعرض في شاشة المخزون. */
export function reservationSummary(state: DbState) {
  const map = new Map<number, { name: string; qty: number; orders: number }>();
  activeReservations(state).forEach(r => {
    const row = map.get(r.productId);
    if (row) {
      row.qty = round2(row.qty + r.qty);
      row.orders++;
    } else {
      map.set(r.productId, {
        name: r.productName,
        qty: r.qty,
        orders: 1,
      });
    }
  });
  return Array.from(map.entries())
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.qty - a.qty);
}
