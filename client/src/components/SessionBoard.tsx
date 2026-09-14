// Design: «سوق الحقل» — وردية الصندوق: الحالة الحالية، حركات النقد،
// وسجل الورديات السابقة بعجزها وزيادتها.
import { useMemo } from "react";
import {
  AlertTriangle,
  ClipboardList,
  LockKeyhole,
  Play,
  Wallet,
} from "lucide-react";
import {
  activeSession,
  expectedCash,
  sessionMovements,
  sessionSummary,
} from "../data/session";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onOpen: () => void;
  onClose: () => void;
};

const sourceLabels: Record<string, string> = {
  sale: "بيع",
  expense: "مصروف",
  collection: "تحصيل",
  payment: "سداد مورد",
  purchase: "شراء",
  opening: "رصيد افتتاحي",
  transfer: "تحويل",
  manual: "قيد يدوي",
};

export default function SessionBoard({ state, money, onOpen, onClose }: Props) {
  const current = activeSession(state);
  const movements = useMemo(
    () => (current ? sessionMovements(state, current) : []),
    [state, current]
  );
  const expected = current ? expectedCash(state, current) : 0;
  const history = useMemo(
    () =>
      (state.cashSessions || [])
        .filter(s => s.status === "closed")
        .slice(0, 20)
        .map(s => sessionSummary(state, s)),
    [state]
  );

  if (!current && !history.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <Wallet />
        </div>
        <h2>لا توجد ورديات بعد</h2>
        <p>
          افتح وردية في بداية اليوم برصيد الدرج، وأقفلها في نهايته بعد عدّ
          النقد؛ فيظهر أي عجز أو زيادة بدل أن يمرّ بلا أثر.
        </p>
        <button className="primary-btn" onClick={onOpen}>
          <Play size={18} /> فتح وردية
        </button>
      </div>
    );

  return (
    <>
      {current ? (
        <>
          <div className="report-summary">
            <div>
              <span className="eyebrow">وردية مفتوحة #{current.no}</span>
              <h2>{money(expected)}</h2>
              <p>
                المتوقع في الدرج · فُتحت{" "}
                {new Date(current.openedAt).toLocaleString("ar-EG")} بواسطة{" "}
                {current.openedBy}
              </p>
            </div>
            <div className="report-tools">
              <button className="primary-btn" onClick={onClose}>
                <LockKeyhole size={17} /> إقفال وجرد
              </button>
            </div>
          </div>

          <div className="report-kpis">
            <div className="report-kpi stock-kpi">
              <div className="report-kpi-icon">
                <Wallet />
              </div>
              <span>رصيد البداية</span>
              <strong>{money(current.openingFloat)}</strong>
              <em>النقد عند فتح الوردية</em>
            </div>
            <div className="report-kpi sales-kpi">
              <div className="report-kpi-icon">
                <Play />
              </div>
              <span>الوارد</span>
              <strong>
                {money(movements.reduce((s, m) => s + m.in, 0))}
              </strong>
              <em>مبيعات نقدية وتحصيل</em>
            </div>
            <div className="report-kpi alert-kpi">
              <div className="report-kpi-icon">
                <ClipboardList />
              </div>
              <span>المنصرف</span>
              <strong>
                {money(movements.reduce((s, m) => s + m.out, 0))}
              </strong>
              <em>مصروفات وسداد</em>
            </div>
          </div>

          <div className="report-section-label">
            <span className="eyebrow">حركات الصندوق</span>
            <b>خلال هذه الوردية</b>
          </div>
          {movements.length ? (
            <div className="panel table-panel">
              <div className="data-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الوقت</th>
                      <th>النوع</th>
                      <th>البيان</th>
                      <th>وارد</th>
                      <th>منصرف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => (
                      <tr key={`${m.no}-${i}`}>
                        <td>
                          {new Date(m.at).toLocaleTimeString("ar-EG", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td>{sourceLabels[m.source] || m.source}</td>
                        <td>{m.description}</td>
                        <td className={m.in ? "good-text" : ""}>
                          {m.in ? money(m.in) : "—"}
                        </td>
                        <td className={m.out ? "danger-text" : ""}>
                          {m.out ? money(m.out) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="empty-cart">
              <span>لا حركات نقدية بعد في هذه الوردية</span>
            </div>
          )}
        </>
      ) : (
        <div className="report-summary">
          <div>
            <span className="eyebrow">الوردية</span>
            <h2>لا توجد وردية مفتوحة</h2>
            <p>افتح وردية في بداية اليوم لتتبّع حركة الدرج.</p>
          </div>
          <div className="report-tools">
            <button className="primary-btn" onClick={onOpen}>
              <Play size={17} /> فتح وردية
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <>
          <div className="report-section-label" style={{ marginTop: 20 }}>
            <span className="eyebrow">السجل</span>
            <b>ورديات سابقة</b>
          </div>
          <div className="panel table-panel">
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الوردية</th>
                    <th>الفتح</th>
                    <th>الإقفال</th>
                    <th>المتوقع</th>
                    <th>المعدود</th>
                    <th>الفرق</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(s => (
                    <tr key={s.no}>
                      <td>#{s.no}</td>
                      <td>
                        {new Date(s.openedAt).toLocaleDateString("ar-EG")}
                      </td>
                      <td>
                        {s.closedAt
                          ? new Date(s.closedAt).toLocaleTimeString("ar-EG", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td>{money(s.expected)}</td>
                      <td>{money(s.counted || 0)}</td>
                      <td>
                        {!s.variance ? (
                          <span className="good-text">مطابق</span>
                        ) : (
                          <b
                            className={
                              s.variance < 0 ? "danger-text" : "good-text"
                            }
                          >
                            {s.variance < 0 ? "عجز " : "زيادة "}
                            {money(Math.abs(s.variance))}
                          </b>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {history.some(s => s.variance && s.variance < 0) && (
            <div className="reset-warn" style={{ marginTop: 14 }}>
              <AlertTriangle size={18} />
              <div>
                <b>ورديات بعجز</b>
                <span>
                  العجز المتكرر يستدعي المراجعة: خطأ في الصرف، أو بيع لم
                  يُسجَّل، أو نقص فعلي.
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
