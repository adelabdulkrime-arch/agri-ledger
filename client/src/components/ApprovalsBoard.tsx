// Design: «OneMedia24 ERP» — اعتماد العمليات الحساسة: من طلب ومن أذن.
import { useMemo, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import {
  APPROVAL_LABELS,
  APPROVAL_STATUS_LABELS,
  approvalSummary,
  approvalsOf,
} from "../data/approvals";
import type { ApprovalRequest, ApprovalStatus, DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onDecide: (request: ApprovalRequest, approve: boolean) => void;
};

const tabs: { id: ApprovalStatus | "all"; label: string }[] = [
  { id: "pending", label: "بانتظار البتّ" },
  { id: "approved", label: "معتمدة" },
  { id: "rejected", label: "مرفوضة" },
  { id: "all", label: "الكل" },
];

export default function ApprovalsBoard({ state, money, onDecide }: Props) {
  const [tab, setTab] = useState<ApprovalStatus | "all">("pending");
  const summary = useMemo(() => approvalSummary(state), [state]);
  const rows = useMemo(
    () => approvalsOf(state, tab === "all" ? {} : { status: tab }),
    [state, tab]
  );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">بانتظار البتّ</span>
          <h2>{summary.pending}</h2>
          <p>
            معتمد {summary.approved} · مرفوض {summary.rejected} · الإجمالي{" "}
            {summary.total}
          </p>
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

      <div className="security-note" style={{ marginBottom: 16 }}>
        <ShieldCheck size={17} />
        <span>
          من يطلب لا يعتمد طلبه، ولو كان مالكًا: الاعتماد رقابة لا توثيق.
          ويبقى هذا ضبطًا تشغيليًا لا حاجزًا أمنيًا — البيانات في هذا
          الجهاز، والحماية الكاملة تحتاج خادمًا.
        </span>
      </div>

      {rows.length ? (
        <div className="panel table-panel">
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th>القيمة</th>
                  <th>طلبه</th>
                  <th>الحالة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.no}>
                    <td>
                      <b>#{a.no}</b>
                    </td>
                    <td>{APPROVAL_LABELS[a.kind]}</td>
                    <td>
                      {a.description}
                      {a.reason && (
                        <span style={{ color: "#8a9a91", fontSize: 11.5 }}>
                          {" "}
                          · {a.reason}
                        </span>
                      )}
                    </td>
                    <td>{a.amount !== undefined ? money(a.amount) : "—"}</td>
                    <td>{a.requestedBy}</td>
                    <td>
                      <span
                        className={`terms-chip ${a.status === "approved" ? "credit" : "cash"}`}
                      >
                        {APPROVAL_STATUS_LABELS[a.status]}
                      </span>
                      {a.decidedBy && (
                        <span style={{ fontSize: 11, color: "#8a9a91" }}>
                          {" "}
                          {a.decidedBy}
                        </span>
                      )}
                    </td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {a.status === "pending" && (
                        <>
                          <button
                            className="small-add"
                            onClick={() => onDecide(a, true)}
                          >
                            <Check size={13} /> اعتماد
                          </button>
                          <button
                            className="row-more"
                            onClick={() => onDecide(a, false)}
                          >
                            <X size={13} /> رفض
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty-module">
          <div className="empty-illustration">
            <ShieldCheck />
          </div>
          <h2>لا طلبات {tab === "pending" ? "معلّقة" : ""}</h2>
          <p>
            تظهر هنا طلبات العمليات الحساسة: تجاوز حد ائتمان، تعديل تكلفة،
            إعادة فتح فترة مقفلة. يطلبها من يحتاجها ويبتّ فيها مسؤول آخر.
          </p>
        </div>
      )}
    </>
  );
}
