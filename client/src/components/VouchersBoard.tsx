// Design: «سوق الحقل» — سندات القبض والصرف: مستند مرقّم لكل حركة نقدية.
import { useMemo, useState } from "react";
import { Download, Printer, ReceiptText, Search } from "lucide-react";
import { toast } from "sonner";
import { INSTRUMENT_LABELS, vouchersOf } from "../data/operations";
import type { DbState, Voucher, VoucherKind } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
};

const tabs = [
  { id: "all", label: "الكل" },
  { id: "receipt", label: "سندات القبض" },
  { id: "payment", label: "سندات الصرف" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function VouchersBoard({ state, money }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vouchersOf(
      state,
      tab === "all" ? {} : { kind: tab as VoucherKind }
    ).filter(
      v =>
        !term ||
        v.party.toLowerCase().includes(term) ||
        String(v.no).includes(term) ||
        v.reference.toLowerCase().includes(term)
    );
  }, [state, tab, search]);

  const totals = useMemo(() => {
    const all = vouchersOf(state);
    return {
      received: all
        .filter(v => v.kind === "receipt")
        .reduce((sum, v) => sum + v.amount, 0),
      paid: all
        .filter(v => v.kind === "payment")
        .reduce((sum, v) => sum + v.amount, 0),
    };
  }, [state]);

  const printVoucher = (v: Voucher) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) {
      toast.error("اسمح بالنوافذ المنبثقة للطباعة");
      return;
    }
    const s = state.settings;
    const title = v.kind === "receipt" ? "سند قبض" : "سند صرف";
    const partyLabel = v.kind === "receipt" ? "استلمنا من" : "صرفنا إلى";
    const styles =
      "body{font-family:Arial,sans-serif;padding:28px;color:#16352d}h1{margin:0 0 2px;font-size:22px}h2{margin:0 0 16px;font-size:15px;color:#666;font-weight:normal}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}th,td{border:1px solid #ddd;padding:9px;text-align:right}th{background:#f2f6f2;width:34%}.sign{margin-top:44px;display:flex;justify-content:space-between;font-size:12px;color:#555}";
    win.document.write(
      `<html dir="rtl"><head><meta charset="utf-8"><title>${title} ${v.no}</title><style>${styles}</style></head><body><h1>${s?.tradeName || s?.name || "OneMedia24 ERP"}</h1><h2>${title} رقم ${v.no}</h2><table><tr><th>${partyLabel}</th><td>${v.party}</td></tr><tr><th>المبلغ</th><td><b>${v.amount}</b></td></tr><tr><th>أداة الدفع</th><td>${INSTRUMENT_LABELS[v.instrument]}</td></tr>${v.reference ? `<tr><th>المرجع</th><td>${v.reference}</td></tr>` : ""}${v.refNo ? `<tr><th>المستند</th><td>#${v.refNo}</td></tr>` : ""}<tr><th>التاريخ</th><td>${new Date(v.at).toLocaleString("ar-EG")}</td></tr>${v.note ? `<tr><th>البيان</th><td>${v.note}</td></tr>` : ""}<tr><th>حرّره</th><td>${v.issuedBy}</td></tr></table><div class="sign"><span>توقيع المستلم: ..................</span><span>توقيع المحاسب: ..................</span></div><script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    win.document.close();
  };

  const exportCsv = () => {
    if (!rows.length) {
      toast.error("لا توجد سندات للتصدير");
      return;
    }
    const csv = [
      ["رقم السند", "النوع", "التاريخ", "الطرف", "المبلغ", "الأداة", "المرجع", "حرّره"],
      ...rows.map(v => [
        String(v.no),
        v.kind === "receipt" ? "قبض" : "صرف",
        new Date(v.at).toLocaleString("ar-EG"),
        v.party,
        String(v.amount),
        INSTRUMENT_LABELS[v.instrument],
        v.reference,
        v.issuedBy,
      ]),
    ]
      .map(line => line.map(c => JSON.stringify(c)).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "سندات-القبض-والصرف.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل السندات");
  };

  if (!(state.vouchers || []).length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <ReceiptText />
        </div>
        <h2>لا توجد سندات بعد</h2>
        <p>
          كل تحصيل من عميل يحرّر سند قبض، وكل سداد لمورد يحرّر سند صرف، مرقّمًا
          وقابلًا للطباعة بتوقيع الطرفين.
        </p>
      </div>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">حركة السندات</span>
          <h2>{money(totals.received - totals.paid)}</h2>
          <p>
            قبض {money(totals.received)} · صرف {money(totals.paid)}
          </p>
        </div>
        <div className="report-tools">
          <button className="outline-btn" onClick={exportCsv}>
            <Download size={16} /> CSV
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

      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث برقم السند أو الطرف أو المرجع…"
            />
          </div>
          <b style={{ fontSize: 12, color: "#8a9a91" }}>{rows.length} سندًا</b>
        </div>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>السند</th>
                <th>النوع</th>
                <th>التاريخ</th>
                <th>الطرف</th>
                <th>المبلغ</th>
                <th>الأداة</th>
                <th>المرجع</th>
                <th>طباعة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(v => (
                <tr key={v.no}>
                  <td>
                    <b>#{v.no}</b>
                  </td>
                  <td>
                    <span
                      className={`terms-chip ${v.kind === "receipt" ? "credit" : "cash"}`}
                    >
                      {v.kind === "receipt" ? "قبض" : "صرف"}
                    </span>
                  </td>
                  <td>{new Date(v.at).toLocaleDateString("ar-EG")}</td>
                  <td>{v.party}</td>
                  <td>
                    <b>{money(v.amount)}</b>
                  </td>
                  <td>{INSTRUMENT_LABELS[v.instrument]}</td>
                  <td>{v.reference || "—"}</td>
                  <td>
                    <button
                      className="small-add"
                      onClick={() => printVoucher(v)}
                    >
                      <Printer size={13} /> طباعة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
