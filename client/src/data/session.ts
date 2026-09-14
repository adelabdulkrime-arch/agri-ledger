// Design: «سوق الحقل» — وردية الصندوق: فتح، متابعة، جرد نقدية، وإقفال
// يكشف العجز أو الزيادة بدل أن يمرّ بلا أثر.
import type { CashSession, DbState } from "./types";
import { OperationError, round2 } from "./operations";
import { ACC, postJournal } from "./ledger";
import { nextNumber } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** الوردية المفتوحة حاليًا، إن وُجدت. */
export function activeSession(state: DbState): CashSession | undefined {
  return (state.cashSessions || []).find(s => s.status === "open");
}

/**
 * يفتح وردية جديدة برصيد ابتدائي في الدرج.
 * لا يُسمح بورديتين مفتوحتين معًا، وإلا اختلطت الحركات بينهما.
 */
export function openCashSession(
  state: DbState,
  input: { openingFloat?: number; openedBy?: string; at?: string; note?: string }
): CashSession {
  if (!state.cashSessions) state.cashSessions = [];
  if (activeSession(state))
    fail("توجد وردية مفتوحة بالفعل؛ أقفلها قبل فتح وردية جديدة");

  const openingFloat = round2(Number(input.openingFloat || 0));
  if (!Number.isFinite(openingFloat) || openingFloat < 0)
    fail("رصيد بداية الوردية لا يصح أن يكون سالبًا");

  const session: CashSession = {
    no: nextNumber(state.cashSessions, 700),
    openedAt: input.at || new Date().toISOString(),
    openingFloat,
    openedBy: (input.openedBy || "").trim() || "صاحب المحل",
    status: "open",
    note: (input.note || "").trim(),
  };
  state.cashSessions.unshift(session);
  return session;
}

/**
 * صافي الحركة النقدية المرحَّلة خلال فترة الوردية.
 * نقرأها من القيود لا من الفواتير، فكل ما يمسّ الصندوق يدخل الحساب
 * سواء كان بيعًا أو مصروفًا أو تحصيلًا أو سدادًا.
 */
export function sessionCashFlow(state: DbState, session: CashSession) {
  const from = new Date(session.openedAt).getTime();
  const to = session.closedAt
    ? new Date(session.closedAt).getTime()
    : Date.now();

  let inflow = 0;
  let outflow = 0;
  (state.journal || []).forEach(entry => {
    const at = new Date(entry.at).getTime();
    if (at < from || at > to) return;
    // تسوية الإقفال ليست حركة تشغيلية؛ استثناؤها يُبقي المنصرف صادقًا.
    if (entry.source === "cash_session") return;
    entry.lines.forEach(line => {
      if (line.accountCode !== ACC.cash) return;
      inflow += line.debit;
      outflow += line.credit;
    });
  });

  return {
    inflow: round2(inflow),
    outflow: round2(outflow),
    net: round2(inflow - outflow),
  };
}

/** تفاصيل حركات الصندوق خلال الوردية، للعرض والمراجعة. */
export function sessionMovements(state: DbState, session: CashSession) {
  const from = new Date(session.openedAt).getTime();
  const to = session.closedAt
    ? new Date(session.closedAt).getTime()
    : Date.now();

  const rows: {
    no: number;
    at: string;
    source: string;
    description: string;
    in: number;
    out: number;
  }[] = [];

  (state.journal || []).forEach(entry => {
    const at = new Date(entry.at).getTime();
    if (at < from || at > to) return;
    if (entry.source === "cash_session") return;
    entry.lines.forEach(line => {
      if (line.accountCode !== ACC.cash) return;
      rows.push({
        no: entry.no,
        at: entry.at,
        source: entry.source,
        description: line.memo || entry.description,
        in: line.debit,
        out: line.credit,
      });
    });
  });

  return rows.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
}

/** المتوقع في الدرج الآن: رصيد البداية زائد صافي الحركة. */
export function expectedCash(state: DbState, session: CashSession) {
  return round2(session.openingFloat + sessionCashFlow(state, session).net);
}

/**
 * يقفل الوردية بعد جرد النقد فعليًا.
 * الفرق بين المعدود والمتوقع يُرحَّل قيدًا، فلا يختفي العجز صامتًا.
 */
export function closeCashSession(
  state: DbState,
  input: { countedCash: number; at?: string; note?: string }
): CashSession {
  const session = activeSession(state);
  if (!session) fail("لا توجد وردية مفتوحة لإقفالها");

  const counted = round2(Number(input.countedCash));
  if (!Number.isFinite(counted) || counted < 0)
    fail("النقد المعدود لا يصح أن يكون سالبًا");

  const at = input.at || new Date().toISOString();
  const expected = expectedCash(state, session);
  const variance = round2(counted - expected);

  session.closedAt = at;
  session.countedCash = counted;
  session.expectedCash = expected;
  session.variance = variance;
  session.status = "closed";
  if (input.note?.trim())
    session.note = session.note
      ? `${session.note} · ${input.note.trim()}`
      : input.note.trim();

  // الفرق يُقيَّد تسوية: العجز مصروف، والزيادة إيراد عارض.
  if (Math.abs(variance) > 0.01)
    postJournal(state, {
      at,
      source: "cash_session",
      sourceNo: session.no,
      description: `تسوية وردية #${session.no} (${variance < 0 ? "عجز" : "زيادة"})`,
      lines:
        variance < 0
          ? [
              {
                accountCode: ACC.expenses,
                debit: Math.abs(variance),
                memo: "عجز صندوق",
              },
              {
                accountCode: ACC.cash,
                credit: Math.abs(variance),
                memo: "تسوية",
              },
            ]
          : [
              { accountCode: ACC.cash, debit: variance, memo: "تسوية" },
              {
                accountCode: ACC.sales,
                credit: variance,
                memo: "زيادة صندوق",
              },
            ],
    });

  return session;
}

/** ملخص وردية جاهز للعرض. */
export function sessionSummary(state: DbState, session: CashSession) {
  const flow = sessionCashFlow(state, session);
  const expected =
    session.status === "closed" && session.expectedCash !== undefined
      ? session.expectedCash
      : expectedCash(state, session);

  return {
    no: session.no,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    openedBy: session.openedBy,
    openingFloat: session.openingFloat,
    inflow: flow.inflow,
    outflow: flow.outflow,
    expected,
    counted: session.countedCash,
    variance: session.variance,
  };
}
