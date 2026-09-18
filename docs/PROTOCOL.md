# Photoshop Bridge Protocol

MCP Server 와 Photoshop UXP Plugin 사이의 통신 규약이다.

이 문서는 Phase 2 범위만 정의한다. Event · Job · Permission 은 이후 Phase 에서 확장한다.

---

## 1. 역할과 방향

```text
MCP Server                         Photoshop UXP Plugin
(WebSocket Server)   ←─────────→   (WebSocket Client)
      listen                            connect
```

* **MCP Server 가 WebSocket 서버**다. Photoshop 이 실행 중이 아니어도 서버는 기동한다.
* **UXP Plugin 이 클라이언트**로 접속한다. Photoshop 이 켜지면 접속하고, 끊기면 재접속한다.
* Command 는 항상 **Server → Plugin** 방향으로만 발행된다.
* Plugin 은 Command 를 발행하지 않는다. 응답과 (이후 Phase 의) Event 만 보낸다.

### 기본 엔드포인트

```text
ws://127.0.0.1:8765
```

* 루프백에만 바인딩한다. 외부 인터페이스에 노출하지 않는다.
* 포트는 `PHOTOSHOP_MCP_PORT` 환경 변수로 변경할 수 있다.
* 동시에 **하나의 Plugin 연결만** 지원한다. 새 연결이 오면 이전 연결을 대체한다.
  (다중 Photoshop 인스턴스 지원은 범위 밖이다.)

---

## 2. 프레임

* WebSocket **텍스트 프레임**을 사용한다.
* 프레임 하나당 JSON 객체 하나. 프레임 경계가 메시지 경계다.
* 인코딩은 UTF-8.
* 최대 프레임 크기는 **4 MiB**. 초과 시 연결을 닫는다.
  (이미지 픽셀 데이터를 이 채널로 보내지 않는다는 뜻이다.)

파싱 실패나 스키마 불일치는 프로토콜 위반으로 취급한다. §3.8 을 참고한다.

---

## 3. 메시지

모든 메시지는 `type` 필드로 구분한다. 메시지는 두 갈래다.

**Connection lifecycle** — 요청/응답이 아니다. `id` 를 갖지 않는다.

| `type` | 방향 | 용도 |
|---|---|---|
| `hello` | Plugin → Server | 1단계. Plugin 이 자신을 알린다 |
| `hello_ack` | Server → Plugin | 2단계. Server 가 수락 또는 거부한다 |
| `ready` | Plugin → Server | 3단계. Plugin 이 Command 처리 준비를 알린다 |

**Request / response** — `id` 로 짝을 맞춘다.

| `type` | 방향 | 용도 |
|---|---|---|
| `command` | Server → Plugin | Command 실행 요청 |
| `response` | Plugin → Server | `command` 에 대한 응답 |
| `event` | Plugin → Server | **예약됨.** Phase 11 에서 사용 |

### 3.1 핸드셰이크 개요

```text
Plugin                          Server
  │                               │
  │──────── hello ───────────────▶│  handshaking
  │                               │
  │◀─────── hello_ack ────────────│  awaiting_ready
  │                               │
  │──────── ready ───────────────▶│  connected
  │                               │
  │◀─────── command ──────────────│  여기서부터 Command 가 흐른다
  │──────── response ────────────▶│
```

**Server 는 `ready` 를 받은 뒤에만 연결을 `connected` 로 보고 Command 를 보낸다.**
`ready` 이전에 Command 요청이 들어오면 `PHOTOSHOP_NOT_CONNECTED` 로 거부한다.

`ready` 에는 응답이 없다. 따라서 "연결됨" 시점이 양쪽에서 미세하게 다르다.

* Plugin: `ready` 를 **보낸** 시점
* Server: `ready` 를 **받은** 시점

Command 는 Server → Plugin 방향으로만 흐르므로 이 차이는 문제가 되지 않는다.
Plugin 이 조금 이르게 "연결됨"으로 표시할 뿐이다.

