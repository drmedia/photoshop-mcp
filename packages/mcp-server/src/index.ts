/**
 * `photoshop-mcp` public library API.
 *
 * CLI 로 실행하려면 `bin/photoshop-mcp.js` 를, 프로그램에 임베드하려면
 * {@link startPhotoshopMcpServer} 를 사용한다.
 *
 * CLI 전용 부트스트랩(`run.ts`)은 이 표면에 포함하지 않는다. `doctor` · `init` 은
 * **판정 함수만** 내놓고 각자의 `main()` 은 빼 둔다 — 종료 코드와 출력은 CLI 의
 * 관심사이고, 임베드하는 쪽은 결과를 받아 스스로 처리한다.
 */
export {
  startPhotoshopMcpServer,
  type BridgeMode,
  type StartOptions,
  type StartedPhotoshopMcp,
} from "./start.js";

export {
  createPhotoshopMcp,
  type CreatePhotoshopMcpOptions,
  type PhotoshopMcp,
} from "@photoshop-mcp/mcp-core";

export { runDoctor, type DoctorCheck, type DoctorReport } from "./doctor.js";
export { runInit, type InitResult, type SearchRoots } from "./init.js";
