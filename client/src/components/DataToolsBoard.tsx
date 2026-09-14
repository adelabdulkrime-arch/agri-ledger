// Design: «سوق الحقل» — أدوات البيانات: الجرد الفعلي، تصفير الأرصدة،
// واستيراد الأصناف والعملاء والموردين من ملفات CSV.
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  FileUp,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { csvTemplate, type ImportKind } from "../data/importer";
import type { DbState } from "../data/types";

/** سطر جرد: التكلفة اختيارية، وغيابها يعني إبقاء المتوسط الحالي. */
type TakeLine = {
  productId: number;
  countedQty: number;
  unitCost?: number;
};

type Props = {
  state: DbState;
  money: (v: number) => string;
  onStockTake: (lines: TakeLine[]) => void;
  onResetOpening: () => void;
  onImport: (kind: ImportKind, text: string) => void;
};

const kinds: { id: ImportKind; label: string; hint: string }[] = [
  { id: "products", label: "الأصناف", hint: "الاسم، الباركود، الكمية، التكلفة" },
  { id: "customers", label: "العملاء", hint: "الاسم، الهاتف، نقدي/آجل" },
  { id: "suppliers", label: "الموردون", hint: "الاسم، الهاتف، الرقم الضريبي" },
];

export default function DataToolsBoard({
  state,
  money,
  onStockTake,
  onResetOpening,
  onImport,
}: Props) {
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [costs, setCosts] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ImportKind>("products");

  // نعرض الأصناف التي لها رصيد أو تكلفة أولًا، فهي ما يحتاج جردًا.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.products
      .filter(
        p =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.barcode || "").includes(term)
      )
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 40);
  }, [state.products, search]);

  const withBalances = state.products.filter(
    p => p.stock !== 0 || p.avgCost !== 0
  ).length;

  const submitTake = () => {
    const lines: TakeLine[] = [];
    for (const [id, raw] of Object.entries(counts)) {
      if (raw.trim() === "") continue;
      const productId = Number(id);
      const countedQty = Number(raw);
      // الكمية المعدودة يجب أن تكون رقمًا صفرًا فأكثر ليُحتسب السطر.
      if (!Number.isFinite(countedQty) || countedQty < 0) continue;

      const rawCost = costs[productId];
      const cost = rawCost === undefined || rawCost.trim() === "" ? NaN : Number(rawCost);
      // التكلفة اختيارية؛ نمررها فقط عند إدخال رقم صالح.
      lines.push(
        Number.isFinite(cost) && cost >= 0
          ? { productId, countedQty, unitCost: cost }
          : { productId, countedQty }
      );
    }

    if (!lines.length) {
      toast.error("أدخل كمية معدودة لصنف واحد على الأقل");
      return;
    }
    onStockTake(lines);
    setCounts({});
    setCosts({});
  };

  const downloadTemplate = () => {
    const blob = new Blob([csvTemplate(kind)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `نموذج-${kinds.find(k => k.id === kind)!.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تنزيل النموذج");
  };

  const pickFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImport(kind, String(reader.result));
    reader.onerror = () => toast.error("تعذر قراءة الملف");
    reader.readAsText(file, "utf-8");
  };

  return (
    <>
      <div className="report-section-label">
        <span className="eyebrow">استيراد البيانات</span>
        <b>ترحيل مخزونك وعملائك ومورديك دفعة واحدة</b>
      </div>

      <div className="panel">
        <div className="import-kinds">
          {kinds.map(k => (
            <button
              key={k.id}
              className={kind === k.id ? "selected" : ""}
              onClick={() => setKind(k.id)}
            >
              <b>{k.label}</b>
              <small>{k.hint}</small>
            </button>
          ))}
        </div>
        <div className="import-actions">
          <button className="outline-btn" onClick={downloadTemplate}>
            <Download size={16} /> نزّل النموذج
          </button>
          <button
            className="primary-btn"
            onClick={() => fileRef.current?.click()}
          >
            <FileUp size={17} /> اختر ملف CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={e => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="import-note">
          نزّل النموذج أولًا وعبّئه، فالأعمدة تُقرأ بالعربية أو الإنجليزية بأي
          ترتيب. يُرفض الملف كاملًا إن كان فيه صف خاطئ، فلا تدخل بيانات ناقصة.
        </p>
      </div>

      <div className="report-section-label" style={{ marginTop: 20 }}>
        <span className="eyebrow">الجرد الفعلي</span>
        <b>اضبط الأرصدة والتكاليف على الواقع</b>
      </div>

      {withBalances > 0 && (
        <div className="reset-warn">
          <AlertTriangle size={18} />
          <div>
            <b>{withBalances} صنفًا يحمل رصيدًا أو تكلفة.</b>
            <span>
              إن كانت هذه أرصدة افتراضية من الكتالوج، صفّرها ثم أدخل مخزونك
              الحقيقي، وإلا ظهرت أرباحك أعلى من الواقع.
            </span>
          </div>
          <button className="outline-btn" onClick={onResetOpening}>
            <RotateCcw size={16} /> تصفير الأرصدة
          </button>
        </div>
      )}

      <div className="panel table-panel" style={{ marginTop: 13 }}>
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث عن صنف لجرده…"
            />
          </div>
          <button className="primary-btn" onClick={submitTake}>
            <ClipboardList size={17} /> حفظ الجرد
          </button>
        </div>

        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الرصيد الدفتري</th>
                <th>متوسط التكلفة</th>
                <th>الكمية المعدودة</th>
                <th>التكلفة الحقيقية</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.stock} {p.unit}
                  </td>
                  <td>{money(p.avgCost)}</td>
                  <td>
                    <input
                      className="take-input"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="—"
                      value={counts[p.id] ?? ""}
                      onChange={e =>
                        setCounts(prev => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="take-input"
                      type="number"
                      min={0}
                      step="any"
                      placeholder="اختياري"
                      value={costs[p.id] ?? ""}
                      onChange={e =>
                        setCosts(prev => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
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
