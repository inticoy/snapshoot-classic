/**
 * 결정적 수학 함수 (멀티플레이 락스텝용).
 *
 * Math.sin·cos·atan2·exp·log·pow·hypot 등은 표준이 정확한 반올림을 요구하지 않아 엔진마다 마지막 비트가 다르다.
 * 실측: 같은 입력 기록이 Chromium(V8)과 WebKit(JSC)에서 31초째부터 다른 경기가 됐다.
 * 그래서 덧셈·곱셈·나눗셈·sqrt(이건 IEEE 754가 정확한 반올림을 보장)만으로 계산하는 fdlibm 방식 구현으로 바꿔 끼운다.
 * 게임 시작 전에 installDeterministicMath()를 한 번 부른다 (화면·서버·검증 모두 같은 함수를 쓰게).
 */

// ---------------------------------------------------------------- 비트 조작 (2^k, 지수·가수 분리)
const buf = new DataView(new ArrayBuffer(8));
function pow2(k: number): number {
  // 정규수 범위 밖은 두 번에 나눠 곱한다
  if (k > 1023) return pow2(1023) * pow2(k - 1023);
  if (k < -1022) return pow2(-1022) * pow2(k + 1022);
  buf.setUint32(0, (k + 1023) << 20);
  buf.setUint32(4, 0);
  return buf.getFloat64(0);
}
/** x = m · 2^e, m ∈ [1, 2) (x > 0, 정규수) */
function frexp(x: number): [number, number] {
  let scale = 0;
  if (x < 2.2250738585072014e-308) { x *= 18014398509481984; scale = -54; } // 비정규수
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const e = ((hi >>> 20) & 0x7ff) - 1023;
  buf.setUint32(0, (hi & 0x800fffff) | (1023 << 20));
  return [buf.getFloat64(0), e + scale];
}

// ---------------------------------------------------------------- sin / cos
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function ksin(x: number): number {
  const z = x * x, v = z * x;
  return x + v * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kcos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z, w = 1 - hz;
  return w + (((1 - w) - hz) + z * r);
}
const INV_PIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11;
/** x = n·π/2 + y (Cody-Waite, 게임에서 쓰는 크기의 각도면 충분히 정확) */
function reduce(x: number): [number, number] {
  const n = Math.round(x * INV_PIO2);
  return [n, (x - n * PIO2_1) - n * PIO2_1T];
}
export function dsin(x: number): number {
  if (!isFinite(x)) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return ksin(x);
  const [n, y] = reduce(x);
  switch (n & 3) {
    case 0: return ksin(y);
    case 1: return kcos(y);
    case 2: return -ksin(y);
    default: return -kcos(y);
  }
}
export function dcos(x: number): number {
  if (!isFinite(x)) return NaN;
  if (Math.abs(x) < 0.7853981633974483) return kcos(x);
  const [n, y] = reduce(x);
  switch (n & 3) {
    case 0: return kcos(y);
    case 1: return -ksin(y);
    case 2: return -kcos(y);
    default: return ksin(y);
  }
}

// ---------------------------------------------------------------- atan / atan2
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
export function datan(x0: number): number {
  if (isNaN(x0)) return NaN;
  const neg = x0 < 0;
  let x = Math.abs(x0);
  if (x >= 7.378697629483821e19) return neg ? -ATANHI[3] - ATANLO[3] : ATANHI[3] + ATANLO[3];
  let id = -1;
  if (x >= 0.4375) {
    if (x < 1.1875) {
      if (x < 0.6875) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
    } else if (x < 2.4375) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const r = id < 0 ? x - x * (s1 + s2) : ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return neg ? -r : r;
}
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;
export function datan2(y: number, x: number): number {
  if (isNaN(x) || isNaN(y)) return NaN;
  if (y === 0) {
    const negX = x < 0 || Object.is(x, -0);
    return negX ? (Object.is(y, -0) ? -PI : PI) : y;
  }
  if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
  if (!isFinite(x) || !isFinite(y)) {
    if (!isFinite(x) && !isFinite(y)) return (x > 0 ? PI / 4 : 3 * PI / 4) * Math.sign(y);
    if (!isFinite(y)) return y > 0 ? PI / 2 : -PI / 2;
    return x > 0 ? (y > 0 ? 0 : -0) : (y > 0 ? PI : -PI);
  }
  const z = datan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

// ---------------------------------------------------------------- exp / log / pow
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
export function dexp(x: number): number {
  if (isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI, lo = k * LN2_LO, r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
  return y * pow2(k);
}
const LG = [6.666666666666735130e-01, 3.999999999940941908e-01, 2.857142874366239149e-01, 2.222219843214978396e-01,
  1.818357216161805012e-01, 1.531383769920937332e-01, 1.479819860511658591e-01];
export function dlog(x: number): number {
  if (isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let [m, k] = frexp(x);
  if (m > Math.SQRT2) { m *= 0.5; k += 1; }
  const f = m - 1;
  const s = f / (2 + f), z = s * s, w = z * z;
  const t1 = w * (LG[1] + w * (LG[3] + w * LG[5]));
  const t2 = z * (LG[0] + w * (LG[2] + w * (LG[4] + w * LG[6])));
  const R = t2 + t1, hfsq = 0.5 * f * f;
  return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (isNaN(x) || isNaN(y)) return NaN;
  // 작은 정수 지수는 곱셈으로 (정확하고 빠르다)
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let r = 1, b = x, e = Math.abs(y);
    while (e > 0) { if (e & 1) r *= b; b *= b; e >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (y === 0.5 && x >= 0) return Math.sqrt(x);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = dexp(y * dlog(-x));
    return y % 2 === 0 ? r : -r;
  }
  return dexp(y * dlog(x));
}
export function dhypot(...v: number[]): number {
  let s = 0;
  for (const a of v) {
    if (a === Infinity || a === -Infinity) return Infinity;
    s += a * a;
  }
  return Math.sqrt(s);
}

let installed = false;
/** Math의 엔진 의존 함수를 결정적 구현으로 바꿔 끼운다 (한 번만) */
export function installDeterministicMath(): void {
  if (installed) return;
  installed = true;
  const M = Math as unknown as Record<string, unknown>;
  M.sin = dsin;
  M.cos = dcos;
  M.tan = (x: number) => dsin(x) / dcos(x);
  M.atan = datan;
  M.atan2 = datan2;
  M.asin = (x: number) => (Math.abs(x) > 1 ? NaN : datan2(x, Math.sqrt((1 - x) * (1 + x))));
  M.acos = (x: number) => (Math.abs(x) > 1 ? NaN : datan2(Math.sqrt((1 - x) * (1 + x)), x));
  M.exp = dexp;
  M.expm1 = (x: number) => dexp(x) - 1;
  M.log = dlog;
  M.log1p = (x: number) => dlog(1 + x);
  M.log2 = (x: number) => dlog(x) / LN2_HI_FULL;
  M.log10 = (x: number) => dlog(x) / LN10;
  M.pow = dpow;
  M.hypot = dhypot;
  M.cbrt = (x: number) => (x < 0 ? -dpow(-x, 1 / 3) : dpow(x, 1 / 3));
  M.sinh = (x: number) => (dexp(x) - dexp(-x)) / 2;
  M.cosh = (x: number) => (dexp(x) + dexp(-x)) / 2;
  M.tanh = (x: number) => { const e = dexp(2 * x); return e === Infinity ? 1 : (e - 1) / (e + 1); };
}
const LN2_HI_FULL = 0.6931471805599453, LN10 = 2.302585092994046;
