// اختبارات محرك استيراد CSV: التحليل، ربط الأعمدة، والتحقق قبل الكتابة.
import { describe, it, expect, beforeEach } from "vitest";
import { emptyState } from "./store";
import { OperationError } from "./operations";
import { csvTemplate, importCsv, parseCsv } from "./importer";
import type { DbState } from "./types";

let db: DbState;

function run<T>(fn: (draft: DbState) => T): T {
  const draft: DbState = JSON.parse(JSON.stringify(db));
  const out = fn(draft);
  db = draft;
  return out;
}

beforeEach(() => {
  db = emptyState();
});

describe("تحليل CSV", () => {
  it("يحلل الصفوف والأعمدة البسيطة", () => {
    const rows = parseCsv("a,b\n1,2\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("يحترم الفواصل داخل النص المقتبس", () => {
    const rows = parseCsv('name,note\n"سماد, كبير",جيد\n');
    expect(rows[1][0]).toBe("سماد, كبير");
    expect(rows[1][1]).toBe("جيد");
  });

  it("يفك الاقتباس المزدوج", () => {
    const rows = parseCsv('a\n"قال ""مرحبا"""\n');
    expect(rows[1][0]).toBe('قال "مرحبا"');
  });

  it("يتجاهل BOM والأسطر الفارغة", () => {
    const rows = parseCsv("﻿a,b\n\n1,2\n\n");
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe("a");
  });
});

describe("استيراد الأصناف", () => {
  it("يضيف أصنافًا جديدة بأرصدتها وتكلفتها", () => {
    const csv =
      "الصنف,الباركود,القسم,الوحدة,الكمية,التكلفة,سعر البيع\n" +
      "سماد NPK,628100000001,أسمدة,كيس,24,120,185\n";
    const r = run(d => importCsv(d, "products", csv));
    expect(r.added).toBe(1);
    expect(db.products).toHaveLength(1);
    const p = db.products[0];
    expect(p.name).toBe("سماد NPK");
    expect(p.stock).toBe(24);
    expect(p.avgCost).toBe(120);
    expect(p.price).toBe(185);
  });

  it("يترك أثرًا في سجل حركات المخزون لا تعديلًا صامتًا", () => {
    const csv = "الصنف,الكمية,التكلفة\nسماد,10,50\n";
    run(d => importCsv(d, "products", csv));
    const move = db.stockMoves.at(-1)!;
    expect(move.type).toBe("ADJUSTMENT");
    expect(move.qtyAfter).toBe(10);
    expect(move.note).toContain("استيراد");
  });

  it("يحدّث الصنف الموجود بدل تكراره", () => {
    const csv = "الصنف,الكمية,التكلفة\nسماد,10,50\n";
    run(d => importCsv(d, "products", csv));
    const again = run(d =>
      importCsv(d, "products", "الصنف,الكمية,التكلفة\nسماد,15,60\n")
    );
    expect(again.updated).toBe(1);
    expect(db.products).toHaveLength(1);
    expect(db.products[0].stock).toBe(15);
    expect(db.products[0].avgCost).toBe(60);
  });

  it("يقبل الأعمدة بالإنجليزية وبأي ترتيب", () => {
    const csv = "cost,name,qty\n70,مبيد,5\n";
    run(d => importCsv(d, "products", csv));
    expect(db.products[0].name).toBe("مبيد");
    expect(db.products[0].stock).toBe(5);
    expect(db.products[0].avgCost).toBe(70);
  });

  it("يقبل الأرقام العربية والفواصل الألفية", () => {
    const csv = 'الصنف,الكمية,التكلفة\nسماد,٢٤,"1,200"\n';
    run(d => importCsv(d, "products", csv));
    expect(db.products[0].stock).toBe(24);
    expect(db.products[0].avgCost).toBe(1200);
  });
});

describe("رفض الملفات غير الصالحة", () => {
  it("يرفض ملفًا بلا صفوف بيانات", () => {
    expect(() => run(d => importCsv(d, "products", "الصنف\n"))).toThrow(
      /فارغ/
    );
  });

  it("يرفض ملفًا بلا عمود اسم", () => {
    expect(() =>
      run(d => importCsv(d, "products", "الكمية,التكلفة\n5,10\n"))
    ).toThrow(/عمود الاسم/);
  });

  it("يرفض الأرقام السالبة ويذكر رقم الصف", () => {
    expect(() =>
      run(d => importCsv(d, "products", "الصنف,الكمية\nسماد,-5\n"))
    ).toThrow(/صف 2/);
  });

  it("لا يكتب شيئًا عند وجود صف خاطئ", () => {
    const before = JSON.stringify(db);
    expect(() =>
      run(d =>
        importCsv(d, "products", "الصنف,الكمية\nسماد,10\nمبيد,-3\n")
      )
    ).toThrow(OperationError);
    expect(JSON.stringify(db)).toBe(before);
  });
});

describe("استيراد العملاء والموردين", () => {
  it("يستورد العملاء مع تصنيف آجل/نقدي", () => {
    const csv =
      "الاسم,الهاتف,النوع,حد الائتمان\n" +
      "مزرعة النخيل,770,آجل,5000\n" +
      "زبون عابر,771,نقدي,0\n";
    const r = run(d => importCsv(d, "customers", csv));
    expect(r.added).toBe(2);
    expect(db.customers[0].terms).toBe("credit");
    expect(db.customers[0].creditLimit).toBe(5000);
    expect(db.customers[1].terms).toBe("cash");
  });

  it("يتخطى العملاء المكررين", () => {
    run(d => importCsv(d, "customers", "الاسم\nأحمد\n"));
    const again = run(d => importCsv(d, "customers", "الاسم\nأحمد\n"));
    expect(again.skipped).toBe(1);
    expect(db.customers).toHaveLength(1);
  });

  it("يستورد الموردين ببياناتهم", () => {
    const csv = "الاسم,الهاتف,الرقم الضريبي\nشركة الوادي,771,TX-1\n";
    const r = run(d => importCsv(d, "suppliers", csv));
    expect(r.added).toBe(1);
    expect(db.suppliers[0].name).toBe("شركة الوادي");
    expect(db.suppliers[0].taxNumber).toBe("TX-1");
  });
});

describe("النماذج الجاهزة", () => {
  it("توفر نموذجًا صالحًا لكل نوع", () => {
    for (const kind of ["products", "customers", "suppliers"] as const) {
      const tpl = csvTemplate(kind);
      const rows = parseCsv(tpl);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // النموذج نفسه يجب أن يُستورد دون خطأ.
      expect(() => run(d => importCsv(d, kind, tpl))).not.toThrow();
    }
  });
});
