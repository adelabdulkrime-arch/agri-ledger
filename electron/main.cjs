// Design: «سوق الحقل» — غلاف سطح المكتب: يشغّل الواجهة داخل نافذة مستقلة
// دون متصفح ودون إنترنت، ويمنح الكاميرا إذنها تلقائيًا لمسح الباركود.
const {
  app,
  BrowserWindow,
  net,
  protocol,
  session,
  shell,
  dialog,
} = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// بروتوكول مخصص بدل file: لأن الكاميرا (getUserMedia) لا تعمل إلا في
// سياق آمن، وfile ليس كذلك. التسجيل هنا يمنحه امتيازات السياق الآمن.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// منع فتح أكثر من نسخة: نسختان تعنيان سجلّي بيانات منفصلين على جهاز واحد.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      backgroundColor: "#f7f5ef",
      title: "دفتر الزراعة",
      icon: path.join(__dirname, "icon.png"),
      show: false,
      webPreferences: {
        // الواجهة لا تحتاج Node، وإبقاؤه مطفأً أأمن.
        nodeIntegration: false,
        contextIsolation: true,
        spellcheck: false,
      },
    });

    // نعرض النافذة بعد جاهزية المحتوى لتفادي وميض أبيض عند الإقلاع.
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadURL("app://local/index.html");

    // الروابط الخارجية تفتح في المتصفح لا داخل النافذة.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http")) {
        shell.openExternal(url);
        return { action: "deny" };
      }
      // نوافذ الطباعة (about:blank) تُفتح داخليًا كما هي.
      return { action: "allow" };
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }

  app.whenReady().then(() => {
    const publicDir = path.join(__dirname, "..", "public");

    // نخدم ملفات الواجهة عبر app:// مع منع الخروج خارج مجلد public.
    protocol.handle("app", request => {
      const { pathname } = new URL(request.url);
      const decoded = decodeURIComponent(pathname);
      const target = path.join(publicDir, decoded);
      const relative = path.relative(publicDir, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        return new Response("not found", { status: 404 });
      return net.fetch(pathToFileURL(target).toString());
    });

    // الكاميرا مطلوبة لمسح الباركود؛ نمنحها تلقائيًا لأن التطبيق محلي
    // ولا يتصل بأي خادم، فلا معنى لسؤال المستخدم في كل مرة.
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        callback(permission === "media");
      }
    );

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  // خطأ غير متوقع يجب أن يظهر للمستخدم بالعربية، لا أن يُغلق النافذة صامتًا.
  process.on("uncaughtException", error => {
    dialog.showErrorBox(
      "حدث خطأ في النظام",
      `${error?.message || error}\n\nبياناتك محفوظة. أعد تشغيل البرنامج.`
    );
  });
}
