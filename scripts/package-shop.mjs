// يجهّز مجلد «نسخة المحل»: ملفات جاهزة للنسخ على أي جهاز ويندوز
// دون تثبيت حزم، ودون إنترنت بعد أول تشغيل.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";

const root = process.cwd();
const out = path.join(root, "shop-package");
const dist = path.join(root, "dist");

if (!existsSync(path.join(dist, "public", "index.html"))) {
  console.error("خطأ: نفّذ pnpm run build:standalone أولًا");
  process.exit(1);
}

// نبدأ من مجلد نظيف حتى لا تبقى ملفات من نسخة سابقة.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(path.join(dist, "server-standalone.cjs"), path.join(out, "agri-ledger.cjs"));
cpSync(path.join(dist, "public"), path.join(out, "public"), {
  recursive: true,
});

// بقايا قالب Manus: أداة تتبّع لا يستخدمها التطبيق، ولا مكان لها في نسخة المحل.
rmSync(path.join(out, "public", "__manus__"), { recursive: true, force: true });

const launcher = `@echo off
chcp 65001 >nul
title دفتر الزراعة — نظام المبيعات والمخزون
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [تنبيه] برنامج Node.js غير مثبت على هذا الجهاز.
    echo.
    echo   الحل: ثبّت Node.js من https://nodejs.org
    echo   اختر النسخة الموصى بها LTS ثم أعد تشغيل هذا الملف.
    echo.
    pause
    exit /b 1
)

if not exist "public\\index.html" (
    echo.
    echo   [خطأ] ملفات النظام ناقصة.
    echo   تأكد من نسخ المجلد كاملًا بما فيه مجلد public.
    echo.
    pause
    exit /b 1
)

start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"

set NODE_ENV=production
node "agri-ledger.cjs"

echo.
echo   تم إيقاف النظام.
pause
`;
writeFileSync(path.join(out, "START-تشغيل-النظام.bat"), launcher, "utf8");

const readme = `دفتر الزراعة — نظام المبيعات والمخزون
=====================================

التشغيل
-------
انقر نقرًا مزدوجًا على ملف: START-تشغيل-النظام.bat
سيفتح المتصفح تلقائيًا على النظام.

لإيقاف النظام: أغلق النافذة السوداء.


المتطلب الوحيد
--------------
برنامج Node.js مثبت على الجهاز.
إن لم يكن مثبتًا، حمّله من: https://nodejs.org
اختر النسخة الموصى بها (LTS) وثبّتها بالضغط التالي حتى النهاية.
تُثبَّت مرة واحدة فقط.


تثبيت النظام كتطبيق على سطح المكتب
-----------------------------------
بعد فتح النظام في المتصفح، اضغط زر «تثبيت التطبيق» الأصفر
في أعلى الشاشة. سيصبح للنظام أيقونة مستقلة على سطح المكتب
ويفتح كتطبيق عادي دون شريط المتصفح.


أين تُحفظ البيانات؟
--------------------
كل البيانات محفوظة داخل متصفح هذا الجهاز، وتعمل دون إنترنت.
البيانات لا تنتقل تلقائيًا بين الأجهزة.

مهم جدًا: صدّر نسخة احتياطية شهريًا من شاشة «النسخ والاستعادة»
واحفظ الملف على فلاشة أو قرص خارجي. النظام سينبهك عند الحاجة.


استخدام النظام من جهاز آخر في المحل
------------------------------------
عند تشغيل النظام، تظهر في النافذة السوداء عناوين مثل:
http://192.168.1.107:3000/

افتح أحد هذه العناوين من متصفح أي جهاز متصل بنفس شبكة الواي فاي.
ملاحظة: كل جهاز يحتفظ ببياناته الخاصة، فاستخدم جهازًا واحدًا
للتسجيل الفعلي حتى لا تتفرق السجلات.


الدعم
-----
راجع ملف todo.md في مجلد المشروع لتفاصيل المزايا والمراحل القادمة.
`;
writeFileSync(path.join(out, "README-اقرأني.txt"), readme, "utf8");

console.log(`تم تجهيز نسخة المحل في: ${out}`);
console.log("انسخ هذا المجلد كاملًا إلى جهاز المحل.");
