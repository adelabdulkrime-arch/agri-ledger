import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// عامل الخدمة للعمل دون إنترنت في المتصفح فقط؛ نسخة سطح المكتب تعمل
// ببروتوكول file الذي لا يدعمه، وهي محلية أصلًا فلا تحتاجه.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  // BASE_URL يساوي "/" محليًا، ومسار المستودع عند النشر على GitHub Pages.
  const base = import.meta.env.BASE_URL || "/";
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch(() => undefined)
  );
}

createRoot(document.getElementById("root")!).render(<App />);
