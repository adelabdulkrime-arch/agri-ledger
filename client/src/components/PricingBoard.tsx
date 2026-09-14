// Design: «سوق الحقل» — قوائم الأسعار ومراكز التكلفة.
import { useMemo, useState } from "react";
import { PieChart, Plus, Search, Tags } from "lucide-react";
import {
  expensesByCostCenter,
  priceFor,
  priceListSummary,
} from "../data/pricing";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAddList: () => void;
  onAddCenter: () => void;
  onSetPrice: (listId: number, productId: number, price: number) => void;
};

const tabs = [
  { id: "lists", label: "قوائم الأسعار" },
  { id: "centers", label: "مراكز التكلفة" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function PricingBoard({
  state,
  money,
  onAddList,
  onAddCenter,
  onSetPrice,
}: Props) {
  const [tab, setTab] = useState<Tab>("lists");
  const [listId, setListId] = useState<number>(0);
  const [search, setSearch] = useState("");

  const lists = useMemo(() => state.priceLists || [], [state.priceLists]);
  const active = listId || lists[0]?.id || 0;
  const summary = useMemo(
    () => (active ? priceListSummary(state, active) : { items: 0, avgDiff: 0 }),
    [state, active]
  );

  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products.filter(
      p => !term || p.name.toLowerCase().includes(term)
    );
  }, [state.products, search]);

  const report = useMemo(() => expensesByCostCenter(state), [state]);

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">
            {tab === "lists" ? "قوائم الأسعار" : "إنفاق المراكز"}
          </span>
          <h2>{tab === "lists" ? lists.length : money(report.total)}</h2>
          <p>
            {tab === "lists"
              ? `${summary.items} صنفًا مسعّرًا · متوسط الفرق ${summary.avgDiff}%`
              : `${(state.costCenters || []).length} مركزًا`}
          </p>
        </div>
        <div className="report-tools">
          <button
            className="outline-btn"
            onClick={tab === "lists" ? onAddList : onAddCenter}
          >
            <Plus size={16} />{" "}
            {tab === "lists" ? "قائمة جديدة" : "مركز جديد"}
          </button>
        </div>
      </div>

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

      {tab === "lists" && (
        <>
          <div className="security-note" style={{ marginBottom: 16 }}>
            <Tags size={17} />
            <span>
              القائمة استثناء لا بديل: الصنف الذي لا تسعّره هنا يبقى بسعره
              المعتاد، فلا تضطر لملء كل الأصناف. والسعر الأصلي لا يتغير.
            </span>
          </div>

          {lists.length ? (
            <div className="panel table-panel">
              <div className="table-toolbar">
                <select
                  className="category-select"
                  value={active}
                  onChange={e => setListId(Number(e.target.value))}
                >
                  {lists.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.active ? "" : " (معطّلة)"}
                    </option>
                  ))}
                </select>
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="ابحث باسم الصنف…"
                  />
                </div>
              </div>
              <div className="data-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>الصنف</th>
                      <th>السعر المعتاد</th>
                      <th>سعر القائمة</th>
                      <th>الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => {
                      const listPrice = priceFor(state, p.id, active);
                      const custom = listPrice !== p.price;
                      const diff = p.price
                        ? Math.round(
                            ((listPrice - p.price) / p.price) * 100
                          )
                        : 0;
                      return (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{money(p.price)}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              defaultValue={custom ? listPrice : ""}
                              placeholder="—"
                              style={{ width: 110 }}
                              onBlur={e =>
                                onSetPrice(
                                  active,
                                  p.id,
                                  Number(e.target.value || 0)
                                )
                              }
                            />
                          </td>
                          <td
                            className={
                              !custom
                                ? ""
                                : diff < 0
                                  ? "danger-text"
                                  : "good-text"
                            }
                          >
                            {custom ? `${diff}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="empty-module">
              <div className="empty-illustration">
                <Tags />
              </div>
              <h2>لا قوائم أسعار</h2>
              <p>
                أنشئ قائمة «أسعار الجملة» مثلًا، وسعّر فيها الأصناف التي
                تختلف عن سعرها المعتاد فقط.
              </p>
              <button className="primary-btn" onClick={onAddList}>
                <Plus size={18} /> قائمة جديدة
              </button>
            </div>
          )}
        </>
      )}

      {tab === "centers" && (
        <>
          <div className="security-note" style={{ marginBottom: 16 }}>
            <PieChart size={17} />
            <span>
              المصروفات وحدها ما يُنسب إلى المراكز، لا كل قيد في الدفاتر.
              هذا ما يجيب «كم أنفق كل فرع؟» دون إثقال كل بيع وشراء بحقل
              يُنسى ملؤه فيصير التقرير ناقصًا بلا أن تدري.
            </span>
          </div>

          {report.rows.length ? (
            <div className="panel table-panel">
              <div className="data-table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>المركز</th>
                      <th>عدد المصروفات</th>
                      <th>الإجمالي</th>
                      <th>النسبة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map(r => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td>{r.count}</td>
                        <td>{money(r.total)}</td>
                        <td>
                          {report.total
                            ? Math.round((r.total / report.total) * 100)
                            : 0}
                          %
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>الإجمالي</th>
                      <th>—</th>
                      <th>{money(report.total)}</th>
                      <th>100%</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="empty-module">
              <div className="empty-illustration">
                <PieChart />
              </div>
              <h2>لا مصروفات منسوبة بعد</h2>
              <p>
                أنشئ مركزًا لكل فرع أو نشاط، ثم اختره عند تسجيل المصروف
                لتعرف كلفة كل واحد على حدة.
              </p>
              <button className="primary-btn" onClick={onAddCenter}>
                <Plus size={18} /> مركز جديد
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
