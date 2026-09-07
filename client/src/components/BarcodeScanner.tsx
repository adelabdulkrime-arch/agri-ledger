// Design: «سوق الحقل» — ماسح باركود سهل: إطار استهداف واضح، صوت تأكيد،
// مسح متتابع دون إغلاق، واختيار الكاميرا. يعمل على كل المتصفحات عبر ZXing.
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Camera, CameraOff, Check, RefreshCw, X } from "lucide-react";
import { usePersistFn } from "../hooks/usePersistFn";

/** أقل فاصل بين مسحتين لنفس الرمز، يمنع التكرار عند بقاء الباركود أمام الكاميرا. */
const REPEAT_GUARD_MS = 1200;

const formats = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
];

/** نغمة قصيرة تؤكد المسح دون الحاجة لملف صوتي. */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1760;
    gain.gain.setValueAtTime(0.13, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // الصوت رفاهية؛ فشله لا يمنع المسح.
  }
}

type Props = {
  onDetected: (code: string) => void;
  onClose: () => void;
  /** نص الحالة الأخيرة، مثل اسم الصنف الذي أضيف للسلة. */
  lastResult?: string;
};

export default function BarcodeScanner({
  onDetected,
  onClose,
  lastResult,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleDetected = usePersistFn(onDetected);
  const lastCode = useRef({ value: "", at: 0 });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>();

  useEffect(() => {
    let stopScan: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "هذا المتصفح لا يدعم الكاميرا. استخدم قارئ USB أو البحث اليدوي."
        );
        return;
      }
      try {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
        });

        const controls = await reader.decodeFromVideoDevice(
          deviceId,
          videoRef.current!,
          result => {
            if (!result) return;
            const value = result.getText();
            const now = Date.now();
            // نتجاهل نفس الرمز إذا تكرر سريعًا، فالمسح المتتابع يبقى مفتوحًا.
            if (
              value === lastCode.current.value &&
              now - lastCode.current.at < REPEAT_GUARD_MS
            )
              return;
            lastCode.current = { value, at: now };
            beep();
            handleDetected(value);
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        stopScan = () => controls.stop();
        setReady(true);
        setError("");

        // قائمة الكاميرات تحتاج إذنًا ممنوحًا، لذلك نقرأها بعد التشغيل.
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(list.filter(d => d.kind === "videoinput"));
      } catch (err: any) {
        if (cancelled) return;
        setReady(false);
        setError(
          err?.name === "NotAllowedError"
            ? "لم يُسمح باستخدام الكاميرا. اسمح بالإذن من إعدادات المتصفح، أو استخدم قارئ USB."
            : "تعذر تشغيل الكاميرا. تأكد من عدم استخدامها في تطبيق آخر، أو استخدم قارئ USB."
        );
      }
    };

    start();
    return () => {
      cancelled = true;
      stopScan?.();
    };
  }, [deviceId, handleDetected]);

  const switchCamera = () => {
    if (devices.length < 2) return;
    const index = devices.findIndex(d => d.deviceId === deviceId);
    setDeviceId(devices[(index + 1) % devices.length].deviceId);
    setReady(false);
  };

  return (
    <div className="scanner-body">
      <div className="scanner-stage">
        <video ref={videoRef} muted playsInline className="scanner-video" />
        {!error && (
          <div className={`scanner-frame ${ready ? "live" : ""}`}>
            <i />
            <i />
            <i />
            <i />
            {ready && <span className="scanner-laser" />}
          </div>
        )}
        {!ready && !error && (
          <div className="scanner-overlay-note">
            <Camera size={26} />
            جارٍ تشغيل الكاميرا…
          </div>
        )}
        {error && (
          <div className="scanner-overlay-note error">
            <CameraOff size={26} />
            {error}
          </div>
        )}
      </div>

      <p className="scanner-hint">
        وجّه الكاميرا نحو الباركود داخل الإطار. الماسح يبقى مفتوحًا ليمكنك مسح
        عدة أصناف متتابعة.
      </p>

      {lastResult && (
        <div className="scanner-last">
          <Check size={17} /> {lastResult}
        </div>
      )}

      <div className="scanner-actions">
        {devices.length > 1 && (
          <button className="outline-btn" onClick={switchCamera}>
            <RefreshCw size={17} /> تبديل الكاميرا
          </button>
        )}
        <button className="primary-btn" onClick={onClose}>
          <X size={18} /> إنهاء المسح
        </button>
      </div>
    </div>
  );
}
