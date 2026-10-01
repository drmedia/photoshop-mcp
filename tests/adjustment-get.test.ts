import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { AdjustmentGetParamsSchema, parseAdjustmentSettings } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.adjustment.get`. (ROADMAP §96)
 *
 * 픽스처는 **실기에서 받은 descriptor 를 그대로** 옮긴 것이다(Photoshop 27.8, `Tracked Sky .tif` 의
 * 조정 레이어). 모양을 짐작해 만든 값이 아니다 — 그래서 `grain` 이 초록이라는 것도 여기서 드러난다.
 */

const REAL_CURVE_BLUE = [
  {
    _obj: "curves",
    transferFunction: 0,
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    adjustment: [
      {
        _obj: "curvesAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "blue" },
        curve: [
          { _obj: "paint", horizontal: 0, vertical: 0 },
          { _obj: "paint", horizontal: 64, vertical: 47 },
          { _obj: "paint", horizontal: 255, vertical: 255 },
        ],
      },
    ],
  },
];

const REAL_CURVE_GREEN_AS_GRAIN = [
  {
    _obj: "curves",
    transferFunction: 0,
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    adjustment: [
      {
        _obj: "curvesAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "grain" },
        curve: [
          { _obj: "paint", horizontal: 0, vertical: 0 },
          { _obj: "paint", horizontal: 37, vertical: 44 },
          { _obj: "paint", horizontal: 68, vertical: 79 },
          { _obj: "paint", horizontal: 255, vertical: 255 },
        ],
      },
    ],
  },
];

const REAL_CURVE_COMPOSITE = [
  {
    _obj: "curves",
    transferFunction: 0,
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    adjustment: [
      {
        _obj: "curvesAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "composite" },
        curve: [
          { _obj: "paint", horizontal: 0, vertical: 0 },
          { _obj: "paint", horizontal: 50, vertical: 41 },
          { _obj: "paint", horizontal: 100, vertical: 88 },
          { _obj: "paint", horizontal: 255, vertical: 245 },
        ],
      },
    ],
  },
];

const REAL_CURVE_RED = [
  {
    _obj: "curves",
    transferFunction: 0,
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    adjustment: [
      {
        _obj: "curvesAdjustment",
        channel: { _ref: "channel", _enum: "channel", _value: "red" },
        curve: [
          { _obj: "paint", horizontal: 0, vertical: 0 },
          { _obj: "paint", horizontal: 100, vertical: 110 },
          { _obj: "paint", horizontal: 255, vertical: 255 },
        ],
      },
    ],
  },
];

const ORIGINAL_COLORS = [0, 60, 120, 180, 240, 300].map((hue) => ({
  _obj: "OriginalColor",
  hue,
  saturation: 100,
  lightness: 50,
}));

const REAL_HUE_SATURATION = [
  {
    _obj: "hueSaturation",
    presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
    GeneratedPreset: false,
    colorize: false,
    OriginalColors: ORIGINAL_COLORS,
    adjustment: [{ _obj: "hueSatAdjustmentV2", hue: 0, saturation: -50, lightness: 0 }],
  },
];

describe("parseAdjustmentSettings — 실제 descriptor", () => {
  it("곡선: 파랑 채널의 점을 input/output 으로 옮긴다", () => {
    expect(parseAdjustmentSettings(REAL_CURVE_BLUE)).toEqual({
      kind: "curves",
      channels: [
        {
          channel: "blue",
          rawChannel: null,
          points: [
            { input: 0, output: 0 },
            { input: 64, output: 47 },
            { input: 255, output: 255 },
          ],
        },
      ],
    });
  });

  it("**초록 채널은 'grain' 으로 오고 green 으로 옮긴다** — 실기에서 확인한 이름이다", () => {
    const settings = parseAdjustmentSettings(REAL_CURVE_GREEN_AS_GRAIN);
    expect(settings).toMatchObject({ kind: "curves" });
    const channels = (settings as { channels: { channel: string | null }[] }).channels;
    expect(channels[0]?.channel).toBe("green");
  });

  it("합성 · 빨강도 옮긴다", () => {
    const composite = parseAdjustmentSettings(REAL_CURVE_COMPOSITE) as {
      channels: { channel: string; points: { input: number; output: number }[] }[];
    };
    expect(composite.channels[0]?.channel).toBe("composite");
    expect(composite.channels[0]?.points).toHaveLength(4);
    // 50 → 41: 어둡게 누른다.
    expect(composite.channels[0]?.points[1]).toEqual({ input: 50, output: 41 });

    const red = parseAdjustmentSettings(REAL_CURVE_RED) as { channels: { channel: string }[] };
    expect(red.channels[0]?.channel).toBe("red");
  });

  it("색조·채도: 마스터 값과 colorize 를 옮긴다", () => {
    expect(parseAdjustmentSettings(REAL_HUE_SATURATION)).toEqual({
      kind: "hueSaturation",
      colorize: false,
      hue: 0,
      saturation: -50,
      lightness: 0,
    });
  });
});

describe("parseAdjustmentSettings — 모르는 것은 통째로 null", () => {
  it("모르는 채널은 이름을 지어내지 않고 rawChannel 에 남긴다", () => {
    const lab = JSON.parse(JSON.stringify(REAL_CURVE_BLUE)) as typeof REAL_CURVE_BLUE;
    (lab[0]?.adjustment[0]?.channel as { _value: string })._value = "lightness";
    const settings = parseAdjustmentSettings(lab) as {
      channels: { channel: string | null; rawChannel: string | null }[];
    };
    expect(settings.channels[0]).toMatchObject({ channel: null, rawChannel: "lightness" });
  });

  it("해석하지 않는 종류(레벨 등)는 null 이다", () => {
    expect(parseAdjustmentSettings([{ _obj: "levels", adjustment: [] }])).toBeNull();
    expect(parseAdjustmentSettings([{ _obj: "brightnessEvent" }])).toBeNull();
  });

  it("**한 점이라도 모양이 틀리면 곡선 전체가 null 이다** — 일부만 주지 않는다", () => {
    const broken = JSON.parse(JSON.stringify(REAL_CURVE_BLUE)) as typeof REAL_CURVE_BLUE;
    (broken[0]?.adjustment[0]?.curve[1] as { vertical: unknown }).vertical = "47";
    expect(parseAdjustmentSettings(broken)).toBeNull();
  });

  it("한 채널이라도 읽지 못하면 다른 채널도 주지 않는다", () => {
    const two = JSON.parse(JSON.stringify(REAL_CURVE_BLUE)) as typeof REAL_CURVE_BLUE;
    two[0]?.adjustment.push({ _obj: "nope" } as never);
    expect(parseAdjustmentSettings(two)).toBeNull();
  });

  it("색상 범위별 조정이 섞이면(마스터가 둘 이상) 짐작하지 않고 null 이다", () => {
    const ranged = JSON.parse(JSON.stringify(REAL_HUE_SATURATION)) as typeof REAL_HUE_SATURATION;
    ranged[0]?.adjustment.push({
      _obj: "hueSatAdjustmentV2",
      hue: 10,
      saturation: 20,
      lightness: 0,
    });
    expect(parseAdjustmentSettings(ranged)).toBeNull();
  });

  it("값이 숫자가 아니면 null 이다", () => {
    const bad = JSON.parse(JSON.stringify(REAL_HUE_SATURATION)) as typeof REAL_HUE_SATURATION;
    (bad[0]?.adjustment[0] as { saturation: unknown }).saturation = "-50";
    expect(parseAdjustmentSettings(bad)).toBeNull();
  });

  it("colorize 가 없거나 불린이 아니면 null 이다 — 색상화 모드를 빠뜨린 채 값만 주지 않는다", () => {
    const missing = JSON.parse(JSON.stringify(REAL_HUE_SATURATION)) as Record<string, unknown>[];
    delete (missing[0] as Record<string, unknown>)["colorize"];
    expect(parseAdjustmentSettings(missing)).toBeNull();

    const text = JSON.parse(JSON.stringify(REAL_HUE_SATURATION)) as Record<string, unknown>[];
    (text[0] as Record<string, unknown>)["colorize"] = "false";
    expect(parseAdjustmentSettings(text)).toBeNull();
  });
  it("배열이 아니거나 비었거나 null 이면 null 이다", () => {
    for (const value of [null, undefined, [], {}, "curves", 3]) {
      expect(parseAdjustmentSettings(value)).toBeNull();
    }
  });
});

describe("photoshop.adjustment.get", () => {
  type Mcp = ReturnType<typeof createPhotoshopMcp>;

  const setup = (bridge: MockPhotoshopBridge = new MockPhotoshopBridge()): Mcp =>
    createPhotoshopMcp({ bridge, logger: createSilentLogger() });

  const invoke = async (
    mcp: Mcp,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

  it("읽기 전용이다", () => {
    expect(setup().tools.get("photoshop.adjustment.get")?.permission).toBe("read");
  });

  it("layerId 는 양의 정수이고 모르는 키는 거절한다", () => {
    expect(AdjustmentGetParamsSchema.safeParse({}).success).toBe(true);
    expect(AdjustmentGetParamsSchema.safeParse({ layerId: 0 }).success).toBe(false);
    expect(AdjustmentGetParamsSchema.safeParse({ layerId: 1, bogus: 1 }).success).toBe(false);
  });

  it("조정 레이어가 아니면 오류가 아니라 isAdjustment: false 다", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "Pixels" })) as {
      id: number;
    };
    const result = await invoke(mcp, "photoshop.adjustment.get", { layerId: layer.id });
    expect(result["isAdjustment"]).toBe(false);
    expect(result["raw"]).toBeNull();
    expect(result["settings"]).toBeNull();
  });

  it("**Mock 은 값을 지어내지 않는다** — 조정 레이어임은 알지만 raw · settings 는 null 이다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.adjustment.curves", {
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    });
    const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; type: string }[];
    };
    const adjustment = layers.find((entry) => entry.type === "adjustment");
    const result = await invoke(mcp, "photoshop.adjustment.get", { layerId: adjustment?.id });
    expect(result["isAdjustment"]).toBe(true);
    expect(result["raw"]).toBeNull();
    expect(result["settings"]).toBeNull();
  });

  it("없는 레이어는 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.adjustment.get", { layerId: 9999 })).rejects.toThrow(
      /찾을 수 없습니다/u,
    );
  });

  it("플러그인이 원본을 주면 서버가 해석해 settings 에 얹고 raw 도 그대로 둔다", async () => {
    class RealisticPlugin extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        if (command.type === "ADJUSTMENT_GET") {
          const base = await super.executeCommand<Record<string, unknown>>(command);
          return { ...base, isAdjustment: true, raw: REAL_CURVE_GREEN_AS_GRAIN } as TResult;
        }
        return super.executeCommand<TResult>(command);
      }
    }
    const mcp = setup(new RealisticPlugin());
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "X" })) as { id: number };
    const result = await invoke(mcp, "photoshop.adjustment.get", { layerId: layer.id });
    expect(result["raw"]).toEqual(REAL_CURVE_GREEN_AS_GRAIN);
    expect(result["settings"]).toMatchObject({
      kind: "curves",
      channels: [{ channel: "green" }],
    });
  });

  it("모양이 틀린 결과는 PROTOCOL_ERROR 다", async () => {
    class Broken extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        if (command.type === "ADJUSTMENT_GET") {
          return { isAdjustment: true } as TResult;
        }
        return super.executeCommand<TResult>(command);
      }
    }
    const mcp = setup(new Broken());
    await expect(invoke(mcp, "photoshop.adjustment.get", {})).rejects.toThrow(/예상과 다릅니다/u);
  });
});
