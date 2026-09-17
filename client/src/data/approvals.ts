// Design: «OneMedia24 ERP» — اعتماد العمليات الحساسة.
//
// الوثيقة (§11.3) تشترط اعتمادًا مستقلًا لما يمسّ الماضي أو يتجاوز
// الحدود. المبدأ: من يطلب ليس من يعتمد. البائع يطلب تجاوز حد ائتمان،
// والمالك يبتّ فيه — فيبقى أثر لمن أذن ولماذا، بدل أن تمرّ العملية
// بقرار فردي لا يُسأل عنه أحد.
//
// حدٌّ يجب أن يبقى واضحًا: هذا ضبط تشغيلي لا حاجز أمني. البيانات في
// متصفح الجهاز، ومن يفتح أدوات المطور يتجاوزه. الحماية الحقيقية تحتاج
// خادمًا يتحقق من كل طلب.
import type {
  ApprovalKind,
  ApprovalRequest,
  ApprovalStatus,
  DbState,
} from "./types";
import { OperationError, round2 } from "./operations";
import { nextNumber } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

export const APPROVAL_LABELS: Record<ApprovalKind, string> = {
  voidPosted: "إلغاء مستند مرحَّل",
  editCost: "تعديل تكلفة",
  creditOverride: "تجاوز حد ائتمان",
  reopenPeriod: "إعادة فتح فترة مقفلة",
  stockVariance: "تسوية عجز أو زيادة",
  priceOverride: "سعر أو خصم استثنائي",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
};

/** من يملك البتّ في الطلبات؛ المالك وحده لما يمسّ الماضي. */
function canDecide(state: DbState, kind: ApprovalKind): boolean {
  const users = state.users || [];
  if (!users.length) return true;
  const me = users.find(u => u.id === state.currentUserId && u.active);
  if (!me) return false;
  if (me.role === "owner") return true;
  // المدير يبتّ في التشغيلي، لا فيما يمسّ الماضي المحاسبي.
  if (me.role === "manager")
    return kind !== "reopenPeriod" && kind !== "voidPosted";
  return false;
}

export function requestApproval(
  state: DbState,
  input: {
    kind: ApprovalKind;
    description: string;
    reason?: string;
    refType?: string;
    refNo?: number;
    amount?: number;
  }
): ApprovalRequest {
  if (!state.approvals) state.approvals = [];
  if (!APPROVAL_LABELS[input.kind]) fail("نوع الاعتماد غير معروف");

  const description = (input.description || "").trim();
  if (!description) fail("اكتب وصف ما تطلب اعتماده");

  const me = (state.users || []).find(u => u.id === state.currentUserId);
  const request: ApprovalRequest = {
    no: nextNumber(state.approvals, 12999),
    kind: input.kind,
    at: new Date().toISOString(),
    requestedBy: me?.name || "غير محدد",
    requestedById: me?.id,
    description,
    reason: (input.reason || "").trim(),
    refType: input.refType,
    refNo: input.refNo,
    amount:
      input.amount === undefined ? undefined : round2(Number(input.amount)),
    status: "pending",
  };
  state.approvals.unshift(request);
  return request;
}

/**
 * يبتّ في الطلب.
 *
 * من طلب لا يعتمد طلبه: هذا هو جوهر الفصل. ولو كان الطالب مالكًا فلا
 * معنى لاعتماده نفسه، لأن الاعتماد حينها توثيق لا رقابة.
 */
export function decideApproval(
  state: DbState,
  no: number,
  approve: boolean,
  note = ""
): ApprovalRequest {
  const request = (state.approvals || []).find(a => a.no === no);
  if (!request) fail("الطلب غير موجود");
  if (request.status !== "pending")
    fail(`الطلب ${APPROVAL_STATUS_LABELS[request.status]} من قبل`);

  if (!canDecide(state, request.kind))
    fail(`لا تملك صلاحية البتّ في ${APPROVAL_LABELS[request.kind]}`);

  const me = (state.users || []).find(u => u.id === state.currentUserId);
  if (me && request.requestedById === me.id)
    fail("لا يعتمد صاحب الطلب طلبه؛ اطلب من مسؤول آخر");

  request.status = approve ? "approved" : "rejected";
  request.decidedAt = new Date().toISOString();
  request.decidedBy = me?.name || "غير محدد";
  request.decisionNote = note.trim();
  return request;
}

/** هل يوجد اعتماد ساري لهذه العملية؟ يُستهلك مرة واحدة. */
export function hasApproval(
  state: DbState,
  kind: ApprovalKind,
  refNo?: number
): boolean {
  return (state.approvals || []).some(
    a =>
      a.kind === kind &&
      a.status === "approved" &&
      (refNo === undefined || a.refNo === refNo)
  );
}

export function approvalsOf(
  state: DbState,
  filter: { status?: ApprovalStatus; kind?: ApprovalKind } = {}
) {
  return (state.approvals || [])
    .filter(a => {
      if (filter.status && a.status !== filter.status) return false;
      if (filter.kind && a.kind !== filter.kind) return false;
      return true;
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export function approvalSummary(state: DbState) {
  const rows = state.approvals || [];
  return {
    total: rows.length,
    pending: rows.filter(a => a.status === "pending").length,
    approved: rows.filter(a => a.status === "approved").length,
    rejected: rows.filter(a => a.status === "rejected").length,
  };
}
