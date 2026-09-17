// Design: «OneMedia24 ERP» — العملات وأسعار الصرف.
//
// حدٌّ محاسبي يجب أن يبقى واضحًا: الدفاتر تُمسك بعملة واحدة هي عملة
// المنشأة (الريال اليمني افتراضًا). العملة الأجنبية تُحفظ كما أُدخلت
// مع سعر صرفها يوم العملية، ويُرحَّل ما يعادلها محليًا.
//
// بغير ذلك يصير ميزان المراجعة جمعًا لأرقام من عملات مختلفة — رقم بلا
// معنى. ولهذا لا نخزّن «مبلغًا» مجردًا بل مبلغًا وعملةً وسعر صرف.
import type { Currency, CurrencyCode, DbState } from "./types";
import { OperationError, round2 } from "./operations";

function fail(message: string): never {
  throw new OperationError(message);
}

export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  YER: "ريال يمني",
  SAR: "ريال سعودي",
  USD: "دولار أمريكي",
};

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  YER: "ر.ي",
  SAR: "ر.س",
  USD: "$",
};

/** العملات الافتراضية؛ الأسعار تقديرية ويجب أن يضبطها المحل بنفسه. */
export function defaultCurrencies(): Currency[] {
  const at = new Date().toISOString();
  return [
    {
      code: "YER",
      name: CURRENCY_NAMES.YER,
      symbol: CURRENCY_SYMBOLS.YER,
      // العملة المحلية سعرها 1 دائمًا؛ هي المرجع.
      rate: 1,
      updatedAt: at,
    },
    {
      code: "SAR",
      name: CURRENCY_NAMES.SAR,
      symbol: CURRENCY_SYMBOLS.SAR,
      rate: 0,
      updatedAt: at,
    },
    {
      code: "USD",
      name: CURRENCY_NAMES.USD,
      symbol: CURRENCY_SYMBOLS.USD,
      rate: 0,
      updatedAt: at,
    },
  ];
}

export function baseCurrency(state: DbState): CurrencyCode {
  return state.settings?.baseCurrency || "YER";
}

export function currenciesOf(state: DbState): Currency[] {
  return state.currencies?.length ? state.currencies : defaultCurrencies();
}

export function findCurrency(state: DbState, code: CurrencyCode) {
  return currenciesOf(state).find(c => c.code === code);
}

/**
 * يضبط سعر صرف عملة مقابل العملة المحلية.
 *
 * العملة المحلية لا يُغيَّر سعرها: هي المرجع الذي تُقاس عليه البقية،
 * وتغييرها يعني إعادة تقييم كل الدفاتر دفعة واحدة.
 */
export function setRate(
  state: DbState,
  code: CurrencyCode,
  rate: number
): Currency {
  if (!state.currencies?.length) state.currencies = defaultCurrencies();

  const base = baseCurrency(state);
  if (code === base) fail("العملة المحلية سعرها 1 دائمًا ولا يُغيَّر");

  const currency = state.currencies.find(c => c.code === code);
  if (!currency) fail("العملة غير معروفة");

  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0)
    fail("سعر الصرف يجب أن يكون أكبر من صفر");

  currency.rate = round2(value);
  currency.updatedAt = new Date().toISOString();
  return currency;
}

/**
 * يحوّل مبلغًا من عملة إلى ما يعادله محليًا.
 *
 * يرمي خطأً إن كان السعر غير مضبوط: التحويل بسعر صفر يصنع مبلغًا
 * صفريًا في الدفاتر، وهو خطأ صامت أسوأ من الرفض الصريح.
 */
export function toBase(
  state: DbState,
  amount: number,
  code: CurrencyCode
): number {
  const base = baseCurrency(state);
  if (code === base) return round2(amount);

  const currency = findCurrency(state, code);
  if (!currency) fail("العملة غير معروفة");
  if (!currency.rate || currency.rate <= 0)
    fail(`اضبط سعر صرف ${CURRENCY_NAMES[code]} من الإعدادات أولًا`);

  return round2(amount * currency.rate);
}

/** يحوّل من المحلية إلى عملة أجنبية، للعرض لا للترحيل. */
export function fromBase(
  state: DbState,
  amount: number,
  code: CurrencyCode
): number {
  const base = baseCurrency(state);
  if (code === base) return round2(amount);

  const currency = findCurrency(state, code);
  if (!currency || !currency.rate || currency.rate <= 0) return 0;
  return round2(amount / currency.rate);
}

/** تنسيق مبلغ بعملته، للعرض في الشاشات والفواتير. */
export function formatMoney(
  amount: number,
  code: CurrencyCode = "YER"
): string {
  return (
    new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(
      amount
    ) +
    " " +
    CURRENCY_SYMBOLS[code]
  );
}

/** هل العملات الأجنبية مضبوطة وجاهزة للاستعمال؟ */
export function ratesReady(state: DbState) {
  const base = baseCurrency(state);
  return currenciesOf(state)
    .filter(c => c.code !== base)
    .every(c => c.rate > 0);
}
