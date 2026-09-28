import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * 채널. (ROADMAP §56)
 *
 * ## 전부 DOM 이다 — 캡처가 한 번도 필요 없었다
 *
 * Adobe 레퍼런스에 `Channels` 컬렉션(`add` · `getByName` · `length` · 색인)과
 * `Channel` 클래스(`histogram` · `name` · `kind` · `visible` · `opacity` ·
 * `duplicate` · `remove`)가 있고, `document.activeChannels` 는 **읽기/쓰기**다.
 * batchPlay 를 한 줄도 쓰지 않는다.
 *
 * ## 왜 필요했는가
 *
 * `selection.save_channel` 이 채널을 만드는데 **목록을 볼 방법이 없었다.**
 * 이름이 틀리면 `selection.load_channel` 이 `"설정" 명령은 현재 사용할 수
 * 없습니다` 만 돌려준다 — 그 벽은 `selection-ops` 주석에 이미 적혀 있었다.
 *
 * ## `load_as_selection` 은 만들지 않았다
 *
 * `selection.load_channel` 이 이미 한다. 같은 능력에 이름이 둘이면 호출자가
 * 어느 쪽이 맞는지 고민한다. (`selection.from_layer` 와 같은 판단)
 */

export interface ChannelInfo {
  /** `document.channels` 에서의 위치. */
  index: number;
  name: string;
  /** 색 성분 채널인지(R·G·B 등). 알파 채널과 가르는 기준이다. */
  isComponent: boolean;
  /** `Channel.kind`. 문자열로 읽히지 않으면 `null` 이고 `rawKind` 에 원본이 있다. */
  kind: string | null;
  rawKind?: string;
  visible: boolean | null;
  opacity: number | null;
}

export interface ChannelDetail extends ChannelInfo {
  /** 256칸 히스토그램. 요청했고 읽혔을 때만 담는다. */
  histogram: number[] | null;
}

type ChannelLike = Record<string, unknown>;

