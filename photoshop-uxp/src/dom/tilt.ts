/**
 * 경계선 기울기 추정. (ROADMAP §17.21)
 *
 * `photoshop` 을 import 하지 않는다. 픽셀 읽기와 분리해 두어야 단위 테스트로
 * 고정할 수 있다 — `camera-raw-keys.ts` · `active-order.ts` 와 같은 이유다.
 *
 * ## 왜 Theil-Sen 인가
 *
 * 최소제곱은 이상치 하나에 끌려간다. 수평선을 재는 자리에는 섬·배·전봇대가
 * 섞이고, 그것들은 경계를 수십 픽셀씩 밀어 올린다. Theil-Sen 은 **모든 쌍의
 * 기울기 중앙값**이라 표본의 절반이 오염될 때까지 버틴다.
 *
 * ## 각도만 주면 위험하다
 *
 * 실기에서 세 번 쟀고 **두 번은 돌리지 않는 것이 답이었다.**
 *
 * ```text
 * 논둑    −1.816°   잔차 IQR 24.6px   직선이 아니었다
 * 종탑     8.366°   잔차 IQR 13.5px   직선이 아니었다
 * 갯벌    −1.873°   잔차 IQR  3.9px   직선이었다 — 교정함
 * ```
 *
 * 세 번 다 그럴듯한 각도가 나왔다. 가른 것은 **잔차**다. 그래서 이 모듈은
 * 기울기와 함께 잔차를 반드시 돌려주고, 어느 쪽도 혼자서는 답이 되지 않는다.
 */

/** 한 줄에서 찾은 경계 위치. `position` 은 서브픽셀이다. */
export interface EdgeSample {
  /** 줄 번호(수평선을 찾을 때는 x). */
  index: number;
  /** 그 줄에서 경계가 있는 좌표(수평선을 찾을 때는 y). */
  position: number;
}

export interface TiltResult {
  /** 기울기(도). 시계 방향이 양수 — `document.rotate` 의 `angle` 과 같은 규약이다. */
  angleDegrees: number;
  /** 기울기(픽셀당 픽셀). 각도로 바꾸기 전 값. */
  slope: number;
  /** 잔차 절대값의 사분위 범위(px). **직선성의 척도다.** */
  residualIqr: number;
  /** 잔차 절대값의 중앙값(px). */
  residualMedian: number;
  /** 잔차 절대값의 최대(px). 하나만 크면 이상치가 남은 것이다. */
  residualMax: number;
  /** 실제로 쓴 표본 수. */
  samples: number;
  /** 표본이 걸친 폭(px). 잔차를 이 값과 견주어 읽는다. */
  spanPixels: number;
  /** 그 폭에서 경계가 오르내린 높이(px). */
  risePixels: number;
}

/**
 * 한 줄의 밝기 프로파일에서 경계를 찾는다.
 *
 * 앞쪽 `edgeMargin` 개와 뒤쪽 `edgeMargin` 개의 평균을 양쪽 밝기로 보고, 그
 * 중간값을 처음 가로지르는 지점을 **선형 보간**으로 집는다. 정수로 반올림하면
 * 기울기 추정이 픽셀 격자에 갇혀 작은 각도를 잡지 못한다.
 *
 * 양쪽 대비가 `minContrast` 미만이면 `null` 이다 — 경계가 없는 줄이다.
 * 0 을 돌려주면 그 줄이 맨 위에 경계가 있다는 틀린 사실을 말하게 된다.
 */
export function findEdge(
  profile: readonly number[],
  minContrast: number,
  edgeMargin: number,
): number | null {
  if (profile.length < edgeMargin * 2 + 2) {
    return null;
  }

  let head = 0;
  let tail = 0;
  for (let i = 0; i < edgeMargin; i += 1) {
    head += profile[i] as number;
    tail += profile[profile.length - 1 - i] as number;
  }
  head /= edgeMargin;
  tail /= edgeMargin;

  if (Math.abs(head - tail) < minContrast) {
    return null;
  }

  // 어느 쪽이 밝은지 짐작하지 않는다. 재서 방향을 정한다.
  const middle = (head + tail) / 2;
  const descending = head > tail;

  for (let i = 1; i < profile.length; i += 1) {
    const previous = profile[i - 1] as number;
    const current = profile[i] as number;
    const crossed = descending
      ? current <= middle && previous > middle
      : current >= middle && previous < middle;
    if (crossed) {
      const delta = previous - current;
      if (delta === 0) {
        return i - 1;
      }
      return i - 1 + (previous - middle) / delta;
    }
  }
  return null;
}

/** 오름차순으로 정렬한 배열에서 분위값. 보간하지 않는다 — 표본이 많아 차이가 없다. */
function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
  return sorted[index] as number;
}

/**
 * Theil-Sen 기울기와 잔차.
 *
 * 쌍의 수는 O(n²) 라 표본이 많으면 느리다. 호출부가 표본을 미리 솎아 넘긴다.
 *
 * `minSeparation` 보다 가까운 쌍은 버린다. 가까운 두 점의 기울기는 서브픽셀
 * 오차에 크게 흔들려 중앙값을 넓힌다.
 */
export function theilSen(samples: readonly EdgeSample[], minSeparation: number): TiltResult | null {
  if (samples.length < 2) {
    return null;
  }

  const slopes: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i] as EdgeSample;
    for (let j = i + 1; j < samples.length; j += 1) {
      const b = samples[j] as EdgeSample;
      const run = b.index - a.index;
      if (run >= minSeparation) {
        slopes.push((b.position - a.position) / run);
      }
    }
  }
  if (slopes.length === 0) {
    return null;
  }

  slopes.sort((x, y) => x - y);
  const slope = quantile(slopes, 0.5);

  // 절편도 중앙값으로 잡는다. 평균을 쓰면 이상치가 선 전체를 들어올린다.
  const intercepts = samples.map((sample) => sample.position - slope * sample.index);
  intercepts.sort((x, y) => x - y);
  const intercept = quantile(intercepts, 0.5);

  const residuals = samples
    .map((sample) => Math.abs(sample.position - (slope * sample.index + intercept)))
    .sort((x, y) => x - y);

  const first = samples[0] as EdgeSample;
  const last = samples[samples.length - 1] as EdgeSample;
  const spanPixels = last.index - first.index;

  return {
    angleDegrees: (Math.atan(slope) * 180) / Math.PI,
    slope,
    residualIqr: quantile(residuals, 0.75) - quantile(residuals, 0.25),
    residualMedian: quantile(residuals, 0.5),
    residualMax: residuals[residuals.length - 1] as number,
    samples: samples.length,
    spanPixels,
    risePixels: slope * spanPixels,
  };
}

/**
 * 표본이 많으면 균등 간격으로 솎는다.
 *
 * Theil-Sen 이 O(n²) 라 5000열이면 1250만 쌍이다. 균등하게 고르면 기울기
 * 추정은 거의 변하지 않으면서 계산이 상수 시간 안에 들어온다. **무작위로
 * 고르지 않는다** — 같은 입력에 같은 답이 나와야 한다.
 */
export function thin<T>(items: readonly T[], limit: number): T[] {
  if (items.length <= limit) {
    return [...items];
  }
  const step = (items.length - 1) / (limit - 1);
  const out: T[] = [];
  for (let i = 0; i < limit; i += 1) {
    out.push(items[Math.round(i * step)] as T);
  }
  return out;
}
