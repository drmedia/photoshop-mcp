# photoshop-uxp

Photoshop 안에서 실행되는 UXP 플러그인입니다. Photoshop MCP 의 실행 Agent 역할을 합니다.
(ARCHITECTURE §11)

```text
photoshop-uxp  →  photoshop-bridge (contracts, type-only)
```

contracts 는 **타입만** 가져옵니다. 컴파일 결과에 `require("@photoshop-mcp/...")` 가 남지 않으므로
번들러가 필요 없습니다. 런타임 의존은 UXP 가 제공하는 `photoshop` · `uxp` 모듈뿐입니다.

## 구조

```text
src/
├─ index.ts                 bootstrap — Dispatcher 구성, 접속, 패널 등록
├─ dispatcher/dispatcher.ts CommandDispatcher — Command → 처리 코드 연결
├─ transport/ws-client.ts   BridgeClient — WebSocket 접속 · 핸드셰이크 · 재접속
├─ dom/document.ts          DOCUMENT_GET (Photoshop DOM)
├─ dom/layers.ts            LAYER_LIST (Photoshop DOM)
├─ dom/mappings.ts          열거형 매핑 (순수 함수, Photoshop 무관)
└─ types/photoshop.d.ts     UXP 모듈 최소 타입 선언
```

## 빌드

CommonJS 로 컴파일합니다. UXP 런타임이 `require("photoshop")` 를 쓰기 때문입니다.

```bash
npm run build          # 저장소 루트에서. dist/ 생성
```

`manifest.json` 의 `main` 은 `dist/index.js` 를 가리킵니다.

## 설치

1. `npm run build` 로 `dist/` 를 만듭니다.
2. Adobe UXP Developer Tool 에서 **Add Plugin** → 이 디렉터리의 `manifest.json` 선택
3. **Load** 로 Photoshop 에 적재합니다.
4. Photoshop 메뉴 `플러그인 > Photoshop MCP` 로 패널을 열어 Bridge 상태를 확인합니다.

MCP 서버가 `ws://127.0.0.1:8765` 에서 대기해야 합니다. 서버 먼저 띄울 필요는 없습니다 —
플러그인이 지수 백오프로 재접속합니다. (PROTOCOL.md §7)

## 검증 상태

| 항목 | 상태 |
|---|---|
| TypeScript 컴파일 | 통과 |
| `CommandDispatcher` | 단위 테스트 통과 (Photoshop 무관) |
| `dom/mappings.ts` | 단위 테스트 통과 (Photoshop 무관) |
| 프로토콜 (서버 측) | 통합 테스트 통과 — 같은 프로토콜의 가짜 플러그인 사용 |
| **Photoshop DOM 호출부** | **미검증.** Photoshop 실기 확인 필요 |
| **manifest · 패널 · UXP WebSocket** | **미검증.** Photoshop 실기 확인 필요 |

`dom/document.ts` 와 `dom/layers.ts` 가 사용하는 Photoshop API 와 `types/photoshop.d.ts` 의
타입 선언은 Adobe 문서를 근거로 작성했으며 실제 Photoshop 에서 확인하지 않았습니다.
열거형 값이 선언과 다를 수 있어 `dom/mappings.ts` 는 알 수 없는 값을 예외 없이
안전한 기본값으로 떨어뜨립니다.
