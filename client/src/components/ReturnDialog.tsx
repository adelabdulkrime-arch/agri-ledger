// Design: «سوق الحقل» — نافذة مرتجع: تعرض بنود الفاتورة الأصلية
// وتسمح بتحديد الكمية المرتجعة لكل صنف، مع بيان المتاح للإرجاع.
import { useMemo, useState } from "react";
import { Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { returnedQuantities, round2 } from "../data/operations";
import type { DbState, Purchase, ReturnKind, Sale } from "../data/types";

type Props = {
  state: DbState;
  kind: ReturnKind;
  source: Sale | Purchase;
  money: (v: number) => string;
  onSubmit: (input: {
    refNo: number;
    reason: string;
    lines: { productId: number; qty: number }[];
  }) => void;
};

export default function ReturnDialog({
  state,
  kind,
  source,
  money,
  onSubmit,
}: Props) {
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});

  /** بنود الفاتورة موحّدة الشكل مهما كان نوعها، مع المتبقي القابل للإرجاع. */
  const rows = useMemo(() => {
    const already = returnedQuantities(state, kind, source.no);
    if (kind === "sale") {
      return (source as Sale).lines.map(line => ({
        productId: line.id,
        name: line.name,
        unit: line.unit,
        price: line.price,
        sold: line.qty,
        remaining: round2(line.qty - (already.get(line.id) || 0)),
      }));
    }
    return (source as Purchase).lines.map(line => ({
      productId: line.productId,
      name: line.name,
      unit: line.unit,
      price: round2(line.total / line.qty),
      sold: line.qty,
      remaining: round2(line.qty - (already.get(line.productId) || 0)),
    }));
  }, [state, kind, source]);

  const total = useMemo(
    () =>
      round2(
        rows.reduce(
          (sum, row) => sum + (Number(quantities[row.productId]) || 0) * row.price,
          0
        )
      ),
    [rows, quantities]
  );

  const submit = () => {
    const lines = rows
      .map(row => ({
        productId: row.productId,
        qty: Number(quantities[row.productId]) || 0,
      }))
      .filter(line => line.qty > 0);
    if (!lines.length) {
      toast.error("حدد كمية لصنف واحد على الأقل");
      return;
    }
    onSubmit({ refNo: source.no, reason, lines });
  };

  const allReturned = rows.every(row => row.remaining <= 0);

  return (
    <div className="purchase-dialog">
      <div className="return-head">
        <Undo2 size={18} />
        <span>
          {kind === "sale" ? "مرتجع بيع من فاتورة" : "مرتجع شراء من فاتورة"} #
          {source.no} ·{" "}
          {kind === "sale"
            ? (source as Sale).customer
            : (source as Purchase).supplierName}
        </span>
      </div>

      {allReturned ? (
        <div className="empty-cart">
          <span>تم إرجاع كل أصناف هذه الفاتورة بالفعل</span>
        </div>
      ) : (
        <>
          <div className="purchase-lines">
            {rows.map(row => (
              <div className="return-line" key={row.productId}>
                <div className="purchase-line-name">
                  <b>{row.name}</b>
                  <small>
                    {kind === "sale" ? "مباع" : "مشترى"} {row.sold} {row.unit} ·{" "}
                    {money(row.price)}
                  </small>
                </div>
                <label>
                  <span>المتاح {row.remaining}</span>
                  <input
                    type="number"
                    min={0}
                    max={row.remaining}
                    step="any"
                    disabled={row.remaining <= 0}
                    value={quantities[row.productId] ?? ""}
                    placeholder="0"
                    onChange={e =>
                      setQuantities(prev => ({
                        ...prev,
                        [row.productId]: e.target.value,
                      }))
                    }
                  />
                </label>
                <strong className="purchase-line-total">
                  {money(
                    round2(
                      (Number(quantities[row.productId]) || 0) * row.price
                    )
                  )}
                </strong>
              </div>
            ))}
          </div>

          <div className="purchase-summary">
            <div className="grand">
              <span>قيمة المرتجع</span>
              <b>{money(total)}</b>
            </div>
          </div>

          <input
            className="plain-input"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="سبب الإرجاع (اختياري)"
          />

          <button
            className="primary-btn full"
            style={{ marginTop: 12 }}
            onClick={submit}
          >
            <Check size={18} />{" "}
            {kind === "sale"
              ? "تأكيد المرتجع وإعادة الكمية للمخزن"
              : "تأكيد المرتجع وخصم الكمية"}
          </button>
        </>
      )}
    </div>
  );
}