/** `document.channels` 를 배열로 편다. 컬렉션이라 `length` + 색인으로 읽는다. */
function allChannels(document: ReturnType<typeof requireActiveDocument>): ChannelLike[] {
  const channels = (document as unknown as ChannelLike)["channels"] as ChannelLike | undefined;
  if (channels === undefined || channels === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 document.channels 가 없습니다(23.0 이상이 필요합니다).",
      { recoverable: false },
    );
  }
  const length = channels["length"];
  if (typeof length !== "number") {
    throw new DispatchError("COMMAND_FAILED", "채널 개수를 읽지 못했습니다.", {
      recoverable: true,
    });
  }
  const out: ChannelLike[] = [];
  for (let i = 0; i < length; i += 1) {
    const entry = (channels as unknown as Record<number, ChannelLike>)[i];
    if (entry !== undefined && entry !== null) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * 색 성분 채널의 이름 집합.
 *
 * **`componentChannels` 는 24.5 부터다.** 없으면 빈 집합이고 `isComponent` 는
 * 전부 `false` 가 된다 — 그때는 `channel.delete` 의 안전장치가 약해지므로
 * 그쪽에서 따로 막는다.
 */
function componentNames(document: ReturnType<typeof requireActiveDocument>): Set<string> {
  const list = (document as unknown as ChannelLike)["componentChannels"];
  if (!Array.isArray(list)) {
    return new Set();
  }
  const names = new Set<string>();
  for (const entry of list as ChannelLike[]) {
    const name = entry?.["name"];
    if (typeof name === "string") {
      names.add(name);
    }
  }
  return names;
}

/** 속성 읽기가 던질 수 있다. 못 읽으면 `null` 이고 지어내지 않는다. */
function read<T>(
  channel: ChannelLike,
  key: string,
  guard: (value: unknown) => value is T,
): T | null {
  try {
    const value = channel[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number";

function describe(channel: ChannelLike, index: number, components: Set<string>): ChannelInfo {
  const name = read(channel, "name", (v): v is string => typeof v === "string") ?? `채널 ${index}`;
  const kindRaw = (() => {
    try {
      return channel["kind"];
    } catch {
      return undefined;
    }
  })();

  const info: ChannelInfo = {
    index,
    name,
    isComponent: components.has(name),
    kind: typeof kindRaw === "string" ? kindRaw : null,
    visible: read(channel, "visible", isBoolean),
    opacity: read(channel, "opacity", isNumber),
  };
  /* **원본은 매핑에 실패했을 때만 담는다.** 성공했는데 남기면 두 값이 같은 것을
   * 가리켜 어느 쪽을 믿어야 할지 모호해진다. (`rawAdjustmentType` 과 같은 규칙) */
  if (info.kind === null && kindRaw !== undefined && kindRaw !== null) {
    info.rawKind = String(kindRaw);
  }
  return info;
}

export function channelList(): { channels: ChannelInfo[] } {
  const document = requireActiveDocument();
  const components = componentNames(document);
  return {
    channels: allChannels(document).map((entry, index) => describe(entry, index, components)),
  };
}

/** 이름 또는 색인으로 하나를 찾는다. 둘 다 없으면 거절한다. */
function locate(
  document: ReturnType<typeof requireActiveDocument>,
  params: { name?: string; index?: number },
): { channel: ChannelLike; index: number } {
  const channels = allChannels(document);
  if (params.index !== undefined) {
    const found = channels[params.index];
    if (found === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `채널 색인 ${params.index} 가 범위를 벗어납니다. 채널은 ${channels.length}개입니다.`,
        { recoverable: true, details: { index: params.index, count: channels.length } },
      );
    }
    return { channel: found, index: params.index };
  }

  const wanted = params.name;
  const at = channels.findIndex((entry) => {
    try {
      return entry["name"] === wanted;
    } catch {
      return false;
    }
  });
  if (at < 0) {
    /* **무엇이 있는지 함께 말한다.** 이 Tool 이 생긴 이유가 "이름이 틀려도
     * 무엇이 있는지 알 수 없다" 였다. */
    throw new DispatchError("INVALID_PARAMETER", `채널 '${String(wanted)}' 이 없습니다.`, {
      recoverable: true,
      details: {
        name: wanted,
        available: channels.map((entry, index) => {
          try {
            return typeof entry["name"] === "string" ? (entry["name"] as string) : `#${index}`;
          } catch {
            return `#${index}`;
          }
        }),
      },
    });
  }
  return { channel: channels[at] as ChannelLike, index: at };
}

export function channelGet(params: {
  name?: string;
  index?: number;
  histogram?: boolean;
}): ChannelDetail {
  const document = requireActiveDocument();
  const { channel, index } = locate(document, params);
  const info = describe(channel, index, componentNames(document));

  let histogram: number[] | null = null;
  if (params.histogram === true) {
    /* **실기에서 두 가지 제약을 잡았다.** 둘 다 Photoshop 이 예외로 답하는데,
     * 그대로 `null` 로 삼키면 호출자는 "값이 없다" 로 읽는다. (ROADMAP §56)
     *
     * ① `문자 구성 요소의 채널에 유효한 작업이 아닙니다`
     *    — 성분 채널(R·G·B)은 혼자 보이게 해도 안 된다. `Channel.histogram`
     *      은 알파 채널 전용이다. 성분 쪽은 `document.statistics` 가 준다.
     * ② `보이는 채널에 대한 막대 그래프만 얻을 수 있습니다`
     *    — `visible` 이 `false` 면 안 된다. `channel.select` 로 보이게 한다. */
    if (info.isComponent) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `'${info.name}' 은 색 성분 채널이라 히스토그램을 얻을 수 없습니다. ` +
          "성분 채널의 분포는 photoshop.document.statistics 가 줍니다.",
        { recoverable: true, details: { name: info.name, isComponent: true } },
      );
    }
    if (info.visible !== true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `'${info.name}' 이 보이지 않아 히스토그램을 얻을 수 없습니다. ` +
          "photoshop.channel.select 로 먼저 보이게 하세요.",
        { recoverable: true, details: { name: info.name, visible: info.visible } },
      );
    }
    try {
      const value = channel["histogram"];
      /* **진짜 배열이 아닐 수 있다.** UXP 가 유사 배열을 주는 자리가 있어
       * `Array.isArray` 만 보면 놓친다 — 실기에서 처음에 `null` 이 나왔다.
       * 길이가 있고 숫자가 들어 있으면 받는다. (ROADMAP §56) */
      if (Array.isArray(value)) {
        histogram = value as number[];
      } else if (value !== null && typeof value === "object") {
        const bag = value as { length?: unknown };
        if (typeof bag.length === "number" && bag.length > 0) {
          const copied = Array.from(value as ArrayLike<unknown>, (entry) =>
            typeof entry === "number" ? entry : Number.NaN,
          );
          histogram = copied.some((entry) => Number.isNaN(entry)) ? null : copied;
        }
      }
    } catch {
      /* 못 읽으면 `null` 이다. 지어내지 않는다. */
      histogram = null;
    }
  }
  return { ...info, histogram };
}

