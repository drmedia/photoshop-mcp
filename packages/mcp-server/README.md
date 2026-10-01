# photoshop-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI clients inspect and edit Adobe Photoshop
documents through a fixed set of tools. Every tool declares a permission level; only `read` and `edit` are
allowed by default, and nothing can run arbitrary scripts or raw `batchPlay` descriptors in Photoshop.

It has two halves: this server, and a small **UXP plugin** (a panel) that runs inside Photoshop and carries
out the commands. You need both.

> **Not published to npm yet.** The `npx` commands below describe the intended setup and do not work until
> it is. Until then, install the packed package locally from the repository:
>
> ```bash
> npm run release:build
> npm run release:verify -- --keep D:/Dev/psmcp-local   # outside the repository, empty or new
> claude mcp add photoshop -- node D:/Dev/psmcp-local/project/node_modules/photoshop-mcp/bin/photoshop-mcp.js
> ```

## Requirements

|           |                                                                         |
| --------- | ----------------------------------------------------------------------- |
| Photoshop | 25.0 or later. **Verified against 27.8 only**                           |
| Node.js   | 22.12 or later                                                          |
| OS        | Windows. On macOS only `window.capture` is known to be unsupported      |
| Client    | Any MCP client over stdio. Tried with Claude Code and VS Code Copilot Chat |

## Setup

**1. Install the Photoshop plugin.** Download `com.drmedia.photoshopmcp_PS.ccx` from the
[GitHub releases](https://github.com/drmedia/photoshop-mcp/releases) page and double-click it.
Photoshop will warn that the plugin is **unsigned** — that is expected. Afterwards the panel appears under
**Plugins > Photoshop MCP**.

**2. Add the server to your MCP client.**

```bash
claude mcp add photoshop -- npx -y photoshop-mcp
```

or in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "photoshop": { "command": "npx", "args": ["-y", "photoshop-mcp"] }
  }
}
```

**3. Check it.** With Photoshop open, the panel shows `● Connected` (after pressing Connect) and a port. Order does not matter —
the plugin reconnects on its own once you press **Connect**, and the server starts fine with Photoshop closed.
The plugin does **not connect by default** — press the `Connect` button in the panel once (the choice is remembered; `Disconnect` stops it).

```bash
npx photoshop-mcp doctor    # what is blocked, and how to fix it
```

If a tool is refused, call `photoshop.diagnostics` from your client first — it says what is blocked and why.

## Ports

The server listens on `127.0.0.1` only. It uses the **first free port from 8765 to 8774**, and the plugin
scans the same range, so another program holding 8765 is not a problem and nothing needs configuring.
`PHOTOSHOP_MCP_PORT` pins one port instead; it must be inside that range for the plugin to find it.

## Permissions

| Level         | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `read`        | Reads only                                         |
| `edit`        | Changes the document, undoably                     |
| `external`    | Writes outside Photoshop. Never overwrites         |
| `destructive` | Cannot be undone (`document.save`, `layer.delete`) |

Set `PHOTOSHOP_MCP_ALLOW` in the client's `env` to change the list. A value replaces the default; it does
not add to it. For example `read,edit,external`, or `read` for a read-only server.

Folders are approved by you, in the panel — a tool can only name a file inside the approved folder.

## Environment variables

| Variable                    | Default                      | Meaning                                              |
| --------------------------- | ---------------------------- | ---------------------------------------------------- |
| `PHOTOSHOP_MCP_ALLOW`       | `read,edit`                  | Allowed permission levels. `all` and `none` also work |
| `PHOTOSHOP_MCP_PORT`        | first free of 8765–8774      | Pin the bridge port                                  |
| `PHOTOSHOP_MCP_BRIDGE`      | `uxp`                        | `mock` runs without Photoshop or the plugin          |
| `PHOTOSHOP_MCP_CAPABILITIES`| `<cwd>/capabilities.json`    | External processors (`npx photoshop-mcp init` makes one) |

More in the [repository README](https://github.com/drmedia/photoshop-mcp#readme). The design documents and
source comments are in Korean.

## License

MIT

---

# 개발 (monorepo 안에서)

이 절은 저장소에서 작업하는 사람을 위한 것입니다.

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

`PHOTOSHOP_MCP_BRIDGE=mock` 은 Photoshop 과 플러그인 없이 `MockPhotoshopBridge` 로 동작합니다.

```bash
PHOTOSHOP_MCP_BRIDGE=mock npm run dev
```

## 릴리스

`npm run release:build` 로 여섯 패키지의 `dist` 를 지우고 처음부터 빌드한 뒤 `npm run release:check` 로
낡은 파일을 확인합니다(`tsc -b` 는 소스가 사라져도 옛 산출물을 지우지 않는다). `npm publish` 는 각 패키지의
`prepublishOnly` 가 같은 점검을 건다. 자세한 것은 `docs/ROADMAP.md` §99.
