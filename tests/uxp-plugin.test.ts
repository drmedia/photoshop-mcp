import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { CommandDispatcher, DispatchError } from "../photoshop-uxp/src/dispatcher/dispatcher.js";
import { orderActiveLayers } from "../photoshop-uxp/src/dom/active-order.js";
import { toBitDepth, toColorMode, toLayerType } from "../photoshop-uxp/src/dom/mappings.js";

/**
 * UXP Plugin 중 Photoshop 런타임에 의존하지 않는 부분만 검증한다.
 *
 * `dom/document.ts` · `dom/layers.ts` 의 Photoshop DOM 호출부는
 * Photoshop 런타임이 필요하므로 실기 확인 대상이다.
 */

describe("CommandDispatcher", () => {
  it("등록한 Command 를 실행하고 payload 를 전달한다", async () => {
    const dispatcher = new CommandDispatcher();
    dispatcher.register("ECHO", async (payload) => ({ echoed: payload["value"] }));

    await expect(dispatcher.dispatch("ECHO", { value: 7 })).resolves.toEqual({ echoed: 7 });
    expect(dispatcher.has("ECHO")).toBe(true);
    expect(dispatcher.list()).toEqual(["ECHO"]);
  });

  it("중복 등록을 거부한다", () => {
    const dispatcher = new CommandDispatcher();
    dispatcher.register("PING", async () => null);

    expect(() => dispatcher.register("PING", async () => null)).toThrow(DispatchError);
    expect(dispatcher.list()).toEqual(["PING"]);
  });

  it("등록되지 않은 Command 는 COMMAND_NOT_SUPPORTED 를 던진다", async () => {
    const dispatcher = new CommandDispatcher();
    dispatcher.register("DOCUMENT_GET", async () => null);

    try {
      await dispatcher.dispatch("LAYER_DUPLICATE", {});
      expect.unreachable("알 수 없는 Command 가 거부되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(DispatchError);
      const dispatchError = error as DispatchError;
      expect(dispatchError.code).toBe("COMMAND_NOT_SUPPORTED");
      expect(dispatchError.details).toEqual({
        command: "LAYER_DUPLICATE",
        registered: ["DOCUMENT_GET"],
      });
    }
  });

  it("핸들러의 DispatchError 는 코드를 유지한다", async () => {
    const dispatcher = new CommandDispatcher();
    dispatcher.register("DOCUMENT_GET", async () => {
      throw new DispatchError("DOCUMENT_NOT_FOUND", "없음", { recoverable: true });
    });

    await expect(dispatcher.dispatch("DOCUMENT_GET", {})).rejects.toThrow(
      expect.objectContaining({ code: "DOCUMENT_NOT_FOUND", recoverable: true }),
    );
  });

  it("그 외 예외는 COMMAND_FAILED 로 정규화한다", async () => {
    const dispatcher = new CommandDispatcher();
    dispatcher.register("BOOM", async () => {
      throw new TypeError("예상치 못한 실패");
    });

    try {
      await dispatcher.dispatch("BOOM", {});
      expect.unreachable("예외가 전파되지 않았습니다");
    } catch (error) {
      const dispatchError = error as DispatchError;
      expect(dispatchError.code).toBe("COMMAND_FAILED");
      expect(dispatchError.message).toBe("예상치 못한 실패");
    }
  });

  it("오류를 프로토콜 오류 객체로 직렬화한다", () => {
    const withDetails = new DispatchError("LAYER_NOT_FOUND", "레이어 없음", {
      details: { layerId: 25 },
      recoverable: true,
    });
    expect(withDetails.toErrorPayload()).toEqual({
      code: "LAYER_NOT_FOUND",
      message: "레이어 없음",
      details: { layerId: 25 },
      recoverable: true,
    });

    // details 가 없으면 키를 넣지 않는다.
    expect(new DispatchError("COMMAND_FAILED", "실패").toErrorPayload()).toEqual({
      code: "COMMAND_FAILED",
      message: "실패",
      recoverable: false,
    });
  });
});

describe("Photoshop 열거형 매핑", () => {
  it("실기에서 관측된 bitDepthNN 형식을 처리한다", () => {
    // Photoshop 27.8 실제 반환 값
    expect(toBitDepth("bitDepth8")).toEqual({ bitDepth: 8 });
    expect(toBitDepth("bitDepth16")).toEqual({ bitDepth: 16 });
    expect(toBitDepth("bitDepth32")).toEqual({ bitDepth: 32 });
  });

  it("bitsPerChannel 문자열과 숫자를 모두 처리한다", () => {
    expect(toBitDepth("eight")).toEqual({ bitDepth: 8 });
    expect(toBitDepth("sixteen")).toEqual({ bitDepth: 16 });
    expect(toBitDepth("thirtyTwo")).toEqual({ bitDepth: 32 });
    expect(toBitDepth("one")).toEqual({ bitDepth: 1 });
    expect(toBitDepth(16)).toEqual({ bitDepth: 16 });
  });

  it("알 수 없는 bitsPerChannel 은 null 과 원본을 돌려준다", () => {
    // 8 로 떨어뜨리면 16/32비트 문서를 8비트로 오인하게 만든다.
    // 실기에서 실제로 16비트 문서가 8 로 보고되었다.
    expect(toBitDepth("sixtyFour")).toEqual({ bitDepth: null, raw: "sixtyFour" });
    expect(toBitDepth(undefined)).toEqual({ bitDepth: null, raw: "undefined" });
    expect(toBitDepth(Number.NaN)).toEqual({ bitDepth: null, raw: "NaN" });
  });

  it("DocumentMode 를 프로토콜 표기로 정규화한다", () => {
    expect(toColorMode("RGB")).toBe("RGB");
    expect(toColorMode("rgbColor")).toBe("RGB");
    expect(toColorMode("grayscale")).toBe("Grayscale");
    expect(toColorMode("labColor")).toBe("Lab");
    expect(toColorMode("indexedColor")).toBe("Indexed");
  });

  it("알 수 없는 DocumentMode 는 원본을 유지한다", () => {
    expect(toColorMode("someFutureMode")).toBe("someFutureMode");
  });

  it("LayerKind 를 프로토콜 type 으로 매핑한다", () => {
    expect(toLayerType("group")).toEqual({ type: "group" });
    expect(toLayerType("layerSection")).toEqual({ type: "group" });
    expect(toLayerType("text")).toEqual({ type: "text" });
    expect(toLayerType("smartObject")).toEqual({ type: "smartObject" });
    expect(toLayerType("curves")).toEqual({ type: "adjustment" });
    expect(toLayerType("brightnessContrast")).toEqual({ type: "adjustment" });
    expect(toLayerType("solidColor")).toEqual({ type: "shape" });
    expect(toLayerType("gradientFill")).toEqual({ type: "shape" });
    expect(toLayerType("pixel")).toEqual({ type: "pixel" });
    expect(toLayerType("normal")).toEqual({ type: "pixel" });
  });

  it("알 수 없는 LayerKind 는 unknown 과 원본을 돌려준다", () => {
    // pixel 로 떨어뜨리면 새로 생긴 조정 레이어를 픽셀 레이어로 오인하게 만든다.
    expect(toLayerType("someFutureKind")).toEqual({
      type: "unknown",
      raw: "someFutureKind",
    });
    expect(toLayerType(undefined)).toEqual({ type: "unknown", raw: "undefined" });
  });
});

describe("orderActiveLayers", () => {
  /**
   * 편집 Command 는 `layerId` 를 생략하면 `document.activeLayers[0]` 을 쓴다.
   * 이 함수가 돌려주는 첫 번째가 그것과 달라지면 `layer.get_active` 가 거짓말을 한다.
   *
   * 실기에서 실제로 틀렸다 — 레이어 순서로 정렬해 id 14 를 첫 번째로 보고했는데
   * `activeLayers[0]` 은 id 13 이었고, 생략 rename 이 13 을 건드렸다.
   */
  const layer = (id: number, name: string, parentId: number | null = null): LayerInfo => ({
    id,
    name,
    type: "pixel",
    visible: true,
    opacity: 100,
    parentId,
    blendMode: "normal",
  });

  /** 레이어 순서는 14 가 13 보다 위다. 실기에서 마주친 배치. */
  const flattened = [layer(14, "배경 복사 2"), layer(13, "배경 복사")];

  it("레이어 순서가 아니라 activeLayers 순서를 따른다", () => {
    const result = orderActiveLayers([13, 14], flattened, [layer(13, "x"), layer(14, "y")]);
    expect(result.map((entry) => entry.id)).toEqual([13, 14]);
  });

  it("평탄화 목록의 parentId 를 가져온다", () => {
    // activeLayers 객체를 그대로 쓰면 parentId 가 null 이 되어 그룹 안 레이어가
    // 최상위로 보고된다.
    const inGroup = [layer(11, "안쪽", 17)];
    const result = orderActiveLayers([11], inGroup, [layer(11, "안쪽", null)]);
    expect(result[0]?.parentId).toBe(17);
  });

  it("평탄화 목록에 없으면 fallback 을 쓰고 자리를 지킨다", () => {
    // 건너뛰면 뒤엣것이 첫 번째로 올라와 편집 대상과 어긋난다.
    const result = orderActiveLayers([99, 13], flattened, [layer(99, "모름"), layer(13, "x")]);
    expect(result.map((entry) => entry.id)).toEqual([99, 13]);
    expect(result[0]?.name).toBe("모름");
  });

  it("선택이 없으면 빈 배열이다", () => {
    expect(orderActiveLayers([], flattened, [])).toEqual([]);
  });
});
