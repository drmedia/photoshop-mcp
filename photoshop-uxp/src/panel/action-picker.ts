import { app } from "photoshop";
import { readAllowed, writeAllowed } from "../dom/action-allowlist.js";

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
 * @returns 닫은 뒤 실제로 저장되어 있는 수.
 */
export async function openActionPicker(): Promise<number> {
  const sets = readSets();
  // 화면에서만 쓰는 선택 상태. 저장 전까지 localStorage 를 건드리지 않는다.
  const chosen = new Set(readAllowed().map((entry) => KEY(entry.set, entry.action)));

  const dialog = document.createElement("dialog");
  /* **패널·Extension 등록 모달과 같은 골격이다.** 위아래는 고정, 가운데만
   * 늘어나고 스크롤된다. `resize: "both"` 를 허용하므로 목록이 따라 늘어나야
   * 한다 — 예전에는 `height:340px` 으로 박혀 있어 창을 키워도 그대로였고
   * 아래만 비었다. 이 기기에 액션이 91개다.
   *
   * `height` · `display:flex` · `margin:0` 셋이 다 필요하다. 자세한 이유는
   * `extension-picker.ts` 에 적었다. */
  dialog.style.cssText =
    "width:460px;height:100vh;margin:0;padding:0;box-sizing:border-box;" +
    "display:flex;flex-direction:column";
  /* **색을 직접 정한다.** 실기에서 글자가 배경에 묻혀 거의 안 보였다 —
   * UXP 대화상자는 패널과 달리 텍스트 색을 물려주지 않는다.
   *
   * 다만 **하드코딩하지 않는다.** Photoshop 은 테마가 넷(Darkest·Dark·Light·
   * Lightest)이라 `#e8e8e8` 은 어두운 둘에서만 맞는다. 호스트가 주는 변수를
   * 쓰면 네 테마를 다 따라간다. */
  const TEXT = "var(--uxp-host-text-color, #e8e8e8)";
  const DIM = "var(--uxp-host-text-color-secondary, #b0b0b0)";
  const LINE = "var(--uxp-host-border-color, #6a6a6a)";
  dialog.innerHTML = [
    `<div style="flex:1;min-height:0;display:flex;flex-direction:column;`,
    `font-family:sans-serif;font-size:12px;padding:10px;color:${TEXT}">`,
    '<div style="flex-shrink:0;display:flex;align-items:center;margin-bottom:6px">',
    `<b style="color:${TEXT}">Actions allowed to run</b>`,
    `<span id="ap-count" style="margin-left:8px"></span>`,
    "</div>",
    `<div style="flex-shrink:0;color:${DIM};margin-bottom:6px">Click a set to expand it. Only the ones you pick can be run.</div>`,
    `<div id="ap-list" style="flex:1;min-height:0;overflow:auto;border:1px solid ${LINE};`,
    `padding:6px;color:${TEXT}"></div>`,
    // UXP 는 flex 의 `gap` 을 지원하지 않는다. 간격은 margin 으로 준다.
    '<div style="flex-shrink:0;margin-top:10px;display:flex;align-items:center">',
    // `cursor` 가 sp-action-button 에서는 먹는지 재 본다. 일반 div 에서는 안 먹었다.
    '<sp-action-button size="s" id="ap-none" style="margin-right:6px;cursor:pointer">Clear all</sp-action-button>',
    '<sp-action-button size="s" id="ap-save" style="cursor:pointer">Save</sp-action-button>',
    '<span style="flex:1"></span>',
    '<sp-action-button size="s" id="ap-close" style="cursor:pointer">Close</sp-action-button>',
    "</div>",
    "</div>",
  ].join("");

  const list = dialog.querySelector("#ap-list") as HTMLElement;
  const count = dialog.querySelector("#ap-count") as HTMLElement;
  const closeButton = dialog.querySelector("#ap-close") as HTMLElement | null;

  // 저장된 상태. `chosen` 과 견주어 "저장 안 함" 을 판단한다.
  let saved = new Set(readAllowed().map((entry) => KEY(entry.set, entry.action)));

  // 세트 헤더의 (고른수/전체) 를 다시 그리려면 그 요소를 들고 있어야 한다.
  // 실기에서 체크해도 헤더가 (0/1) 그대로였다 — **숫자가 거짓말을 했다.**
  const heads = new Map<string, HTMLElement>();

  const badgeFor = (node: SetNode): string => {
    if (node.actions === null) {
      return "";
    }
    const picked = node.actions.filter((name) => chosen.has(KEY(node.name, name))).length;
    return ` (${String(picked)}/${String(node.actions.length)})`;
  };

  const renderCount = (): void => {
    // **고른 것과 저장한 것을 구분해서 보여준다.** 실기에서 사용자가
    // "저장된 건지 선택한 건지 알기 힘들다" 고 했다 — 같은 숫자를 하나로만
    // 보여주면 둘을 구분할 수 없다.
    const dirty = chosen.size !== saved.size || [...chosen].some((key) => !saved.has(key));
    count.textContent = `${chosen.size} selected · ${dirty ? "unsaved" : "saved"}`;
    // 저장 여부는 색으로도 말한다. 이 둘은 의미색이라 테마와 무관하게 둔다.
    count.style.color = dirty ? "#e8a33d" : "#5aa469";
    if (closeButton !== null) {
      // 닫기 버튼이 결과를 말한다. 저장 안 한 채로 닫는 것이 사고가 되지 않게.
      closeButton.textContent = dirty ? "Close without saving" : "Close";
    }
    for (const node of sets) {
      const head = heads.get(node.name);
      if (head !== undefined) {
        head.innerHTML = `<b>${node.actions === null ? "▶" : "▼"} ${escape(node.name)}</b>${badgeFor(node)}`;
      }
    }
  };

  const render = (): void => {
    list.innerHTML = "";
    heads.clear();
    for (const node of sets) {
      const row = document.createElement("div");
      row.style.marginBottom = "2px";

      const head = document.createElement("div");
      head.style.cursor = "pointer";
      head.style.padding = "3px 2px";
      head.style.color = TEXT;
      head.innerHTML = `<b>${node.actions === null ? "▶" : "▼"} ${escape(node.name)}</b>${badgeFor(node)}`;
      heads.set(node.name, head);
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
        all.innerHTML = '<a href="#" style="color:#7fb3ff">Select / clear this whole set</a>';
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
          line.style.padding = "1px 0";
          line.style.display = "flex";
          line.style.alignItems = "center";
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
          label.style.color = TEXT;
          label.style.marginLeft = "6px";
          label.textContent = name;
          line.appendChild(box);
          line.appendChild(label);
          row.appendChild(line);
        }
      }
      list.appendChild(row);
    }
  };

  render();
  renderCount();

  // **UXP 는 `<form method="dialog">` 제출로 닫히지 않는다.** 실기에서 버튼이
  // 아무 반응도 없었다. 동작을 직접 건다.
  //
  // **저장과 모두 해제는 창을 닫지 않는다.** 닫히면 저장이 됐는지 확인할 방법이
  // 없다 — 실기에서 사용자가 바로 그것을 지적했다.
  dialog.querySelector("#ap-save")?.addEventListener("click", (event) => {
    event.preventDefault();
    writeAllowed(
      [...chosen].map((key) => {
        const [set, action] = key.split("\u0000");
        return { set: set ?? "", action: action ?? "" };
      }),
    );
    saved = new Set(chosen);
    renderCount();
  });
  dialog.querySelector("#ap-none")?.addEventListener("click", (event) => {
    event.preventDefault();
    // 화면에서만 지운다. 저장은 `저장` 을 눌러야 한다.
    chosen.clear();
    render();
    renderCount();
  });
  dialog.querySelector("#ap-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    (dialog as unknown as { close: (value: string) => void }).close("close");
  });

  document.body.appendChild(dialog);

  const show = (dialog as unknown as { uxpShowModal?: (options: unknown) => Promise<string> })
    .uxpShowModal;
  try {
    if (typeof show === "function") {
      await show.call(dialog, { title: "Choose actions", resize: "both" });
    } else {
      (dialog as unknown as { showModal: () => void }).showModal();
    }
  } finally {
    dialog.remove();
  }

  // 저장은 창 안에서 끝났다. 실제로 남은 것을 읽어 돌려준다 —
  // 화면 상태를 그대로 돌려주면 저장 안 한 것을 저장했다고 말하게 된다.
  return readAllowed().length;
}
