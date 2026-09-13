// Design: «سوق الحقل» — محرك استيراد CSV للأصناف والعملاء والموردين.
// يتحقق من كل صف قبل أي كتابة، فلا يُستورد ملف نصفه صالح.
import type { DbState } from "./types";
import { OperationError, round2 } from "./operations";
import { createCustomer, createSupplier, postStockTake } from "./operations";

export type ImportKind = "products" | "customers" | "suppliers";

export type ImportIssue = { row: number; message: string };

export type ImportResult = {
  kind: ImportKind;
  /** عدد الصفوف التي أُضيفت فعلًا. */
  added: number;
  /** صفوف موجودة سابقًا فحُدّثت بدل تكرارها. */
  updated: number;
  skipped: number;
  issues: ImportIssue[];
};

/**
 * محلل CSV بسيط يدعم الاقتباس والفواصل داخل النص والأسطر المتعددة.
 * كُتب يدويًا بدل مكتبة لأن الحاجة محدودة ولا داعي لحجم إضافي.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // BOM يسبقه Excel عادةً؛ إزالته تمنع تلوث أول عنوان عمود.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/** أسماء الأعمدة المقبولة بالعربية والإنجليزية، لتسهيل ملفات المستخدم. */
const HEADERS: Record<ImportKind, Record<string, string[]>> = {
  products: {
    name: ["الصنف", "الاسم", "name", "product"],
    barcode: ["الباركود", "barcode"],
    category: ["القسم", "الفئة", "category"],
    unit: ["الوحدة", "unit"],
    qty: ["الكمية", "الرصيد", "qty", "quantity", "stock"],
    cost: ["التكلفة", "سعر الشراء", "cost", "unitcost"],
    price: ["سعر البيع", "السعر", "price"],
  },
  customers: {
    name: ["الاسم", "العميل", "name", "customer"],
    phone: ["الهاتف", "الجوال", "phone"],
    terms: ["النوع", "التعامل", "terms"],
    creditLimit: ["حد الائتمان", "creditlimit", "limit"],
    address: ["العنوان", "address"],
  },
  suppliers: {
    name: ["الاسم", "المورد", "name", "supplier"],
    phone: ["الهاتف", "الجوال", "phone"],
    address: ["العنوان", "address"],
    taxNumber: ["الرقم الضريبي", "taxnumber", "tax"],
  },
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** يربط أعمدة الملف بحقول النظام مهما كان ترتيبها أو لغتها. */
function mapColumns(header: string[], kind: ImportKind) {
  const spec = HEADERS[kind];
  const map: Record<string, number> = {};
  header.forEach((col, index) => {
    const key = normalize(col);
    for (const [field, aliases] of Object.entries(spec)) {
      if (map[field] !== undefined) continue;
      if (aliases.some(a => normalize(a) === key)) map[field] = index;
    }
  });
  return map;
}

function num(value: string | undefined) {
  if (value === undefined) return 0;
  // نقبل الأرقام العربية والفواصل الألفية.
  const cleaned = value
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/,/g, "")
    .trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * يستورد ملف CSV إلى الحالة. يتحقق من كل الصفوف أولًا، وإن كان أي صف
 * غير صالح يرمي خطأ قبل الكتابة، فلا تُستورد بيانات ناقصة.
 */
export function importCsv(
  state: DbState,
  kind: ImportKind,
  text: string
): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw new OperationError("الملف فارغ أو لا يحوي صفوف بيانات");

  const map = mapColumns(rows[0], kind);
  if (map.name === undefined)
    throw new OperationError("لم يُعثر على عمود الاسم في الملف");

  const issues: ImportIssue[] = [];
  const body = rows.slice(1);

  // تحقق كامل قبل أي كتابة.
  const prepared = body.map((cols, i) => {
    const rowNo = i + 2;
    const name = (cols[map.name] || "").trim();
    if (!name) issues.push({ row: rowNo, message: "الاسم مفقود" });

    const qty = map.qty !== undefined ? num(cols[map.qty]) : 0;
    const cost = map.cost !== undefined ? num(cols[map.cost]) : 0;
    const price = map.price !== undefined ? num(cols[map.price]) : 0;
    const limit =
      map.creditLimit !== undefined ? num(cols[map.creditLimit]) : 0;

    for (const [label, v] of [
      ["الكمية", qty],
      ["التكلفة", cost],
      ["السعر", price],
      ["حد الائتمان", limit],
    ] as [string, number][]) {
      if (Number.isNaN(v)) issues.push({ row: rowNo, message: `${label} ليست رقمًا` });
      else if (v < 0) issues.push({ row: rowNo, message: `${label} سالبة` });
    }

    return { rowNo, cols, name, qty, cost, price, limit };
  });

  if (issues.length)
    throw new OperationError(
      `الملف يحوي ${issues.length} خطأ. أول خطأ: صف ${issues[0].row} — ${issues[0].message}`
    );

  let added = 0;
  let updated = 0;
  let skipped = 0;

  if (kind === "products") {
    const takeLines: { productId: number; countedQty: number; unitCost: number }[] =
      [];
    prepared.forEach(p => {
      const barcode =
        map.barcode !== undefined ? (p.cols[map.barcode] || "").trim() : "";
      const existing = state.products.find(
        x =>
          (barcode && x.barcode === barcode) ||
          x.name.trim().toLowerCase() === p.name.toLowerCase()
      );

      if (existing) {
        if (p.price > 0) existing.price = round2(p.price);
        takeLines.push({
          productId: existing.id,
          countedQty: p.qty,
          unitCost: p.cost,
        });
        updated++;
        return;
      }

      const id = state.products.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      state.products.push({
        id,
        name: p.name,
        category:
          map.category !== undefined
            ? (p.cols[map.category] || "").trim() || "غير مصنف"
            : "غير مصنف",
        unit:
          map.unit !== undefined
            ? (p.cols[map.unit] || "").trim() || "قطعة"
            : "قطعة",
        stock: 0,
        price: round2(p.price),
        color: "leaf",
        barcode: barcode || `628${String(Date.now()).slice(-6)}${id}`,
        avgCost: 0,
        lastCost: 0,
      });
      takeLines.push({ productId: id, countedQty: p.qty, unitCost: p.cost });
      added++;
    });

    // الكميات تدخل عبر الجرد لتترك أثرًا في سجل الحركات لا كتعديل صامت.
    const withQty = takeLines.filter(l => l.countedQty > 0 || l.unitCost > 0);
    if (withQty.length) postStockTake(state, withQty, "استيراد أرصدة");
  }

  if (kind === "customers") {
    prepared.forEach(p => {
      if (
        state.customers.some(
          c => c.name.trim().toLowerCase() === p.name.toLowerCase()
        )
      ) {
        skipped++;
        return;
      }
      const termsRaw =
        map.terms !== undefined ? normalize(p.cols[map.terms] || "") : "";
      createCustomer(state, {
        name: p.name,
        phone: map.phone !== undefined ? (p.cols[map.phone] || "").trim() : "",
        address:
          map.address !== undefined ? (p.cols[map.address] || "").trim() : "",
        terms:
          termsRaw.includes("آجل") || termsRaw.includes("credit")
            ? "credit"
            : "cash",
        creditLimit: p.limit,
      });
      added++;
    });
  }

  if (kind === "suppliers") {
    prepared.forEach(p => {
      if (
        state.suppliers.some(
          s => s.name.trim().toLowerCase() === p.name.toLowerCase()
        )
      ) {
        skipped++;
        return;
      }
      createSupplier(state, {
        name: p.name,
        phone: map.phone !== undefined ? (p.cols[map.phone] || "").trim() : "",
        address:
          map.address !== undefined ? (p.cols[map.address] || "").trim() : "",
        taxNumber:
          map.taxNumber !== undefined
            ? (p.cols[map.taxNumber] || "").trim()
            : "",
      });
      added++;
    });
  }

  return { kind, added, updated, skipped, issues };
}

/** نموذج CSV جاهز للتعبئة، يشرح الأعمدة المتوقعة للمستخدم. */
export function csvTemplate(kind: ImportKind): string {
  const templates: Record<ImportKind, string> = {
    products:
      "الصنف,الباركود,القسم,الوحدة,الكمية,التكلفة,سعر البيع\nسماد NPK,628100000001,أسمدة,كيس,24,120,185\n",
    customers:
      "الاسم,الهاتف,النوع,حد الائتمان,العنوان\nمزرعة النخيل,770000000,آجل,5000,صنعاء\n",
    suppliers:
      "الاسم,الهاتف,العنوان,الرقم الضريبي\nشركة الوادي,771000000,صنعاء,TX-1\n",
  };
  return "﻿" + templates[kind];
}
