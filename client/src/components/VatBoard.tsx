// Design: «سوق الحقل» — الإقرار الضريبي: ما حُصّل وما دُفع وما يُسدَّد.
import { useMemo, useState } from "react";
import { AlertTriangle, Download, Printer, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { monthPeriod, quarterPeriod, vatReturn } from "../data/vat";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

export default function VatBoard({ state, money }: Props) {
  const now = new Date();
  const [mode, setMode] = useState<"month" | "quarter">("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);

  const period = useMemo(
    () => (mode === "month" ? monthPeriod(year, month) : quarterPeriod(year, quarter)),
    [mode, year, month, quarter]
  );

  const report = useMemo(() => vatReturn(state, period), [state, period]);

  const periodLabel =
    mode === "month" ? `${MONTHS[month]} ${year}` : `الربع ${quarter} — ${year}`;

  const rows = [
    { label: "المبيعات الخاضعة", base: report.sales.base, vat: report.sales.vat },
    {
      label: "مردودات المبيعات",
      base: -report.salesReturns.base,
      vat: 0,
    },
    {
      label: "المشتريات الخاضعة",
      base: report.purchases.base,
      vat: report.purchases.vat,
    },
    {
      label: "مردودات المشتريات",
      base: -report.purchaseReturns.base,
      vat: -report.purchaseReturns.vat,
    },
  ];

  const exportCsv = () => {
    const csv = [
      ["البند", "الوعاء", "الضريبة"],
      ...rows.map(r => [r.label, String(r.base), String(r.vat)]),
      ["ضريبة المخرجات", "", String(report.outputVat)],
      ["ضريبة المدخلات القابلة للخصم", "", String(report.inputVat)],
      ["الصافي المستحق", "", String(report.net)],
    ]
      .map(line => line.map(c => JSON.stringify(c)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `إقرار-ضريبي-${periodLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل الإقرار");
  };

  const printReport = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const s = state.settings;
    const body = rows
      .map(
        r =>
          `<tr><td>${r.label}</td><td>${r.base}</td><td>${r.vat}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}tfoot td{font-weight:bold}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>إقرار ضريبي ${periodLabel}</title><style>${styles}</style></head><body><h1>الإقرار الضريبي — ${periodLabel}</h1><p>${s?.name || ""}${s?.taxNumber ? ` · الرقم الضريبي: ${s.taxNumber}` : ""}</p><table><thead><tr><th>البند</th><th>الوعاء</th><th>الضريبة</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td>ضريبة المخرجات</td><td>—</td><td>${report.outputVat}</td></tr><tr><td>ضريبة المدخلات القابلة للخصم</td><td>—</td><td>${report.inputVat}</td></tr><tr><td>الصافي ${report.net >= 0 ? "المستحق للهيئة" : "المسترد"}</td><td>—</td><td>${Math.abs(report.net)}</td></tr></tfoot></table><script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    win.document.close();
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">
            {report.net >= 0 ? "المستحق للهيئة" : "رصيد مسترد"}
          </span>
          <h2>{money(Math.abs(report.net))}</h2>
          <p>
            {periodLabel} · {report.invoiceCount} مستندًا
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={printReport}>
            <Printer size={16} /> طباعة
          </button>
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      {!report.registered && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            <b>المحل غير مسجَّل في ضريبة القيمة المضافة</b>
            <span>
              لذلك لا تُخصم ضريبة المدخلات: ما دُفع للموردين محمَّل على تكلفة
              المخزون. فعّل التسجيل من «إعدادات المحل» إن كنت مسجَّلًا فعلًا.
            </span>
          </div>
        </div>
      )}

      <div className="panel table-panel">
        <div className="table-toolbar">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              className="category-select"
              value={mode}
              onChange={e => setMode(e.target.value as "month" | "quarter")}
            >
              <option value="month">شهري</option>
              <option value="quarter">ربع سنوي</option>
            </select>
            {mode === "month" ? (
              <select
                className="category-select"
                value={month}
                onChange={e => setMonth(Number(e.target.value))}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="category-select"
                value={quarter}
                onChange={e => setQuarter(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map(q => (
                  <option key={q} value={q}>
                    الربع {q}
                  </option>
                ))}
              </select>
            )}
            <select
              className="category-select"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
            >
              {[year - 2, year - 1, year, year + 1].map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>البند</th>
                <th>الوعاء (قبل الضريبة)</th>
                <th>الضريبة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{money(r.base)}</td>
                  <td>{money(r.vat)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>ضريبة المخرجات (محصَّلة)</th>
                <th>—</th>
                <th>{money(report.outputVat)}</th>
              </tr>
              <tr>
                <th>ضريبة المدخلات القابلة للخصم</th>
                <th>—</th>
                <th>{money(report.inputVat)}</th>
              </tr>
              <tr>
                <th>
                  الصافي {report.net >= 0 ? "المستحق للهيئة" : "المسترد"}
                </th>
                <th>—</th>
                <th>{money(Math.abs(report.net))}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="security-note" style={{ marginTop: 16 }}>
        <ReceiptText size={17} />
        <span>
          هذا التقرير يقرأ ما رُحّل فعلًا في دفاترك خلال الفترة، وهو أداة
          مراجعة لا تقديمٌ للإقرار. راجعه مع محاسبك قبل الرفع للهيئة، فقد
          تختلف قواعد الاستحقاق والإعفاء حسب نشاطك.
        </span>
      </div>
    </>
  );
}
