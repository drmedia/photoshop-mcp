import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus, createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PHOTOSHOP_UNKNOWN,
  type EventRecord,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Event System. (ROADMAP §15, ARCHITECTURE §21)
 *
 * MCP 에는 임의 이벤트를 클라이언트로 밀어주는 통로가 없다. 그래서 두 갈래로 쓴다 —
 * Extension 은 구독하고, LLM 은 `photoshop.event.recent` 로 조회한다.
 *
 * 가장 중요한 성질은 **이름을 짐작하지 않는 것**이다. 해석하지 못한 Photoshop 알림은
 * `photoshop.unknown` 으로 두고 원본을 보존한다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ev-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const bus = (capacity?: number): EventBus =>
  new EventBus({
    logger: createSilentLogger(),
    ...(capacity === undefined ? {} : { capacity }),
  });

describe("발행과 구독", () => {
  it("구독자에게 즉시 전달한다", () => {
    const events = bus();
    const seen: EventRecord[] = [];
    events.on("photoshop.layer.created", (event) => seen.push(event));

    events.emit("photoshop.layer.created", { id: 7 });
    events.emit("photoshop.layer.deleted", { id: 7 });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ seq: 1, name: "photoshop.layer.created", data: { id: 7 } });
  });

  it("접두사로 구독할 수 있다", () => {
    const events = bus();
    const seen: string[] = [];
    events.on("photoshop.", (event) => seen.push(event.name));
    events.on("command", (event) => seen.push(event.name));

    events.emit("photoshop.layer.created");
    events.emit("command.started");
    events.emit("other.thing");

    expect(seen).toEqual(["photoshop.layer.created", "command.started"]);
  });

  it("*는 전부 받는다", () => {
    const events = bus();
    let count = 0;
    events.on("*", () => (count += 1));

    events.emit("a.b");
    events.emit("c.d");
    expect(count).toBe(2);
  });

  it("구독을 해제할 수 있다", () => {
    const events = bus();
    let count = 0;
    const off = events.on("*", () => (count += 1));

    events.emit("a.b");
    off();
    events.emit("c.d");
    expect(count).toBe(1);
  });

  it("한 구독자의 오류가 다른 구독자를 막지 않는다", () => {
    // 한 Extension 의 버그가 이벤트 흐름 전체를 멈추면 안 된다.
    const events = bus();
    const seen: string[] = [];
    events.on("*", () => {
      throw new Error("구독자 버그");
    });
    events.on("*", (event) => seen.push(event.name));

    expect(() => events.emit("a.b")).not.toThrow();
    expect(seen).toEqual(["a.b"]);
  });
});

describe("이름을 짐작하지 않는다", () => {
  it("해석한 이름은 그대로 쓰고 원본을 보존한다", () => {
    const events = bus();
    const record = events.emitFromPlugin("photoshop.layer.created", {
      action: "make",
      documentId: 1,
    });

    expect(record.name).toBe("photoshop.layer.created");
    expect(record.raw).toEqual({ action: "make", documentId: 1 });
  });

  it("해석하지 못한 이름은 photoshop.unknown 으로 두고 원본을 남긴다", () => {
    // 그럴듯한 이름으로 덮으면 틀린 것을 알 수 없다.
    // 이 프로젝트는 bitDepth · layer.kind · blendMode 에서 같은 방식으로 세 번
    // 실제 버그를 잡았다.
    const events = bus();
    const record = events.emitFromPlugin("invertMask", { action: "invertMask", weird: true });

    expect(record.name).toBe(PHOTOSHOP_UNKNOWN);
    expect(record.data["reported"]).toBe("invertMask");
    expect(record.raw).toEqual({ action: "invertMask", weird: true });
  });

  it("payload 가 객체가 아니어도 죽지 않는다", () => {
    const events = bus();
    for (const payload of [null, undefined, "문자열", 42, [1, 2]]) {
      const record = events.emitFromPlugin("photoshop.layer.created", payload);
      expect(record.name).toBe("photoshop.layer.created");
      expect(record.data).toEqual({});
    }
  });
});

describe("조회", () => {
  it("after 로 새 것만 받는다", () => {
    const events = bus();
    events.emit("a.b");
    const mark = events.lastSeq;
    events.emit("c.d");
    events.emit("e.f");

    expect(events.recent({ after: mark }).map((r) => r.name)).toEqual(["c.d", "e.f"]);
  });

  /**
   * **`limit` 은 뒤에서 자른다.** 폴링이 앞으로 가야 해서 그쪽이 맞지만,
   * descriptor 를 잡을 때는 반대로 오래된 구간을 봐야 한다 — 슬라이더를 한 번
   * 끌면 이벤트가 수백 개 쌓여 앞의 것이 창 밖으로 밀린다. 실기에서 조정
   * 레이어 넷 중 셋을 이렇게 놓쳤다. (ROADMAP §52)
   */
  it("**after + limit 으로는 오래된 쪽에 못 닿는다** — before 가 있는 이유", () => {
    const events = bus();
    for (const name of ["a.one", "a.two", "a.three", "a.four"]) {
      events.emit(name);
    }

    /* 뒤에서 둘. 앞의 둘은 볼 방법이 없다. */
    expect(events.recent({ after: 0, limit: 2 }).map((r) => r.name)).toEqual(["a.three", "a.four"]);
  });

  it("before 로 오래된 구간을 본다", () => {
    const events = bus();
    events.emit("a.one");
    const mark = events.lastSeq;
    events.emit("b.two");
    events.emit("c.three");

    /* `before` 는 그 번호를 **포함하지 않는다** — `after` 와 짝이 맞아야
     * 두 값을 이어 붙여 훑을 수 있다. */
    expect(events.recent({ before: events.lastSeq }).map((r) => r.name)).toEqual([
      "a.one",
      "b.two",
    ]);
    expect(events.recent({ after: mark, before: events.lastSeq }).map((r) => r.name)).toEqual([
      "b.two",
    ]);
  });

  it("prefix 로 거른다", () => {
    const events = bus();
    events.emit("photoshop.layer.created");
    events.emit("command.started");

    expect(events.recent({ prefix: "command." }).map((r) => r.name)).toEqual(["command.started"]);
  });

  it("limit 은 최신 쪽을 남긴다", () => {
    // 오래된 것을 남기면 폴링이 앞으로 못 간다.
    const events = bus();
    for (const name of ["a.1", "a.2", "a.3"]) {
      events.emit(name);
    }
    expect(events.recent({ limit: 2 }).map((r) => r.name)).toEqual(["a.2", "a.3"]);
  });

  it("용량을 넘으면 오래된 것부터 버린다", () => {
    // Photoshop 은 사용자가 조금만 움직여도 알림을 쏟아낸다.
    const events = bus(3);
    for (let i = 0; i < 6; i += 1) {
      events.emit(`a.${i}`);
    }

    expect(events.size).toBe(3);
    expect(events.recent().map((r) => r.name)).toEqual(["a.3", "a.4", "a.5"]);
    // 일련번호는 계속 올라간다. 버려진 것도 번호를 썼다.
    expect(events.lastSeq).toBe(6);
  });
});

