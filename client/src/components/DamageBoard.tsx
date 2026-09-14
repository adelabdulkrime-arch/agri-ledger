// Design: «سوق الحقل» — إتلاف البضاعة: ما خرج بلا بيع، وكم كلّف.
import { useMemo, useState } from "react";
import { AlertTriangle, PackageX, Plus, Search } from "lucide-react";
import { DAMAGE_REASON_LABELS, damageSummary, damagesOf } from "../data/damage";
import type { DamageReason, DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
};

export default function DamageBoard({ state, money, onAdd }: Props) {
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<DamageReason | "">("");

  const summary = useMemo(() => damageSummary(state), [state]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return damagesOf(state, reason ? { reason } : {}).filter(
      d =>
        !term ||
        d.productName.toLowerCase().includes(term) ||
        (d.lotNo || "").toLowerCase().includes(term)
    );
  }, [state, search, reason]);

  if (!(state.damages || []).length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <PackageX />
        </div>
        <h2>لا توجد بضاعة متلفة</h2>
        <p>
          سجّل هنا ما خرج من المخزون بلا بيع: مبيد انتهت صلاحيته، كيس تمزّق،
          بضاعة فُقدت. تُخصم من الرصيد وتُحمَّل خسارةً باسمها، مفصولةً عن
          تسويات الجرد لتعرف كم يكلّفك التلف وحده.
        </p>
        <button className="primary-btn" onClick={onAdd}>
          <Plus size={18} /> تسجيل إتلاف
        </button>
      </div>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">إجمالي خسائر التالف</span>
          <h2>{money(summary.total)}</h2>
          <p>{summary.count} عملية إتلاف مسجّلة</p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={onAdd}>
            <Plus size={16} /> تسجيل إتلاف
          </button>
        </div>
      </div>

      {summary.byReason.length > 0 && (
        <div className="panel table-panel" style={{ marginBottom: 16 }}>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>السبب</th>
                  <th>عدد العمليات</th>
                  <th>الخسارة</th>
                  <th>النسبة</th>
                </tr>
              </thead>
              <tbody>
                {summary.byReason.map(r => (
                  <tr key={r.reason}>
                    <td>
                      <b>{r.label}</b>
                    </td>
                    <td>{r.count}</td>
                    <td className="danger-text">{money(r.total)}</td>
                    <td>
                      {summary.total
                        ? Math.round((r.total / summary.total) * 100)
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالصنف أو رقم التشغيلة…"
            />
          </div>
          <select
            className="category-select"
            value={reason}
            onChange={e => setReason(e.target.value as DamageReason | "")}
          >
            <option value="">كل الأسباب</option>
            {(
              Object.keys(DAMAGE_REASON_LABELS) as DamageReason[]
            ).map(key => (
              <option key={key} value={key}>
                {DAMAGE_REASON_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>الرقم</th>
                <th>التاريخ</th>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>التكلفة</th>
                <th>الخسارة</th>
                <th>السبب</th>
                <th>التشغيلة</th>
                <th>سجّله</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => (
                <tr key={d.no}>
                  <td>
                    <b>#{d.no}</b>
                  </td>
                  <td>{new Date(d.at).toLocaleDateString("ar-EG")}</td>
                  <td>{d.productName}</td>
                  <td>{d.qty}</td>
                  <td>{money(d.unitCost)}</td>
                  <td className="danger-text">
                    <b>{money(d.total)}</b>
                  </td>
                  <td>{DAMAGE_REASON_LABELS[d.reason]}</td>
                  <td>{d.lotNo || "—"}</td>
                  <td>{d.recordedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="security-note" style={{ marginTop: 16 }}>
        <AlertTriangle size={17} />
        <span>
          الإتلاف مفصول عن تسوية الجرد عمدًا: الجرد يصحّح خطأ في العدّ،
          والإتلاف قرار واعٍ بخسارة بضاعة. خلطهما يخفي كم يخسر المحل من
          التلف وحده.
        </span>
      </div>
    </>
  );
}
