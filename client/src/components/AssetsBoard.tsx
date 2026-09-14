// Design: «سوق الحقل» — الأصول الثابتة وإهلاكها، والمصروفات المدفوعة مقدمًا.
import { useMemo, useState } from "react";
import { CalendarClock, Landmark, Plus, TrendingDown } from "lucide-react";
import {
  assetsSummary,
  bookValue,
  isFullyDepreciated,
  monthKey,
  monthlyAmortization,
  monthlyDepreciation,
  prepaidRemaining,
  prepaidSummary,
} from "../data/assets";
import { EXPENSE_LABELS } from "../data/operations";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  money: (v: number) => string;
  onAddAsset: () => void;
  onAddPrepaid: () => void;
  onPostDepreciation: () => void;
  onPostAmortization: () => void;
};

const tabs = [
  { id: "assets", label: "الأصول الثابتة" },
  { id: "prepaid", label: "مصروفات مقدمة" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export default function AssetsBoard({
  state,
  money,
  onAddAsset,
  onAddPrepaid,
  onPostDepreciation,
  onPostAmortization,
}: Props) {
  const [tab, setTab] = useState<Tab>("assets");

  const assets = useMemo(() => state.fixedAssets || [], [state.fixedAssets]);
  const prepaid = useMemo(
    () => state.prepaidExpenses || [],
    [state.prepaidExpenses]
  );
  const aSummary = useMemo(() => assetsSummary(state), [state]);
  const pSummary = useMemo(() => prepaidSummary(state), [state]);

  const thisMonth = monthKey(new Date());
  const pendingAssets = assets.filter(
    a => a.active && !isFullyDepreciated(a) && a.lastPostedMonth !== thisMonth
  ).length;
  const pendingPrepaid = prepaid.filter(
    e => prepaidRemaining(e) > 0.009 && e.lastPostedMonth !== thisMonth
  ).length;

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">
            {tab === "assets" ? "القيمة الدفترية" : "المتبقي مقدمًا"}
          </span>
          <h2>
            {money(tab === "assets" ? aSummary.bookValue : pSummary.remaining)}
          </h2>
          <p>
            {tab === "assets"
              ? `${aSummary.count} أصلًا · التكلفة ${money(aSummary.cost)} · المجمع ${money(aSummary.accumulated)}`
              : `${pSummary.count} مصروفًا · المدفوع ${money(pSummary.paid)} · المستهلك ${money(pSummary.amortized)}`}
          </p>
        </div>
        <div className="report-tools">
          <button
            className="outline-btn"
            onClick={tab === "assets" ? onAddAsset : onAddPrepaid}
          >
            <Plus size={16} />{" "}
            {tab === "assets" ? "أصل جديد" : "مصروف مقدم"}
          </button>
          <button
            className="primary-btn"
            onClick={
              tab === "assets" ? onPostDepreciation : onPostAmortization
            }
          >
            <TrendingDown size={16} /> ترحيل الشهر
          </button>
        </div>
      </div>

      {(tab === "assets" ? pendingAssets : pendingPrepaid) > 0 && (
        <div className="reset-warn" style={{ marginBottom: 16 }}>
          <CalendarClock size={18} />
          <div>
            <b>
              {tab === "assets" ? pendingAssets : pendingPrepaid} بند لم
              يُرحَّل عن هذا الشهر
            </b>
            <span>
              اضغط «ترحيل الشهر» ليأخذ كل بند نصيبه. الترحيل مرة واحدة لكل
              شهر، فلا خوف من الضغط مرتين.
            </span>
          </div>
        </div>
      )}

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

      <div className="security-note" style={{ marginBottom: 16 }}>
        <Landmark size={17} />
        <span>
          ما دفعتَه اليوم ولم تستهلكه بعد ليس مصروف اليوم: الثلاجة تخدمك
          سنوات، وإيجار السنة يغطي اثني عشر شهرًا. تحميل قيمتهما كاملة على
          شهر الشراء يشوّه ربح ذلك الشهر ويجمّل ما بعده، فيدخلان أصلًا ثم
          يأخذ كل شهر نصيبه.
        </span>
      </div>

      {tab === "assets" && (
        <div className="panel table-panel">
          {assets.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الأصل</th>
                    <th>التكلفة</th>
                    <th>العمر</th>
                    <th>القسط الشهري</th>
                    <th>مجمع الإهلاك</th>
                    <th>القيمة الدفترية</th>
                    <th>آخر ترحيل</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={a.id}>
                      <td>
                        <b>{a.name}</b>
                        {isFullyDepreciated(a) && (
                          <span className="terms-chip cash">مُهلك بالكامل</span>
                        )}
                      </td>
                      <td>{money(a.cost)}</td>
                      <td>{a.usefulLifeYears} سنوات</td>
                      <td>{money(monthlyDepreciation(a))}</td>
                      <td>{money(a.accumulated)}</td>
                      <td>
                        <b>{money(bookValue(a))}</b>
                      </td>
                      <td>{a.lastPostedMonth || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <Landmark size={26} />
              <span>
                لا أصول مسجّلة — أضف الثلاجة والرفوف والسيارة لتعرف قيمتها
                الحقيقية
              </span>
            </div>
          )}
        </div>
      )}

      {tab === "prepaid" && (
        <div className="panel table-panel">
          {prepaid.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>المصروف</th>
                    <th>البند</th>
                    <th>المبلغ</th>
                    <th>المدة</th>
                    <th>نصيب الشهر</th>
                    <th>المستهلك</th>
                    <th>المتبقي</th>
                  </tr>
                </thead>
                <tbody>
                  {prepaid.map(e => (
                    <tr key={e.id}>
                      <td>
                        <b>{e.description}</b>
                      </td>
                      <td>{EXPENSE_LABELS[e.category]}</td>
                      <td>{money(e.amount)}</td>
                      <td>{e.months} شهرًا</td>
                      <td>{money(monthlyAmortization(e))}</td>
                      <td>{money(e.amortized)}</td>
                      <td>
                        <b
                          className={
                            prepaidRemaining(e) > 0 ? "" : "good-text"
                          }
                        >
                          {money(prepaidRemaining(e))}
                        </b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <CalendarClock size={26} />
              <span>
                لا مصروفات مقدمة — سجّل إيجار السنة أو التأمين ليتوزع على
                أشهره
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
