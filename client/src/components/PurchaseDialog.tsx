// Design: «سوق الحقل» — شاشة فاتورة الشراء: اختيار المورد، إضافة الأصناف
// بالبحث أو الباركود أو الماسح، ثم الدفع. نفس نمط شاشة البيع الحالية.
import { lazy, Suspense, useMemo, useState } from "react";
import {
  Camera,
  Check,
  PackagePlus,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useUsbScanner } from "../hooks/useUsbScanner";
import { usePersistFn } from "../hooks/usePersistFn";
import type { PaymentMethod, Product, Supplier } from "../data/types";
import { round2 } from "../data/operations";

const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

export type PurchaseDraftLine = {
  productId: number;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  discount: number;
  tax: number;
  /** رقم التشغيلة المطبوع على العبوة؛ يُنشئ دفعة مستقلة بصلاحيتها. */
  lotNo?: string;
  /** صلاحية هذه الدفعة تحديدًا، لا صلاحية الصنف عمومًا. */
  expiryDate?: string;
};

type Props = {
  products: Product[];
  suppliers: Supplier[];
  money: (v: number) => string;
  onSubmit: (input: {
    supplierId: number;
    supplierInvoiceNo: string;
    notes: string;
    paymentMethod: PaymentMethod;
    paid: number;
    lines: PurchaseDraftLine[];
  }) => void;
  onAddSupplier: () => void;
};

