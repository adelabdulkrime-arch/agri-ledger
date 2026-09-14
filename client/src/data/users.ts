// Design: «سوق الحقل» — المستخدمون والصلاحيات وسجل التدقيق.
//
// حدٌّ يجب أن يبقى واضحًا: النظام يعمل في المتصفح ويحفظ في localStorage،
// فهذه الصلاحيات ضوابط تشغيلية تمنع الأخطاء وتثبّت المسؤولية، وليست
// حاجزًا أمنيًا. الحماية الحقيقية تحتاج خادمًا يتحقق من كل طلب.
import type {
  AuditEntry,
  DbState,
  Permission,
  User,
  UserRole,
} from "./types";
import { OperationError } from "./operations";
import { nextId } from "./store";

function fail(message: string): never {
  throw new OperationError(message);
}

/** صلاحيات كل دور؛ المالك يملك كل شيء. */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    "sell",
    "purchase",
    "voidInvoice",
    "editCost",
    "viewProfit",
    "manageUsers",
    "closePeriod",
    "stockTake",
    "backup",
  ],
  // المدير يدير المحل لكن لا يضيف مستخدمين ولا يقفل فترات محاسبية.
  manager: [
    "sell",
    "purchase",
    "voidInvoice",
    "editCost",
    "viewProfit",
    "stockTake",
    "backup",
  ],
  // البائع يبيع فقط: لا يرى الأرباح ولا يلغي فاتورة ولا يعدّل التكلفة.
  cashier: ["sell"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "مالك",
  manager: "مدير",
  cashier: "بائع",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  sell: "البيع",
  purchase: "الشراء",
  voidInvoice: "إلغاء الفواتير",
  editCost: "تعديل التكلفة",
  viewProfit: "رؤية الأرباح",
  manageUsers: "إدارة المستخدمين",
  closePeriod: "إقفال الفترات",
  stockTake: "الجرد",
  backup: "النسخ والاستعادة",
};

export function permissionsOf(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/** المستخدم النشط حاليًا على هذا الجهاز. */
export function currentUser(state: DbState): User | undefined {
  if (!state.currentUserId) return undefined;
  return (state.users || []).find(
    u => u.id === state.currentUserId && u.active
  );
}

/**
 * هل يملك المستخدم الحالي هذه الصلاحية؟
 *
 * بلا مستخدمين مسجّلين يُسمح بكل شيء، فالمحل ذو المشغّل الواحد لا
 * ينبغي أن يُجبَر على تسجيل دخول لا يحتاجه.
 */
export function can(state: DbState, permission: Permission): boolean {
  if (!(state.users || []).length) return true;
  const user = currentUser(state);
  if (!user) return false;
  return permissionsOf(user.role).includes(permission);
}

/** يرمي خطأً مفهومًا عند غياب الصلاحية. */
export function requirePermission(state: DbState, permission: Permission) {
  if (!can(state, permission))
    fail(`لا تملك صلاحية ${PERMISSION_LABELS[permission]}`);
}

export function createUser(
  state: DbState,
  input: { name: string; role: UserRole; pin: string }
): User {
  if (!state.users) state.users = [];

  const name = (input.name || "").trim();
  if (!name) fail("اسم المستخدم مطلوب");
  if (state.users.some(u => u.name.trim().toLowerCase() === name.toLowerCase()))
    fail("يوجد مستخدم بنفس الاسم");

  const pin = (input.pin || "").trim();
  if (!/^\d{4,6}$/.test(pin)) fail("رمز الدخول يجب أن يكون 4 إلى 6 أرقام");
  if (state.users.some(u => u.pin === pin))
    fail("رمز الدخول مستخدم؛ اختر رمزًا مختلفًا");

  // أول مستخدم يكون مالكًا دائمًا، وإلا أُغلق النظام على الجميع.
  const role: UserRole = state.users.length === 0 ? "owner" : input.role;

  const user: User = {
    id: nextId(state.users),
    name,
    role,
    pin,
    active: true,
    createdAt: new Date().toISOString(),
  };
  state.users.push(user);
  return user;
}

export function updateUser(
  state: DbState,
  id: number,
  patch: Partial<Pick<User, "name" | "role" | "pin" | "active">>
): User {
  const user = (state.users || []).find(u => u.id === id);
  if (!user) fail("المستخدم غير موجود");

  const owners = state.users.filter(u => u.role === "owner" && u.active);
  // لا يصح تجريد آخر مالك من دوره أو تعطيله، فيبقى النظام بلا مالك.
  if (user.role === "owner" && owners.length === 1) {
    if (patch.role && patch.role !== "owner")
      fail("لا يمكن تغيير دور المالك الوحيد");
    if (patch.active === false) fail("لا يمكن تعطيل المالك الوحيد");
  }

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) fail("اسم المستخدم مطلوب");
    if (
      state.users.some(
        u => u.id !== id && u.name.trim().toLowerCase() === name.toLowerCase()
      )
    )
      fail("يوجد مستخدم بنفس الاسم");
    user.name = name;
  }

  if (patch.pin !== undefined) {
    const pin = patch.pin.trim();
    if (!/^\d{4,6}$/.test(pin)) fail("رمز الدخول يجب أن يكون 4 إلى 6 أرقام");
    if (state.users.some(u => u.id !== id && u.pin === pin))
      fail("رمز الدخول مستخدم؛ اختر رمزًا مختلفًا");
    user.pin = pin;
  }

  if (patch.role !== undefined) user.role = patch.role;
  if (patch.active !== undefined) user.active = patch.active;
  return user;
}

/** دخول برمز؛ يعيد المستخدم أو يرمي خطأً. */
export function login(state: DbState, pin: string): User {
  const code = (pin || "").trim();
  const user = (state.users || []).find(u => u.pin === code && u.active);
  if (!user) fail("رمز الدخول غير صحيح");
  state.currentUserId = user.id;
  return user;
}

export function logout(state: DbState) {
  state.currentUserId = undefined;
}

/** يسجّل حركة في سجل التدقيق باسم المستخدم النشط. */
export function recordAudit(
  state: DbState,
  input: {
    action: string;
    description: string;
    refType?: string;
    refNo?: number;
  }
): AuditEntry {
  if (!state.auditLog) state.auditLog = [];
  const user = currentUser(state);

  const entry: AuditEntry = {
    id: nextId(state.auditLog),
    at: new Date().toISOString(),
    userId: user?.id,
    userName: user?.name || "غير محدد",
    action: input.action,
    description: input.description,
    refType: input.refType,
    refNo: input.refNo,
  };
  state.auditLog.push(entry);

  // السجل لا ينمو بلا حد على جهاز محدود المساحة؛ نحتفظ بالأحدث.
  const MAX = 2000;
  if (state.auditLog.length > MAX)
    state.auditLog = state.auditLog.slice(-MAX);

  return entry;
}

/** سجل التدقيق مرتبًا من الأحدث، مع تصفية اختيارية. */
export function auditTrail(
  state: DbState,
  filter?: { userId?: number; action?: string; from?: Date; to?: Date }
) {
  return (state.auditLog || [])
    .filter(e => {
      if (filter?.userId && e.userId !== filter.userId) return false;
      if (filter?.action && e.action !== filter.action) return false;
      const at = new Date(e.at);
      if (filter?.from && at < filter.from) return false;
      if (filter?.to && at > filter.to) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
      // القيود المسجّلة في نفس الميلي ثانية يفصلها المعرّف التصاعدي.
      return diff !== 0 ? diff : b.id - a.id;
    });
}
