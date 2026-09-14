// Design: «سوق الحقل» — محرك القيد المزدوج: دليل الحسابات، ترحيل القيود،
// دفتر الأستاذ، وميزان مراجعة مُرحَّل لا مُستنتَج.
import type {
  Account,
  AccountType,
  DbState,
  JournalEntry,
  JournalLine,
} from "./types";
import { OperationError, round2 } from "./operations";
import { nextNumber } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** رموز الحسابات التي تعتمد عليها القيود الآلية. */
export const ACC = {
  cash: "1100",
  bank: "1110",
  receivables: "1200",
  inventory: "1300",
  /** ضريبة مدخلات مدفوعة للموردين، تُخصم من ضريبة المخرجات لا تُحمَّل على التكلفة. */
  vatInput: "1400",
  payables: "2100",
  vatPayable: "2200",
  capital: "3100",
  retained: "3200",
  sales: "4100",
  salesReturns: "4200",
  cogs: "5100",
  expenses: "5200",
  inventoryAdjust: "5300",
} as const;

/**
 * دليل حسابات افتراضي يغطي دورة محل التجزئة.
 * الترقيم يتبع العرف: 1 أصول، 2 خصوم، 3 حقوق ملكية، 4 إيرادات، 5 مصروفات.
 */
export function defaultChart(): Account[] {
  const a = (
    code: string,
    name: string,
    type: AccountType,
    parent?: string
  ): Account => ({
    code,
    name,
    type,
    // الأصول والمصروفات طبيعتها مدينة، وما عداها دائنة.
    normalSide: type === "asset" || type === "expense" ? "debit" : "credit",
    parent,
    system: true,
    active: true,
  });

  return [
    a("1000", "الأصول", "asset"),
    a(ACC.cash, "الصندوق", "asset", "1000"),
    a(ACC.bank, "البنك", "asset", "1000"),
    a(ACC.receivables, "ذمم مدينة — العملاء", "asset", "1000"),
    a(ACC.inventory, "المخزون", "asset", "1000"),
    a(ACC.vatInput, "ضريبة القيمة المضافة — مدخلات", "asset", "1000"),

    a("2000", "الخصوم", "liability"),
    a(ACC.payables, "ذمم دائنة — الموردون", "liability", "2000"),
    a(ACC.vatPayable, "ضريبة القيمة المضافة المستحقة", "liability", "2000"),

    a("3000", "حقوق الملكية", "equity"),
    a(ACC.capital, "رأس المال", "equity", "3000"),
    a(ACC.retained, "أرباح محتجزة", "equity", "3000"),

    a("4000", "الإيرادات", "revenue"),
    a(ACC.sales, "المبيعات", "revenue", "4000"),
    // مردودات المبيعات حساب مقابل للإيراد: طبيعته مدينة رغم تصنيفه إيرادًا.
    {
      ...a(ACC.salesReturns, "مردودات المبيعات", "revenue", "4000"),
      normalSide: "debit" as const,
    },

    a("5000", "المصروفات", "expense"),
    a(ACC.cogs, "تكلفة البضاعة المباعة", "expense", "5000"),
    a(ACC.expenses, "مصروفات تشغيلية", "expense", "5000"),
    a(ACC.inventoryAdjust, "تسويات المخزون", "expense", "5000"),
  ];
}

/** يهيّئ دليل الحسابات عند أول استخدام دون المساس بحسابات أضافها المستخدم. */
export function ensureChart(state: DbState): number {
  if (!state.accounts) state.accounts = [];
  const existing = new Set(state.accounts.map(x => x.code));
  const missing = defaultChart().filter(x => !existing.has(x.code));
  state.accounts.push(...missing);
  return missing.length;
}

export function findAccount(state: DbState, code: string) {
  return state.accounts.find(x => x.code === code);
}

