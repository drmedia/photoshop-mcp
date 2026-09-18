# @photoshop-mcp/mcp-server

실행 프로그램. `mcp-core` 의 조립 결과를 stdio transport 로 기동합니다.

## 역할 분리

```text
bin/photoshop-mcp.js   최소 CLI launcher. 컴파일하지 않음. shebang 포함.
src/index.ts           public library API (임베드용 표면)
src/start.ts           startPhotoshopMcpServer() — 조립 + 기동, 부작용 없음
src/run.ts             CLI bootstrap — 시작 로그 · 시그널 처리 · 종료 코드
```

경계:

- `bin/` 에는 비즈니스 로직 · Tool 등록 · Command Engine 구성을 두지 않습니다.
  `dist/run.js` 의 `main()` 을 호출하는 것이 전부입니다.
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

`bin/` 은 `dist/run.js` 를 import 하므로 **빌드 없이 `npm start` 하면 실패합니다.**
`npm start` 에 자동 빌드를 걸지 않는 것은 의도된 선택입니다. 개발 중에는 `npm run dev` 를 쓰세요.

## Bridge

Phase 1 에서는 `MockPhotoshopBridge` 로 동작합니다. 실제 Photoshop 연결은 Phase 2 범위이며,
`startPhotoshopMcpServer({ bridge })` 로 UXP Bridge 를 주입하는 형태로 교체합니다.

stdout 은 MCP stdio 전송이 사용하므로 로그는 stderr 로만 출력합니다.
