/**
 * 서버 식별 정보.
 *
 * MCP 핸드셰이크와 `photoshop.ping` 응답이 같은 값을 보고해야 하므로
 * 최하위 contracts 계층에서 단일 출처로 관리한다.
 */
export const SERVER_NAME = "PhotoshopMCP";
export const SERVER_VERSION = "0.1.0";
