// Design: «سوق الحقل» — شاشات محرك القيد المزدوج: دليل الحسابات،
// دفتر الأستاذ، قيود اليومية، والقوائم المالية.
import { useMemo, useState } from "react";
import { BookOpen, Download, Lock, Printer, Scale, Search } from "lucide-react";
import { toast } from "sonner";
import {
  accountBalance,
  balanceSheet,
  generalLedger,
  incomeStatement,
} from "../data/ledger";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onClosePeriod: () => void;
};

const tabs = [
  { id: "chart", label: "دليل الحسابات" },
  { id: "ledger", label: "دفتر الأستاذ" },
  { id: "journal", label: "قيود اليومية" },
  { id: "income", label: "قائمة الدخل" },
  { id: "balance", label: "الميزانية" },
] as const;

type Tab = (typeof tabs)[number]["id"];

const typeLabels: Record<string, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};

export default function LedgerBoard({ state, money, onClosePeriod }: Props) {
  const [tab, setTab] = useState<Tab>("chart");
  const [account, setAccount] = useState<string>("");
  const [search, setSearch] = useState("");

  const income = useMemo(() => incomeStatement(state), [state]);
  const balance = useMemo(() => balanceSheet(state), [state]);
  const ledgerRows = useMemo(
    () => (account ? generalLedger(state, account) : []),
    [state, account]
  );

  const chartRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.accounts || [])
      .filter(
        a =>
          !term ||
          a.name.toLowerCase().includes(term) ||
          a.code.includes(term)
      )
      .map(a => ({ ...a, balance: accountBalance(state, a.code) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [state, search]);

  const journalRows = useMemo(
    () => state.journal.slice().reverse().slice(0, 60),
    [state.journal]
  );

  const exportCsv = (rows: string[][], name: string) => {
    if (rows.length < 2) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    const csv = rows
      .map(r => r.map(c => JSON.stringify(c)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم التنزيل");
  };

  const printPanel = (title: string, head: string[], body: string[][]) => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const styles =
      "body{font-family:Arial,sans-serif;padding:22px;color:#16352d}h1{margin:0 0 4px}p{color:#666;margin:0 0 14px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:7px;text-align:right}th{background:#f2f6f2}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style></head><body><h1>${title}</h1><p>حتى ${new Date().toLocaleString("ar-EG")}</p><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`
    );
    win.document.close();
  };

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">الدفاتر المحاسبية</span>
          <h2>القيد المزدوج</h2>
          <p>
            {state.journal.length} قيدًا مرحَّلًا · {(state.accounts || []).length}{" "}
            حسابًا في الدليل
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={onClosePeriod}>
            <Lock size={16} /> إقفال فترة
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

      {tab === "chart" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث برقم الحساب أو اسمه…"
              />
            </div>
            <button
              className="outline-btn"
              onClick={() =>
                exportCsv(
                  [
                    ["رقم", "الحساب", "النوع", "الطبيعة", "الرصيد"],
                    ...chartRows.map(a => [
                      a.code,
                      a.name,
                      typeLabels[a.type] || a.type,
                      a.normalSide === "debit" ? "مدين" : "دائن",
                      String(a.balance),
                    ]),
                  ],
                  "دليل-الحسابات"
                )
              }
            >
              <Download size={16} /> CSV
            </button>
          </div>
          <div className="data-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم</th>
                  <th>الحساب</th>
                  <th>النوع</th>
                  <th>الطبيعة</th>
                  <th>الرصيد</th>
                  <th>الأستاذ</th>
                </tr>
              </thead>
              <tbody>
                {chartRows.map(a => (
                  <tr key={a.code}>
                    <td>{a.code}</td>
                    <td>{a.parent ? `— ${a.name}` : <b>{a.name}</b>}</td>
                    <td>{typeLabels[a.type] || a.type}</td>
                    <td>{a.normalSide === "debit" ? "مدين" : "دائن"}</td>
                    <td>
                      <b>{money(a.balance)}</b>
                    </td>
                    <td>
                      <button
                        className="small-add"
                        onClick={() => {
                          setAccount(a.code);
                          setTab("ledger");
                        }}
                      >
                        <BookOpen size={13} /> عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "ledger" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <select
              className="category-select"
              value={account}
              onChange={e => setAccount(e.target.value)}
            >
              <option value="">— اختر حسابًا —</option>
              {(state.accounts || []).map(a => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
            {account && (
              <button
                className="outline-btn"
                onClick={() =>
                  printPanel(
                    `دفتر أستاذ — ${state.accounts.find(a => a.code === account)?.name}`,
                    ["القيد", "التاريخ", "البيان", "مدين", "دائن", "الرصيد"],
                    ledgerRows.map(r => [
                      `#${r.no}`,
                      new Date(r.at).toLocaleDateString("ar-EG"),
                      r.description,
                      r.debit ? money(r.debit) : "",
                      r.credit ? money(r.credit) : "",
                      money(r.balance),
                    ])
                  )
                }
              >
                <Printer size={16} /> طباعة
              </button>
            )}
          </div>
          {account && ledgerRows.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>القيد</th>
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th>الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((r, i) => (
                    <tr key={`${r.no}-${i}`}>
                      <td>#{r.no}</td>
                      <td>{new Date(r.at).toLocaleDateString("ar-EG")}</td>
                      <td>{r.description}</td>
                      <td>{r.debit ? money(r.debit) : "—"}</td>
                      <td>{r.credit ? money(r.credit) : "—"}</td>
                      <td>
                        <b>{money(r.balance)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <span>
                {account ? "لا توجد حركات على هذا الحساب" : "اختر حسابًا لعرض دفتره"}
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "journal" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              آخر {journalRows.length} قيد من {state.journal.length}
            </b>
          </div>
          {journalRows.length ? (
            <div className="ledger-list">
              {journalRows.map(j => {
                const total = j.lines.reduce((s, l) => s + l.debit, 0);
                return (
                  <div className="journal-entry" key={j.no}>
                    <div className="journal-head">
                      <b>
                        قيد #{j.no}
                        {j.reversedBy && (
                          <span className="terms-chip credit">معكوس</span>
                        )}
                      </b>
                      <span>
                        {new Date(j.at).toLocaleDateString("ar-EG")} ·{" "}
                        {j.description}
                      </span>
                      <strong>{money(total)}</strong>
                    </div>
                    <div className="journal-lines">
                      {j.lines.map((l, i) => {
                        const acc = state.accounts.find(
                          a => a.code === l.accountCode
                        );
                        return (
                          <div className="journal-line" key={i}>
                            <span className={l.credit ? "indent" : ""}>
                              {l.accountCode} · {acc?.name || ""}
                            </span>
                            <span>{l.debit ? money(l.debit) : "—"}</span>
                            <span>{l.credit ? money(l.credit) : "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-cart">
              <span>لا توجد قيود بعد — سجّل أول عملية</span>
            </div>
          )}
        </div>
      )}

      {tab === "income" && (
        <div className="panel">
          <div className="fin-statement">
            <div className="fin-row">
              <span>الإيرادات (بعد المردودات)</span>
              <b>{money(income.revenue)}</b>
            </div>
            <div className="fin-row">
              <span>المصروفات (تشمل تكلفة المبيع)</span>
              <b>({money(income.expenses)})</b>
            </div>
            <div className="fin-row total">
              <span>صافي الدخل</span>
              <b className={income.netIncome >= 0 ? "good-text" : "danger-text"}>
                {money(income.netIncome)}
              </b>
            </div>
            <div className="fin-row">
              <span>هامش الربح</span>
              <b>{income.margin}%</b>
            </div>
          </div>
          <button
            className="outline-btn"
            style={{ marginTop: 14 }}
            onClick={() =>
              printPanel(
                "قائمة الدخل",
                ["البند", "القيمة"],
                [
                  ["الإيرادات", money(income.revenue)],
                  ["المصروفات", money(income.expenses)],
                  ["صافي الدخل", money(income.netIncome)],
                  ["هامش الربح", `${income.margin}%`],
                ]
              )
            }
          >
            <Printer size={16} /> طباعة
          </button>
        </div>
      )}

      {tab === "balance" && (
        <div className="panel">
          <div className="fin-statement">
            <div className="fin-row">
              <span>إجمالي الأصول</span>
              <b>{money(balance.assets)}</b>
            </div>
            <div className="fin-row">
              <span>الخصوم</span>
              <b>{money(balance.liabilities)}</b>
            </div>
            <div className="fin-row">
              <span>حقوق الملكية</span>
              <b>{money(balance.equity)}</b>
            </div>
            <div className="fin-row">
              <span>صافي الدخل</span>
              <b>{money(balance.netIncome)}</b>
            </div>
            <div className="fin-row total">
              <span>الخصوم + حقوق الملكية</span>
              <b>{money(balance.totalLiabilitiesAndEquity)}</b>
            </div>
          </div>
          {!balance.balanced && (
            <div className="reset-warn" style={{ marginTop: 14 }}>
              <Scale size={18} />
              <div>
                <b>الميزانية غير متوازنة</b>
                <span>
                  راجع القيود المرحَّلة؛ الفرق يشير إلى قيد غير مكتمل.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
