// Design: «سوق الحقل» — المصروفات التشغيلية: تسجيل سريع وملخص حسب البند.
import { useMemo, useState } from "react";
import { Download, Plus, Trash2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import {
  EXPENSE_LABELS,
  expensesByCategory,
  expensesTotal,
} from "../data/operations";
import type { DbState, Expense, ExpenseCategory } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
  onDelete: (expense: Expense) => void;
};

const ranges = [
  { id: "month", label: "هذا الشهر", days: 30 },
  { id: "quarter", label: "آخر ٩٠ يومًا", days: 90 },
  { id: "year", label: "آخر سنة", days: 365 },
  { id: "all", label: "كل الفترات", days: null as number | null },
];

export default function ExpensesBoard({
  state,
  money,
  onAdd,
  onDelete,
}: Props) {
  const [range, setRange] = useState("month");

  const scoped = useMemo(() => {
    const found = ranges.find(r => r.id === range);
    if (!found || found.days === null) return state.expenses;
    const start = new Date();
    start.setDate(start.getDate() - found.days);
    return state.expenses.filter(e => new Date(e.at) >= start);
  }, [state.expenses, range]);

  const total = expensesTotal(scoped);
  const groups = expensesByCategory(scoped);

  const exportCsv = () => {
    if (!scoped.length) {
      toast.error("لا توجد مصروفات في هذه الفترة");
      return;
    }
    const rows = [
      ["التاريخ", "البند", "الوصف", "القيمة", "المرجع", "ملاحظات"],
      ...scoped.map(e => [
        new Date(e.at).toLocaleString("ar-EG"),
        EXPENSE_LABELS[e.category],
        e.description,
        String(e.amount),
        e.reference,
        e.notes,
      ]),
    ];
    const csv = rows
      .map(row => row.map(cell => JSON.stringify(cell)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `المصروفات-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل ملف المصروفات");
  };

  if (!state.expenses.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <WalletCards />
        </div>
        <h2>لا توجد مصروفات مسجلة</h2>
        <p>
          سجّل الإيجار والرواتب والكهرباء ليصبح صافي الربح دقيقًا، لا الربح
          الإجمالي فقط.
        </p>
        <button className="primary-btn" onClick={onAdd}>
          <Plus size={18} /> تسجيل مصروف
        </button>
      </div>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">المصروفات التشغيلية</span>
          <h2>{money(total)}</h2>
          <p>
            {scoped.length} مصروف خلال{" "}
            {ranges.find(r => r.id === range)?.label}
          </p>
        </div>
        <div className="report-tools">
          <select
            className="category-select"
            value={range}
            onChange={e => setRange(e.target.value)}
          >
            {ranges.map(r => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={17} /> تصدير CSV
          </button>
          <button className="primary-btn" onClick={onAdd}>
            <Plus size={17} /> مصروف جديد
          </button>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="expense-groups">
          {groups.map(group => (
            <div className="expense-group" key={group.category}>
              <span>{group.label}</span>
              <b>{money(group.total)}</b>
              <i
                style={{
                  width: total > 0 ? `${(group.total / total) * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="panel table-panel" style={{ marginTop: 16 }}>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>البند</th>
                <th>الوصف</th>
                <th>المرجع</th>
                <th>القيمة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {scoped.map(expense => (
                <tr key={expense.id}>
                  <td>{new Date(expense.at).toLocaleDateString("ar-EG")}</td>
                  <td>{EXPENSE_LABELS[expense.category as ExpenseCategory]}</td>
                  <td>{expense.description}</td>
                  <td>{expense.reference || "—"}</td>
                  <td>
                    <b>{money(expense.amount)}</b>
                  </td>
                  <td>
                    <button
                      className="row-more"
                      onClick={() => onDelete(expense)}
                      title="حذف المصروف"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