/** يضيف حسابًا فرعيًا من صنع المستخدم. */
export function createAccount(
  state: DbState,
  input: { code: string; name: string; type: AccountType; parent?: string }
): Account {
  const code = (input.code || "").trim();
  const name = (input.name || "").trim();
  if (!code) fail("رقم الحساب مطلوب");
  if (!name) fail("اسم الحساب مطلوب");
  if (findAccount(state, code)) fail(`الحساب ${code} موجود بالفعل`);
  if (input.parent && !findAccount(state, input.parent))
    fail("الحساب الأب غير موجود");

  const account: Account = {
    code,
    name,
    type: input.type,
    normalSide:
      input.type === "asset" || input.type === "expense" ? "debit" : "credit",
    parent: input.parent,
    system: false,
    active: true,
  };
  state.accounts.push(account);
  return account;
}

/** هل التاريخ يقع داخل فترة مقفلة؟ */
export function isClosed(state: DbState, at: string) {
  const t = new Date(at).getTime();
  return (state.closedPeriods || []).some(
    p => t >= new Date(p.from).getTime() && t <= new Date(p.to).getTime()
  );
}

export type JournalInput = {
  at?: string;
  source: string;
  sourceNo: number;
  description: string;
  lines: { accountCode: string; debit?: number; credit?: number; memo?: string }[];
};

/**
 * يرحّل قيد يومية بعد التحقق من توازنه ومن صحة حساباته.
 * القيد غير المتوازن يُرفض، فلا يدخل الدفتر رقم خاطئ أبدًا.
 */
export function postJournal(state: DbState, input: JournalInput): JournalEntry {
  ensureChart(state);
  const at = input.at || new Date().toISOString();

  if (isClosed(state, at))
    fail("لا يمكن الترحيل: التاريخ يقع في فترة محاسبية مقفلة");

  const lines: JournalLine[] = [];
  input.lines.forEach(raw => {
    const debit = round2(Number(raw.debit || 0));
    const credit = round2(Number(raw.credit || 0));
    if (!Number.isFinite(debit) || !Number.isFinite(credit))
      fail("قيمة القيد غير صحيحة");
    if (debit < 0 || credit < 0) fail("قيم القيد لا تصح أن تكون سالبة");
    // السطر إما مدين أو دائن؛ الجمع بينهما يخفي الخطأ.
    if (debit > 0 && credit > 0)
      fail("السطر لا يصح أن يكون مدينًا ودائنًا معًا");
    if (debit === 0 && credit === 0) return;
    if (!findAccount(state, raw.accountCode))
      fail(`الحساب ${raw.accountCode} غير موجود في الدليل`);

    lines.push({
      accountCode: raw.accountCode,
      debit,
      credit,
      memo: (raw.memo || "").trim(),
    });
  });

  if (!lines.length) fail("القيد بلا سطور");

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.01)
    fail(
      `القيد غير متوازن: مدين ${totalDebit} مقابل دائن ${totalCredit}`
    );

  const entry: JournalEntry = {
    no: nextNumber(state.journal, 1000),
    at,
    source: input.source,
    sourceNo: input.sourceNo,
    description: input.description,
    lines,
  };
  state.journal.push(entry);
  return entry;
}

/**
 * قيد عكسي لإلغاء قيد مرحَّل؛ لا نحذف القيود أبدًا حفاظًا على الأثر.
 */
export function reverseJournal(
  state: DbState,
  no: number,
  reason = "عكس قيد"
): JournalEntry {
  const original = state.journal.find(j => j.no === no);
  if (!original) fail("القيد غير موجود");
  if (original.reversedBy) fail("القيد معكوس بالفعل");

  const entry = postJournal(state, {
    source: original.source,
    sourceNo: original.sourceNo,
    description: `${reason} #${original.no}`,
    // عكس الاتجاه: ما كان مدينًا يصبح دائنًا.
    lines: original.lines.map(l => ({
      accountCode: l.accountCode,
      debit: l.credit,
      credit: l.debit,
      memo: l.memo,
    })),
  });
  original.reversedBy = entry.no;
  return entry;
}

