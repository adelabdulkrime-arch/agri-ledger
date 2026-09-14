// Design: «سوق الحقل» — التسوية البنكية: أشّر ما ظهر في كشف البنك،
// ليظهر الفرق بدل أن يبقى مجهولًا.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, Landmark } from "lucide-react";
import { INSTRUMENT_LABELS } from "../data/operations";
import { reconcileBank } from "../data/reconcile";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onToggle: (key: string) => void;
  onClearAll: (to: Date) => void;
};

const SOURCE_LABELS: Record<string, string> = {
  sale: "بيع",
  purchase: "شراء",
  payment: "سداد مورد",
  collection: "تحصيل",
  expense: "مصروف",
  transfer: "تحويل",
  opening: "رصيد افتتاحي",
  manual: "قيد يدوي",
  purchase_return: "مرتجع شراء",
  sale_return: "مرتجع بيع",
};

export default function ReconcileBoard({
  state,
  money,
  onToggle,
  onClearAll,
}: Props) {
  const [statement, setStatement] = useState("");

  const report = useMemo(
    () => reconcileBank(state, { statementBalance: Number(statement) || 0 }),
    [state, statement]
  );

  if (!report.movements.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <Landmark />
        </div>
        <h2>لا توجد حركات بنكية</h2>
        <p>
          ستظهر هنا كل حركة مرّت على حساب البنك — تحصيل بتحويل، سداد بشيك،
          بيع بالشبكة، أو إيداع من الصندوق — لتؤشّر ما ظهر منها في كشف البنك.
        </p>
      </div>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">رصيد البنك في دفترنا</span>
          <h2>{money(report.bookBalance)}</h2>
          <p>
            طوبق {money(report.clearedBalance)} · معلّق{" "}
            {report.unclearedCount} حركة بقيمة {money(report.unclearedTotal)}
          </p>
        </div>
        <div className="report-tools">
          <label className="field" style={{ minWidth: 190 }}>
            <span>رصيد كشف البنك</span>
            <input
              type="number"
              step="any"
              value={statement}
              onChange={e => setStatement(e.target.value)}
              placeholder="0"
            />
          </label>
          <button
            className="outline-btn"
            onClick={() => onClearAll(new Date())}
          >
            <CheckCheck size={16} /> تأشير الكل
          </button>
        </div>
      </div>

      {statement !== "" && (
        <div
          className={report.difference === 0 ? "security-note" : "reset-warn"}
          style={{ marginBottom: 16 }}
        >
          {report.difference === 0 ? (
            <CheckCheck size={17} />
          ) : (
            <AlertTriangle size={18} />
          )}
          <div>
            <b>
              {report.difference === 0
                ? "التسوية مطابقة"
                : `فرق ${money(Math.abs(report.difference))}`}
            </b>
            <span>
              {report.difference === 0
                ? "ما أشّرته يساوي رصيد الكشف تمامًا."
                : report.difference > 0
                  ? "المؤشَّر في دفترنا أكبر من الكشف؛ راجع حركة أشّرتها ولم تظهر في البنك."
                  : "الكشف أكبر من المؤشَّر؛ هناك حركة ظهرت في البنك ولم تؤشّرها بعد."}
            </span>
          </div>
        </div>
      )}

      <div className="panel table-panel">
        <div className="table-toolbar">
          <b style={{ fontSize: 13, color: "#284e40" }}>
            {report.movements.length} حركة بنكية
          </b>
        </div>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>ظهر في الكشف</th>
                <th>التاريخ</th>
                <th>العملية</th>
                <th>البيان</th>
                <th>وارد</th>
                <th>صادر</th>
              </tr>
            </thead>
            <tbody>
              {report.movements.map(m => (
                <tr key={m.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.cleared}
                      onChange={() => onToggle(m.key)}
                      style={{ width: 17, height: 17 }}
                    />
                  </td>
                  <td>{new Date(m.at).toLocaleDateString("ar-EG")}</td>
                  <td>{SOURCE_LABELS[m.source] || m.source}</td>
                  <td>{m.description}</td>
                  <td className={m.debit ? "good-text" : ""}>
                    {m.debit ? money(m.debit) : "—"}
                  </td>
                  <td className={m.credit ? "danger-text" : ""}>
                    {m.credit ? money(m.credit) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="security-note" style={{ marginTop: 16 }}>
        <Landmark size={17} />
        <span>
          النظام لا يتصل بالبنك ولا يقرأ كشفًا آليًا: أنت من يؤشّر ما ظهر في
          كشفك، والنظام يحفظ التأشير ويحسب الفرق. أدوات الدفع غير النقدية
          ({Object.values(INSTRUMENT_LABELS).slice(1).join("، ")}) هي ما يظهر
          هنا، أما النقد فمكانه جرد الوردية.
        </span>
      </div>
    </>
  );
}
