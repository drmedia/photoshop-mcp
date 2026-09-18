import {
  DEFAULT_MOCK_DOCUMENT,
  DEFAULT_MOCK_LAYERS,
  ErrorCode,
  MockPhotoshopBridge,
  PhotoshopMcpError,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

describe("MockPhotoshopBridge", () => {
  it("기본값으로 연결된 상태다", () => {
    expect(new MockPhotoshopBridge().isConnected()).toBe(true);
    expect(new MockPhotoshopBridge({ connected: false }).isConnected()).toBe(false);
  });

  describe("문서 조회", () => {
    it("기본 Mock 문서를 반환한다", async () => {
      await expect(new MockPhotoshopBridge().getDocumentInfo()).resolves.toEqual({
        id: 1,
        name: "test.psd",
        width: 6048,
        height: 4024,
        bitDepth: 16,
        colorMode: "RGB",
      });
    });

    it("주입한 문서를 반환한다", async () => {
      const bridge = new MockPhotoshopBridge({
        document: {
          id: 9,
          name: "milky.psd",
          width: 100,
          height: 50,
          bitDepth: 8,
          colorMode: "RGB",
        },
      });
      await expect(bridge.getDocumentInfo()).resolves.toMatchObject({ id: 9, name: "milky.psd" });
    });

    it("내부 상태를 복사해서 반환하므로 호출자가 변경해도 영향이 없다", async () => {
      const bridge = new MockPhotoshopBridge();
      const first = await bridge.getDocumentInfo();
      first.name = "변조됨";

      await expect(bridge.getDocumentInfo()).resolves.toMatchObject({ name: "test.psd" });
      expect(DEFAULT_MOCK_DOCUMENT.name).toBe("test.psd");
    });
  });

  describe("레이어 조회", () => {
    it("기본 Mock 레이어 목록을 반환한다", async () => {
      const layers = await new MockPhotoshopBridge().getLayers();

      expect(layers).toHaveLength(DEFAULT_MOCK_LAYERS.length);
      expect(layers[0]).toEqual({
        id: 10,
        name: "Background",
        type: "pixel",
        visible: true,
        opacity: 100,
        parentId: null,
      });
      expect(layers.map((layer) => layer.name)).toEqual(["Background", "Curves 1", "Retouch"]);
    });

    it("빈 레이어 목록도 표현할 수 있다", async () => {
      await expect(new MockPhotoshopBridge({ layers: [] }).getLayers()).resolves.toEqual([]);
    });

    it("내부 상태를 복사해서 반환한다", async () => {
      const bridge = new MockPhotoshopBridge();
      const layers = await bridge.getLayers();
      layers.pop();

      await expect(bridge.getLayers()).resolves.toHaveLength(DEFAULT_MOCK_LAYERS.length);
    });
  });

  describe("오류 재현", () => {
    it("연결이 없으면 PHOTOSHOP_NOT_CONNECTED 를 던진다", async () => {
      const bridge = new MockPhotoshopBridge();
      bridge.setConnected(false);

      for (const call of [
        () => bridge.getDocumentInfo(),
        () => bridge.getLayers(),
        () => bridge.executeCommand({ type: "DOCUMENT_GET", params: {} }),
      ]) {
        await expect(call()).rejects.toThrow(
          expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED, recoverable: true }),
        );
      }
    });

    it("열린 문서가 없으면 DOCUMENT_NOT_FOUND 를 던진다", async () => {
      const bridge = new MockPhotoshopBridge({ document: null });

      await expect(bridge.getDocumentInfo()).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
      );
      await expect(bridge.getLayers()).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
      );
    });

    it("failNextWith 로 주입한 오류는 1회만 발생한다", async () => {
      const bridge = new MockPhotoshopBridge();
      bridge.failNextWith(
        new PhotoshopMcpError(ErrorCode.LAYER_NOT_FOUND, "레이어 25 를 찾을 수 없습니다."),
      );

      await expect(bridge.getLayers()).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }),
      );
      await expect(bridge.getLayers()).resolves.toHaveLength(DEFAULT_MOCK_LAYERS.length);
    });
  });

  describe("executeCommand", () => {
    it("Phase 1 Command 를 처리하고 호출을 기록한다", async () => {
      const bridge = new MockPhotoshopBridge();

      await expect(bridge.executeCommand({ type: "PING", params: {} })).resolves.toEqual({
        connected: true,
      });
      await expect(
        bridge.executeCommand({ type: "DOCUMENT_GET", params: {} }),
      ).resolves.toMatchObject({ name: "test.psd" });
      await expect(bridge.executeCommand({ type: "LAYER_LIST", params: {} })).resolves.toHaveLength(
        DEFAULT_MOCK_LAYERS.length,
      );

      expect(bridge.executedCommands.map((command) => command.type)).toEqual([
        "PING",
        "DOCUMENT_GET",
        "LAYER_LIST",
      ]);
    });

    it("지원하지 않는 Command 는 COMMAND_NOT_SUPPORTED 를 던진다", async () => {
      await expect(
        new MockPhotoshopBridge().executeCommand({ type: "MASK_CREATE", params: {} }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }));
    });
  });
});
