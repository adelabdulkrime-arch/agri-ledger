// Design: «سوق الحقل» — ميزان المراجعة بالقيد المزدوج، مدين ودائن.
import { useMemo } from "react";
import { Download, Printer, Scale } from "lucide-react";
import { toast } from "sonner";
import { postedTrialBalance } from "../data/ledger";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

export default function TrialBalanceBoard({ state, money }: Props) {
  const tb = useMemo(() => postedTrialBalance(state), [state]);

  const exportCsv = () => {
    const rows = [
      ["رقم الحساب", "الحساب", "مدين", "دائن"],
      ...tb.rows.map(r => [r.code, r.name, String(r.debit), String(r.credit)]),
      ["", "الإجمالي", String(tb.totalDebit), String(tb.totalCredit)],
    ];
    const csv = rows
      .map(r => r.map(c => JSON.stringify(c)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ميزان-المراجعة-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل ميزان المراجعة");
  };

  const print = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const body = tb.rows
      .map(
        r =>
          `<tr><td>${r.code}</td><td>${r.name}</td><td>${r.debit ? money(r.debit) : ""}</td><td>${r.credit ? money(r.credit) : ""}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f2f6f2}tfoot td{font-weight:bold;background:#f7f7f2}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>ميزان المراجعة</title><style>${styles}</style></head><body><h1>ميزان المراجعة</h1><p>حتى ${new Date().toLocaleString("ar-EG")}</p><table><thead><tr><th>رقم</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan=2>الإجمالي</td><td>${money(tb.totalDebit)}</td><td>${money(tb.totalCredit)}</td></tr></tfoot></table><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">ميزان المراجعة</span>
          <h2>{tb.balanced ? "الميزان متوازن" : "الميزان غير متوازن"}</h2>
          <p>
            المدين {money(tb.totalDebit)} · الدائن {money(tb.totalCredit)}
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={print}>
            <Printer size={17} /> طباعة
          </button>
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={17} /> تصدير CSV
          </button>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>رقم</th>
                <th>الحساب</th>
                <th>مدين</th>
                <th>دائن</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map(r => (
                <tr key={r.code}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.debit ? money(r.debit) : "—"}</td>
                  <td>{r.credit ? money(r.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tb-total">
                <td colSpan={2}>
                  <b>الإجمالي</b>
                </td>
                <td>
                  <b>{money(tb.totalDebit)}</b>
                </td>
                <td>
                  <b>{money(tb.totalCredit)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {!tb.balanced && (
        <div className="reset-warn" style={{ marginTop: 14 }}>
          <Scale size={18} />
          <div>
            <b>فرق في الميزان</b>
            <span>
              راجع حركات المخزون وكشوف الحسابات. الفرق غالبًا من تعديل يدوي على
              البيانات خارج النظام.
            </span>
          </div>
        </div>
      )}
    </>
  );
}
