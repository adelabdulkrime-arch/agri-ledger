// Design: «سوق الحقل» — المستخدمون والصلاحيات وسجل التدقيق.
import { useMemo, useState } from "react";
import {
  History,
  LogIn,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  auditTrail,
  currentUser,
  permissionsOf,
} from "../data/users";
import type { DbState, Permission, User } from "../data/types";

type Props = {
  state: DbState;
  onAdd: () => void;
  onEdit: (user: User) => void;
  onLogin: () => void;
  onLogout: () => void;
};

const tabs = [
  { id: "users", label: "المستخدمون" },
  { id: "audit", label: "سجل التدقيق" },
] as const;

type Tab = (typeof tabs)[number]["id"];

const actionLabels: Record<string, string> = {
  postSale: "بيع",
  postPurchase: "شراء",
  voidPurchase: "إلغاء فاتورة",
  postSaleReturn: "مرتجع بيع",
  postPurchaseReturn: "مرتجع شراء",
  addExpense: "مصروف",
  collectFromCustomer: "تحصيل",
  payPurchase: "سداد مورد",
  postStockTake: "جرد",
  resetOpeningBalances: "تصفير الأرصدة",
  closePeriod: "إقفال فترة",
  openCashSession: "فتح وردية",
  closeCashSession: "إقفال وردية",
  login: "دخول",
  logout: "خروج",
  createUser: "إضافة مستخدم",
  updateUser: "تعديل مستخدم",
};

export default function UsersBoard({
  state,
  onAdd,
  onEdit,
  onLogin,
  onLogout,
}: Props) {
  const [tab, setTab] = useState<Tab>("users");
  const [search, setSearch] = useState("");

  const me = currentUser(state);
  const users = state.users || [];

  const log = useMemo(() => {
    const term = search.trim().toLowerCase();
    return auditTrail(state)
      .filter(
        e =>
          !term ||
          e.userName.toLowerCase().includes(term) ||
          e.description.toLowerCase().includes(term)
      )
      .slice(0, 100);
  }, [state, search]);

  if (!users.length)
    return (
      <div className="empty-module">
        <div className="empty-illustration">
          <UserCog />
        </div>
        <h2>لا يوجد مستخدمون</h2>
        <p>
          النظام يعمل الآن بلا تسجيل دخول، وهو المناسب لمحل يديره شخص واحد.
          أضف مستخدمين فقط إن عمل معك موظف وأردت تحديد ما يراه ويفعله، وتثبيت
          من نفّذ كل عملية.
        </p>
        <button className="primary-btn" onClick={onAdd}>
          <Plus size={18} /> إضافة أول مستخدم
        </button>
      </div>
    );

  return (
    <>
      <div className="report-summary">
        <div>
          <span className="eyebrow">الجلسة الحالية</span>
          <h2>{me ? me.name : "لم يسجّل أحد الدخول"}</h2>
          <p>
            {me
              ? `${ROLE_LABELS[me.role]} · ${permissionsOf(me.role).length} صلاحية`
              : "سجّل الدخول لتتمكن من العمل"}
          </p>
        </div>
        <div className="report-tools">
          {me ? (
            <button className="outline-btn" onClick={onLogout}>
              <LogOut size={16} /> خروج
            </button>
          ) : (
            <button className="primary-btn" onClick={onLogin}>
              <LogIn size={17} /> دخول
            </button>
          )}
        </div>
      </div>

      <div className="security-note">
        <ShieldCheck size={17} />
        <span>
          هذه ضوابط تشغيلية تمنع الأخطاء وتثبّت المسؤولية، وليست حاجزًا أمنيًا:
          البيانات محفوظة في متصفح هذا الجهاز، ومن يفتح أدوات المطور يستطيع
          تجاوزها. الحماية الكاملة تحتاج خادمًا.
        </span>
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

      {tab === "users" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <b style={{ fontSize: 13, color: "#284e40" }}>
              {users.length} مستخدمًا
            </b>
            <button className="outline-btn" onClick={onAdd}>
              <Plus size={16} /> مستخدم جديد
            </button>
          </div>
          <div className="ledger-list">
            {users.map(u => (
              <div className="ledger-row" key={u.id}>
                <div className="ledger-mark">
                  <UserCog size={18} />
                </div>
                <div className="ledger-main">
                  <strong>
                    {u.name}
                    <span
                      className={`terms-chip ${u.role === "cashier" ? "cash" : "credit"}`}
                    >
                      {ROLE_LABELS[u.role]}
                    </span>
                    {!u.active && (
                      <span className="terms-chip cash">معطّل</span>
                    )}
                    {me?.id === u.id && (
                      <span className="terms-chip credit">أنت</span>
                    )}
                  </strong>
                  <span>
                    {permissionsOf(u.role)
                      .map(p => PERMISSION_LABELS[p as Permission])
                      .join(" · ")}
                  </span>
                </div>
                <button className="row-more" onClick={() => onEdit(u)}>
                  تعديل
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "audit" && (
        <div className="panel table-panel">
          <div className="table-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ابحث باسم المستخدم أو الوصف…"
              />
            </div>
            <b style={{ fontSize: 12, color: "#8a9a91" }}>
              {(state.auditLog || []).length} حركة مسجّلة
            </b>
          </div>
          {log.length ? (
            <div className="data-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>المستخدم</th>
                    <th>العملية</th>
                    <th>التفاصيل</th>
                    <th>المرجع</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map(e => (
                    <tr key={e.id}>
                      <td>
                        {new Date(e.at).toLocaleString("ar-EG", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td>
                        <b>{e.userName}</b>
                      </td>
                      <td>{actionLabels[e.action] || e.action}</td>
                      <td>{e.description}</td>
                      <td>{e.refNo ? `#${e.refNo}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-cart">
              <History size={26} />
              <span>لا حركات مسجّلة بعد</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
