import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  // BASE_URL يساوي "/" محليًا، ومسار المستودع عند النشر على GitHub Pages.
  const base = import.meta.env.BASE_URL || "/";
  window.addEventListener("load", () =>
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch(() => undefined)
  );
}

createRoot(document.getElementById("root")!).render(<App />);
