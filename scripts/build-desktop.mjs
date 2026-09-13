// يبني تطبيق سطح المكتب ومثبّت exe عبر electron-builder.
// المسارات نسبية لأن Electron يحمّل الصفحة ببروتوكول file.
import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";

const root = process.cwd();
const staging = path.join(root, "desktop-build");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd, args, env = {}) {
  // ELECTRON_RUN_AS_NODE يجبر Electron على الإقلاع كـ Node عادي، فيصبح
  // require("electron") نصًا بدل الوحدة. نزيله حتى يعمل التحزيم.
  const clean = { ...process.env, ...env };
  delete clean.ELECTRON_RUN_AS_NODE;
  // ويندوز لا يشغّل .cmd عبر execFileSync دون صدفة فينتج EINVAL،
  // وshell: true يحل ذلك. لكنه يعيد قسمة الوسائط على المسافات، ومسار
  // المشروع يحوي مسافة وأقواس، فنقتبس كل وسيط فيه مسافة ليصل كما هو.
  const quoted = args.map(a => (/\s/.test(a) ? `"${a}"` : a));
  execFileSync(cmd, quoted, {
    stdio: "inherit",
    env: clean,
    cwd: root,
    shell: true,
  });
}

console.log("\n[1/3] بناء الواجهة بمسارات نسبية...");
run(npx, ["vite", "build"], { BASE_PATH: "./" });

if (!existsSync(path.join(root, "dist", "public", "index.html"))) {
  console.error("فشل البناء: لم يُنشأ index.html");
  process.exit(1);
}

console.log("\n[2/3] تجهيز ملفات التطبيق...");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

cpSync(path.join(root, "dist", "public"), path.join(staging, "public"), {
  recursive: true,
});
// بقايا قالب Manus لا مكان لها في تطبيق يعمل دون إنترنت.
rmSync(path.join(staging, "public", "__manus__"), {
  recursive: true,
  force: true,
});
cpSync(path.join(root, "electron"), path.join(staging, "electron"), {
  recursive: true,
});

// package.json مستقل للتطبيق، حتى لا يحزم electron-builder تبعيات التطوير.
writeFileSync(
  path.join(staging, "package.json"),
  JSON.stringify(
    {
      name: "agri-ledger",
      productName: "Agri Ledger",
      version: "1.0.0",
      description: "نظام مبيعات ومخزون ومحاسبة لمحل الأسمدة والمعدات الزراعية",
      main: "electron/main.cjs",
      author: "Agri Ledger",
      license: "UNLICENSED",
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log("\n[3/3] بناء المثبّت (قد يستغرق دقائق)...");
cpSync(
  path.join(root, "electron-builder.json"),
  path.join(staging, "electron-builder.json")
);
run(npx, [
  "electron-builder",
  "--win",
  "--x64",
  "--config",
  "electron-builder.json",
  "--projectDir",
  staging,
]);

console.log("\nتم. المثبّت في مجلد: installer/");
