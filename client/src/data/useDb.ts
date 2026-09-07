// Design: «سوق الحقل» — ربط المخزن الموحّد بواجهة React.
// كل تغيير يمر عبر معاملة واحدة، فلا تُحفظ نصف عملية أبدًا.
import { useCallback, useRef, useState } from "react";
import { loadState, saveState, transact } from "./store";
import { OperationError } from "./operations";
import type { DbState, Product } from "./types";

/**
 * يدمج كتالوج التطبيق مع منتجات المستخدم المحفوظة دون حذف أي صنف أضافه،
 * ويضمن أن كل صنف يحمل باركودًا وحقول تكلفة.
 */
function mergeCatalog(saved: Product[], catalog: Product[]): Product[] {
  const normalized = saved.map((p, i) => ({
    ...p,
    barcode: p.barcode || `62810000000${i + 1}`,
    avgCost: Number(p.avgCost) || 0,
    lastCost: Number(p.lastCost) || 0,
  }));
  const names = new Set(normalized.map(p => p.name.trim().toLowerCase()));
  const barcodes = new Set(normalized.map(p => p.barcode));
  const additions = catalog.filter(
    p => !names.has(p.name.trim().toLowerCase()) && !barcodes.has(p.barcode)
  );
  return [...normalized, ...additions];
}

export function useDb(catalog: Product[]) {
  const [state, setState] = useState<DbState>(() => {
    const loaded = loadState();
    const merged = mergeCatalog(loaded.products, catalog);
    const next = { ...loaded, products: merged };
    saveState(next);
    return next;
  });
  // المرجع يحمل أحدث حالة دائمًا، حتى تُنفذ العمليات المتتابعة على بيانات صحيحة
  // دون انتظار إعادة رسم React.
  const latest = useRef(state);
  latest.current = state;

  /**
   * ينفذ عملية ويحفظها فورًا. عند رمي OperationError لا يُحفظ ولا يتغير شيء،
   * ويُعاد الخطأ للمستدعي ليعرض رسالة مفهومة للمستخدم.
   */
  const run = useCallback(<T,>(mutator: (draft: DbState) => T): T => {
    let result!: T;
    const next = transact(latest.current, draft => {
      result = mutator(draft);
    });
    latest.current = next;
    setState(next);
    return result;
  }, []);

  /** يستبدل الحالة بالكامل، للاستعادة من نسخة احتياطية. */
  const replace = useCallback((next: DbState) => {
    saveState(next);
    latest.current = next;
    setState(next);
  }, []);

  return { state, run, replace, OperationError };
}
