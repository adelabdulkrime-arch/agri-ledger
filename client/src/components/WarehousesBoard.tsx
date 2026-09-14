// Design: «سوق الحقل» — المخازن والفروع: رصيد كل مكان، والتحويل بينها.
import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Boxes,
  Check,
  Plus,
  Search,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  stockAt,
  transfersOf,
  warehouseSummary,
} from "../data/warehouses";
import type { DbState, Warehouse } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
  onEdit: (warehouse: Warehouse) => void;
  onTransfer: (input: {
    fromWarehouseId: number;
    toWarehouseId: number;
    lines: { productId: number; qty: number }[];
    note: string;
  }) => void;
};

const tabs = [
  { id: "list", label: "المخازن" },
  { id: "stock", label: "أرصدة الأصناف" },
  { id: "transfer", label: "تحويل بضاعة" },
  { id: "history", label: "سجل التحويلات" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function WarehousesBoard({
  state,
  money,
  onAdd,
  onEdit,
  onTransfer,
}: Props) {
  const [tab, setTab] = useState<Tab>("list");
  const [search, setSearch] = useState("");

  const active = useMemo(
    () => (state.warehouses || []).filter(w => w.active),
    [state.warehouses]
  );

  const [from, setFrom] = useState<number>(active[0]?.id || 0);
  const [to, setTo] = useState<number>(active[1]?.id || 0);
  const [productId, setProductId] = useState<number>(0);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products.filter(
      p => !term || p.name.toLowerCase().includes(term)
    );
  }, [state.products, search]);

  const history = useMemo(() => transfersOf(state), [state]);

  const available = productId ? stockAt(state, productId, from) : 0;

  const submitTransfer = () => {
    const amount = Number(qty);
    if (!from || !to) {
      toast.error("اختر المخزن المُرسِل والمستقبِل");
      return;
    }
    if (from === to) {
      toast.error("اختر مخزنين مختلفين");
      return;
    }
    if (!productId) {
      toast.error("اختر الصنف");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("أدخل كمية أكبر من صفر");
      return;
    }
    if (amount > available) {
      toast.error(`الرصيد المتاح هو ${available} فقط`);
      return;
    }
    onTransfer({
      fromWarehouseId: from,
      toWarehouseId: to,
      lines: [{ productId, qty: amount }],
      note,
    });
    setQty("");
    setNote("");
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">أماكن التخزين</span>
          <h2>{active.length}</h2>
          <p>
            {state.products.length} صنفًا موزّعًا على المخازن النشطة
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={onAdd}>
            <Plus size={16} /> مخزن جديد
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

      {tab === "list" && (
        <div className="panel table-panel">
          <div className="ledger-list">
            {(state.warehouses || []).map(w => {
              const s = warehouseSummary(state, w.id);
              return (
                <div className="ledger-row" key={w.id}>
                  <div className="ledger-mark">
                    <WarehouseIcon size={18} />
                  </div>
                  <div className="ledger-main">
                    <strong>
                      {w.name}
                      {w.isDefault && (
                        <span className="terms-chip credit">افتراضي</span>
                      )}
                      {!w.active && (
                        <span className="terms-chip cash">معطّل</span>
                      )}
                    </strong>
                    <span>{w.note || "—"}</span>
                  </div>
                  <div className="supplier-figures">
                    <span>{s.items} صنفًا</span>
                    <b>{money(s.value)}</b>
                  </div>
                  <button className="row-more" onClick={() => onEdit(w)}>
                    تعديل
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
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
                  {active.map(w => (
                    <th key={w.id}>{w.name}</th>
                  ))}
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {active.map(w => {
                      const qtyHere = stockAt(state, p.id, w.id);
                      return (
                        <td
                          key={w.id}
                          className={qtyHere <= 0 ? "danger-text" : ""}
                        >
                          {qtyHere}
                        </td>
                      );
                    })}
                    <td>
                      <b>{p.stock}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "transfer" && (
        <div className="panel table-panel">
          <div className="form-grid" style={{ padding: 16 }}>
            <label className="field">
              <span>من مخزن</span>
              <select
                className="category-select"
                value={from}
                onChange={e => setFrom(Number(e.target.value))}
              >
                {active.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>إلى مخزن</span>
              <select
                className="category-select"
                value={to}
                onChange={e => setTo(Number(e.target.value))}
              >
                <option value={0}>— اختر —</option>
                {active
                  .filter(w => w.id !== from)
                  .map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>الصنف</span>
              <select
                className="category-select"
                value={productId}
                onChange={e => setProductId(Number(e.target.value))}
              >
                <option value={0}>— اختر —</option>
                {state.products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>الكمية (المتاح {available})</span>
              <input
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={e => setQty(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>ملاحظة</span>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="اختياري"
              />
            </label>
          </div>

          <div className="security-note" style={{ margin: "0 16px 16px" }}>
            <ArrowLeftRight size={17} />
            <span>
              التحويل ينقل البضاعة بين مكانين ولا يُنشئ قيدًا محاسبيًا: لم
              تدخل ملكية المحل ولم تخرج منها، وتكلفتها لم تتغير. يتغير
              فقط جواب سؤال «كم عندي في هذا الفرع؟».
            </span>
          </div>

          <div style={{ padding: "0 16px 18px" }}>
            <button className="primary-btn full" onClick={submitTransfer}>
              <Check size={18} /> تنفيذ التحويل
            </button>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="panel table-panel">
          {history.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>التاريخ</th>
                    <th>من</th>
                    <th>إلى</th>
                    <th>الأصناف</th>
                    <th>القيمة</th>
                    <th>نفّذه</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(t => (
                    <tr key={t.no}>
                      <td>
                        <b>#{t.no}</b>
                      </td>
                      <td>{new Date(t.at).toLocaleDateString("ar-EG")}</td>
                      <td>{t.fromName}</td>
                      <td>{t.toName}</td>
                      <td>{t.lines.length}</td>
                      <td>{money(t.total)}</td>
                      <td>{t.issuedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <Boxes size={26} />
              <span>لا تحويلات بعد</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
