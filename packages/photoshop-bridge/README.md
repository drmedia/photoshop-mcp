# @photoshop-mcp/photoshop-bridge

**Contracts 계층.** 모든 상위 계층과 `photoshop-uxp` 가 여기에 의존합니다.

## 구성

```text
src/
├─ protocol/types.ts        PhotoshopCommand, DocumentInfo, LayerInfo (zod 스키마 + 파생 타입)
├─ protocol/errors.ts       PhotoshopMcpError 와 표준 오류 코드
├─ protocol/messages.ts     Bridge 와이어 포맷 (PROTOCOL.md §3)
├─ protocol/server-info.ts  SERVER_NAME, SERVER_VERSION 단일 출처
├─ tool.ts                  ToolDefinition, ToolRegistry
├─ bridge.ts                PhotoshopBridge 인터페이스
├─ mock-bridge.ts           MockPhotoshopBridge (Photoshop 불필요)
├─ uxp-bridge.ts            UXPPhotoshopBridge (실제 Photoshop)
└─ transport/
   ├─ transport.ts          BridgeTransport 인터페이스
   └─ websocket-transport.ts WebSocketBridgeTransport (서버 측)
```

Tool 계약을 여기에 두는 이유는 MCP 서버 구현(`mcp-core`)과 Tool 정의(`photoshop-tools`)가
서로를 참조하지 않게 하기 위함입니다. 의존 방향은 `mcp-core → photoshop-tools` 한쪽입니다.

## Bridge 구현 두 가지

| 구현 | 용도 |
|---|---|
| `MockPhotoshopBridge` | Photoshop 없이 응답 생성. 테스트와 개발용 |
| `UXPPhotoshopBridge` | `BridgeTransport` 를 통해 실제 Photoshop 과 통신 |

둘은 같은 `PhotoshopBridge` 인터페이스를 만족하므로 상위 계층은 교체 사실을 알지 못합니다.

`UXPPhotoshopBridge` 는 Plugin 응답을 zod 로 검증합니다. Plugin 은 별도 프로세스이므로
응답 형태를 신뢰하지 않습니다. 스키마를 만족하지 않으면 `PROTOCOL_ERROR` 로 차단합니다.

## Transport

`WebSocketBridgeTransport` 는 **서버** 역할입니다. Photoshop 이 실행 중이 아니어도 기동하며,
Plugin 이 클라이언트로 접속합니다. 재접속 책임은 Plugin 쪽에 있습니다.

담당하는 것: 연결 상태 기계, 핸드셰이크와 버전 협상, 요청 ID 대응, 요청별 타임아웃,
끊김 시 대기 요청 즉시 실패, 프레임 크기 제한.

Photoshop 기능은 알지 못합니다. 규약은 [docs/PROTOCOL.md](../../docs/PROTOCOL.md) 를 참고하세요.
