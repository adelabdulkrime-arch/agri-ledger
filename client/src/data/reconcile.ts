// Design: «سوق الحقل» — التسوية البنكية: مطابقة حركات البنك في دفترنا
// بما ظهر فعلًا في كشف البنك، وبيان الفرق بدل تجاهله.
//
// حدٌّ يجب أن يبقى واضحًا: النظام لا يتصل بالبنك ولا يقرأ كشفًا آليًا.
// أنت من يؤشّر ما ظهر في الكشف، والنظام يحسب الفرق ويحفظ التأشير.
import type { DbState, JournalEntry } from "./types";
import { ACC } from "./ledger";
import { round2 } from "./operations";

/** حركة بنكية واحدة كما هي في دفترنا. */
export type BankMovement = {
  /** رقم القيد؛ مع رقم السطر يصنعان مفتاحًا فريدًا. */
  journalNo: number;
  lineIndex: number;
  /** مفتاح التأشير المحفوظ: "رقم القيد:رقم السطر". */
  key: string;
  at: string;
  source: string;
  description: string;
  /** وارد للبنك. */
  debit: number;
  /** صادر من البنك. */
  credit: number;
  cleared: boolean;
};

export type ReconcileSummary = {
  movements: BankMovement[];
  /** رصيد البنك في دفترنا حتى تاريخ التسوية. */
  bookBalance: number;
  /** رصيد ما تمت مطابقته فقط. */
  clearedBalance: number;
  /** ما لم يظهر في الكشف بعد. */
  unclearedCount: number;
  unclearedTotal: number;
  /** رصيد الكشف كما أدخله المستخدم. */
  statementBalance: number;
  /** الفرق الذي يجب أن يصير صفرًا بعد تسوية سليمة. */
  difference: number;
};

function bankLines(state: DbState, to?: Date) {
  const rows: BankMovement[] = [];
  const cleared = new Set(state.reconciled || []);

  (state.journal || []).forEach((entry: JournalEntry) => {
    if (to && new Date(entry.at).getTime() > to.getTime()) return;
    entry.lines.forEach((line, index) => {
      if (line.accountCode !== ACC.bank) return;
      const key = `${entry.no}:${index}`;
      rows.push({
        journalNo: entry.no,
        lineIndex: index,
        key,
        at: entry.at,
        source: entry.source,
        description: line.memo || entry.description,
        debit: line.debit,
        credit: line.credit,
        cleared: cleared.has(key),
      });
    });
  });

  return rows.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );
}

/**
 * يبني التسوية: حركات البنك، وما طوبق منها، والفرق عن رصيد الكشف.
 *
 * الفرق الصفري لا يعني أن كل شيء مطابق، بل أن ما أشّرته يساوي كشفك؛
 * وهذا هو المقصود من التسوية.
 */
export function reconcileBank(
  state: DbState,
  input: { statementBalance?: number; to?: Date } = {}
): ReconcileSummary {
  const movements = bankLines(state, input.to);

  const bookBalance = round2(
    movements.reduce((sum, m) => sum + m.debit - m.credit, 0)
  );
  const clearedBalance = round2(
    movements
      .filter(m => m.cleared)
      .reduce((sum, m) => sum + m.debit - m.credit, 0)
  );
  const uncleared = movements.filter(m => !m.cleared);
  const statementBalance = round2(Number(input.statementBalance || 0));

  return {
    movements,
    bookBalance,
    clearedBalance,
    unclearedCount: uncleared.length,
    unclearedTotal: round2(
      uncleared.reduce((sum, m) => sum + m.debit - m.credit, 0)
    ),
    statementBalance,
    // ما أشّرته ناقص ما يقوله الكشف؛ صفر يعني تسوية سليمة.
    difference: round2(clearedBalance - statementBalance),
  };
}

/** يؤشّر حركة أو يلغي تأشيرها؛ التأشير محفوظ لا يُعاد كل مرة. */
export function toggleCleared(state: DbState, key: string) {
  if (!state.reconciled) state.reconciled = [];
  const index = state.reconciled.indexOf(key);
  if (index >= 0) state.reconciled.splice(index, 1);
  else state.reconciled.push(key);
  return state.reconciled.includes(key);
}

/** يؤشّر كل ما حتى تاريخ معيّن دفعة واحدة. */
export function clearAllUpTo(state: DbState, to: Date) {
  if (!state.reconciled) state.reconciled = [];
  let count = 0;
  bankLines(state, to).forEach(m => {
    if (!state.reconciled!.includes(m.key)) {
      state.reconciled!.push(m.key);
      count++;
    }
  });
  return count;
}
