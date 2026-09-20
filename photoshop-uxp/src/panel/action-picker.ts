import { app } from "photoshop";
import { readAllowed, writeAllowed, type AllowedAction } from "../dom/action-allowlist.js";

/**
 * 액션 선택 모달. (ROADMAP §17.36)
 *
 * ## 왜 패널인가
 *
 * 액션은 Photoshop 안에 있고 **고를 수 있는 것은 사용자뿐이다.** 서버가 대신
 * 고를 수 없다 — 작업 폴더 승인(§8.5)이 패널에서만 되는 것과 같은 자리다.
 *
 * ## 왜 모달인가
 *
 * 도킹된 패널은 260×200 이고 사용자가 높이를 늘리지 못하는 경우가 있다.
 * 이 기기에만 액션이 91개라 패널 안에는 담기지 않는다.
 *
 * ## **펼칠 때 읽는다**
 *
 * UXP 는 속성 하나마다 Photoshop 으로 왕복한다(§17.34). 91개를 한 번에 읽으면
 * 20초 가까이 걸려 모달이 멈춘 것처럼 보인다. 세트 이름만 먼저 읽고
 * 사용자가 펼친 세트의 액션만 읽는다.
 */

interface SetNode {
  name: string;
  /** 아직 안 읽었으면 `null`. */
  actions: string[] | null;
}

const KEY = (set: string, action: string): string => `${set}\u0000${action}`;

function readSets(): SetNode[] {
  const tree = (app as unknown as Record<string, unknown>)["actionTree"] as
    { length: number; [index: number]: Record<string, unknown> } | undefined;
  if (tree === undefined || typeof tree.length !== "number") {
    return [];
  }
  const out: SetNode[] = [];
  for (let i = 0; i < tree.length; i += 1) {
    const name = tree[i]?.["name"];
    if (typeof name === "string") {
      out.push({ name, actions: null });
    }
  }
  return out;
}

function readActions(setName: string): string[] {
  const tree = (app as unknown as Record<string, unknown>)["actionTree"] as
    { length: number; [index: number]: Record<string, unknown> } | undefined;
  if (tree === undefined) {
    return [];
  }
  for (let i = 0; i < tree.length; i += 1) {
    if (tree[i]?.["name"] !== setName) {
      continue;
    }
    const actions = tree[i]?.["actions"] as
      { length: number; [index: number]: Record<string, unknown> } | undefined;
    if (actions === undefined || typeof actions.length !== "number") {
      return [];
    }
    const names: string[] = [];
    for (let j = 0; j < actions.length; j += 1) {
      const name = actions[j]?.["name"];
      if (typeof name === "string") {
        names.push(name);
      }
    }
    return names;
  }
  return [];
}

const escape = (value: string): string =>
  value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

/**
 * 모달을 띄우고 사용자가 저장하면 허용 목록을 갱신한다.
 *
 * @returns 저장한 수. 취소하면 `null`.
 */
export async function openActionPicker(): Promise<number | null> {
  const sets = readSets();
  // 화면에서만 쓰는 선택 상태. 저장 전까지 localStorage 를 건드리지 않는다.
  const chosen = new Set(readAllowed().map((entry) => KEY(entry.set, entry.action)));

  const dialog = document.createElement("dialog");
  dialog.style.width = "460px";
  dialog.innerHTML = [
    '<form method="dialog" style="font-family:sans-serif;font-size:12px;padding:10px">',
    '<div style="display:flex;align-items:center;margin-bottom:6px">',
    "<b>실행을 허용할 액션</b>",
    '<span id="ap-count" style="margin-left:8px;opacity:.7"></span>',
    "</div>",
    '<div style="opacity:.7;margin-bottom:6px">세트를 눌러 펼칩니다. 고른 것만 부를 수 있습니다.</div>',
    '<div id="ap-list" style="height:320px;overflow:auto;border:1px solid #555;padding:6px"></div>',
    '<div style="margin-top:10px;text-align:right">',
    '<button id="ap-none" value="none" style="margin-right:6px">모두 해제</button>',
    '<button id="ap-cancel" value="cancel" style="margin-right:6px">취소</button>',
    '<button id="ap-save" value="save">저장</button>',
    "</div>",
    "</form>",
  ].join("");

  const list = dialog.querySelector("#ap-list") as HTMLElement;
  const count = dialog.querySelector("#ap-count") as HTMLElement;

  const renderCount = (): void => {
    count.textContent = `${chosen.size}개 선택됨`;
  };

  const render = (): void => {
    list.innerHTML = "";
    for (const node of sets) {
      const row = document.createElement("div");
      row.style.marginBottom = "2px";

      const head = document.createElement("div");
      head.style.cursor = "pointer";
      const picked =
        node.actions === null
          ? 0
          : node.actions.filter((name) => chosen.has(KEY(node.name, name))).length;
      const badge =
        node.actions === null ? "" : ` (${String(picked)}/${String(node.actions.length)})`;
      head.innerHTML = `<b>${node.actions === null ? "▶" : "▼"} ${escape(node.name)}</b>${badge}`;
      head.addEventListener("click", () => {
        // 펼칠 때 읽는다. 접을 때는 읽은 것을 버려 다음에 다시 읽게 한다 —
        // 사용자가 Photoshop 에서 액션을 바꿨을 수 있다.
        node.actions = node.actions === null ? readActions(node.name) : null;
        render();
      });
      row.appendChild(head);

      if (node.actions !== null) {
        const all = document.createElement("div");
        all.style.margin = "2px 0 2px 14px";
        all.innerHTML = '<a href="#" style="opacity:.8">이 세트 전체 선택 / 해제</a>';
        all.addEventListener("click", (event) => {
          event.preventDefault();
          const names = node.actions ?? [];
          const every = names.every((name) => chosen.has(KEY(node.name, name)));
          for (const name of names) {
            if (every) {
              chosen.delete(KEY(node.name, name));
            } else {
              chosen.add(KEY(node.name, name));
            }
          }
          renderCount();
          render();
        });
        row.appendChild(all);

        for (const name of node.actions) {
          const key = KEY(node.name, name);
          const line = document.createElement("div");
          line.style.marginLeft = "14px";
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = chosen.has(key);
          box.addEventListener("change", () => {
            if (box.checked) {
              chosen.add(key);
            } else {
              chosen.delete(key);
            }
            renderCount();
          });
          const label = document.createElement("span");
          label.textContent = ` ${name}`;
          line.appendChild(box);
          line.appendChild(label);
          row.appendChild(line);
        }
      }
      list.appendChild(row);
    }
  };

  renderCount();
  render();
  document.body.appendChild(dialog);

  const show = (dialog as unknown as { uxpShowModal?: (options: unknown) => Promise<string> })
    .uxpShowModal;
  let result: string;
  try {
    result =
      typeof show === "function"
        ? await show.call(dialog, { title: "액션 선택", resize: "both" })
        : ((dialog as unknown as { showModal: () => void }).showModal(), "save");
  } finally {
    dialog.remove();
  }

  if (result === "cancel" || result === "reasonCanceled") {
    return null;
  }
  const entries: AllowedAction[] =
    result === "none"
      ? []
      : [...chosen].map((key) => {
          const [set, action] = key.split("\u0000");
          return { set: set ?? "", action: action ?? "" };
        });
  writeAllowed(entries);
  return entries.length;
}
