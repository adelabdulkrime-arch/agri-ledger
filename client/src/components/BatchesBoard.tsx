// Design: «سوق الحقل» — دفعات الأصناف: الصلاحيات، الأقرب انتهاءً،
// وتتبّع من اشترى تشغيلة بعينها عند الحاجة لسحبها.
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, Search, Users } from "lucide-react";
import { batchTrace, expiringBatches } from "../data/batches";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

const tabs = [
  { id: "all", label: "كل الدفعات" },
  { id: "expiring", label: "قاربت الانتهاء" },
  { id: "trace", label: "تتبّع تشغيلة" },
] as const;

type Tab = (typeof tabs)[number]["id"];

/** أيام متبقية على الصلاحية؛ سالب يعني منتهية. */
function daysLeft(date?: string) {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

function expiryTone(days: number | null) {
  if (days === null) return "";
  if (days < 0) return "danger-text";
  if (days <= 60) return "warn-text";
  return "good-text";
}

export default function BatchesBoard({ state, money }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [traceId, setTraceId] = useState<number | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.batches || [])
      .filter(
        b =>
          !term ||
          b.productName.toLowerCase().includes(term) ||
          b.lotNo.toLowerCase().includes(term)
      )
      .sort((a, b) => {
        // المنتهية والقريبة أولًا، فهي ما يحتاج قرارًا.
        const da = daysLeft(a.expiryDate);
        const db2 = daysLeft(b.expiryDate);
        if (da === null && db2 === null) return 0;
        if (da === null) return 1;
        if (db2 === null) return -1;
        return da - db2;
      });
  }, [state.batches, search]);

  const soon = useMemo(() => expiringBatches(state, 90), [state]);
  const trace = useMemo(
    () => (traceId ? batchTrace(state, traceId) : null),
    [state, traceId]
  );

  if (!(state.batches || []).length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <Boxes />
        </div>
        <h2>لا توجد دفعات مسجّلة</h2>
        <p>
          عند تسجيل فاتورة شراء، اكتب رقم التشغيلة وتاريخ الصلاحية لكل صنف.
          عندها يصرف النظام الأقرب انتهاءً أولًا، ويمكنك تتبّع من اشترى أي
          تشغيلة إن احتجت سحبها.
        </p>
      </div>
    );

  return (
    <>
      {soon.length > 0 && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            <b>
              {soon.filter(b => b.expired).length} دفعة منتهية و
              {soon.filter(b => !b.expired).length} قاربت الانتهاء
            </b>
            <span>
              راجعها قبل بيعها؛ المنتهية لا يصح صرفها ويجب فصلها عن المخزون.
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

      {(tab === "all" || tab === "expiring") && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث باسم الصنف أو رقم التشغيلة…"
              />
            </div>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>التشغيلة</th>
                  <th>الصلاحية</th>
                  <th>وارد</th>
                  <th>متبقٍ</th>
                  <th>التكلفة</th>
                  <th>المورد</th>
                  <th>تتبّع</th>
                </tr>
              </thead>
              <tbody>
                {(tab === "expiring" ? soon : rows).map(b => {
                  const days = daysLeft(b.expiryDate);
                  return (
                    <tr key={b.id}>
                      <td>{b.productName}</td>
                      <td>
                        <b>{b.lotNo}</b>
                      </td>
                      <td className={expiryTone(days)}>
                        {b.expiryDate
                          ? `${new Date(b.expiryDate).toLocaleDateString("ar-EG")}${
                              days !== null
                                ? days < 0
                                  ? " · منتهية"
                                  : ` · ${days} يومًا`
                                : ""
                            }`
                          : "—"}
                      </td>
                      <td>{b.qtyReceived}</td>
                      <td>
                        <b className={b.qtyRemaining ? "" : "danger-text"}>
                          {b.qtyRemaining}
                        </b>
                      </td>
                      <td>{money(b.unitCost)}</td>
                      <td>{b.supplierName}</td>
                      <td>
                        <button
                          className="small-add"
                          onClick={() => {
                            setTraceId(b.id);
                            setTab("trace");
                          }}
                        >
                          <Users size={13} /> المشترون
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "trace" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <select
              className="category-select"
              value={traceId ?? ""}
              onChange={e => setTraceId(Number(e.target.value) || null)}
            >
              <option value="">— اختر تشغيلة —</option>
              {(state.batches || []).map(b => (
                <option key={b.id} value={b.id}>
                  {b.productName} · {b.lotNo}
                </option>
              ))}
            </select>
          </div>

          {trace ? (
            <>
              <div className="trace-head">
                <div>
                  <span>التشغيلة</span>
                  <b>{trace.batch.lotNo}</b>
                </div>
                <div>
                  <span>الصنف</span>
                  <b>{trace.batch.productName}</b>
                </div>
                <div>
                  <span>بيع منها</span>
                  <b>{trace.soldQty}</b>
                </div>
                <div>
                  <span>متبقٍ</span>
                  <b>{trace.batch.qtyRemaining}</b>
                </div>
              </div>
              {trace.buyers.length ? (
                <div className="data-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>الفاتورة</th>
                        <th>التاريخ</th>
                        <th>العميل</th>
                        <th>الكمية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace.buyers.map((x, i) => (
                        <tr key={`${x.saleNo}-${i}`}>
                          <td>#{x.saleNo}</td>
                          <td>
                            {new Date(x.at).toLocaleDateString("ar-EG")}
                          </td>
                          <td>{x.customer}</td>
                          <td>
                            <b>{x.qty}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-cart">
                  <span>لم يُبَع من هذه التشغيلة بعد</span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-cart">
              <span>اختر تشغيلة لعرض من اشترى منها</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