export default function PurchaseDialog({
  products,
  suppliers,
  money,
  onSubmit,
  onAddSupplier,
}: Props) {
  const [supplierId, setSupplierId] = useState<number | "">(
    suppliers[0]?.id ?? ""
  );
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<PurchaseDraftLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paid, setPaid] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [scanFeedback, setScanFeedback] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter(
        p =>
          p.name.toLowerCase().includes(term) ||
          (p.barcode || "").includes(term)
      )
      .slice(0, 8);
  }, [products, search]);

  const addLine = usePersistFn((product: Product) => {
    setLines(prev => {
      const existing = prev.find(l => l.productId === product.id);
      if (existing)
        return prev.map(l =>
          l.productId === product.id ? { ...l, qty: l.qty + 1 } : l
        );
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          qty: 1,
          // نقترح آخر تكلفة معروفة لتسريع الإدخال، والمستخدم يعدلها.
          unitCost: product.lastCost || 0,
          discount: 0,
          tax: 0,
          lotNo: "",
          expiryDate: "",
        },
      ];
    });
    setSearch("");
    toast.success(`أضيف ${product.name} للفاتورة`);
  });

  /** نفس منطق الباركود المستخدم في البيع، حتى تتطابق التجربة. */
  const handleBarcode = usePersistFn((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const found = products.find(p => p.barcode === code);
    if (found) {
      addLine(found);
      setScanFeedback(`تمت إضافة ${found.name}`);
      return;
    }
    setSearch(code);
    setScanFeedback(`لا يوجد صنف بالباركود ${code}`);
    toast.info("لا يوجد صنف مسجل بهذا الباركود");
  });

  useUsbScanner(handleBarcode, true);

  const update = (id: number, patch: Partial<PurchaseDraftLine>) =>
    setLines(prev =>
      prev.map(l => (l.productId === id ? { ...l, ...patch } : l))
    );

  const totals = useMemo(() => {
    const subtotal = round2(
      lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)
    );
    const discount = round2(lines.reduce((sum, l) => sum + l.discount, 0));
    const tax = round2(lines.reduce((sum, l) => sum + l.tax, 0));
    return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
  }, [lines]);

  const submit = () => {
    if (supplierId === "") {
      toast.error("اختر موردًا للفاتورة");
      return;
    }
    if (!lines.length) {
      toast.error("أضف صنفًا واحدًا على الأقل");
      return;
    }
    onSubmit({
      supplierId: Number(supplierId),
      supplierInvoiceNo,
      notes,
      paymentMethod,
      paid: paymentMethod === "partial" ? Number(paid || 0) : 0,
      lines,
    });
  };

  if (!suppliers.length)
    return (
      <div className="empty-module" style={{ margin: 0, padding: 46 }}>
        <div className="empty-illustration">
          <ShoppingBag />
        </div>
        <h2>أضف موردًا أولًا</h2>
        <p>فاتورة الشراء تحتاج موردًا مسجلًا لتتبع الحساب والمديونية.</p>
        <button className="primary-btn" onClick={onAddSupplier}>
          <PackagePlus size={18} /> إضافة مورد
        </button>
      </div>
    );

  return (
    <div className="purchase-dialog">
      <div className="purchase-head">
        <label>
          <span>المورد</span>
          <select
            className="category-select"
            value={supplierId}
            onChange={e => setSupplierId(Number(e.target.value))}
          >
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>رقم فاتورة المورد</span>
          <input
            className="plain-input"
            value={supplierInvoiceNo}
            onChange={e => setSupplierInvoiceNo(e.target.value)}
            placeholder="اختياري"
          />
        </label>
      </div>

      <div className="sale-search-row">
        <div className="search-field">
          <Search size={18} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الباركود…"
            autoFocus
          />
        </div>
        <button
          className="camera-btn"
          onClick={() => setShowScanner(true)}
          title="مسح الباركود بالكاميرا"
        >
          <Camera size={19} />
        </button>
      </div>
      <div className="search-hint">
        قارئ USB يعمل تلقائيًا · الأصناف تُضاف بنفس طريقة شاشة البيع
      </div>

      {filtered.length > 0 && (
        <div className="search-results">
          {filtered.map(p => (
            <button key={p.id} onClick={() => addLine(p)}>
              <b>{p.name}</b>
              <small>
                {p.barcode} · الرصيد {p.stock} {p.unit}
              </small>
            </button>
          ))}
        </div>
      )}

      {showScanner && (
        <Suspense
          fallback={<div className="scanner-loading">جارٍ تحضير الماسح…</div>}
        >
          <BarcodeScanner
            onDetected={handleBarcode}
            lastResult={scanFeedback}
            onClose={() => {
              setShowScanner(false);
              setScanFeedback("");
            }}
          />
        </Suspense>
      )}

      <div className="purchase-lines">
        {lines.length ? (
          lines.map(line => (
            <div className="purchase-line" key={line.productId}>
              <div className="purchase-line-name">
                <b>{line.name}</b>
                <small>{line.unit}</small>
              </div>
              <label>
                <span>الكمية</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={line.qty}
                  onChange={e =>
                    update(line.productId, { qty: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>سعر الشراء</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={line.unitCost}
                  onChange={e =>
                    update(line.productId, { unitCost: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>خصم</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={line.discount}
                  onChange={e =>
                    update(line.productId, { discount: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>ضريبة</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={line.tax}
                  onChange={e =>
                    update(line.productId, { tax: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <span>رقم التشغيلة</span>
                <input
                  value={line.lotNo || ""}
                  placeholder="اختياري"
                  onChange={e =>
                    update(line.productId, { lotNo: e.target.value })
                  }
                />
              </label>
              <label>
                <span>الصلاحية</span>
                <input
                  type="date"
                  value={line.expiryDate || ""}
                  onChange={e =>
                    update(line.productId, { expiryDate: e.target.value })
                  }
                />
              </label>
              <strong className="purchase-line-total">
                {money(
                  round2(line.qty * line.unitCost - line.discount + line.tax)
                )}
              </strong>
              <button
                className="row-more"
                title="حذف السطر"
                onClick={() =>
                  setLines(prev =>
                    prev.filter(l => l.productId !== line.productId)
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))
        ) : (
          <div className="empty-cart">
            <ShoppingBag size={28} />
            <span>ابحث عن صنف أو امسح الباركود لإضافته</span>
          </div>
        )}
      </div>

      <div className="purchase-summary">
        <div>
          <span>الإجمالي قبل الخصم</span>
          <b>{money(totals.subtotal)}</b>
        </div>
        <div>
          <span>الخصم</span>
          <b>{money(totals.discount)}</b>
        </div>
        <div>
          <span>الضريبة</span>
          <b>{money(totals.tax)}</b>
        </div>
        <div className="grand">
          <span>الإجمالي</span>
          <b>{money(totals.total)}</b>
        </div>
      </div>

      <div className="payment-row">
        {(
          [
            ["cash", "نقدي"],
            ["credit", "آجل"],
            ["partial", "جزئي"],
          ] as [PaymentMethod, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={paymentMethod === id ? "selected" : ""}
            onClick={() => setPaymentMethod(id)}
          >
            {label}
          </button>
        ))}
        {paymentMethod === "partial" && (
          <input
            type="number"
            min={0}
            step="any"
            className="plain-input"
            value={paid}
            onChange={e => setPaid(e.target.value)}
            placeholder="المبلغ المدفوع"
          />
        )}
      </div>
      {paymentMethod === "partial" && (
        <div className="search-hint">
          المتبقي على الحساب:{" "}
          {money(Math.max(0, round2(totals.total - Number(paid || 0))))}
        </div>
      )}

      <textarea
        className="plain-input notes-input"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="ملاحظات (اختياري)"
        rows={2}
      />

      <button className="primary-btn full" onClick={submit}>
        <Check size={18} /> حفظ الفاتورة وتحديث المخزون
      </button>
    </div>
  );
}
