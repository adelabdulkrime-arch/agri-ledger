// Design: «سوق الحقل» — إدارة وحدات البيع والباركودات الإضافية لصنف واحد.
import { useState } from "react";
import { Barcode, Boxes, Plus, Trash2 } from "lucide-react";
import { unitsOf } from "../data/operations";
import type { Product } from "../data/types";

type Props = {
  product: Product;
  money: (v: number) => string;
  onAddUnit: (unit: {
    name: string;
    factor: number;
    price: number;
    barcode: string;
  }) => void;
  onRemoveUnit: (name: string) => void;
  onAddBarcode: (code: string) => void;
  onRemoveBarcode: (code: string) => void;
};

export default function ProductUnitsDialog({
  product,
  money,
  onAddUnit,
  onRemoveUnit,
  onAddBarcode,
  onRemoveBarcode,
}: Props) {
  const [name, setName] = useState("");
  const [factor, setFactor] = useState("");
  const [price, setPrice] = useState("");
  const [unitBarcode, setUnitBarcode] = useState("");
  const [altCode, setAltCode] = useState("");

  const units = unitsOf(product);

  const submitUnit = () => {
    onAddUnit({
      name,
      factor: Number(factor),
      price: Number(price || 0),
      barcode: unitBarcode,
    });
    setName("");
    setFactor("");
    setPrice("");
    setUnitBarcode("");
  };

  return (
    <div className="purchase-dialog">
      <div className="return-head">
        <Boxes size={18} />
        <span>
          {product.name} · الوحدة الأساسية: {product.unit} · الرصيد{" "}
          {product.stock}
        </span>
      </div>

      <div className="report-section-label">
        <span className="eyebrow">وحدات البيع</span>
        <b>الكرتون والشوال والعبوة</b>
      </div>

      <div className="purchase-lines">
        {units.map(unit => (
          <div className="unit-row" key={unit.name}>
            <div className="purchase-line-name">
              <b>{unit.name}</b>
              <small>
                {unit.factor === 1
                  ? "الوحدة الأساسية"
                  : `${unit.factor} ${product.unit}`}
                {unit.barcode ? ` · ${unit.barcode}` : ""}
              </small>
            </div>
            <strong className="purchase-line-total">
              {money(
                typeof unit.price === "number" && unit.price > 0
                  ? unit.price
                  : product.price * unit.factor
              )}
            </strong>
            {unit.factor !== 1 && (
              <button
                className="row-more"
                onClick={() => onRemoveUnit(unit.name)}
                title="حذف الوحدة"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="unit-form">
        <label>
          <span>اسم الوحدة</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="كرتون"
          />
        </label>
        <label>
          <span>يساوي كم {product.unit}</span>
          <input
            type="number"
            min="0"
            step="any"
            value={factor}
            onChange={e => setFactor(e.target.value)}
            placeholder="12"
          />
        </label>
        <label>
          <span>سعر البيع</span>
          <input
            type="number"
            min="0"
            step="any"
            value={price}
            onChange={e => setPrice(e.target.value)}
            placeholder="اتركه فارغًا للحساب التلقائي"
          />
        </label>
        <label>
          <span>باركود العبوة</span>
          <input
            value={unitBarcode}
            onChange={e => setUnitBarcode(e.target.value)}
            placeholder="اختياري"
          />
        </label>
        <button className="outline-btn" onClick={submitUnit}>
          <Plus size={16} /> إضافة وحدة
        </button>
      </div>

      <div className="report-section-label" style={{ marginTop: 18 }}>
        <span className="eyebrow">الباركودات</span>
        <b>عبوات الموردين المختلفة</b>
      </div>

      <div className="barcode-chips">
        <span className="barcode-chip primary">
          <Barcode size={13} /> {product.barcode}
          <i>أساسي</i>
        </span>
        {(product.altBarcodes || []).map(code => (
          <span className="barcode-chip" key={code}>
            <Barcode size={13} /> {code}
            <button onClick={() => onRemoveBarcode(code)} title="حذف">
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="sale-search-row" style={{ marginTop: 11 }}>
        <div className="search-field">
          <Barcode size={17} />
          <input
            value={altCode}
            onChange={e => setAltCode(e.target.value)}
            placeholder="أضف باركودًا إضافيًا لنفس الصنف"
          />
        </div>
        <button
          className="outline-btn"
          onClick={() => {
            onAddBarcode(altCode);
            setAltCode("");
          }}
        >
          <Plus size={16} /> إضافة
        </button>
      </div>
    </div>
  );
}
