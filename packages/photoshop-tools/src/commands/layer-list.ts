import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";

export const LAYER_LIST = "LAYER_LIST";

/** 활성 문서의 레이어 목록을 조회한다. */
export const layerListCommand: CommandHandler<Record<string, never>, LayerInfo[]> = async (
  _command,
  context,
) => context.bridge.getLayers();
