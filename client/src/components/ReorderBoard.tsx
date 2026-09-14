// Design: «سوق الحقل» — اقتراح إعادة الطلب: ماذا أشتري، وكم، ومن أين.
import { useMemo, useState } from "react";
import { Download, ShoppingBag, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_LEAD_DAYS,
  DEFAULT_SAFETY_DAYS,
  DEFAULT_WINDOW_DAYS,
  groupBySupplier,
  reorderSuggestions,
} from "../data/reorder";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

export default function ReorderBoard({ state, money }: Props) {
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [leadDays, setLeadDays] = useState(DEFAULT_LEAD_DAYS);

  const rows = useMemo(
    () =>
      reorderSuggestions(state, {
        windowDays,
        leadDays,
        safetyDays: DEFAULT_SAFETY_DAYS,
      }),
    [state, windowDays, leadDays]
  );

  const groups = useMemo(() => groupBySupplier(rows), [rows]);
  const total = useMemo(
    () => rows.reduce((sum, r) => sum + r.estimatedCost, 0),
    [rows]
  );

  const exportCsv = () => {
    if (!rows.length) {
      toast.error("لا توجد اقتراحات للتصدير");
      return;
    }
    const csv = [
      [
        "المورد",
        "الصنف",
        "الرصيد",
        "بيع خلال المدة",
        "الصرف اليومي",
        "يكفي (يوم)",
        "المقترح شراؤه",
        "التكلفة المتوقعة",
        "السبب",
      ],
      ...rows.map(r => [
        r.supplierName || "بلا مورد",
        r.name,
        String(r.stock),
        String(r.soldInWindow),
        String(r.dailyUse),
        Number.isFinite(r.daysOfCover) ? String(Math.floor(r.daysOfCover)) : "—",
        String(r.suggestedQty),
        String(r.estimatedCost),
        r.reason,
      ]),
    ]
      .map(line => line.map(c => JSON.stringify(c)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "اقتراح-الطلب.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل الاقتراح");
  };

  if (!rows.length)
    return (
      <>
        <div className="security-note" style={{ marginBottom: 16 }}>
          <TrendingUp size={17} />
          <span>
            الاقتراح يُقاس من بيعك الفعلي خلال {windowDays} يومًا، لا من تقدير
            عام. حين لا يظهر شيء فرصيدك يكفي مدة التوريد.
          </span>
        </div>
        <div className="empty-module">
          <div className="empty-illustration">
            <ShoppingBag />
          </div>
          <h2>لا شيء يحتاج طلبًا الآن</h2>
          <p>
            كل الأصناف رصيدها يكفي مدة التوريد ({leadDays} يومًا) ومخزون
            الأمان. سيظهر هنا ما ينفد أو ما يقترب من النفاد حسب سرعة بيعه.
          </p>
        </div>
      </>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">التكلفة المتوقعة للطلب</span>
          <h2>{money(total)}</h2>
          <p>
            {rows.length} صنفًا من {groups.length} موردًا
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      <div className="panel table-panel" style={{ marginBottom: 16 }}>
        <div className="table-toolbar">
          <label className="field" style={{ minWidth: 170 }}>
            <span>مدة قياس البيع (يوم)</span>
            <input
              type="number"
              min={7}
              value={windowDays}
              onChange={e => setWindowDays(Number(e.target.value) || 7)}
            />
          </label>
          <label className="field" style={{ minWidth: 170 }}>
            <span>مدة التوريد (يوم)</span>
            <input
              type="number"
              min={1}
              value={leadDays}
              onChange={e => setLeadDays(Number(e.target.value) || 1)}
            />
          </label>
        </div>
      </div>

      {groups.map(group => (
        <div
          className="panel table-panel"
          key={group.supplierId || 0}
          style={{ marginBottom: 16 }}
        >
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              {group.supplierName}
            </b>
            <b style={{ fontSize: 13 }}>{money(group.total)}</b>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>الرصيد</th>
                  <th>بيع خلال {windowDays} يومًا</th>
                  <th>الصرف اليومي</th>
                  <th>يكفي</th>
                  <th>المقترح</th>
                  <th>التكلفة</th>
                  <th>السبب</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(r => (
                  <tr key={r.productId}>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td className={r.stock <= 0 ? "danger-text" : ""}>
                      {r.stock} {r.unit}
                    </td>
                    <td>{r.soldInWindow}</td>
                    <td>{r.dailyUse}</td>
                    <td
                      className={
                        Number.isFinite(r.daysOfCover) && r.daysOfCover <= 7
                          ? "danger-text"
                          : ""
                      }
                    >
                      {Number.isFinite(r.daysOfCover)
                        ? `${Math.floor(r.daysOfCover)} يوم`
                        : "—"}
                    </td>
                    <td>
                      <b>
                        {r.suggestedQty} {r.unit}
                      </b>
                    </td>
                    <td>{money(r.estimatedCost)}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="security-note">
        <TrendingUp size={17} />
        <span>
          هذا اقتراح لا أمر شراء: يُقاس من بيعك خلال {windowDays} يومًا
          ليغطي {leadDays} يوم توريد و{DEFAULT_SAFETY_DAYS} أيام أمان. صنف
          موسمي بيع مرة واحدة لا يصحّ قياسه بمتوسط يومي، ولهذا يظهر أساس
          الحساب أمامك لتحكم بنفسك.
        </span>
      </div>
    </>
  );
}
