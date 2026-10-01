import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Photoshop API 커버리지 매트릭스. (ROADMAP §88)
 *
 * `scripts/api-coverage.mjs` 가 Adobe 공식 DOM 레퍼런스와 플러그인 소스를 견주는 도구다.
 * 이 테스트는 **도구가 스스로 틀리지 않게** 한다 — 파서가 표를 잘못 읽거나, 스캐너가
 * 주석·문장 속 이름을 센다면 보고서 전체가 그럴듯하게 틀린다.
 */

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

interface Member {
  name: string;
  minVersion: string | null;
}
interface Snapshot {
  source: string;
  commit: string;
  classes: Record<string, { properties: Member[]; methods: Member[] }>;
}
interface Row {
  className: string;
  members: { name: string; status: string }[];
}
interface Tool {
  parseClass: (markdown: string) => { properties: Member[]; methods: Member[] };
  scanNames: (code: string) => { members: Set<string>; strings: Set<string> };
  loadOtherwise: () => { member: string; tool: string; via: string }[];
  compare: (snapshot: Snapshot) => Row[];
}

// 변수로 경로를 주어 .mjs 의 타입 선언 요구를 피한다.
const modulePath = "../scripts/api-coverage.mjs";
const tool = (await import(/* @vite-ignore */ modulePath)) as Tool;

const snapshot = JSON.parse(
  readFileSync(root("docs/api-coverage/adobe-api-snapshot.json"), "utf8"),
) as Snapshot;
const allMembers = (className: string): string[] => {
  const cls = snapshot.classes[className];
  return cls ? [...cls.properties, ...cls.methods].map((m) => m.name) : [];
};

describe("parseClass — Adobe 문서 파서", () => {
  const sample = [
    "# Thing",
    "## Properties",
    "| Name | Type | Access | Min Version | Description |",
    "| :--- | :--- | :--- | :--- | :--- |",
    "| width | *number* | R W | 22.5 | 너비 |",
    "| parent | [*Layer*](/ps-reference/classes/layer.md) | R | 23.0 | 부모 |",
    "## Methods",
    "### flip",
    // Adobe 문서에는 이 모양(백슬래시 붙은 HTML)으로 들어 있다.
    String.raw`\<span class="minversion" style="x"\>23.0\</span\>`,
    "### link",
    String.raw`\<span class="minversion" style="x"\>24.1\</span\>`,
  ].join("\n");

  it("표의 속성을 읽고 머리글 줄은 멤버로 세지 않는다", () => {
    const { properties } = tool.parseClass(sample);
    expect(properties.map((p) => p.name)).toEqual(["width", "parent"]);
    expect(properties.map((p) => p.name)).not.toContain("Name");
  });

  it("속성의 최소 버전과 링크 걷어낸 형식을 읽는다", () => {
    const { properties } = tool.parseClass(sample);
    expect(properties[1]).toMatchObject({ name: "parent", type: "Layer", minVersion: "23.0" });
  });

  it("메서드와 그 최소 버전을 읽는다 — 버전은 제목 바로 뒤 스팬에 있다", () => {
    const { methods } = tool.parseClass(sample);
    expect(methods).toEqual([
      { name: "flip", minVersion: "23.0" },
      { name: "link", minVersion: "24.1" },
    ]);
  });

  it("속성을 `###` 제목으로 적는 문서(CountItem 꼴)도 읽는다", () => {
    const { properties } = tool.parseClass(
      ["## Properties", "### groupIndex", "### itemIndex", "## Methods"].join("\n"),
    );
    expect(properties.map((p) => p.name)).toEqual(["groupIndex", "itemIndex"]);
  });
});

describe("scanNames — 소스에서 쓰는 이름", () => {
  it("멤버 접근과 정확히 그 이름인 문자열을 센다", () => {
    const { members, strings } = tool.scanNames(
      'layer.flip(a); doc?.resizeCanvas(); x["rasterize"]; y = "translate";',
    );
    expect(members).toEqual(new Set(["flip", "resizeCanvas"]));
    expect(strings).toEqual(new Set(["rasterize", "translate"]));
  });

  it("주석 속 이름은 세지 않는다", () => {
    const { members, strings } = tool.scanNames(
      "// layer.flip 은 아직\n/* document.crop */\nconst a = 1;",
    );
    expect(members.size).toBe(0);
    expect(strings.size).toBe(0);
  });

  it("문자열 안의 `//` 를 주석으로 오인하지 않는다 — 뒤의 코드를 잃으면 안 된다", () => {
    const { members } = tool.scanNames('const u = "http://x"; layer.merge();');
    expect(members.has("merge")).toBe(true);
  });

  it("오류 메시지 같은 문장 속 이름은 세지 않는다", () => {
    const { members, strings } = tool.scanNames(
      '"이 Photoshop 에는 document.resizeCanvas 가 없습니다"',
    );
    expect(members.has("resizeCanvas")).toBe(false);
    expect(strings.size).toBe(0);
  });
});

