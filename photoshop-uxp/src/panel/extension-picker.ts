import {
  addRegisteredFolder,
  readRegistered,
  writeRegistered,
  type RegisteredExtension,
} from "../dom/extension-registry.js";

/**
 * Extension 등록 모달. (ROADMAP §18.3)
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 사용자가 설치한 것만 여기서 고른다.
 *
 * UXP 모달에서 실기로 배운 것을 그대로 따른다(§17.36).
 *
 * - 버튼 기본 스타일이 커서 **높이를 직접 못 박는다**
 * - 대화상자는 **텍스트 색을 물려주지 않는다** — 명시한다
 * - `<form method="dialog">` 제출로 **닫히지 않는다** — `dialog.close(값)` 을 건다
 *
 * **저장 버튼을 두지 않는다.** 추가는 `getFolder()` 제스처가 곧 의사 표시이고,
 * 제거는 그 자리에서 사라지는 것이 사용자가 기대하는 결과다. 한쪽만 즉시면
 * 같은 창에서 두 규칙이 섞여 무엇이 저장됐는지 알 수 없다.
 */

const TEXT = "#e8e8e8";
const BTN = "font-size:11px;padding:1px 8px;height:22px;min-height:0;margin:0;white-space:nowrap";

function row(entry: RegisteredExtension, index: number): string {
  const when = entry.addedAt === 0 ? "" : new Date(entry.addedAt).toLocaleDateString();
  return [
    '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;',
    `border-bottom:1px solid #3a3a3a;color:${TEXT}">`,
    '<div style="flex:1;word-break:break-all;font-size:11px">',
    entry.path,
    when === "" ? "" : `<span style="opacity:.6"> · ${when}</span>`,
    "</div>",
    `<button id="ep-drop-${String(index)}" style="${BTN}">제거</button>`,
    "</div>",
  ].join("");
}

/**
 * 모달을 연다. **패널 버튼에서만 부를 수 있다** — `getFolder()` 가 사용자
 * 제스처를 요구하고, 그것이 곧 안전장치다(LLM 이 임의 폴더를 적재시킬 수 없다).
 */
export async function openExtensionPicker(): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = `width:520px;color:${TEXT};background:#323232`;

  let entries = readRegistered();

  const fail = (message: string): void => {
    const box = dialog.querySelector("#ep-error");
    if (box !== null) {
      box.textContent = message;
      (box as HTMLElement).style.display = "block";
    }
  };

  const clearError = (): void => {
    const box = dialog.querySelector("#ep-error");
    if (box !== null) {
      (box as HTMLElement).style.display = "none";
    }
  };

  const render = (): void => {
    const count = dialog.querySelector("#ep-count");
    if (count !== null) {
      count.textContent =
        entries.length === 0 ? "등록된 것이 없습니다" : `${String(entries.length)}개 등록`;
    }

    const list = dialog.querySelector("#ep-list");
    if (list === null) {
      return;
    }
    list.innerHTML =
      entries.length === 0
        ? '<div style="opacity:.7;padding:8px 0;font-size:11px">아래 <b>폴더 추가</b> 로 고르세요.</div>'
        : entries.map(row).join("");

    // 제거는 즉시 저장한다. `innerHTML` 을 다시 쓰므로 버튼도 매번 다시 건다.
    entries.forEach((_, index) => {
      list.querySelector(`#ep-drop-${String(index)}`)?.addEventListener("click", (event) => {
        event.preventDefault();
        entries = entries.filter((__, other) => other !== index);
        writeRegistered(entries);
        clearError();
        render();
      });
    });
  };

  dialog.innerHTML = [
    `<div style="padding:10px;font-family:sans-serif;color:${TEXT}">`,
    '<div style="font-size:13px;margin-bottom:2px">Extension 등록</div>',
    '<div style="font-size:11px;opacity:.75;margin-bottom:8px">',
    "설치한 Extension 폴더를 고릅니다. <b>extension.json</b> 이 들어 있어야 합니다.",
    "</div>",
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">',
    `<button id="ep-add" style="${BTN}">폴더 추가…</button>`,
    '<div id="ep-count" style="flex:1;font-size:11px;opacity:.85"></div>',
    `<button id="ep-close" style="${BTN}">닫기</button>`,
    "</div>",
    '<div id="ep-list" style="max-height:240px;overflow:auto"></div>',
    '<div id="ep-error" style="margin-top:8px;padding:4px;background:#4a1f1f;',
    'color:#ffb4b4;font-size:11px;word-break:break-all;display:none"></div>',
    '<div style="margin-top:8px;font-size:11px;opacity:.7">',
    "바꾼 뒤에는 <b>MCP 서버를 다시 연결</b>해야 Tool 목록에 반영됩니다.",
    "</div></div>",
  ].join("");

  dialog.querySelector("#ep-add")?.addEventListener("click", (event) => {
    event.preventDefault();
    void addRegisteredFolder()
      .then((result) => {
        entries = result.entries;
        if (result.duplicate) {
          fail("이미 등록된 폴더입니다.");
        } else {
          clearError();
        }
        render();
      })
      .catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
  });

  dialog.querySelector("#ep-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close("close");
  });

  document.body.appendChild(dialog);
  render();
  try {
    await (dialog as unknown as { uxpShowModal: (o: unknown) => Promise<unknown> }).uxpShowModal({
      title: "Extension 등록",
      resize: "both",
      size: { width: 520, height: 380 },
    });
  } finally {
    dialog.remove();
  }
}
