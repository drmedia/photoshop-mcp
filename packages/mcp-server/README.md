# @photoshop-mcp/mcp-server

실행 프로그램. `mcp-core` 의 조립 결과를 stdio transport 로 기동합니다.

## 역할 분리

```text
bin/photoshop-mcp.js   최소 CLI launcher. 컴파일하지 않음. shebang 포함.
src/index.ts           public library API (임베드용 표면)
src/start.ts           startPhotoshopMcpServer() — Bridge 선택 · 조립 · 기동
src/run.ts             CLI bootstrap — 환경 변수 · 로그 · 시그널 · 종료 코드
```

경계:

- `bin/` 에는 비즈니스 로직 · Tool 등록 · Command Engine 구성을 두지 않습니다.
  빌드 산출물 확인과 `main()` 호출이 전부입니다.
- `src/start.ts` 는 로그를 출력하거나 `process` 를 건드리지 않습니다. 그것은 `run.ts` 의 책임입니다.
- `src/index.ts` 는 CLI 전용 부트스트랩(`run.ts`)을 노출하지 않습니다.

## 실행

개발 — 빌드 없이 `src` 를 바로 실행합니다.

```bash
npm run dev          # tsx, 1회 실행
npm run dev:watch    # 파일 변경 시 재시작
```

프로덕션 — 빌드 후 컴파일된 산출물을 실행합니다.

```bash
npm run build
npm start
```

`bin/` 은 `dist/run.js` 를 import 하므로 빌드 없이 `npm start` 하면
"먼저 npm run build 를 실행하세요" 안내와 함께 종료 코드 1 로 끝납니다.
`npm start` 에 자동 빌드를 걸지 않는 것은 의도된 선택입니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PHOTOSHOP_MCP_BRIDGE` | `uxp` | `uxp` 또는 `mock` |
| `PHOTOSHOP_MCP_PORT` | `8765` | Bridge WebSocket 포트 |

`uxp` 모드는 WebSocket 서버를 띄우고 UXP Plugin 접속을 기다립니다.
Photoshop 이 없어도 MCP 서버는 정상 기동하며, 이때 Photoshop 이 필요한 Tool 은
`PHOTOSHOP_NOT_CONNECTED` 를 반환합니다.

`mock` 모드는 `MockPhotoshopBridge` 로 동작합니다. Photoshop 과 플러그인이 모두 불필요합니다.

```bash
PHOTOSHOP_MCP_BRIDGE=mock npm run dev
```
