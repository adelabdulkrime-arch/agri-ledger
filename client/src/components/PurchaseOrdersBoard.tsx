// Design: «OneMedia24 ERP» — أوامر الشراء: ما طُلب ولم يصل بعد.
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  ClipboardList,
  PackageCheck,
  Plus,
  Printer,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  PO_STATUS_LABELS,
  purchaseOrderSummary,
  purchaseOrdersOf,
} from "../data/purchaseorders";
import type { DbState, PurchaseOrder, PurchaseOrderStatus } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAdd: () => void;
  onApprove: (order: PurchaseOrder) => void;
  onReceive: (order: PurchaseOrder) => void;
  onCancel: (order: PurchaseOrder) => void;
};

const tabs: { id: PurchaseOrderStatus | "all"; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "draft", label: "مسودات" },
  { id: "approved", label: "معتمدة" },
  { id: "received", label: "مستلمة" },
];

/** هل تأخر الأمر عن موعده المتوقع؟ */
function isLate(o: PurchaseOrder) {
  if (!o.expectedAt || o.status === "received" || o.status === "cancelled")
    return false;
  return new Date(o.expectedAt).getTime() < Date.now();
}

export default function PurchaseOrdersBoard({
  state,
  money,
  onAdd,
  onApprove,
  onReceive,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<PurchaseOrderStatus | "all">("all");
  const [search, setSearch] = useState("");

  const summary = useMemo(() => purchaseOrderSummary(state), [state]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return purchaseOrdersOf(
      state,
      tab === "all" ? {} : { status: tab }
    ).filter(
      o =>
        !term ||
        o.supplierName.toLowerCase().includes(term) ||
        String(o.no).includes(term)
    );
  }, [state, tab, search]);

  const printOrder = (o: PurchaseOrder) => {
    const win = window.open("", "_blank", "width=800,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const s = state.settings;
    const body = o.lines
      .map(
        l =>
          `<tr><td>${l.name}</td><td>${l.qty} ${l.unit}</td><td>${l.unitCost}</td><td>${l.receivedQty}</td><td>${l.total}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:26px;color:#16352d}h1{margin:0 0 2px;font-size:21px}h2{margin:0 0 14px;font-size:14px;color:#666;font-weight:normal}p{color:#666;margin:2px 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f2f6f2}tfoot td{font-weight:bold}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>أمر شراء ${o.no}</title><style>${styles}</style></head><body><h1>${s?.tradeName || s?.name || "OneMedia24 ERP"}</h1><h2>أمر شراء رقم ${o.no} — ${PO_STATUS_LABELS[o.status]}</h2><p>المورد: ${o.supplierName}</p><p>التاريخ: ${new Date(o.at).toLocaleString("ar-EG")}</p>${o.expectedAt ? `<p>التوريد المتوقع: ${new Date(o.expectedAt).toLocaleDateString("ar-EG")}</p>` : ""}<table><thead><tr><th>الصنف</th><th>المطلوب</th><th>التكلفة</th><th>المستلم</th><th>الإجمالي</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">الإجمالي</td><td>${o.total}</td></tr></tfoot></table>${o.note ? `<p>ملاحظات: ${o.note}</p>` : ""}<p style="margin-top:30px;font-size:12px;color:#555">هذا أمر شراء وليس فاتورة؛ لا يُحرّك مخزونًا ولا دفاتر حتى الاستلام.</p><script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    win.document.close();
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">أوامر مفتوحة</span>
          <h2>{money(summary.openValue)}</h2>
          <p>
            {summary.open} أمرًا من {summary.total} · استُلم{" "}
            {summary.received}
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={onAdd}>
            <Plus size={16} /> أمر شراء جديد
          </button>
        </div>
      </div>

      {summary.late > 0 && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            <b>{summary.late} أمرًا تأخر عن موعده</b>
            <span>راجع الموردين المتأخرين قبل أن ينفد الصنف من المخزن.</span>
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

      <div className="security-note" style={{ marginBottom: 16 }}>
        <ClipboardList size={17} />
        <span>
          أمر الشراء التزام تجاري لا حركة مالية: لا يمسّ المخزون ولا
          الدفاتر. المخزون يتحرك عند الاستلام، والدفاتر عند الفاتورة.
        </span>
      </div>

      {rows.length ? (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث بالرقم أو اسم المورد…"
              />
            </div>
            <b style={{ fontSize: 12, color: "#8a9a91" }}>{rows.length} أمرًا</b>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>المورد</th>
                  <th>الأصناف</th>
                  <th>الإجمالي</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(o => {
                  const late = isLate(o);
                  const partial = o.lines.some(
                    l => l.receivedQty > 0 && l.receivedQty < l.qty
                  );
                  return (
                    <tr key={o.no}>
                      <td>
                        <b>#{o.no}</b>
                      </td>
                      <td>{new Date(o.at).toLocaleDateString("ar-EG")}</td>
                      <td>{o.supplierName}</td>
                      <td>{o.lines.length}</td>
                      <td>
                        <b>{money(o.total)}</b>
                      </td>
                      <td>
                        <span
                          className={`terms-chip ${o.status === "received" ? "credit" : "cash"}`}
                        >
                          {PO_STATUS_LABELS[o.status]}
                        </span>
                        {partial && (
                          <span className="terms-chip cash">جزئي</span>
                        )}
                        {late && (
                          <span className="terms-chip cash">متأخر</span>
                        )}
                      </td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="small-add"
                          onClick={() => printOrder(o)}
                        >
                          <Printer size={13} /> طباعة
                        </button>
                        {o.status === "draft" && (
                          <button
                            className="small-add"
                            onClick={() => onApprove(o)}
                          >
                            <CheckCheck size={13} /> اعتماد
                          </button>
                        )}
                        {o.status === "approved" && (
                          <button
                            className="small-add"
                            onClick={() => onReceive(o)}
                          >
                            <PackageCheck size={13} /> استلام وفوترة
                          </button>
                        )}
                        {o.status !== "received" &&
                          o.status !== "cancelled" && (
                            <button
                              className="row-more"
                              onClick={() => onCancel(o)}
                            >
                              <X size={13} /> إلغاء
                            </button>
                          )}
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
            <ClipboardList />
          </div>
          <h2>لا أوامر شراء</h2>
          <p>
            أنشئ أمر شراء لتثبيت ما طلبته من المورد قبل وصوله، فتعرف ما
            تأخر وما وصل جزئيًا بدل أن تفاجئك الفاتورة.
          </p>
          <button className="primary-btn" onClick={onAdd}>
            <Plus size={18} /> أمر شراء جديد
          </button>
        </div>
      )}
    </>
  );
}