describe("스냅샷", () => {
  it("Adobe 저장소에서 받았고 클래스가 충분하다", () => {
    expect(snapshot.source).toBe("AdobeDocs/uxp-photoshop");
    expect(snapshot.commit).toMatch(/^[0-9a-f]{40}$/u);
    // 하위 폴더(preferences/…)를 놓치면 37개가 된다 — 처음 그렇게 틀렸다.
    expect(Object.keys(snapshot.classes).length).toBeGreaterThanOrEqual(48);
  });

  it("하위 폴더의 Preferences 문서를 포함한다", () => {
    expect(Object.keys(snapshot.classes).filter((c) => c.startsWith("Preferences/")).length).toBe(
      12,
    );
  });

  it("빈 클래스와 표 머리글이 멤버로 들어가지 않았다", () => {
    for (const [name, cls] of Object.entries(snapshot.classes)) {
      expect(cls.properties.length + cls.methods.length, `${name} 이 비어 있다`).toBeGreaterThan(0);
      expect(allMembers(name), `${name} 에 머리글 줄이 멤버로 들어갔다`).not.toContain("Name");
    }
  });

  it("알려진 멤버가 있다", () => {
    expect(allMembers("Layer")).toContain("flip");
    expect(allMembers("Document")).toContain("resizeCanvas");
    expect(allMembers("Selection")).toContain("makeWorkPath");
  });
});

describe("대응표 (provided-otherwise.json)", () => {
  const entries = tool.loadOtherwise();
  const mcp = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
  });

  it("항목이 있다", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const entry of entries) {
    it(`${entry.member} → ${entry.tool}`, () => {
      // 멤버가 스냅샷에 있다 — 오타나 문서에서 사라진 이름을 잡는다.
      const [className, name] = entry.member.split(".") as [string, string];
      expect(allMembers(className), `${entry.member} 이 Adobe 문서에 없다`).toContain(name);
      // Tool 이 실제로 등록되어 있다 — Tool 을 지우거나 바꾸고 표를 잊으면 잡힌다.
      expect(mcp.tools.get(entry.tool), `${entry.tool} 이 등록되어 있지 않다`).toBeDefined();
      expect(entry.via).toBeTruthy();
    });
  }

  it("같은 멤버를 두 번 적지 않는다", () => {
    const names = entries.map((e) => e.member);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("판정", () => {
  const rows = tool.compare(snapshot);
  const statusOf = (member: string): string | undefined => {
    const [className, name] = member.split(".") as [string, string];
    return rows.find((r) => r.className === className)?.members.find((m) => m.name === name)
      ?.status;
  };

  it("플러그인이 쓰는 이 클래스 고유의 멤버는 확인으로 나온다", () => {
    expect(statusOf("Layer.flip")).toBe("confirmed");
  });

  it("여러 클래스가 공유하는 이름은 확인으로 세지 않는다 — 귀속할 수 없다", () => {
    // `name` 은 Layer · Action · Channel … 에 모두 있다.
    expect(statusOf("Layer.name")).not.toBe("confirmed");
  });

  it("대응표에 적힌 것은 대응으로 나온다", () => {
    expect(statusOf("Layer.applyGaussianBlur")).toBe("otherwise");
  });

  it("Preferences 하위는 반사 읽기다 — 이름 비교 대상이 아니다", () => {
    const row = rows.find((r) => r.className.startsWith("Preferences/"));
    expect(row?.members.every((m) => m.status === "reflective")).toBe(true);
  });
});

describe("보고서", () => {
  it("docs/API_COVERAGE.md 가 최신이다 — 소스나 스냅샷이 바뀌었으면 다시 만든다", () => {
    // 낡으면 종료 코드 1. 메시지가 다시 만드는 법을 말한다.
    expect(() =>
      execFileSync(process.execPath, [root("scripts/api-coverage.mjs"), "--check"], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
