import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

/**
 * جذر الملفات يعمل في صيغتي ESM وCJS معًا: نسخة التطوير تُبنى ESM،
 * ونسخة المحل المستقلة تُبنى CJS لأن express يعتمد require داخليًا.
 */
function resolveDirname(): string {
  // في CJS يكون __dirname معرفًا، وفي ESM نشتقه من import.meta.url.
  if (typeof __dirname !== "undefined") return __dirname;
  // eval يمنع المُحزّم من تحليل import.meta في بناء cjs.
  const url = (0, eval)("import.meta.url") as string;
  return path.dirname(fileURLToPath(url));
}

/** عناوين الشبكة المحلية، ليفتح جهاز آخر النظام على نفس الواي فاي. */
function localAddresses(port: number | string): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal)
        out.push(`http://${net.address}:${port}/`);
    }
  }
  return out;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const dirname = resolveDirname();

  // نسخة المحل تضع public بجوار الملف؛ نسخة التطوير تضعها في dist.
  const candidates = [
    path.resolve(dirname, "public"),
    path.resolve(dirname, "..", "dist", "public"),
  ];
  const staticPath =
    candidates.find(p => {
      try {
        return require("fs").existsSync(path.join(p, "index.html"));
      } catch {
        return false;
      }
    }) || candidates[0];

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log("");
    console.log("  دفتر الزراعة — النظام يعمل الآن");
    console.log("  ================================");
    console.log(`  على هذا الجهاز:  http://localhost:${port}/`);
    for (const url of localAddresses(port))
      console.log(`  من أجهزة الشبكة: ${url}`);
    console.log("");
    console.log("  لإيقاف النظام: أغلق هذه النافذة");
    console.log("");
  });
}

startServer().catch(console.error);