/** رصيد حساب بطبيعته: موجب يعني رصيدًا طبيعيًا. */
export function accountBalance(state: DbState, code: string, to?: Date) {
  const account = findAccount(state, code);
  if (!account) return 0;
  let debit = 0;
  let credit = 0;
  state.journal.forEach(j => {
    if (to && new Date(j.at) > to) return;
    j.lines.forEach(l => {
      if (l.accountCode !== code) return;
      debit += l.debit;
      credit += l.credit;
    });
  });
  return round2(
    account.normalSide === "debit" ? debit - credit : credit - debit
  );
}

/** دفتر أستاذ حساب واحد برصيد تراكمي. */
export function generalLedger(state: DbState, code: string, from?: Date, to?: Date) {
  const account = findAccount(state, code);
  if (!account) return [];
  const rows = state.journal
    .filter(j => {
      const at = new Date(j.at);
      if (from && at < from) return false;
      if (to && at > to) return false;
      return j.lines.some(l => l.accountCode === code);
    })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let running = 0;
  const out: {
    no: number;
    at: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[] = [];

  rows.forEach(j => {
    j.lines
      .filter(l => l.accountCode === code)
      .forEach(l => {
        running = round2(
          account.normalSide === "debit"
            ? running + l.debit - l.credit
            : running + l.credit - l.debit
        );
        out.push({
          no: j.no,
          at: j.at,
          description: l.memo || j.description,
          debit: l.debit,
          credit: l.credit,
          balance: running,
        });
      });
  });
  return out;
}

/** ميزان مراجعة مُرحَّل من القيود الفعلية لا مشتق من الجداول. */
export function postedTrialBalance(state: DbState, to?: Date) {
  const totals = new Map<string, { debit: number; credit: number }>();
  state.journal.forEach(j => {
    if (to && new Date(j.at) > to) return;
    j.lines.forEach(l => {
      const cur = totals.get(l.accountCode) || { debit: 0, credit: 0 };
      cur.debit += l.debit;
      cur.credit += l.credit;
      totals.set(l.accountCode, cur);
    });
  });

  const rows = Array.from(totals.entries())
    .map(([code, v]) => {
      const account = findAccount(state, code);
      const net = round2(v.debit - v.credit);
      return {
        code,
        name: account?.name || code,
        type: account?.type,
        // نعرض الصافي في عموده الطبيعي، كما تُعرض الموازين عادةً.
        debit: net > 0 ? net : 0,
        credit: net < 0 ? Math.abs(net) : 0,
      };
    })
    .filter(r => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return {
    rows,
    totalDebit,
    totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.01,
  };
}

/** قائمة الدخل: الإيرادات ناقص المصروفات خلال فترة. */
export function incomeStatement(state: DbState, from?: Date, to?: Date) {
  let revenue = 0;
  let expenses = 0;
  state.journal.forEach(j => {
    const at = new Date(j.at);
    if (from && at < from) return;
    if (to && at > to) return;
    j.lines.forEach(l => {
      const acc = findAccount(state, l.accountCode);
      if (!acc) return;
      if (acc.type === "revenue") revenue += l.credit - l.debit;
      if (acc.type === "expense") expenses += l.debit - l.credit;
    });
  });
  revenue = round2(revenue);
  expenses = round2(expenses);
  const net = round2(revenue - expenses);
  return {
    revenue,
    expenses,
    netIncome: net,
    margin: revenue > 0 ? round2((net / revenue) * 100) : 0,
  };
}

/** الميزانية العمومية: الأصول = الخصوم + حقوق الملكية + صافي الدخل. */
export function balanceSheet(state: DbState, to?: Date) {
  const sum = (type: AccountType) =>
    round2(
      state.accounts
        .filter(a => a.type === type)
        .reduce((s, a) => s + accountBalance(state, a.code, to), 0)
    );

  const assets = sum("asset");
  const liabilities = sum("liability");
  const equity = sum("equity");
  const income = incomeStatement(state, undefined, to);

  const rightSide = round2(liabilities + equity + income.netIncome);
  return {
    assets,
    liabilities,
    equity,
    netIncome: income.netIncome,
    totalLiabilitiesAndEquity: rightSide,
    balanced: Math.abs(assets - rightSide) < 0.01,
  };
}

/**
 * رصيد افتتاحي للصندوق أو البنك مقابل رأس المال.
 * بدونه يبدأ الميزان مائلًا لأن المشتريات تُنقص النقد من الصفر.
 */
export function postOpeningBalance(
  state: DbState,
  input: { cash?: number; bank?: number; at?: string; note?: string }
): JournalEntry {
  const cash = round2(Number(input.cash || 0));
  const bank = round2(Number(input.bank || 0));
  if (!Number.isFinite(cash) || !Number.isFinite(bank))
    fail("قيمة الرصيد غير صحيحة");
  if (cash < 0 || bank < 0) fail("الرصيد الافتتاحي لا يصح أن يكون سالبًا");
  const total = round2(cash + bank);
  if (total <= 0) fail("أدخل رصيدًا افتتاحيًا أكبر من صفر");

  const lines: JournalInput["lines"] = [];
  if (cash > 0)
    lines.push({ accountCode: ACC.cash, debit: cash, memo: "رصيد افتتاحي" });
  if (bank > 0)
    lines.push({ accountCode: ACC.bank, debit: bank, memo: "رصيد افتتاحي" });
  lines.push({ accountCode: ACC.capital, credit: total, memo: "رأس المال" });

  return postJournal(state, {
    at: input.at,
    source: "opening",
    sourceNo: 0,
    description: input.note?.trim() || "رصيد افتتاحي",
    lines,
  });
}

/** قيد يدوي يكتبه المحاسب مباشرة، لما لا تغطيه العمليات الآلية. */
export function postManualJournal(
  state: DbState,
  input: {
    at?: string;
    description: string;
    lines: { accountCode: string; debit?: number; credit?: number; memo?: string }[];
  }
): JournalEntry {
  const description = (input.description || "").trim();
  if (!description) fail("اكتب بيانًا للقيد");
  return postJournal(state, {
    at: input.at,
    source: "manual",
    sourceNo: 0,
    description,
    lines: input.lines,
  });
}

/** حركة نقدية بين الصندوق والبنك. */
export function transferCash(
  state: DbState,
  input: { from: "cash" | "bank"; amount: number; at?: string; note?: string }
): JournalEntry {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) fail("قيمة التحويل غير صحيحة");
  const fromCode = input.from === "cash" ? ACC.cash : ACC.bank;
  const toCode = input.from === "cash" ? ACC.bank : ACC.cash;

  const available = accountBalance(state, fromCode);
  if (amount > available)
    fail(`الرصيد المتاح هو ${available} فقط`);

  return postJournal(state, {
    at: input.at,
    source: "transfer",
    sourceNo: 0,
    description:
      input.note?.trim() ||
      (input.from === "cash" ? "إيداع في البنك" : "سحب من البنك"),
    lines: [
      { accountCode: toCode, debit: amount, memo: "وارد" },
      { accountCode: fromCode, credit: amount, memo: "صادر" },
    ],
  });
}

/** إقفال فترة: يمنع أي ترحيل بتاريخ داخلها. */
export function closePeriod(
  state: DbState,
  from: string,
  to: string,
  note = ""
) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    fail("تاريخ الإقفال غير صحيح");
  if (start > end) fail("تاريخ البداية بعد تاريخ النهاية");

  const overlap = (state.closedPeriods || []).some(
    p =>
      start <= new Date(p.to) && end >= new Date(p.from)
  );
  if (overlap) fail("الفترة متداخلة مع فترة مقفلة سابقًا");

  state.closedPeriods.push({
    from: start.toISOString(),
    to: end.toISOString(),
    closedAt: new Date().toISOString(),
    note: note.trim(),
  });
  return state.closedPeriods.length;
}
