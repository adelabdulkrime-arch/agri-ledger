// Design: «سوق الحقل» — نافذة تسجيل دفعة لمورد، بدل نافذة المتصفح الافتراضية.
import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { INSTRUMENT_LABELS } from "../data/operations";
import type { PaymentInstrument, Purchase } from "../data/types";

type Props = {
  purchase: Purchase;
  money: (v: number) => string;
  onSubmit: (
    amount: number,
    instrument: PaymentInstrument,
    reference: string
  ) => void;
};

export default function PaymentDialog({ purchase, money, onSubmit }: Props) {
  const [amount, setAmount] = useState("");
  const [instrument, setInstrument] = useState<PaymentInstrument>("cash");
  const [reference, setReference] = useState("");
  const value = Number(amount) || 0;
  const remaining = Math.max(0, purchase.balance - value);

  const submit = () => {
    if (value <= 0) {
      toast.error("أدخل قيمة أكبر من صفر");
      return;
    }
    if (value > purchase.balance) {
      toast.error("الدفعة أكبر من المبلغ المتبقي");
      return;
    }
    onSubmit(value, instrument, reference.trim());
  };

  const labelStyle = {
    fontSize: 11,
    color: "#7b9388",
    fontWeight: 700,
    display: "block",
    marginBottom: 5,
  } as const;

  return (
    <div className="purchase-dialog">
      <div className="purchase-summary">
        <div>
          <span>إجمالي الفاتورة</span>
          <b>{money(purchase.total)}</b>
        </div>
        <div>
          <span>المدفوع سابقًا</span>
          <b>{money(purchase.paid)}</b>
        </div>
        <div className="grand">
          <span>المتبقي</span>
          <b>{money(purchase.balance)}</b>
        </div>
      </div>

      <label style={{ display: "block", marginTop: 6 }}>
        <span style={labelStyle}>قيمة الدفعة</span>
        <input
          className="plain-input"
          type="number"
          min={0}
          max={purchase.balance}
          step="any"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0"
          autoFocus
        />
      </label>

      <label style={{ display: "block", marginTop: 10 }}>
        <span style={labelStyle}>أداة الدفع</span>
        <select
          className="category-select"
          style={{ width: "100%" }}
          value={instrument}
          onChange={e => setInstrument(e.target.value as PaymentInstrument)}
        >
          {(
            Object.keys(INSTRUMENT_LABELS) as PaymentInstrument[]
          ).map(key => (
            <option key={key} value={key}>
              {INSTRUMENT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {instrument !== "cash" && (
        <label style={{ display: "block", marginTop: 10 }}>
          <span style={labelStyle}>رقم الشيك أو الحوالة</span>
          <input
            className="plain-input"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="اختياري"
          />
        </label>
      )}

      <div className="search-hint" style={{ marginTop: 8 }}>
        {instrument === "cash"
          ? `سيتبقى بعد هذه الدفعة: ${money(remaining)}`
          : `تخرج من حساب البنك لا من الصندوق · المتبقي: ${money(remaining)}`}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="outline-btn"
          style={{ flex: 1, justifyContent: "center" }}
          onClick={() => setAmount(String(purchase.balance))}
        >
          سداد كامل
        </button>
        <button
          className="primary-btn"
          style={{ flex: 2, justifyContent: "center" }}
          onClick={submit}
        >
          <Check size={18} /> تسجيل الدفعة
        </button>
      </div>
    </div>
  );
}
