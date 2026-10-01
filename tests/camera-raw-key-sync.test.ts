import { CURVE_KEYS, KEYS } from "../photoshop-uxp/src/dom/camera-raw-keys.js";
import { CameraRawParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 서버 스키마와 플러그인 키 표의 **이름 집합**을 맞춘다. (ROADMAP §84)
 *
 * 둘은 다른 프로세스에서 돌고 서로를 import 하지 않는다. 이어 주는 것은 파라미터
 * 이름이라는 약속뿐이다. 스키마에만 이름을 더하면 **오류 없이 값이 버려지고**
 * (`buildCameraRawDescriptor` 는 표에 없는 이름을 건너뛴다), 표에만 더하면 아무도
 * 못 쓰는 죽은 키가 된다. 양쪽 다 이 테스트가 막는다.
 *
 * `layerId` 는 대상 지정이고 `localCorrections` 는 키 표가 아니라 `$LCs` 의 XMP
 * 조립을 타므로 이름 집합에서 뺀다 — 뒤쪽은 `camera-raw.test.ts` 가 따로 고정한다.
 */

const NOT_IN_KEY_TABLE = new Set(["layerId", "localCorrections"]);

/** `.strict().superRefine()` 이 씌운 껍데기를 벗겨 최상위 키를 꺼낸다. */
function schemaKeys(): string[] {
  let node: unknown = CameraRawParamsSchema;
  for (let depth = 0; depth < 5; depth += 1) {
    const shape = (node as { shape?: Record<string, unknown> }).shape;
    if (shape !== undefined) {
      return Object.keys(shape);
    }
    node = (node as { _def?: { schema?: unknown } })._def?.schema;
    if (node === undefined) {
      break;
    }
  }
  throw new Error("CameraRawParamsSchema 의 shape 를 찾지 못했다 — zod 구조가 바뀌었는가?");
}

describe("Camera Raw 스키마 ↔ 키 표", () => {
  const schema = schemaKeys().filter((name) => !NOT_IN_KEY_TABLE.has(name));
  const table = [...Object.keys(KEYS), ...Object.keys(CURVE_KEYS)];

  it("스키마의 모든 이름이 키 표에 있다 — 없으면 조용히 버려진다", () => {
    const missing = schema.filter((name) => !table.includes(name));
    expect(missing).toEqual([]);
  });

  it("키 표의 모든 이름이 스키마에 있다 — 없으면 아무도 못 쓰는 죽은 키다", () => {
    const dead = table.filter((name) => !schema.includes(name));
    expect(dead).toEqual([]);
  });

  it("서로 다른 이름이 같은 descriptor 키로 나가지 않는다", () => {
    const keys = [...Object.values(KEYS), ...Object.values(CURVE_KEYS)];
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicated).toEqual([]);
  });

  it("두 표가 이름을 나눠 갖지 않는다 — 숫자 키와 곡선 키는 다른 경로다", () => {
    const shared = Object.keys(KEYS).filter((name) => name in CURVE_KEYS);
    expect(shared).toEqual([]);
  });

  it("비교 대상이 비어 있지 않다", () => {
    // 껍데기 벗기기가 빈 배열을 돌려주면 위 둘이 헛통과한다.
    expect(schema.length).toBeGreaterThan(50);
    expect(table.length).toBeGreaterThan(50);
  });
});
