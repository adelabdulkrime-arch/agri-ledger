// Design: «سوق الحقل» — قائمة فواتير الشراء مع البحث والتصفية وحالة السداد.
import { useMemo, useState } from "react";
import { FileText, Plus, Printer, Search, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import type { DbState, Purchase } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onNew: () => void;
  onPay: (purchase: Purchase) => void;
  onVoid: (purchase: Purchase) => void;
};

const statusFilters = [
  { id: "all", label: "الكل" },
  { id: "paid", label: "مدفوعة" },
  { id: "partial", label: "جزئي" },
  { id: "credit", label: "آجلة" },
  { id: "void", label: "ملغاة" },
];

function statusOf(p: Purchase) {
  if (p.status === "void") return { id: "void", label: "ملغاة", tone: "late" };
  if (p.balance <= 0) return { id: "paid", label: "مدفوعة", tone: "paid" };
  if (p.paid > 0) return { id: "partial", label: "جزئي", tone: "late" };
  return { id: "credit", label: "آجلة", tone: "late" };
}

export default function PurchasesBoard({
  state,
  money,
  onNew,
  onPay,
  onVoid,
}: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [openNo, setOpenNo] = useState<number | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.purchases.filter(p => {
      const status = statusOf(p).id;
      if (filter !== "all" && status !== filter) return false;
      if (!term) return true;
      return (
        String(p.no).includes(term) ||
        p.supplierName.toLowerCase().includes(term) ||
        (p.supplierInvoiceNo || "").toLowerCase().includes(term)
      );
    });
  }, [state.purchases, search, filter]);

  const open = openNo
    ? state.purchases.find(p => p.no === openNo) || null
    : null;

  const printPurchase = (purchase: Purchase) => {
    const win = window.open("", "_blank", "width=800,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const body = purchase.lines
      .map(
        l =>
          `<tr><td>${l.name}</td><td>${l.qty} ${l.unit}</td><td>${money(l.unitCost)}</td><td>${money(l.discount)}</td><td>${money(l.tax)}</td><td>${money(l.total)}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 12px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}.tot{margin-top:14px;font-size:14px}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>فاتورة شراء ${purchase.no}</title><style>${styles}</style></head><body><h1>فاتورة شراء #${purchase.no}</h1><p>المورد: ${purchase.supplierName} · فاتورة المورد: ${purchase.supplierInvoiceNo || "—"} · ${new Date(purchase.at).toLocaleString("ar-EG")}</p><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th>خصم</th><th>ضريبة</th><th>الإجمالي</th></tr></thead><tbody>${body}</tbody></table><div class="tot"><p>الإجمالي: <b>${money(purchase.total)}</b> · المدفوع: <b>${money(purchase.paid)}</b> · المتبقي: <b>${money(purchase.balance)}</b></p></div><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  if (!state.purchases.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <ShoppingBag />
        </div>
        <h2>لا توجد فواتير شراء بعد</h2>
        <p>سجّل أول فاتورة شراء ليبدأ النظام بحساب التكلفة والربح الحقيقي.</p>
        <button className="primary-btn" onClick={onNew}>
          <Plus size={18} /> فاتورة شراء جديدة
        </button>
      </div>
    );

  return (
    <>
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث برقم الفاتورة أو المورد…"
            />
          </div>
          <select
            className="category-select"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
            {statusFilters.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <button className="outline-btn" onClick={onNew}>
            <Plus size={16} /> فاتورة جديدة
          </button>
        </div>

        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>الفاتورة</th>
                <th>فاتورة المورد</th>
                <th>المورد</th>
                <th>التاريخ</th>
                <th>الإجمالي</th>
                <th>المدفوع</th>
                <th>المتبقي</th>
                <th>الحالة</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const status = statusOf(p);
                return (
                  <tr key={p.no}>
                    <td>#{p.no}</td>
                    <td>{p.supplierInvoiceNo || "—"}</td>
                    <td>{p.supplierName}</td>
                    <td>{new Date(p.at).toLocaleDateString("ar-EG")}</td>
                    <td>{money(p.total)}</td>
                    <td>{money(p.paid)}</td>
                    <td>{money(p.balance)}</td>
                    <td>
                      <span className={`status ${status.tone}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="purchase-actions">
                      <button
                        className="small-add"
                        onClick={() => setOpenNo(p.no)}
                      >
                        <FileText size={13} /> عرض
                      </button>
                      <button
                        className="row-more"
                        onClick={() => printPurchase(p)}
                        title="طباعة"
                      >
                        <Printer size={15} />
                      </button>
                      {p.status === "confirmed" && p.balance > 0 && (
                        <button
                          className="row-more"
                          onClick={() => onPay(p)}
                          title="تسجيل دفعة"
                        >
                          دفعة
                        </button>
                      )}
                      {p.status === "confirmed" && (
                        <button
                          className="row-more"
                          onClick={() => onVoid(p)}
                          title="إلغاء الفاتورة"
                        >
                          إلغاء
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

      {open && (
        <div className="panel" style={{ marginTop: 17 }}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">تفاصيل الفاتورة</span>
              <h3>
                #{open.no} · {open.supplierName}
              </h3>
            </div>
            <button className="outline-btn" onClick={() => setOpenNo(null)}>
              إغلاق
            </button>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>سعر الشراء</th>
                  <th>خصم</th>
                  <th>ضريبة</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {open.lines.map(l => (
                  <tr key={l.productId}>
                    <td>{l.name}</td>
                    <td>
                      {l.qty} {l.unit}
                    </td>
                    <td>{money(l.unitCost)}</td>
                    <td>{money(l.discount)}</td>
                    <td>{money(l.tax)}</td>
                    <td>{money(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open.notes && (
            <p style={{ fontSize: 12, color: "#7d8d84", marginTop: 12 }}>
              ملاحظات: {open.notes}
            </p>
          )}
        </div>
      )}
    </>
  );
}
