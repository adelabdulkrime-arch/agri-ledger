// Design: «سوق الحقل» — قارئ الباركود USB يعمل كلوحة مفاتيح؛ نلتقط الأحرف السريعة
// المتتابعة المنتهية بـ Enter ونعتبرها باركودًا، دون إزعاج الكتابة العادية.
import { useEffect, useRef } from "react";
import { usePersistFn } from "./usePersistFn";

/** أقصى فاصل زمني بين حرفين ليُعتبر الإدخال من قارئ آلي لا من يد إنسان. */
const MAX_GAP_MS = 35;
/** أقل عدد أحرف يُقبل كباركود، لتفادي الالتقاط الخاطئ. */
const MIN_LENGTH = 4;

/**
 * يستمع لقارئ الباركود USB على مستوى الصفحة كاملة.
 * لا يحتاج المستخدم لوضع المؤشر في أي حقل — امسح فقط.
 */
export function useUsbScanner(onScan: (code: string) => void, enabled = true) {
  const handleScan = usePersistFn(onScan);
  const buffer = useRef("");
  const lastKeyAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // نتجاهل الكتابة داخل الحقول متعددة الأسطر حتى لا نعطل الملاحظات.
      if (target?.tagName === "TEXTAREA" || target?.isContentEditable) return;

      const now = Date.now();
      // فجوة طويلة تعني بداية إدخال جديد (أو كتابة بشرية).
      if (now - lastKeyAt.current > MAX_GAP_MS) buffer.current = "";
      lastKeyAt.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length >= MIN_LENGTH) {
          // منعُ الافتراضي يوقف إرسال النموذج الذي يسببه القارئ تلقائيًا.
          event.preventDefault();
          handleScan(code);
        }
        return;
      }

      // القارئ يرسل أرقامًا وحروفًا فقط؛ نتجاهل مفاتيح التحكم.
      if (event.key.length === 1) buffer.current += event.key;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, handleScan]);
}
