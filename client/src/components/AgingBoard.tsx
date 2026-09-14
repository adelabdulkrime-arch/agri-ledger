// Design: «سوق الحقل» — أعمار الديون: من تأخر، وكم، ومنذ متى.
import { useMemo, useState } from "react";
import { AlertTriangle, Download, HandCoins, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import {
  AGING_BUCKETS,
  doubtfulAllowance,
  payablesAging,
  receivablesAging,
  type BucketId,
} from "../data/aging";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

const tabs = [
  { id: "receivable", label: "ما لنا على العملاء" },
  { id: "payable", label: "ما علينا للموردين" },
] as const;

type Tab = (typeof tabs)[number]["id"];

/** الأقدم أشد خطورة، فيأخذ لونًا أوضح. */
function toneOf(bucket: BucketId) {
  if (bucket === "d90") return "danger-text";
  if (bucket === "d61") return "warn-text";
  return "";
}

export default function AgingBoard({ state, money }: Props) {
  const [tab, setTab] = useState<Tab>("receivable");
  const [search, setSearch] = useState("");

  const report = useMemo(
    () => (tab === "receivable" ? receivablesAging(state) : payablesAging(state)),
    [state, tab]
  );

  const allowance = useMemo(() => doubtfulAllowance(report), [report]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return report.rows.filter(
      r =>
        !term ||
        r.name.toLowerCase().includes(term) ||
        (r.phone || "").includes(term)
    );
  }, [report, search]);

  const exportCsv = () => {
    if (!rows.length) {
      toast.error("لا توجد ديون قائمة للتصدير");
      return;
    }
    const header = [
      tab === "receivable" ? "العميل" : "المورد",
      "الهاتف",
      ...AGING_BUCKETS.map(b => b.label),
      "الإجمالي",
      "أقدم دين (يوم)",
    ];
    const body = rows.map(r => [
      r.name,
      r.phone || "",
      ...AGING_BUCKETS.map(b => String(r.buckets[b.id as BucketId])),
      String(r.total),
      String(r.oldestDays),
    ]);
    const csv = [header, ...body]
      .map(line => line.map(cell => JSON.stringify(cell)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `أعمار-الديون-${tab === "receivable" ? "العملاء" : "الموردين"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل التقرير");
  };

  const printReport = () => {
    const win = window.open("", "_blank", "width=1000,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const head = AGING_BUCKETS.map(b => `<th>${b.label}</th>`).join("");
    const body = rows
      .map(
        r =>
          `<tr><td>${r.name}</td>${AGING_BUCKETS.map(
            b => `<td>${r.buckets[b.id as BucketId] || ""}</td>`
          ).join("")}<td><b>${r.total}</b></td><td>${r.oldestDays}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}";
    const title =
      tab === "receivable" ? "أعمار ديون العملاء" : "أعمار ديون الموردين";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body><h1>${title}</h1><p>الإجمالي ${report.total} · المتأخر أكثر من 90 يومًا ${report.overdue90} · طُبع في ${new Date().toLocaleString("ar-EG")}</p><table><thead><tr><th>الاسم</th>${head}<th>الإجمالي</th><th>أقدم دين</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    win.document.close();
  };

  if (!report.rows.length)
    return (
      <>
        <div className="report-tabs">
          {tabs.map(t => (
            <button
              key={t.id}
              className={tab === t.id ? "selected" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="empty-module">
          <div className="empty-illustration">
            <HandCoins />
          </div>
          <h2>لا توجد ديون قائمة</h2>
          <p>
            {tab === "receivable"
              ? "كل ما بيع بالآجل محصَّل. سيظهر هنا كل دين لم يُسدَّد، مرتبًا بعمره، لتعرف من تأخر ومنذ متى."
              : "لا مستحقات على المحل للموردين. ستظهر هنا فواتير الشراء غير المسددة موزعة بعمرها."}
          </p>
        </div>
      </>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">
            {tab === "receivable" ? "إجمالي ما لنا" : "إجمالي ما علينا"}
          </span>
          <h2>{money(report.total)}</h2>
          <p>
            {report.rows.length}{" "}
            {tab === "receivable" ? "عميلًا مدينًا" : "موردًا دائنًا"} · أقدم دين{" "}
            {report.rows[0]?.oldestDays || 0} يومًا
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

      {report.overdue90 > 0 && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            <b>{money(report.overdue90)} مضى عليه أكثر من 90 يومًا</b>
            <span>
              {tab === "receivable"
                ? `هذا أخطر ما في الكشف؛ تقدير المخصص له ${money(allowance.total)} إن اعتمدت النسب المقترحة.`
                : "راجع سداد هذه الفواتير قبل أن تتأثر علاقتك بالمورد."}
            </span>
          </div>
        </div>
      )}

      <div className="report-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الهاتف…"
            />
          </div>
          <b style={{ fontSize: 12, color: "#8a9a91" }}>
            {rows.length} حسابًا
          </b>
        </div>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>{tab === "receivable" ? "العميل" : "المورد"}</th>
                {AGING_BUCKETS.map(b => (
                  <th key={b.id}>{b.label}</th>
                ))}
                <th>الإجمالي</th>
                <th>أقدم دين</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    {r.phone ? (
                      <span style={{ color: "#8a9a91" }}> · {r.phone}</span>
                    ) : null}
                  </td>
                  {AGING_BUCKETS.map(b => {
                    const value = r.buckets[b.id as BucketId];
                    return (
                      <td key={b.id} className={value ? toneOf(b.id as BucketId) : ""}>
                        {value ? money(value) : "—"}
                      </td>
                    );
                  })}
                  <td>
                    <b>{money(r.total)}</b>
                  </td>
                  <td className={toneOf(r.documents[0]?.bucket || "d0")}>
                    {r.oldestDays} يومًا
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>الإجمالي</th>
                {AGING_BUCKETS.map(b => (
                  <th key={b.id}>{money(report.totals[b.id as BucketId])}</th>
                ))}
                <th>{money(report.total)}</th>
                <th>—</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {tab === "receivable" && (
        <div className="panel table-panel" style={{ marginTop: 17 }}>
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              تقدير مخصص الديون المشكوك في تحصيلها
            </b>
            <b style={{ fontSize: 13 }}>{money(allowance.total)}</b>
          </div>
          <div className="security-note">
            <AlertTriangle size={17} />
            <span>
              النسب أدناه تقدير إداري مقترح لا قاعدة مُلزِمة، والمعيار يطلب
              تقديرًا معقولًا للخسائر المتوقعة ويترك النسبة لتجربتك مع عملائك.
              لا يُسجَّل هذا المخصص في الدفاتر تلقائيًا؛ هو رقم لمساعدتك على
              القرار.
            </span>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الشريحة</th>
                  <th>الرصيد</th>
                  <th>النسبة</th>
                  <th>المخصص</th>
                </tr>
              </thead>
              <tbody>
                {allowance.lines.map(l => (
                  <tr key={l.bucket}>
                    <td>{l.label}</td>
                    <td>{money(l.base)}</td>
                    <td>{Math.round(l.rate * 100)}%</td>
                    <td>
                      <b>{money(l.allowance)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
