// Design: «سوق الحقل» — نافذة تسجيل دفعة لمورد، بدل نافذة المتصفح الافتراضية.
import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import type { Purchase } from "../data/types";

type Props = {
  purchase: Purchase;
  money: (v: number) => string;
  onSubmit: (amount: number) => void;
};

export default function PaymentDialog({ purchase, money, onSubmit }: Props) {
  const [amount, setAmount] = useState("");
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
    onSubmit(value);
  };

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
        <span
          style={{
            fontSize: 11,
            color: "#7b9388",
            fontWeight: 700,
            display: "block",
            marginBottom: 5,
          }}
        >
          قيمة الدفعة
        </span>
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

      <div className="search-hint" style={{ marginTop: 8 }}>
        سيتبقى بعد هذه الدفعة: {money(remaining)}
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