export async function channelCreate(params: { name?: string }): Promise<ChannelInfo> {
  return runModal("Create channel", async () => {
    const document = requireActiveDocument();
    const channels = (document as unknown as ChannelLike)["channels"] as ChannelLike | undefined;
    const add = channels?.["add"];
    if (typeof add !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.channels.add 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const before = allChannels(document).length;
    const created = (add as () => unknown).call(channels) as ChannelLike | undefined;
    if (created === undefined || created === null) {
      throw new DispatchError("COMMAND_FAILED", "채널을 만들지 못했습니다.", {
        recoverable: true,
      });
    }
    if (params.name !== undefined) {
      created["name"] = params.name;
    }

    /* **정말 늘었는지 확인한다.** 오류 없이 아무 일도 안 하는 경로가 이
     * 프로젝트에 여럿 있었다. */
    const after = allChannels(document);
    if (after.length !== before + 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `채널이 늘지 않았습니다(${before} → ${after.length}). channel.list 로 확인하세요.`,
        { recoverable: true },
      );
    }
    return describe(
      after[after.length - 1] as ChannelLike,
      after.length - 1,
      componentNames(document),
    );
  });
}

/**
 * 편집 대상 채널을 고른다.
 *
 * **`mask.select` 와 다른 축이다.** 그쪽은 "레이어 픽셀이냐 마스크냐" 를
 * 고르고 이쪽은 "어느 채널이냐" 를 고른다. 둘 다 이후 편집이 어디에 걸릴지를
 * 바꾸므로 끝나면 되돌린다.
 */
export async function channelSelect(params: { names: string[] }): Promise<{
  active: string[];
}> {
  return runModal("Select channels", async () => {
    const document = requireActiveDocument();
    const channels = allChannels(document);

    const picked: ChannelLike[] = [];
    for (const name of params.names) {
      const found = channels.find((entry) => {
        try {
          return entry["name"] === name;
        } catch {
          return false;
        }
      });
      if (found === undefined) {
        throw new DispatchError("INVALID_PARAMETER", `채널 '${name}' 이 없습니다.`, {
          recoverable: true,
          details: {
            name,
            available: channelList().channels.map((entry) => entry.name),
          },
        });
      }
      picked.push(found);
    }

    (document as unknown as ChannelLike)["activeChannels"] = picked;

    /* **쓴 값이 실제로 들어갔는지 읽어서 답한다.** */
    const active = (document as unknown as ChannelLike)["activeChannels"];
    const names = Array.isArray(active)
      ? (active as ChannelLike[]).map((entry) => {
          try {
            return typeof entry["name"] === "string" ? (entry["name"] as string) : "";
          } catch {
            return "";
          }
        })
      : [];
    return { active: names };
  });
}

export async function channelDuplicate(params: {
  name?: string;
  index?: number;
}): Promise<ChannelInfo> {
  return runModal("Duplicate channel", async () => {
    const document = requireActiveDocument();
    const { channel } = locate(document, params);
    const duplicate = channel["duplicate"];
    if (typeof duplicate !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 Channel 에 duplicate 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const before = allChannels(document).length;
    await (duplicate as () => Promise<void>).call(channel);

    const after = allChannels(document);
    if (after.length !== before + 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `채널이 늘지 않았습니다(${before} → ${after.length}). channel.list 로 확인하세요.`,
        { recoverable: true },
      );
    }
    return describe(
      after[after.length - 1] as ChannelLike,
      after.length - 1,
      componentNames(document),
    );
  });
}

/**
 * 채널을 지운다. **destructive 다.**
 *
 * **색 성분 채널은 거절한다.** R·G·B 를 지우면 문서의 색 모드가 바뀌거나
 * 그림이 망가진다 — 되돌릴 길이 History 뿐이다. `componentChannels` 로 가른다.
 */
export async function channelDelete(params: { name?: string; index?: number }): Promise<{
  deleted: string;
  remaining: number;
}> {
  return runModal("Delete channel", async () => {
    const document = requireActiveDocument();
    const components = componentNames(document);
    const { channel, index } = locate(document, params);
    const info = describe(channel, index, components);

    if (info.isComponent) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `'${info.name}' 은 색 성분 채널이라 지울 수 없습니다. 알파 채널만 지웁니다.`,
        { recoverable: true, details: { name: info.name } },
      );
    }
    /* **성분 목록을 못 읽으면 막지 않는다** — 없는 것을 참으로 읽어 멀쩡한
     * 호출을 막는 것이 더 나쁘다(`isBackgroundLayer` 와 같은 원칙). 다만 그때는
     * 지울 것이 성분 채널일 수도 있으므로 개수로 한 번 더 본다. */
    if (components.size === 0 && allChannels(document).length <= 3) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "이 문서에 알파 채널이 없어 보입니다. channel.list 로 먼저 확인하세요.",
        { recoverable: true },
      );
    }

    const remove = channel["remove"];
    if (typeof remove !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 Channel 에 remove 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }
    await (remove as () => Promise<void>).call(channel);

    const after = allChannels(document);
    if (after.some((entry) => entry === channel)) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `'${info.name}' 이 지워지지 않았습니다. channel.list 로 확인하세요.`,
        { recoverable: true, details: { name: info.name } },
      );
    }
    return { deleted: info.name, remaining: after.length };
  });
}
