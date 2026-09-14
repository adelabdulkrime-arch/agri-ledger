// Design: «سوق الحقل» — عروض الأسعار وأوامر البيع وسندات التسليم
// والفواتير المعلّقة: مستندات لا تمسّ المخزون حتى تصير فاتورة.
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardList,
  Printer,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DRAFT_LABELS,
  DRAFT_STATUS_LABELS,
  draftSummary,
  draftsOf,
  isExpired,
} from "../data/drafts";
import type { DbState, Draft, DraftKind } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onConvert: (draft: Draft) => void;
  onCancel: (draft: Draft) => void;
  onRemove: (draft: Draft) => void;
};

const tabs: { id: DraftKind; label: string }[] = [
  { id: "quotation", label: "عروض الأسعار" },
  { id: "order", label: "أوامر البيع" },
  { id: "delivery", label: "سندات التسليم" },
  { id: "parked", label: "الفواتير المعلّقة" },
];

const hints: Record<DraftKind, string> = {
  quotation:
    "وعدٌ بسعر لمدة محددة. لا يخصم مخزونًا، ويصير فاتورة حين يوافق العميل.",
  order:
    "اتفاق على توريد. لا يخصم مخزونًا حتى التسليم الفعلي وتحويله إلى فاتورة.",
  delivery:
    "توثيق تسليم بضاعة فاتورة قائمة. لا يخصم شيئًا لأن الفاتورة خصمته أصلًا.",
  parked:
    "سلة محفوظة لتكملها لاحقًا. استعدها في شاشة البيع فتعود كما تركتها.",
};

export default function DraftsBoard({
  state,
  money,
  onConvert,
  onCancel,
  onRemove,
}: Props) {
  const [tab, setTab] = useState<DraftKind>("quotation");
  const [search, setSearch] = useState("");

  const summary = useMemo(() => draftSummary(state, tab), [state, tab]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return draftsOf(state, tab).filter(
      d =>
        !term ||
        d.customer.toLowerCase().includes(term) ||
        String(d.no).includes(term)
    );
  }, [state, tab, search]);

  const printDraft = (d: Draft) => {
    const win = window.open("", "_blank", "width=800,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const s = state.settings;
    const body = d.lines
      .map(
        l =>
          `<tr><td>${l.name}</td><td>${l.qty} ${l.unitName}</td><td>${l.price}</td><td>${l.discount || ""}</td><td>${l.total}</td></tr>`
      )
      .join("");
    const styles =
      "body{font-family:Arial,sans-serif;padding:26px;color:#16352d}h1{margin:0 0 2px;font-size:21px}h2{margin:0 0 14px;font-size:14px;color:#666;font-weight:normal}p{color:#666;margin:2px 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f2f6f2}tfoot td{font-weight:bold}.note{margin-top:16px;font-size:12px;color:#555}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>${DRAFT_LABELS[d.kind]} ${d.no}</title><style>${styles}</style></head><body><h1>${s?.tradeName || s?.name || "دفتر الزراعة"}</h1><h2>${DRAFT_LABELS[d.kind]} رقم ${d.no}</h2>${s?.taxNumber ? `<p>الرقم الضريبي: ${s.taxNumber}</p>` : ""}${s?.phone ? `<p>هاتف: ${s.phone}</p>` : ""}<p>العميل: ${d.customer}</p><p>التاريخ: ${new Date(d.at).toLocaleString("ar-EG")}</p>${d.validUntil ? `<p>صالح حتى: ${new Date(d.validUntil).toLocaleDateString("ar-EG")}</p>` : ""}${d.saleNo ? `<p>الفاتورة: #${d.saleNo}</p>` : ""}<table><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">الإجمالي قبل الخصم</td><td>${d.subtotal}</td></tr>${d.discount ? `<tr><td colspan="4">الخصم</td><td>${d.discount}</td></tr>` : ""}${d.tax ? `<tr><td colspan="4">الضريبة</td><td>${d.tax}</td></tr>` : ""}<tr><td colspan="4">الصافي</td><td>${d.total}</td></tr></tfoot></table>${d.note ? `<p class="note">ملاحظات: ${d.note}</p>` : ""}<p class="note">${d.kind === "quotation" ? "هذا عرض سعر وليس فاتورة؛ لا يُلزم بتسليم البضاعة قبل الاتفاق." : d.kind === "delivery" ? "سند تسليم بضاعة." : ""}</p><script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    win.document.close();
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">{DRAFT_LABELS[tab]}</span>
          <h2>{money(summary.openValue)}</h2>
          <p>
            {summary.open} مفتوح من {summary.total} · حُوِّل{" "}
            {summary.converted}
          </p>
        </div>
      </div>

      {summary.expired > 0 && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            <b>{summary.expired} عرضًا انتهت صلاحيته</b>
            <span>
              السعر فيها لم يعد مُلزِمًا؛ راجعها قبل تحويلها إلى فاتورة.
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

      <div className="security-note" style={{ marginBottom: 16 }}>
        <ClipboardList size={17} />
        <span>{hints[tab]}</span>
      </div>

      {rows.length ? (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث بالرقم أو اسم العميل…"
              />
            </div>
            <b style={{ fontSize: 12, color: "#8a9a91" }}>
              {rows.length} مستندًا
            </b>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاريخ</th>
                  <th>العميل</th>
                  <th>الأصناف</th>
                  <th>الإجمالي</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(d => {
                  const expired = isExpired(d);
                  return (
                    <tr key={d.no}>
                      <td>
                        <b>#{d.no}</b>
                      </td>
                      <td>{new Date(d.at).toLocaleDateString("ar-EG")}</td>
                      <td>{d.customer}</td>
                      <td>{d.lines.length}</td>
                      <td>
                        <b>{money(d.total)}</b>
                      </td>
                      <td>
                        <span
                          className={`terms-chip ${d.status === "converted" ? "credit" : "cash"}`}
                        >
                          {DRAFT_STATUS_LABELS[d.status]}
                        </span>
                        {expired && (
                          <span className="terms-chip cash">منتهٍ</span>
                        )}
                      </td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          className="small-add"
                          onClick={() => printDraft(d)}
                        >
                          <Printer size={13} /> طباعة
                        </button>
                        {d.status === "open" && d.kind !== "delivery" && (
                          <button
                            className="small-add"
                            onClick={() => onConvert(d)}
                          >
                            <ArrowLeftRight size={13} />{" "}
                            {d.kind === "parked" ? "استعادة" : "تحويل لفاتورة"}
                          </button>
                        )}
                        {d.status === "open" && d.kind === "parked" && (
                          <button
                            className="row-more"
                            onClick={() => onRemove(d)}
                          >
                            <Trash2 size={13} /> حذف
                          </button>
                        )}
                        {d.status === "open" && d.kind !== "parked" && (
                          <button
                            className="row-more"
                            onClick={() => onCancel(d)}
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
          <h2>لا توجد {DRAFT_LABELS[tab]}</h2>
          <p>
            {tab === "parked"
              ? "علّق أي فاتورة من شاشة البيع حين يطلب العميل مهلة، فتعود إليها كما تركتها."
              : tab === "delivery"
                ? "أنشئ سند تسليم من فاتورة بيع قائمة لتوثيق استلام العميل للبضاعة."
                : `أنشئ ${DRAFT_LABELS[tab]} من شاشة البيع، ثم حوّله إلى فاتورة عند الاتفاق.`}
          </p>
        </div>
      )}
    </>
  );
}
