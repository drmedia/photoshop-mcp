import { describe, expect, it } from "vitest";
import { CommandDispatcher, DispatchError } from "../photoshop-uxp/src/dispatcher/dispatcher.js";
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
  it("bitsPerChannel 문자열과 숫자를 모두 처리한다", () => {
    expect(toBitDepth("eight")).toBe(8);
    expect(toBitDepth("sixteen")).toBe(16);
    expect(toBitDepth("thirtyTwo")).toBe(32);
    expect(toBitDepth("one")).toBe(1);
    expect(toBitDepth(16)).toBe(16);
  });

  it("알 수 없는 bitsPerChannel 은 8 로 떨어진다", () => {
    expect(toBitDepth("sixtyFour")).toBe(8);
    expect(toBitDepth(undefined)).toBe(8);
    expect(toBitDepth(Number.NaN)).toBe(8);
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
    expect(toLayerType("group")).toBe("group");
    expect(toLayerType("layerSection")).toBe("group");
    expect(toLayerType("text")).toBe("text");
    expect(toLayerType("smartObject")).toBe("smartObject");
    expect(toLayerType("curves")).toBe("adjustment");
    expect(toLayerType("brightnessContrast")).toBe("adjustment");
    expect(toLayerType("solidColor")).toBe("shape");
    expect(toLayerType("gradientFill")).toBe("shape");
    expect(toLayerType("pixel")).toBe("pixel");
  });

  it("알 수 없는 LayerKind 는 pixel 로 떨어진다", () => {
    // Photoshop 버전이 올라가며 새 kind 가 생겨도 목록 조회가 실패하지 않아야 한다.
    expect(toLayerType("someFutureKind")).toBe("pixel");
    expect(toLayerType(undefined)).toBe("pixel");
  });
});
