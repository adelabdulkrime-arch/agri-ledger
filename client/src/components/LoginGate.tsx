// Design: «OneMedia24 ERP» — بوابة الدخول: لا يُفتح النظام قبل تعريف من يشغّله.
//
// حدٌّ يجب أن يبقى واضحًا: هذه بوابة تشغيلية تحدد الدور والمسؤولية، وليست
// حاجزًا أمنيًا. البيانات محفوظة في متصفح هذا الجهاز، ومن يفتح أدوات المطور
// يستطيع تجاوزها. الحماية الحقيقية تحتاج خادمًا يتحقق من كل طلب.
import { useState } from "react";
import { KeyRound, LogIn, ShieldCheck, UserRound } from "lucide-react";
import type { DbState } from "../data/types";

type Props = {
  state: DbState;
  logoUrl: string;
  /** يتحقق من الاسم والرمز؛ يعيد رسالة الخطأ أو فارغًا عند النجاح. */
  onLogin: (name: string, pin: string) => string;
  /** إنشاء أول مستخدم حين يكون النظام فارغًا. */
  onCreateFirst: (name: string, pin: string) => string;
};

export default function LoginGate({
  state,
  logoUrl,
  onLogin,
  onCreateFirst,
}: Props) {
  const users = state.users || [];
  // بلا مستخدمين لا يمكن الدخول أصلًا، فنعرض إنشاء المالك الأول.
  const firstRun = users.length === 0;

  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const message = firstRun
      ? onCreateFirst(name.trim(), pin.trim())
      : onLogin(name.trim(), pin.trim());
    setError(message);
    setBusy(false);
    if (!message) {
      setName("");
      setPin("");
    }
  };

  return (
    <div className="login-gate" dir="rtl">
      <div className="login-card">
        <div className="login-brand">
          <img src={logoUrl} alt="OneMedia24 ERP" />
          <div>
            <strong>OneMedia24 ERP</strong>
            <span>نظام المبيعات والمخزون والمحاسبة</span>
          </div>
        </div>

        {firstRun ? (
          <p className="login-hint">
            لا يوجد مستخدمون بعد. أنشئ حساب المالك الأول؛ وهو الحساب الذي
            يملك كل الصلاحيات ويستطيع إضافة بقية المستخدمين.
          </p>
        ) : (
          <p className="login-hint">
            أدخل اسم المستخدم ورمز الدخول للمتابعة.
          </p>
        )}

        <form onSubmit={submit}>
          <label className="login-field">
            <span>اسم المستخدم</span>
            <div className="login-input">
              <UserRound size={18} />
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={firstRun ? "اسمك" : "اكتب اسمك"}
                autoFocus
                autoComplete="username"
              />
            </div>
          </label>

          <label className="login-field">
            <span>كلمة السر</span>
            <div className="login-input">
              <KeyRound size={18} />
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="من 4 إلى 6 أرقام"
                inputMode="numeric"
                autoComplete="current-password"
              />
            </div>
          </label>

          {error && <div className="login-error">{error}</div>}

          <button className="login-submit" type="submit" disabled={busy}>
            <LogIn size={18} />
            {firstRun ? "إنشاء الحساب والدخول" : "دخول"}
          </button>
        </form>

        <div className="login-note">
          <ShieldCheck size={15} />
          <span>
            ضبط تشغيلي يحدد الدور والمسؤولية، لا حاجز أمني: البيانات محفوظة
            في هذا الجهاز. الحماية الكاملة تحتاج خادمًا.
          </span>
        </div>
      </div>

      <div className="login-rights">
        حقوق الهوية البصرية · One Media
      </div>
    </div>
  );
}
