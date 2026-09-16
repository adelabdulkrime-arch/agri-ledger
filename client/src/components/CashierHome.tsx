// Design: «OneMedia24 ERP» — شاشة البائع: البيع أواًلا وأخيرًا.
//
// ليست نسخة مقلّمة من شاشة المدير. البائع يحتاج ثلاثة أشياء: أن يبيع
// بسرعة، أن يعرف ما باعه اليوم، وأن يرى ما قارب النفاد. كل ما عدا ذلك
// تشتيت يبطئه ويزيد احتمال الخطأ.
import { useMemo } from "react";
import {
  AlertTriangle,
  LogOut,
  Receipt,
  ScanLine,
  ShoppingCart,
} from "lucide-react";
import { stockAlerts } from "../data/operations";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  userName: string;
  onNewSale: () => void;
  onScan: () => void;
  onLogout: () => void;
};

export default function CashierHome({
  state,
  money,
  userName,
  onNewSale,
  onScan,
  onLogout,
}: Props) {
  /** مبيعات اليوم وحده: البائع يُقاس بيومه لا بتاريخ المحل كله. */
  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = (state.sales || []).filter(
      s => new Date(s.at).getTime() >= start.getTime()
    );
    return {
      count: rows.length,
      total: rows.reduce((sum, s) => sum + s.total, 0),
      rows: rows.slice(0, 8),
    };
  }, [state.sales]);

  const alerts = useMemo(() => stockAlerts(state).slice(0, 6), [state]);

  return (
    <div className="cashier-shell" dir="rtl">
      <header className="cashier-top">
        <div className="cashier-who">
          <span className="cashier-avatar">{userName.slice(0, 1)}</span>
          <div>
            <strong>{userName}</strong>
            <span>بائع · {new Date().toLocaleDateString("ar-EG")}</span>
          </div>
        </div>
        <button className="cashier-out" onClick={onLogout}>
          <LogOut size={17} /> خروج
        </button>
      </header>

      <div className="cashier-actions">
        <button className="cashier-primary" onClick={onNewSale}>
          <ShoppingCart size={26} />
          <span>
            <b>فاتورة بيع جديدة</b>
            <small>ابدأ عملية بيع الآن</small>
          </span>
        </button>
        <button className="cashier-secondary" onClick={onScan}>
          <ScanLine size={22} />
          <span>
            <b>مسح باركود</b>
            <small>بالكاميرا أو القارئ</small>
          </span>
        </button>
      </div>

      <div className="cashier-stats">
        <div className="cashier-stat">
          <span>مبيعات اليوم</span>
          <b>{money(today.total)}</b>
        </div>
        <div className="cashier-stat">
          <span>عدد الفواتير</span>
          <b>{today.count}</b>
        </div>
      </div>

      <div className="cashier-grid">
        <section className="cashier-panel">
          <h3>
            <Receipt size={17} /> فواتير اليوم
          </h3>
          {today.rows.length ? (
            <ul className="cashier-list">
              {today.rows.map(s => (
                <li key={s.no}>
                  <span className="c-no">#{s.no}</span>
                  <span className="c-name">{s.customer}</span>
                  <span className="c-time">
                    {new Date(s.at).toLocaleTimeString("ar-EG", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <b>{money(s.total)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cashier-empty">
              لم تسجّل فاتورة اليوم بعد. اضغط «فاتورة بيع جديدة» للبدء.
            </p>
          )}
        </section>

        <section className="cashier-panel">
          <h3>
            <AlertTriangle size={17} /> تحتاج انتباهك
          </h3>
          {alerts.length ? (
            <ul className="cashier-list alerts">
              {alerts.map(a => (
                <li key={`${a.kind}-${a.productId}`}>
                  <span className={`c-dot ${a.kind}`} />
                  <span className="c-name">{a.name}</span>
                  <span className="c-msg">{a.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cashier-empty">
              لا تنبيهات — المخزون بحالة جيدة.
            </p>
          )}
        </section>
      </div>

      <footer className="cashier-foot">
        OneMedia24 ERP · حقوق الهوية البصرية One Media
      </footer>
    </div>
  );
}
