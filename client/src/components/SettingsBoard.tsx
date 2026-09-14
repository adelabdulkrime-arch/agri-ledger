// Design: «سوق الحقل» — بيانات المحل التي تظهر على الفاتورة النظامية.
import { useState } from "react";
import { Check, ShieldCheck, Store } from "lucide-react";
import type { DbState, ShopSettings } from "../data/types";

type Props = {
  state: DbState;
  onSave: (patch: ShopSettings) => void;
};

const EMPTY: ShopSettings = {
  name: "",
  tradeName: "",
  taxNumber: "",
  crNumber: "",
  address: "",
  phone: "",
  vatRate: 0,
  vatRegistered: false,
};

export default function SettingsBoard({ state, onSave }: Props) {
  const [form, setForm] = useState<ShopSettings>({
    ...EMPTY,
    ...(state.settings || {}),
  });

  const set = <K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      name: form.name.trim(),
      tradeName: form.tradeName.trim(),
      taxNumber: form.taxNumber.trim(),
      crNumber: form.crNumber.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      vatRate: Number(form.vatRate) || 0,
    });
  };

  return (
    <form className="panel table-panel" onSubmit={submit}>
      <div className="table-toolbar">
        <b style={{ fontSize: 13, color: "#284e40" }}>
          <Store size={15} /> بيانات المحل
        </b>
        <button className="primary-btn" type="submit">
          <Check size={16} /> حفظ
        </button>
      </div>

      <div className="form-grid" style={{ padding: 16 }}>
        <label className="field">
          <span>اسم المنشأة</span>
          <input
            value={form.name}
            onChange={e => set("name", e.target.value)}
            placeholder="كما في السجل التجاري"
          />
        </label>
        <label className="field">
          <span>الاسم التجاري</span>
          <input
            value={form.tradeName}
            onChange={e => set("tradeName", e.target.value)}
            placeholder="الاسم الظاهر للعملاء"
          />
        </label>
        <label className="field">
          <span>الرقم الضريبي</span>
          <input
            value={form.taxNumber}
            onChange={e => set("taxNumber", e.target.value)}
            placeholder="إلزامي في الفاتورة الضريبية"
          />
        </label>
        <label className="field">
          <span>السجل التجاري</span>
          <input
            value={form.crNumber}
            onChange={e => set("crNumber", e.target.value)}
            placeholder="اختياري"
          />
        </label>
        <label className="field">
          <span>العنوان</span>
          <input
            value={form.address}
            onChange={e => set("address", e.target.value)}
            placeholder="يظهر على الفاتورة"
          />
        </label>
        <label className="field">
          <span>الهاتف</span>
          <input
            value={form.phone}
            onChange={e => set("phone", e.target.value)}
            placeholder="اختياري"
          />
        </label>
        <label className="field">
          <span>نسبة الضريبة المقترحة %</span>
          <input
            type="number"
            min={0}
            max={100}
            step="0.5"
            value={form.vatRate}
            onChange={e => set("vatRate", Number(e.target.value))}
          />
        </label>
      </div>

      <div className="security-note" style={{ margin: "0 16px 16px" }}>
        <ShieldCheck size={17} />
        <span>
          تفعيل التسجيل الضريبي يغيّر ترحيل المشتريات: تُفصل ضريبة المدخلات
          في حساب مستقل بدل تحميلها على تكلفة المخزون، فتنخفض تكلفة الأصناف
          الجديدة بمقدار الضريبة. الفواتير المرحَّلة سابقًا تبقى كما هي، ولا
          يُعاد حسابها بأثر رجعي.
        </span>
      </div>

      <label
        className="field"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: "0 16px 18px",
        }}
      >
        <input
          type="checkbox"
          checked={form.vatRegistered}
          onChange={e => set("vatRegistered", e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <span>المحل مسجَّل في ضريبة القيمة المضافة</span>
      </label>
    </form>
  );
}
