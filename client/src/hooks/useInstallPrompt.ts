// Design: «سوق الحقل» — زر تثبيت داخل النظام، فالمستخدم لا يعرف قوائم المتصفح.
import { useEffect, useState } from "react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      // التطبيق المثبّت يفتح في وضع standalone، فلا داعي لعرض الزر.
      typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // نمنع شريط المتصفح الافتراضي لنعرض زرًا عربيًا في مكان مفهوم.
      event.preventDefault();
      setDeferred(event as InstallEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // الحدث يُستهلك بعد استخدامه مرة واحدة.
    setDeferred(null);
    return outcome === "accepted";
  };

  return { canInstall: !!deferred && !installed, installed, install };
}
