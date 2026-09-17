// Design: «سوق الحقل» — بيانات المحل التي تظهر على الفاتورة النظامية.
import { useState } from "react";
import { Check, Coins, ShieldCheck, Store } from "lucide-react";
import { CURRENCY_NAMES, currenciesOf } from "../data/currency";
import type { CurrencyCode, DbState, ShopSettings } from "../data/types";

type Props = {
  state: DbState;
  onSave: (patch: ShopSettings) => void;
  onSetRate: (code: CurrencyCode, rate: number) => void;
};

const EMPTY: ShopSettings = {
  name: "",
  tradeName: "",
  taxNumber: "",
  crNumber: "",
  address: "",
  phone: "",
  vatRate: 0,
  baseCurrency: "YER",
  vatRegistered: false,
};

export default function SettingsBoard({ state, onSave, onSetRate }: Props) {
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
        <label className="field">
          <span>عملة الدفاتر</span>
          <select
            className="category-select"
            value={form.baseCurrency || "YER"}
            onChange={e =>
              set("baseCurrency", e.target.value as CurrencyCode)
            }
          >
            {(Object.keys(CURRENCY_NAMES) as CurrencyCode[]).map(code => (
              <option key={code} value={code}>
                {CURRENCY_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel table-panel" style={{ margin: "0 16px 16px" }}>
        <div className="table-toolbar">
          <b style={{ fontSize: 13, color: "#284e40" }}>
            <Coins size={15} /> أسعار الصرف مقابل عملة الدفاتر
          </b>
        </div>
        <div className="security-note" style={{ margin: "0 0 12px" }}>
          <Coins size={17} />
          <span>
            الدفاتر تُمسك بعملة واحدة. العملة الأجنبية تُحفظ كما أُدخلت مع
            سعر صرفها، ويُرحَّل ما يعادلها محليًا — وإلا صار الميزان جمعًا
            لعملات مختلفة، وهو رقم بلا معنى.
          </span>
        </div>
        <div className="data-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>العملة</th>
                <th>الرمز</th>
                <th>كم تساوي بعملة الدفاتر</th>
                <th>آخر تحديث</th>
              </tr>
            </thead>
            <tbody>
              {currenciesOf(state).map(c => {
                const isBase = c.code === (form.baseCurrency || "YER");
                return (
                  <tr key={c.code}>
                    <td>
                      <b>{c.name}</b>
                      {isBase && (
                        <span className="terms-chip credit">عملة الدفاتر</span>
                      )}
                    </td>
                    <td>{c.symbol}</td>
                    <td>
                      {isBase ? (
                        <span style={{ color: "#8a9a91" }}>1 (المرجع)</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step="any"
                          defaultValue={c.rate || ""}
                          placeholder="اكتب السعر"
                          style={{ width: 130 }}
                          onBlur={e =>
                            onSetRate(c.code, Number(e.target.value || 0))
                          }
                        />
                      )}
                    </td>
                    <td style={{ fontSize: 11.5, color: "#8a9a91" }}>
                      {c.rate
                        ? new Date(c.updatedAt).toLocaleDateString("ar-EG")
                        : "غير مضبوط"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
