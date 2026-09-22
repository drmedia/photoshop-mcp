import {
  isPortInUse,
  parseLsof,
  parseNetstat,
  portConflictMessage,
} from "../packages/mcp-server/src/port-holder.js";
import { describe, expect, it } from "vitest";

/**
 * 포트를 쥔 프로세스를 알아내는 규칙. (ROADMAP §18.4)
 *
 * `EADDRINUSE` 한 줄만 나오면 사용자에게 보이는 증상은 "Photoshop 이 안
 * 붙는다" 다. 실기에서 하루에 세 번 그랬고 그때마다 원인을 처음부터 다시
 * 찾았다. **PID 를 알아야 끝낼 수 있다.**
 */

const NETSTAT = [
  "활성 연결",
  "",
  "  프로토콜  로컬 주소           외부 주소           상태            PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234",
  "  TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       39560",
  "  TCP    127.0.0.1:8765         127.0.0.1:51067        ESTABLISHED     39560",
  "  TCP    [::]:445               [::]:0                 LISTENING       4",
].join("\n");

describe("netstat 읽기", () => {
  it("LISTENING 인 PID 를 찾는다", () => {
    expect(parseNetstat(NETSTAT, 8765)).toBe(39560);
  });

  it("**ESTABLISHED 를 고르지 않는다** — 쥐고 있는 쪽은 LISTENING 이다", () => {
    /* 같은 포트에 두 줄이 있다. 연결 쪽을 집으면 상대 프로세스를 죽이게 된다. */
    const onlyEstablished = [
      "  TCP    127.0.0.1:9999         127.0.0.1:51067        ESTABLISHED     777",
    ].join("\n");
    expect(parseNetstat(onlyEstablished, 9999)).toBeNull();
  });

  it("다른 포트를 집지 않는다", () => {
    expect(parseNetstat(NETSTAT, 876)).toBeNull();
    expect(parseNetstat(NETSTAT, 87650)).toBeNull();
  });

  it("**IPv6 주소의 콜론에 속지 않는다**", () => {
    const v6 = ["  TCP    [::]:8765              [::]:0                 LISTENING       42"].join(
      "\n",
    );
    expect(parseNetstat(v6, 8765)).toBe(42);
  });

  it("못 찾으면 null 이다", () => {
    expect(parseNetstat("", 8765)).toBeNull();
    expect(parseNetstat("쓰레기 출력", 8765)).toBeNull();
  });
});

describe("lsof 읽기", () => {
  it("첫 PID 를 쓴다", () => {
    expect(parseLsof("4242\n4243\n")).toBe(4242);
  });

  it("빈 출력이면 null 이다", () => {
    expect(parseLsof("")).toBeNull();
  });
});

describe("포트 충돌 판정", () => {
  it("code 로도 message 로도 알아본다", () => {
    expect(isPortInUse(Object.assign(new Error("boom"), { code: "EADDRINUSE" }))).toBe(true);
    expect(isPortInUse(new Error("listen EADDRINUSE: address already in use"))).toBe(true);
  });

  it("다른 오류는 아니다", () => {
    expect(isPortInUse(new Error("ENOENT"))).toBe(false);
    expect(isPortInUse(null)).toBe(false);
  });
});

describe("안내 문장", () => {
  it("**세 갈래를 모두 말한다** — 쓰거나, 끝내거나, 포트를 바꾸거나", () => {
    /* 하나만 말하면 나머지 둘을 아는 사람만 빠져나온다. */
    const message = portConflictMessage(8765, 39560);

    expect(message).toContain("39560");
    expect(message).toContain("taskkill");
    expect(message).toContain("PHOTOSHOP_MCP_PORT");
    expect(message).toContain("이미 떠 있다면");
  });

  it("**PID 를 모르면 지어내지 않는다**", () => {
    // 짐작한 PID 를 내놓으면 사용자가 엉뚱한 프로세스를 죽인다.
    const message = portConflictMessage(8765, null);

    expect(message).not.toMatch(/PID [0-9]/u);
    expect(message).toContain("netstat");
    expect(message).toContain("PHOTOSHOP_MCP_PORT");
  });
});