describe("Command 수명 이벤트", () => {
  it("성공하면 started 와 completed 가 난다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });

    await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r1" });

    const names = mcp.events.recent({ prefix: "command." }).map((r) => r.name);
    expect(names).toEqual(["command.started", "command.completed"]);

    const completed = mcp.events.recent({ prefix: "command.completed" })[0];
    expect(completed?.data).toMatchObject({ command: "LAYER_LIST", requestId: "r1" });
    expect(completed?.data["durationMs"]).toBeTypeOf("number");
  });

  it("실패하면 failed 에 코드가 담긴다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });

    await expect(
      mcp.tools.invoke("photoshop.layer.rename", { layerId: 99999, name: "x" }, { requestId: "r" }),
    ).rejects.toThrow();

    const failed = mcp.events.recent({ prefix: "command.failed" })[0];
    expect(failed?.data).toMatchObject({
      command: "LAYER_RENAME",
      code: ErrorCode.LAYER_NOT_FOUND,
    });
  });

  it("권한으로 거부된 호출은 started 를 내지 않는다", async () => {
    // 거부된 호출까지 기록하면 로그가 시끄러워진다.
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({ workspacePath: "C:/작업" }),
      logger: createSilentLogger(),
    });

    await expect(
      mcp.tools.invoke("photoshop.document.export", { filename: "a" }, { requestId: "r" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED }));

    expect(mcp.events.recent({ prefix: "command." })).toHaveLength(0);
  });
});

describe("Tool 로 조회", () => {
  it("lastSeq 를 함께 준다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });
    await mcp.tools.invoke("photoshop.ping", {}, { requestId: "r" });

    const first = await mcp.tools.invoke<{ events: EventRecord[]; lastSeq: number }>(
      "photoshop.event.recent",
      {},
      { requestId: "r" },
    );
    expect(first.events.length).toBeGreaterThan(0);
    expect(first.lastSeq).toBe(first.events[first.events.length - 1]?.seq);

    // 그 뒤로 아무 일도 없었으면 비어 있어야 한다.
    const second = await mcp.tools.invoke<{ events: EventRecord[]; lastSeq: number }>(
      "photoshop.event.recent",
      { after: first.lastSeq },
      { requestId: "r" },
    );
    expect(second.events).toEqual([]);
    // 조회 결과가 비어도 다음 폴링 시작점은 알 수 있어야 한다.
    expect(second.lastSeq).toBe(first.lastSeq);
  });

  it("read 권한이면 된다", () => {
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    expect(mcp.tools.get("photoshop.event.recent")?.permission).toBe("read");
  });
});

describe("Extension 구독", () => {
  async function loadExtension(
    mcp: ReturnType<typeof createPhotoshopMcp>,
    namespace: string,
    body: string,
  ): Promise<void> {
    const directory = join(workspace, namespace);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "main.mjs"), body, "utf8");
    await writeFile(
      join(directory, "extension.json"),
      JSON.stringify({
        id: `com.test.${namespace}`,
        name: namespace,
        version: "1.0.0",
        namespace,
        main: "main.mjs",
        permissions: ["photoshop.read"],
      }),
      "utf8",
    );
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
  }

  it("Extension 이 이벤트를 구독할 수 있다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });
    await loadExtension(
      mcp,
      "watcher",
      [
        "export const seen = [];",
        "export function activate(context) {",
        '  context.events.on("photoshop.", (event) => { seen.push(event.name); });',
        "}",
      ].join("\n"),
    );

    expect(mcp.events.subscriberCount).toBe(1);
    mcp.events.emit("photoshop.layer.created");
  });

  it("unload 하면 구독이 정리된다", async () => {
    // 리스너를 남기면 사라진 Extension 의 코드가 계속 불린다.
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });
    await loadExtension(
      mcp,
      "leaky",
      [
        "export function activate(context) {",
        '  context.events.on("*", () => {});',
        '  context.events.on("*", () => {});',
        "}",
      ].join("\n"),
    );

    expect(mcp.events.subscriberCount).toBe(2);
    await mcp.extensions.unload("leaky");
    expect(mcp.events.subscriberCount).toBe(0);
  });
});
