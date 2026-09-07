// Design: «سوق الحقل» — الموردون وكشف الحساب، بنفس بطاقات وجداول النظام.
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  Download,
  Phone,
  Plus,
  Printer,
  Search,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supplierStatement, supplierTotals } from "../data/operations";
import type { DbState, Supplier } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
  onEdit: (supplier: Supplier) => void;
};

export default function SuppliersBoard({ state, money, onAdd, onEdit }: Props) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.suppliers
      .filter(
        s =>
          !term ||
          s.name.toLowerCase().includes(term) ||
          s.phone.includes(term)
      )
      .map(s => ({ supplier: s, totals: supplierTotals(state, s.id) }))
      .sort((a, b) => b.totals.balance - a.totals.balance);
  }, [state, search]);

  const open = openId
    ? state.suppliers.find(s => s.id === openId) || null
    : null;
  const statement = open ? supplierStatement(state, open.id) : [];

  const exportStatement = () => {
    if (!open || !statement.length) {
      toast.error("لا توجد حركات في كشف الحساب");
      return;
    }
    const rowsCsv = [
      ["التاريخ", "نوع الحركة", "رقم الفاتورة", "مدين", "دائن", "الرصيد", "ملاحظات"],
      ...statement.map(entry => [
        new Date(entry.at).toLocaleString("ar-EG"),
        entry.type,
        String(entry.refNo),
        String(entry.debit),
        String(entry.credit),
        String(entry.balance),
        entry.note,
      ]),
    ];
    const csv = rowsCsv
      .map(row => row.map(cell => JSON.stringify(cell)).join(","))
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
    const totals = supplierTotals(state, open.id);
    const body = statement
      .map(
        entry =>
          `<tr><td>${new Date(entry.at).toLocaleString("ar-EG")}</td><td>${entry.type}</td><td>#${entry.refNo}</td><td>${entry.debit || ""}</td><td>${entry.credit || ""}</td><td>${entry.balance}</td><td>${entry.note}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${open.name}</title><style>${styles}</style></head><body><h1>كشف حساب المورد — ${open.name}</h1><p>الهاتف: ${open.phone || "—"} · الرصيد المستحق: ${money(totals.balance)} · طُبع في ${new Date().toLocaleString("ar-EG")}</p><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>ملاحظات</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  if (!state.suppliers.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <UserRound />
        </div>
        <h2>لا يوجد موردون بعد</h2>
        <p>أضف موردًا لتسجيل فواتير الشراء وتتبع المديونية.</p>
        <button className="primary-btn" onClick={onAdd}>
          <Plus size={18} /> إضافة مورد
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
              placeholder="ابحث باسم المورد أو الهاتف…"
            />
          </div>
          <button className="outline-btn" onClick={onAdd}>
            <Plus size={16} /> مورد جديد
          </button>
        </div>
        <div className="ledger-list">
          {rows.map(({ supplier, totals }) => (
            <div className="ledger-row" key={supplier.id}>
              <div className="ledger-mark">
                <UserRound size={18} />
              </div>
              <div className="ledger-main">
                <strong>{supplier.name}</strong>
                <span>
                  {supplier.phone ? (
                    <>
                      <Phone size={11} /> {supplier.phone} ·{" "}
                    </>
                  ) : null}
                  {totals.count} فاتورة · إجمالي {money(totals.total)}
                </span>
              </div>
              <div className="supplier-figures">
                <span>مدفوع {money(totals.paid)}</span>
                <b className={totals.balance > 0 ? "danger-text" : "good-text"}>
                  {totals.balance > 0
                    ? `مستحق ${money(totals.balance)}`
                    : "لا يوجد مستحق"}
                </b>
              </div>
              <button
                className="small-add"
                onClick={() => setOpenId(supplier.id)}
              >
                كشف الحساب <ChevronLeft size={14} />
              </button>
              <button className="row-more" onClick={() => onEdit(supplier)}>
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
                  {statement.map(entry => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.at).toLocaleString("ar-EG")}</td>
                      <td>{entry.type}</td>
                      <td>#{entry.refNo}</td>
                      <td>{entry.debit ? money(entry.debit) : "—"}</td>
                      <td>{entry.credit ? money(entry.credit) : "—"}</td>
                      <td>
                        <b>{money(entry.balance)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <span>لا توجد حركات على هذا المورد بعد</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