### 3.2 `hello` — 1단계

Plugin 은 접속 직후 다른 메시지보다 먼저 `hello` 를 보낸다.

```json
{
  "type": "hello",
  "payload": {
    "protocolVersion": 1,
    "plugin": { "name": "photoshop-mcp-uxp", "version": "0.1.0" },
    "host": { "app": "PS", "version": "26.0.0" },
    "commands": ["DOCUMENT_GET", "LAYER_LIST"]
  }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `protocolVersion` | O | Plugin 이 구현한 프로토콜 버전 |
| `plugin` | O | Plugin 이름과 버전 |
| `host` | X | Photoshop 호스트 정보 |
| `commands` | O | Plugin 의 Dispatcher 에 등록된 Command 목록 |

### 3.3 `hello_ack` — 2단계

수락:

```json
{
  "type": "hello_ack",
  "payload": {
    "accepted": true,
    "protocolVersion": 1,
    "server": { "name": "PhotoshopMCP", "version": "0.1.0" }
  }
}
```

거부:

```json
{
  "type": "hello_ack",
  "payload": {
    "accepted": false,
    "protocolVersion": 1,
    "error": {
      "code": "PROTOCOL_VERSION_MISMATCH",
      "message": "프로토콜 버전이 다릅니다. server=1 plugin=2"
    }
  }
}
```

거부한 경우 Server 는 `hello_ack` 를 보낸 직후 연결을 닫는다.
Plugin 은 백오프 재접속으로 이어진다. 버전 문제는 재접속으로 해결되지 않으므로
로그를 남겨 사용자가 원인을 알 수 있게 한다.

### 3.4 `ready` — 3단계

```json
{ "type": "ready" }
```

payload 는 없다.

`ready` 는 **Dispatcher 가 Command 를 처리할 수 있다**는 뜻이다.
그러므로 Plugin 은 Dispatcher 구성이 끝난 뒤에만 보낸다.

Server 는 다음과 같이 다룬다.

* `awaiting_ready` 상태에서 받으면 `connected` 로 전이한다.
* 그 밖의 상태(`hello` 를 건너뛴 경우 등)에서 받으면 **무시한다.** 연결은 유지한다.
* 재접속하면 처음부터 다시 `hello` → `hello_ack` → `ready` 를 거친다.
  Server 는 이전 연결의 상태를 이어받지 않는다.

### 3.5 버전 협상

`PROTOCOL_VERSION` 은 현재 **1** 이다.

* `hello.payload.protocolVersion` 이 Server 의 버전과 다르면 Server 는
  `accepted: false` 와 `PROTOCOL_VERSION_MISMATCH` 로 응답하고 연결을 닫는다.
* 하위 호환이 필요해지면 Server 가 여러 버전을 수용하는 방식으로 확장한다.
  Plugin 쪽에 분기를 두지 않는다.
* 호환되지 않는 변경은 반드시 이 버전을 올린다.

### 3.6 `command` — 실행 요청

```json
{
  "id": "req-001",
  "type": "command",
  "command": "DOCUMENT_GET",
  "payload": {}
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | O | 요청 식별자. 연결 수명 안에서 유일하다 |
| `command` | O | Command 식별자. 대문자 스네이크 케이스 |
| `payload` | O | Command 별 파라미터. 없으면 `{}` |

`id` 는 Server 가 생성한다. 형식은 규정하지 않으며, 구현은 `req-1`, `req-2` … 순번을 쓴다.

`payload` 는 `PhotoshopCommand` 의 `documentId` 와 `params` 를 평탄화한 형태다.

```text
PhotoshopCommand { type, documentId?, params }
        ↓
{ command: type, payload: { ...params, documentId? } }
```

Phase 2 의 `DOCUMENT_GET` · `LAYER_LIST` 는 파라미터가 없으므로 `payload` 는 `{}` 다.

### 3.7 `response` — 응답

성공:

```json
{ "type": "response", "id": "req-001", "success": true, "result": {} }
```

실패:

```json
{
  "type": "response",
  "id": "req-001",
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "No active document.",
    "recoverable": true
  }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | O | 대응하는 `command` 의 `id` |
| `success` | O | 성공 여부 |
| `result` | `success: true` 일 때 | Command 결과 |
| `error` | `success: false` 일 때 | 5장의 오류 객체 |

`details` 와 `recoverable` 은 생략할 수 있다. 생략 시 `recoverable` 은 `false` 로 본다.

응답의 `id` 가 대기 중인 요청과 일치하지 않으면 **그 응답을 버린다.** 연결은 유지한다.
타임아웃 후 늦게 도착한 응답이 여기 해당한다.

`connected` 이전에 도착한 `response` 도 버린다.

### 3.8 프로토콜 위반

파싱 실패나 스키마 불일치는 프로토콜 위반이다. Server 는 대기 중인 요청을
`PROTOCOL_ERROR` 로 실패시키고 연결을 닫는다.

## 4. Phase 2 Command

### `DOCUMENT_GET`

요청 `payload`: `{}`

결과:

```json
{
  "id": 1,
  "name": "milkyway.psd",
  "width": 6048,
  "height": 4024,
  "bitDepth": 16,
  "colorMode": "RGB"
}
```

| 필드 | 형 | 설명 |
|---|---|---|
| `id` | number | Photoshop 문서 ID |
| `name` | string | 문서 이름 |
| `width` · `height` | number | 픽셀 크기 |
| `bitDepth` | number | 8 / 16 / 32 |
| `colorMode` | string | `RGB` · `CMYK` · `Grayscale` · `Lab` 등 |

활성 문서가 없으면 `DOCUMENT_NOT_FOUND`.

### `LAYER_LIST`

요청 `payload`: `{}`

결과는 레이어 배열이다. 순서는 Photoshop 의 레이어 순서(위 → 아래)를 따른다.

```json
[
  { "id": 10, "name": "Background", "type": "pixel", "visible": true },
  { "id": 11, "name": "Curves 1", "type": "adjustment", "visible": true }
]
```

| 필드 | 형 | 설명 |
|---|---|---|
| `id` | number | 레이어 ID |
| `name` | string | 레이어 이름 |
| `type` | string | `pixel` · `adjustment` · `group` · `text` · `shape` · `smartObject` |
| `visible` | boolean | 표시 여부 |

Opacity 와 Parent 는 Phase 3 에서 추가한다.

활성 문서가 없으면 `DOCUMENT_NOT_FOUND`.

---

## 5. 오류

오류 객체는 `PhotoshopMcpError` 의 직렬화 형태와 같다. (ARCHITECTURE §32)

```typescript
{ code: string; message: string; details?: unknown; recoverable?: boolean }
```

### Plugin 이 발생시키는 코드

| 코드 | 의미 | `recoverable` |
|---|---|---|
| `DOCUMENT_NOT_FOUND` | 활성 문서 없음 | true |
| `LAYER_NOT_FOUND` | 지정한 레이어 없음 | true |
| `INVALID_PARAMETER` | `payload` 가 스키마 불일치 | false |
| `COMMAND_NOT_SUPPORTED` | Dispatcher 에 등록되지 않은 Command | false |
| `COMMAND_FAILED` | 그 외 실행 실패 | false |

### Server 가 발생시키는 코드

| 코드 | 의미 | `recoverable` |
|---|---|---|
| `PHOTOSHOP_NOT_CONNECTED` | 연결 없음 또는 핸드셰이크 미완료 | true |
| `COMMAND_TIMEOUT` | 타임아웃 내 응답 없음 | true |
| `PROTOCOL_VERSION_MISMATCH` | 버전 불일치 | false |
| `PROTOCOL_ERROR` | 파싱 실패 또는 스키마 위반 | false |

오류 코드는 **추가만 한다.** 기존 코드의 의미를 바꾸지 않는다.

---

## 6. 타임아웃

* Command 기본 타임아웃은 **15초**다. 요청 단위로 조정할 수 있다.
* 타임아웃이 지나면 Server 는 대기를 해제하고 `COMMAND_TIMEOUT` 으로 실패시킨다.
* 그 뒤에 도착한 응답은 대기 항목이 없으므로 버려진다. (3.1)
* 타임아웃은 연결을 닫지 않는다. Plugin 이 살아 있을 수 있기 때문이다.

---

## 7. 연결 수명

```text
      ┌──────────────┐
      │ DISCONNECTED │ ◀───────────────────┐
      └──────┬───────┘                     │
             │ Plugin 접속                 │
             ▼                             │
      ┌──────────────┐                     │
      │ HANDSHAKING  │ ────────────────────┤  hello_ack(accepted: false)
      │  hello 대기  │                     │  또는 close / error
      └──────┬───────┘                     │
             │ hello 수신 · 버전 일치      │
             │ → hello_ack(accepted: true) │
             ▼                             │
      ┌──────────────┐                     │
      │AWAITING_READY│ ────────────────────┤  close / error
      │  ready 대기  │                     │
      └──────┬───────┘                     │
             │ ready 수신                  │
             ▼                             │
      ┌──────────────┐                     │
      │  CONNECTED   │ ────────────────────┘  close / error
      │ Command 허용 │
      └──────────────┘
```

Command 는 `CONNECTED` 에서만 보낸다. `HANDSHAKING` 과 `AWAITING_READY` 에서
Command 요청이 들어오면 `PHOTOSHOP_NOT_CONNECTED` 로 즉시 거부한다.

### 끊김 처리

연결이 끊기면 Server 는 대기 중인 모든 요청을 `PHOTOSHOP_NOT_CONNECTED` 로 즉시 실패시킨다.
타임아웃까지 기다리지 않는다.

### 재접속

재접속 책임은 **Plugin 쪽**에 있다. Server 는 계속 listen 한다.

* 지수 백오프를 사용한다. 초기 1초, 최대 30초.
* 핸드셰이크가 성공하면 백오프를 초기 값으로 되돌린다.
* 재접속 후에는 `hello` 부터 다시 시작한다. 세 단계를 모두 거쳐야 한다.
* Server 는 이전 연결의 상태를 이어받지 않는다. 세션 상태가 없다.

### 연결 교체

동시에 하나의 Plugin 연결만 유지한다. 새 연결이 오면 이전 연결을 닫고 대체하며,
새 연결도 `hello` 부터 시작한다.

## 8. 보안

* 루프백에만 바인딩한다.
* 인증은 없다. 로컬 프로세스 간 통신을 전제한다.
* `payload` 로 실행 가능한 코드를 전달하지 않는다.
  임의 JavaScript 와 임의 `batchPlay` descriptor 는 이 프로토콜의 범위 밖이다.
  (ARCHITECTURE §23)
* Plugin 은 **등록된 Command 만** 실행한다. Command 이름으로 코드를 동적 구성하지 않는다.

---

## 9. Transport 교체

프로토콜은 WebSocket 에 종속되지 않는다. 메시지 규약(3장)만 만족하면 다른 전송으로 바꿀 수 있다.

```text
BridgeTransport (interface)
      ├─ WebSocketBridgeTransport   (Phase 2, 구현됨)
      ├─ LocalSocketBridgeTransport (미구현)
      └─ HttpBridgeTransport        (미구현)
```

전송 계층은 Photoshop 기능을 알지 못한다. 프레임 송수신과 연결 상태만 다룬다.
Command 의 의미 해석은 Plugin 의 Dispatcher 책임이다.
