// Design: «سوق الحقل» — العملاء وكشوف حساباتهم، بنفس بطاقات وجداول النظام.
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Download,
  HandCoins,
  Phone,
  Plus,
  Printer,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { customerStatement, customerTotals } from "../data/operations";
import type { Customer, DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
  onEdit: (customer: Customer) => void;
  onCollect: (customer: Customer) => void;
};

export default function CustomersBoard({
  state,
  money,
  onAdd,
  onEdit,
  onCollect,
}: Props) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.customers
      .filter(
        c =>
          !term ||
          c.name.toLowerCase().includes(term) ||
          c.phone.includes(term)
      )
      .map(c => ({ customer: c, totals: customerTotals(state, c.id) }))
      // الأكثر مديونية أولًا، فهو ما يحتاج المتابعة.
      .sort((a, b) => b.totals.balance - a.totals.balance);
  }, [state, search]);

  const open = openId
    ? state.customers.find(c => c.id === openId) || null
    : null;
  const statement = open ? customerStatement(state, open.id) : [];

  const exportStatement = () => {
    if (!open || !statement.length) {
      toast.error("لا توجد حركات في كشف الحساب");
      return;
    }
    const rowsCsv = [
      ["التاريخ", "الحركة", "المرجع", "مدين", "دائن", "الرصيد", "ملاحظات"],
      ...statement.map(e => [
        new Date(e.at).toLocaleString("ar-EG"),
        e.type,
        e.refNo ? `#${e.refNo}` : "—",
        String(e.debit),
        String(e.credit),
        String(e.balance),
        e.note,
      ]),
    ];
    const csv = rowsCsv
      .map(r => r.map(cell => JSON.stringify(cell)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `كشف-حساب-${open.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل كشف الحساب");
  };

  const printStatement = () => {
    if (!open) return;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const totals = customerTotals(state, open.id);
    const body = statement
      .map(
        e =>
          `<tr><td>${new Date(e.at).toLocaleString("ar-EG")}</td><td>${e.type}</td><td>${e.refNo ? "#" + e.refNo : "—"}</td><td>${e.debit || ""}</td><td>${e.credit || ""}</td><td>${e.balance}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${open.name}</title><style>${styles}</style></head><body><h1>كشف حساب العميل — ${open.name}</h1><p>الهاتف: ${open.phone || "—"} · التعامل: ${open.terms === "credit" ? "آجل" : "نقدي"} · المستحق: ${money(totals.balance)} · طُبع في ${new Date().toLocaleString("ar-EG")}</p><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  if (!state.customers.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <UsersRound />
        </div>
        <h2>لا يوجد عملاء مسجلون</h2>
        <p>
          أضف عميلًا لتتبع البيع الآجل وكشف حسابه. البيع النقدي العابر لا يحتاج
          تسجيل عميل.
        </p>
        <button className="primary-btn" onClick={onAdd}>
          <Plus size={18} /> إضافة عميل
        </button>
      </div>
    );

  return (
    <>
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث باسم العميل أو الهاتف…"
            />
          </div>
          <button className="outline-btn" onClick={onAdd}>
            <Plus size={16} /> عميل جديد
          </button>
        </div>
        <div className="ledger-list">
          {rows.map(({ customer, totals }) => (
            <div className="ledger-row" key={customer.id}>
              <div className="ledger-mark">
                <UserRound size={18} />
              </div>
              <div className="ledger-main">
                <strong>
                  {customer.name}
                  <span
                    className={`terms-chip ${customer.terms === "credit" ? "credit" : "cash"}`}
                  >
                    {customer.terms === "credit" ? "آجل" : "نقدي"}
                  </span>
                </strong>
                <span>
                  {customer.phone ? (
                    <>
                      <Phone size={11} /> {customer.phone} ·{" "}
                    </>
                  ) : null}
                  {totals.count} فاتورة · إجمالي {money(totals.total)}
                </span>
              </div>
              <div className="supplier-figures">
                <span>حُصّل {money(totals.collected)}</span>
                <b className={totals.balance > 0 ? "danger-text" : "good-text"}>
                  {totals.balance > 0
                    ? `عليه ${money(totals.balance)}`
                    : "لا يوجد مستحق"}
                </b>
              </div>
              {totals.balance > 0 && (
                <button
                  className="small-add"
                  onClick={() => onCollect(customer)}
                >
                  <HandCoins size={14} /> تحصيل
                </button>
              )}
              <button
                className="small-add"
                onClick={() => setOpenId(customer.id)}
              >
                كشف الحساب <ChevronLeft size={14} />
              </button>
              <button className="row-more" onClick={() => onEdit(customer)}>
                تعديل
              </button>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="panel table-panel" style={{ marginTop: 17 }}>
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              كشف حساب — {open.name}
            </b>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="outline-btn" onClick={printStatement}>
                <Printer size={16} /> طباعة
              </button>
              <button className="outline-btn" onClick={exportStatement}>
                <Download size={16} /> CSV
              </button>
              <button className="outline-btn" onClick={() => setOpenId(null)}>
                إغلاق
              </button>
            </div>
          </div>
          {statement.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الحركة</th>
                    <th>المرجع</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.map(e => (
                    <tr key={e.id}>
                      <td>{new Date(e.at).toLocaleDateString("ar-EG")}</td>
                      <td>{e.type}</td>
                      <td>{e.refNo ? `#${e.refNo}` : "—"}</td>
                      <td>{e.debit ? money(e.debit) : "—"}</td>
                      <td>{e.credit ? money(e.credit) : "—"}</td>
                      <td>
                        <b>{money(e.balance)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <span>لا توجد حركات على هذا العميل بعد</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
