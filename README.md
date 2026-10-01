# PhotoshopMCP

Control Adobe Photoshop from an MCP client. A monorepo containing the MCP server, a
Photoshop UXP plugin that acts as the bridge, and an extension system.

> 한국어: [README_KO.md](README_KO.md) — the Korean document is the detailed one.
> Source comments, error messages and the design documents under `docs/` are in Korean.

## Requirements

|             |                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------- |
| Photoshop   | 25.0 or later. **Verified against 27.8 only**                                              |
| Node        | 22.12+ (the runtime works on 18+, but the dev and test tooling requires 22.12)              |
| OS          | Windows. On macOS only `window.capture` is known to be unsupported; the rest is unverified  |
| Plugin      | The UXP plugin must be loaded into Photoshop ([Connecting](#connecting-photoshop))          |

Tried with Claude Code and VS Code Copilot Chat as MCP clients.

> **Status: Phase 13 (Production Hardening) complete. Phase 14 (Distribution) is prepared but not executed.**
> 164 core tools and 6 resources, plus 4 extensions (`example` 2 · `graxpert` 2 ·
> `rcastro` 3 · `starnet` 1), all verified against Photoshop 27.8.
> Every tool and command declares a permission level; only `read` and `edit` are allowed by default.
> **Not published to npm yet** — clone it.

## Quick start

```bash
npm install
npm run build
npm start
```

During development you can skip the build and run the TypeScript sources directly
(`tsx` plus a `development` export condition):

```bash
npm run dev          # once
npm run dev:watch    # restart on change
```

`bin/photoshop-mcp.js` reads from `dist/`, so `npm start` without a build fails on
purpose — no implicit build is wired in.

```bash
npm run check        # format + lint + build + typecheck:tests + test
npm test
```

## Connecting Photoshop

1. Start the MCP server (`npm run build && npm start`).
2. Load `photoshop-uxp/manifest.json` in the Adobe UXP Developer Tool (Add → Load).
3. Open **Plugins > Photoshop MCP** in Photoshop and check the bridge status.

Order does not matter — the plugin reconnects with exponential backoff. The server
starts fine with Photoshop closed; tools that need it return `PHOTOSHOP_NOT_CONNECTED`.

```bash
npm run build && npm run verify:live   # end-to-end check against a running Photoshop
PHOTOSHOP_MCP_BRIDGE=mock npm run dev  # no Photoshop, no plugin
```

## Permissions

Every tool and command declares a level. Only `read` and `edit` are allowed by default.

| Level         | Meaning                              | Examples                                                            |
| ------------- | ------------------------------------ | ------------------------------------------------------------------- |
| `read`        | Reads only                           | `ping`, `document.get`, `layer.list`, `document.capture`              |
| `edit`        | Changes the document, undoably       | layers · groups · adjustments · masks · selections · filters          |
| `external`    | Writes outside Photoshop. **Never overwrites** | `document.save_as`, `document.export`, external processors  |
| `destructive` | Cannot be undone                     | `document.save`, `layer.delete`, `document.flatten`, `action.run`     |

```bash
PHOTOSHOP_MCP_ALLOW=read                 # read-only server
PHOTOSHOP_MCP_ALLOW=read,edit,external   # saving allowed, overwriting not
PHOTOSHOP_MCP_ALLOW=all
```

Whatever you pass is **the whole list** — it does not add to the default.

Enforcement happens in the command engine, not in the tool layer: extensions can call
commands directly without going through a tool. A tool's level is `tools/list` metadata
and a fast-fail.

## Safety model

Four rules shape the whole design.

1. An LLM cannot run arbitrary JavaScript inside Photoshop.
2. An LLM cannot run arbitrary `batchPlay` descriptors.
3. Every change goes through a registered command.
4. Destructive operations are classified explicitly.

The same applies to external processors: executables come only from `capabilities.json`
(absolute paths), argv is assembled from declared parameters, nothing goes through a
shell, and file I/O is limited to filenames inside one approved folder.

**The output folder is approved by the user in the Photoshop panel**, not by the server.
`getFolder()` requires a user gesture, and that is the safeguard: the LLM supplies a
filename, never a path. Separators and `..` are rejected by the schema.

## What it can do

The full list with permission levels is in [docs/CORE_API.md](docs/CORE_API.md).

| Area        | Tools                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Inspect     | document and layer info, active layers, histogram and per-channel noise statistics       |
| Layers      | create · duplicate · rename · select · visibility · opacity · reorder · delete · groups   |
| Adjustments | curves · levels · brightness/contrast · hue/saturation · vibrance, as adjustment layers   |
| Masks       | create · enable and disable · gradient · dab (adds to an existing mask)                  |
| Selections  | rectangle · ellipse · canvas · colour range · subject                                    |
| Filters     | gaussian blur · high pass · minimum/maximum · Camera Raw                                 |
| Retouching  | spot removal (content-aware fill), dodge and burn, paint dab                             |
| Geometry    | crop (canvas only, pixels kept) · rotate (returns a safe crop rectangle) · tilt measuring |
| Capture     | document · layer · selection · window — returned as MCP image blocks                     |
| Files       | save_as (psd/psb) · export (png/jpg/16-bit tiff) · open · save · place                   |
| Text        | create · edit · font listing — watermarks and signatures                                 |
| Actions     | list and run user-recorded actions, limited to an allow-list chosen in the panel         |

Editing tools return the resulting layer state, so you rarely need to re-list. Omitting
`layerId` targets the active layer.

```text
MCP Client → Tool Handler → Command Engine → Photoshop Bridge
                                                   │
                            ┌──────────────────────┴───────────────────┐
                   MockPhotoshopBridge                      UXPPhotoshopBridge
                   (no Photoshop needed)                              │
                                                          WebSocketBridgeTransport
                                                                   ═ WebSocket ═
                                                              Photoshop UXP Plugin
```

## Long-running work

**The default MCP request timeout is 60 seconds** and external processors take longer —
StarNet2 took 67 s on a 4032×6048 image, which produced `-32001 Request timed out`.

So slow tools return a job id immediately and you poll for the result.

```text
starnet.remove_stars →  { jobId: "09f3ad43-..." }              0 s
photoshop.job.status →  running | 25% separating stars
photoshop.job.status →  completed | result: {...}             75 s
```

`photoshop.job.cancel` actually kills the child process. Stopping the server cancels
every running job, otherwise external processes outlive it. Jobs live in memory only.

## Resources and events

Documents, layers, selection, history, capabilities and extensions are exposed as MCP
resources — tools are *actions*, resources are *context*.

```text
photoshop://document/current   photoshop://layers        photoshop://selection
photoshop://history            photoshop://capabilities  photoshop://extensions
```

Subscribe and you get `notifications/resources/updated` when a command changes the
document. Read-only commands do not notify.

`photoshop.event.recent` returns what happened recently; pass `after: lastSeq` for only
what is new. Photoshop's own notifications work too, but you have to register with
`["all"]` — registering by event name silently delivers nothing.

## Extensions

An extension registers tools under its own namespace and drives Photoshop through core
commands only. It never touches the bridge. Writing one is documented in
[docs/EXTENSION_API.md](docs/EXTENSION_API.md).

```text
gx.*        GraXpert CLI (gradient removal, denoise)
rcastro.*   RC-Astro CLI (BlurXTerminator · NoiseXTerminator · StarXTerminator)
starnet.*   StarNet2
example.*   a minimal example
```

**Bundled extensions are not shipped in a distribution.** The user registers installed
ones in the Photoshop panel, and the server picks them up when the bridge connects,
announcing `tools/list_changed`. Within this repository,
`PHOTOSHOP_MCP_EXTENSIONS_ENABLED` chooses which bundled ones load, or `none` for a
core-only server.

## When something does not work

```text
photoshop.diagnostics       from a connected client
npx photoshop-mcp doctor    before a client is attached
```

Both report the bridge, permissions, external processors, extensions, workflows, jobs
and events — and for anything blocked, **how to unblock it**. They share one
implementation so they cannot disagree.

External processors write large 16-bit TIFFs (140 MB each at 4032×6048).
`photoshop.workspace.usage` shows what has piled up; `photoshop.workspace.delete`
removes named files only — no patterns, because the approved folder is the user's.

## Configuration

| Variable                           | Default                     | Meaning                                                  |
| ---------------------------------- | --------------------------- | -------------------------------------------------------- |
| `PHOTOSHOP_MCP_BRIDGE`             | `uxp`                       | `uxp` or `mock`                                            |
| `PHOTOSHOP_MCP_PORT`               | unset = first free of 8765–8774 | Pin the Bridge WebSocket port (must be inside that range) |
| `PHOTOSHOP_MCP_ALLOW`              | `read,edit`                 | Permission levels. `all` and `none` also work              |
| `PHOTOSHOP_MCP_EXTENSIONS`         | `<cwd>/extensions`          | Extension directory                                        |
| `PHOTOSHOP_MCP_EXTENSIONS_ENABLED` | unset = all                 | Namespaces to load. `none` loads nothing                   |
| `PHOTOSHOP_MCP_CAPABILITIES`       | `<cwd>/capabilities.json`   | External processor config                                  |
| `PHOTOSHOP_MCP_WORKFLOWS`          | `<cwd>/workflows.json`      | Workflow config                                            |
| `PHOTOSHOP_MCP_DEBUG`              | unset                       | `1` enables correlation-id tracing                         |

Logs go to stderr — stdout belongs to the MCP stdio transport.

## Not included

Deliberately out of scope:

- Arbitrary `batchPlay` descriptors or arbitrary JavaScript execution — **non-goals**
- Job persistence — jobs are in memory and vanish when the server restarts
- Command registration by extensions — they call core commands, they do not add any
- Extension hot reload without restarting the server
- Real percentage progress for external processors — only stages are reported

## Documentation

Written in Korean.

- [README_KO.md](README_KO.md) — the detailed readme
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — structure and principles
- [docs/CORE_API.md](docs/CORE_API.md) — the authority for tool names and permissions
- [docs/ROADMAP.md](docs/ROADMAP.md) — the authority for phases, and the record of what
  was tried, measured, and got wrong
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — bridge messages and the three-step handshake
- [docs/EXTENSION_API.md](docs/EXTENSION_API.md) — writing an extension
- [photoshop-uxp/README.md](photoshop-uxp/README.md) — what UXP actually does, measured

## License

[MIT](LICENSE).
