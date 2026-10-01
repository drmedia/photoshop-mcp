#!/usr/bin/env node
/**
 * Photoshop API 커버리지 매트릭스.
 *
 * Adobe 공식 DOM 레퍼런스(클래스의 속성·메서드)와 이 저장소의 플러그인 소스가 실제로 쓰는 것을
 * 자동으로 견준다.
 *
 * ```bash
 * node scripts/api-coverage.mjs             # 스냅샷으로 docs/API_COVERAGE.md 를 만든다
 * node scripts/api-coverage.mjs --check     # 문서가 최신인지만 본다 (테스트가 쓴다)
 * node scripts/api-coverage.mjs --refresh   # Adobe 저장소에서 스냅샷을 새로 받는다 (네트워크)
 * ```
 *
 * ## 기준은 Adobe 의 공개 문서 원본이다
 *
 * `AdobeDocs/uxp-photoshop` 의 `src/pages/ps-reference/classes/*.md` 를 파싱한다. 한 번 받아
 * `docs/api-coverage/adobe-api-snapshot.json` 으로 커밋하므로 평소 실행은 오프라인이고 결과가
 * 재현된다. `--refresh` 만 네트워크를 쓴다.
 *
 * ## 무엇을 "쓴다" 고 보는가
 *
 * 플러그인 소스(`photoshop-uxp/src`, 선언 파일 제외)에서 **주석을 걷어내고**
 *   - 멤버 접근 `.이름` · `?.이름`
 *   - 문자열 리터럴이 정확히 그 이름인 것 (`["resizeCanvas"]`, `"flip"`)
 * 을 센다. 오류 메시지 같은 문장 속 이름은 세지 않는다.
 *
 * ## 한계 — 귀속
 *
 * `name` · `id` 처럼 **여러 클래스가 공유하는 이름**은 어느 클래스에서 쓴 것인지 알 수 없다.
 * 그런 것은 "확인" 으로 세지 않고 "공유 이름" 으로 따로 둔다. 과대 집계를 피하려는 선택이고,
 * 그래서 확인 수는 **하한**이다. 반사적으로 읽는 곳(`preferences.get`)은 이름이 코드에 없어
 * "흔적 없음" 으로 나온다 — 그것은 빈틈이 아니라 읽는 방식이다.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SNAPSHOT = join(ROOT, "docs/api-coverage/adobe-api-snapshot.json");
const REPORT = join(ROOT, "docs/API_COVERAGE.md");
const SRC = join(ROOT, "photoshop-uxp/src");
const REPO = "AdobeDocs/uxp-photoshop";
const BASE = `https://raw.githubusercontent.com/${REPO}/main/src/pages/ps-reference/classes`;

// ── 1. Adobe 레퍼런스 파싱 ─────────────────────────────────────────────

/** 마크다운 링크·강조·HTML 엔티티를 걷어낸 평문. */
const plain = (text) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*`]/gu, "")
    .replace(/\\</gu, "<")
    .replace(/&#x60;/gu, "`")
    .trim();

/**
 * 한 클래스 문서를 `{ properties, methods }` 로 읽는다.
 *
 * 속성은 두 모양으로 적혀 있다 — 대부분 `## Properties` 아래 표이고, 일부(`CountItem`)는
 * `### 이름` 제목이다. 둘 다 읽는다. 최소 버전은 제목 바로 뒤의 `minversion` 스팬에 있다.
 */
export function parseClass(markdown) {
  const properties = [];
  const methods = [];
  let section = null;
  let current = null; // 최소 버전을 기다리는 멤버
  // 이름 열 다음의 열 이름들. 대부분의 문서가 이 순서다.
  let columns = ["Type", "Access", "Min Version", "Description"];

  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^(#{2,3}) (.+)$/u.exec(line);
    if (heading) {
      if (heading[1] === "##") {
        section = heading[2].trim();
        current = null;
      } else if (section === "Methods") {
        current = { name: heading[2].trim(), minVersion: null };
        methods.push(current);
      } else if (section === "Properties") {
        current = { name: heading[2].trim(), type: "", access: "", minVersion: null };
        properties.push(current);
      }
      continue;
    }
    if (section === "Properties") {
      const row = /^\|\s*([A-Za-z_][\w]*)\s*\|(.*)\|\s*$/u.exec(line);
      if (row && row[1] === "Name") {
        // 표 머리글은 멤버가 아니다. 대신 **열 순서를 읽는다** — `CharacterStyle` 은
        // `Default` · `Range` 열이 끼어 있어 최소 버전의 위치가 다르다.
        columns = row[2].split(/(?<!\\)\|/u).map((cell) => plain(cell));
        continue;
      }
      if (row) {
        // 유니온 형식은 `A \| B` 로 적힌다 — 이스케이프된 파이프는 셀 경계가 아니다.
        const cells = row[2].split(/(?<!\\)\|/u).map((cell) => plain(cell));
        const at = (header) => cells[columns.indexOf(header)] ?? "";
        const minVersion = at("Min Version");
        properties.push({
          name: row[1],
          type: at("Type"),
          access: at("Access"),
          minVersion: minVersion === "" ? null : minVersion,
        });
        continue;
      }
    }
    if (current !== null && current.minVersion === null) {
      const version = /minversion[^>]*>\s*(\d+(?:\.\d+)*)\s*\\?</u.exec(line);
      if (version) {
        current.minVersion = version[1];
      }
    }
  }
  return { properties, methods };
}

async function refreshSnapshot() {
  const tree = await (
    await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`)
  ).json();
  const prefix = "src/pages/ps-reference/classes/";
  // 하위 폴더(`preferences/…`)도 있다 — 파일명만 보면 놓친다.
  const files = tree.tree
    .filter(
      (entry) =>
        entry.type === "blob" && entry.path.startsWith(prefix) && entry.path.endsWith(".md"),
    )
    .map((entry) => entry.path.slice(prefix.length))
    .filter((file) => file.split("/").pop() !== "index.md");
  const head = await (await fetch(`https://api.github.com/repos/${REPO}/commits/main`)).json();

  const classes = {};
  for (const file of files.sort()) {
    const response = await fetch(`${BASE}/${file}`);
    if (!response.ok) {
      throw new Error(`${file}: ${String(response.status)}`);
    }
    const markdown = await response.text();
    const title =
      /^title:\s*"?([^"\n]+?)"?\s*$/mu.exec(markdown)?.[1] ?? file.replace(/\.md$/u, "");
    // 하위 폴더 문서는 폴더 이름을 앞에 붙인다 — `Preferences/Cursors`.
    const dir = file.includes("/") ? file.split("/").slice(0, -1).join("/") : "";
    const name = dir === "" ? title : `${dir[0].toUpperCase()}${dir.slice(1)}/${title}`;
    classes[name] = parseClass(markdown);
  }
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(
    SNAPSHOT,
    `${JSON.stringify({ source: REPO, commit: head.sha, commitDate: head.commit?.committer?.date, classes }, null, 1)}\n`,
  );
  console.log(
    `스냅샷: 클래스 ${Object.keys(classes).length}개 (${REPO}@${String(head.sha).slice(0, 7)})`,
  );
}

// ── 2. 플러그인 소스에서 쓰는 이름 모으기 ────────────────────────────────

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "types" ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * 주석을 걷어내고 `{ members, strings }` 를 모은다.
 * 정규식 한 번으로는 문자열 안의 `//` 를 주석으로 오인하므로 한 글자씩 상태를 따라간다.
 */
export function scanNames(code) {
  const members = new Set();
  const strings = new Set();
  let index = 0;
  const length = code.length;

  while (index < length) {
    const ch = code[index];
    const next = code[index + 1];
    if (ch === "/" && next === "/") {
      while (index < length && code[index] !== "\n") {
        index += 1;
      }
    } else if (ch === "/" && next === "*") {
      index += 2;
      while (index < length && !(code[index] === "*" && code[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let text = "";
      index += 1;
      while (index < length && code[index] !== ch) {
        if (code[index] === "\\") {
          index += 1;
        }
        text += code[index] ?? "";
        index += 1;
      }
      index += 1;
      if (/^[A-Za-z_]\w*$/u.test(text)) {
        strings.add(text);
      }
    } else if (ch === ".") {
      const match = /^\.\s*([A-Za-z_]\w*)/u.exec(code.slice(index, index + 80));
      if (match) {
        members.add(match[1]);
        index += match[0].length;
      } else {
        index += 1;
      }
    } else {
      index += 1;
    }
  }
  return { members, strings };
}

// ── 3. 견주기 ──────────────────────────────────────────────────────────

const OTHERWISE = join(ROOT, "docs/api-coverage/provided-otherwise.json");

/**
 * 사람이 검증한 대응표. DOM 사용 흔적만으로는 못 잡는 것을 채운다.
 *
 * ```json
 * { "member": "Layer.applyGaussianBlur", "tool": "photoshop.filter.gaussian_blur",
 *   "via": "batchPlay", "note": "…" }
 * ```
 *
 * 이 표는 **자동으로 검증된다** — `member` 가 스냅샷에 있는지, `tool` 이 레지스트리에 있는지를
 * `tests/api-coverage.test.ts` 가 본다. 낡으면 실패한다.
 */
export function loadOtherwise() {
  return existsSync(OTHERWISE) ? JSON.parse(readFileSync(OTHERWISE, "utf8")) : [];
}

const NOT_EXPOSED = join(ROOT, "docs/api-coverage/not-exposed.json");

/**
 * 일부러 열지 않은 것과 그 사유. **사유가 기록으로 남은 것만** 적는다.
 *
 * ```json
 * { "members": ["CharacterStyle.ligatures", …], "reason": "…", "source": "ROADMAP §…" }
 * ```
 *
 * 사유 없이 안 열린 것은 "제외" 가 아니라 **미결정**이다 — "흔적 없음" 으로 남긴다. 그래야 결정이
 * 필요한 목록이 사라지지 않는다. 항목마다 멤버가 스냅샷에 있는지, 그 멤버를 소스가 아직 안 쓰는지를
 * `tests/api-coverage.test.ts` 가 본다 — 열었는데 제외로 적혀 있으면 실패한다.
 */
export function loadNotExposed() {
  return existsSync(NOT_EXPOSED) ? JSON.parse(readFileSync(NOT_EXPOSED, "utf8")) : [];
}

/**
 * `Preferences/*` 는 `preferences.get` 이 하위 객체의 열거 가능한 키를 **반사적으로** 읽는다
 * (`app-info.ts`). 이름이 코드에 없으므로 이름 기준 비교가 성립하지 않는다.
 */
const REFLECTIVE = (className) => className.startsWith("Preferences/");

export function compare(snapshot) {
  const otherwise = new Map(loadOtherwise().map((entry) => [entry.member, entry]));
  const excludedBy = new Map(
    loadNotExposed().flatMap((entry) => entry.members.map((member) => [member, entry])),
  );
  const used = new Map(); // 이름 → 쓰는 파일들
  for (const file of sourceFiles(SRC)) {
    const { members, strings } = scanNames(readFileSync(file, "utf8"));
    const rel = relative(SRC, file).replaceAll("\\", "/");
    for (const name of new Set([...members, ...strings])) {
      used.set(name, [...(used.get(name) ?? []), rel]);
    }
  }

  // 이름이 몇 개 클래스에 있는지 — 여럿이면 귀속할 수 없다.
  const classCountByName = new Map();
  for (const [, cls] of Object.entries(snapshot.classes)) {
    for (const name of new Set([...cls.properties, ...cls.methods].map((m) => m.name))) {
      classCountByName.set(name, (classCountByName.get(name) ?? 0) + 1);
    }
  }

  const rows = [];
  for (const [className, cls] of Object.entries(snapshot.classes)) {
    const members = [
      ...cls.properties.map((m) => ({ ...m, kind: "속성" })),
      ...cls.methods.map((m) => ({ ...m, kind: "메서드" })),
    ].map((m) => {
      const files = used.get(m.name) ?? [];
      const shared = (classCountByName.get(m.name) ?? 1) > 1;
      const mapped = otherwise.get(`${className}.${m.name}`);
      const excluded = excludedBy.get(`${className}.${m.name}`);
      // 소스의 이름 흔적만으로 본 판정. 사람이 적은 표가 덮기 전의 값이다.
      const baseStatus = files.length === 0 ? "none" : shared ? "shared" : "confirmed";
      // 우선순위: 대응 > 제외 > 반사 읽기 > 소스의 이름 흔적.
      let status = baseStatus;
      if (REFLECTIVE(className)) {
        status = "reflective";
      }
      if (excluded) {
        status = "excluded";
      }
      if (mapped) {
        status = "otherwise";
      }
      return {
        ...m,
        files,
        status,
        baseStatus,
        mapped,
        excluded,
        sharedBy: classCountByName.get(m.name) ?? 1,
      };
    });
    rows.push({ className, members });
  }
  return rows;
}

// ── 4. 보고서 ──────────────────────────────────────────────────────────

const pct = (a, b) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(0)}%`);

export function render(snapshot, rows) {
  const lines = [];
  const total = rows.flatMap((r) => r.members);
  const count = (s) => total.filter((m) => m.status === s).length;

  lines.push("# Photoshop API 커버리지 매트릭스", "");
  lines.push(
    "> **자동 생성 문서다 — 직접 고치지 않는다.** `node scripts/api-coverage.mjs` 가 만든다.",
    "> 기준은 Adobe 공식 DOM 레퍼런스 원본(`" +
      snapshot.source +
      "@" +
      String(snapshot.commit).slice(0, 7) +
      "`, " +
      String(snapshot.commitDate ?? "").slice(0, 10) +
      ")이고 비교 대상은 `photoshop-uxp/src` 다.",
    "",
  );
  lines.push(
    "## 읽는 법",
    "",
    "- **확인** — 그 이름이 **이 클래스에만** 있고 플러그인 소스가 쓴다. 가장 믿을 만하다.",
    "- **공유 이름** — 소스가 그 이름을 쓰지만 이름을 여러 클래스가 공유해(`name` · `id` · `delete` …)",
    "  **어느 클래스를 가리키는지 알 수 없다.** 쓰고 있을 수도, 아닐 수도 있다.",
    "- **대응** — 사람이 적은 `docs/api-coverage/provided-otherwise.json` 의 항목. DOM 이 아니라",
    "  다른 길(주로 batchPlay)로 **Tool 이 이미 제공**한다. 표는 테스트가 검증한다.",
    "- **제외** — `docs/api-coverage/not-exposed.json` 의 항목. **사유가 기록으로 남은 것만** 적는다.",
    "  멤버를 소스가 쓰기 시작하면 테스트가 실패하므로 낡은 제외가 남지 않는다.",
    "- **반사 읽기** — `Preferences/*` 는 `preferences.get` 이 열거 가능한 키를 훑어 읽는다. 이름이",
    "  코드에 없는 것이 정상이라 이름 기준 비교가 성립하지 않는다.",
    "- **흔적 없음** — 소스 어디에도 그 이름이 없고 사유도 기록에 없다. **아직 정해지지 않은 것**이다.",
    "  빈틈일 수도, 일부러 안 연 것일 수도, batchPlay 로 이미 제공하는데 대응표에 안 적힌 것일 수도 있다.",
    "",
    '**"흔적 없음" 을 "Tool 이 없다" 로 읽지 않는다.** 이 문서는 DOM **사용 흔적**을 센다.',
    "batchPlay 로 구현한 기능은 DOM 멤버 이름이 코드에 없어 흔적 없음으로 나온다.",
    '확인 수는 하한이고, 이 표는 **어디를 들여다볼지** 알려 줄 뿐 "무엇이 빠졌다" 고 단정하지 않는다.',
    "",
  );

  lines.push("## 요약", "");
  lines.push(
    `클래스 ${rows.length}개 · 멤버 ${total.length}개 — ` +
      `확인 **${count("confirmed")}** (${pct(count("confirmed"), total.length)}) · ` +
      `대응 ${count("otherwise")} · ` +
      `제외 ${count("excluded")} · ` +
      `공유 이름 ${count("shared")} (${pct(count("shared"), total.length)}) · ` +
      `반사 읽기 ${count("reflective")} · ` +
      `흔적 없음 ${count("none")} (${pct(count("none"), total.length)})`,
    "",
  );

  // DOM 에 있는데 batchPlay 로 구현한 것 — 옮길 후보.
  const viaBatchPlay = total.filter((m) => m.mapped && /batchPlay/iu.test(m.mapped.via ?? ""));
  if (viaBatchPlay.length > 0) {
    lines.push(
      "## DOM 에 있는데 batchPlay 로 구현한 것",
      "",
      "Adobe 레퍼런스를 먼저 본다는 이 프로젝트의 규칙에서 보면 **옮길 수 있는지 살펴볼 후보**다.",
      "`selection.set` 을 batchPlay 에서 DOM 으로 옮기며 `mode` 와 `antiAlias` 를 얻은 것(ROADMAP §71)과",
      "같은 종류다. 옮기라는 권고가 아니다 — 스마트 필터로 붙는 방식이 같은지 등은 재 봐야 안다.",
      "",
      "| DOM 멤버 | 최소 버전 | Tool | 비고 |",
      "|---|---|---|---|",
    );
    for (const m of viaBatchPlay) {
      lines.push(
        `| \`${m.mapped.member}\`${m.kind === "메서드" ? "()" : ""} | ${m.minVersion ?? "—"} | \`${m.mapped.tool}\` | ${m.mapped.note ?? ""} |`,
      );
    }
    lines.push("");
  }

  // 같은 기능을 다른 DOM 메서드로 제공하는 것 — 옮길 일은 아니고 이름이 다른 것이다.
  const viaOtherDom = total.filter((m) => m.mapped && !/batchPlay/iu.test(m.mapped.via ?? ""));
  if (viaOtherDom.length > 0) {
    lines.push(
      "## 같은 기능을 다른 DOM 메서드로 제공하는 것",
      "",
      '이름 기준으로는 "흔적 없음" 이지만 Tool 은 있다. 다른 메서드로 같은 일을 한다.',
      "",
      "| DOM 멤버 | 최소 버전 | Tool | 어떻게 |",
      "|---|---|---|---|",
    );
    for (const m of viaOtherDom) {
      lines.push(
        `| \`${m.mapped.member}\`${m.kind === "메서드" ? "()" : ""} | ${m.minVersion ?? "—"} | \`${m.mapped.tool}\` | ${m.mapped.note ?? ""} |`,
      );
    }
    lines.push("");
  }

  // 일부러 열지 않은 것 — 사유와 출처를 함께.
  const excludedEntries = loadNotExposed();
  if (excludedEntries.length > 0) {
    lines.push("## 일부러 열지 않은 것", "");
    for (const entry of excludedEntries) {
      const classes = [...new Set(entry.members.map((member) => member.split(".")[0]))];
      lines.push(
        `- **${entry.members.length}개** (${classes.join(" · ")}): ${entry.reason}`,
        `  - 출처: ${entry.source}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## 클래스별 요약",
    "",
    "| 클래스 | 멤버 | 확인 | 대응 | 제외 | 공유 이름 | 반사 읽기 | 흔적 없음 | 확인 비율 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const { className, members } of [...rows].sort(
    (a, b) => b.members.length - a.members.length || a.className.localeCompare(b.className),
  )) {
    const c = (s) => members.filter((m) => m.status === s).length;
    lines.push(
      `| ${className} | ${members.length} | ${c("confirmed")} | ${c("otherwise")} | ${c("excluded")} | ${c("shared")} | ${c("reflective")} | ${c("none")} | ${pct(c("confirmed"), members.length)} |`,
    );
  }
  lines.push("");

  lines.push("## 클래스별 상세", "");
  for (const { className, members } of [...rows].sort((a, b) =>
    a.className.localeCompare(b.className),
  )) {
    const by = (s) => members.filter((m) => m.status === s);
    const label = (m) => `\`${m.name}\`${m.kind === "메서드" ? "()" : ""}`;
    lines.push(`### ${className}`, "");
    if (by("reflective").length > 0) {
      lines.push(
        `- **반사 읽기 (${by("reflective").length})**: \`preferences.get\` 이 훑는다 — 이름 비교 대상이 아니다.`,
      );
    }
    if (by("confirmed").length > 0) {
      lines.push(
        `- **확인 (${by("confirmed").length})**: ${by("confirmed").map(label).join(" · ")}`,
      );
    }
    if (by("otherwise").length > 0) {
      lines.push(
        `- **대응 (${by("otherwise").length})**: ${by("otherwise")
          .map((m) => `${label(m)} → \`${m.mapped.tool}\``)
          .join(" · ")}`,
      );
    }
    if (by("excluded").length > 0) {
      lines.push(
        `- **제외 (${by("excluded").length})**: ${by("excluded").map(label).join(" · ")} — 사유는 위 "일부러 열지 않은 것"`,
      );
    }
    if (by("shared").length > 0) {
      lines.push(
        `- **공유 이름 (${by("shared").length})**: ${by("shared")
          .map((m) => `\`${m.name}\`(${m.sharedBy})`)
          .join(" · ")}`,
      );
    }
    if (by("none").length > 0) {
      lines.push(
        `- **흔적 없음 (${by("none").length})**: ${by("none")
          .map((m) => `${label(m)}${m.minVersion ? ` _${m.minVersion}_` : ""}`)
          .join(" · ")}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "---",
    "",
    "공유 이름 뒤의 숫자는 그 이름을 가진 클래스 수다. 흔적 없음 뒤의 기울임 숫자는 최소 Photoshop 버전이다.",
    "",
  );
  return `${lines.join("\n")}`;
}

// ── 실행 ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--refresh")) {
    await refreshSnapshot();
  }
  if (!existsSync(SNAPSHOT)) {
    console.error("스냅샷이 없다. `--refresh` 로 먼저 받는다.");
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const report = render(snapshot, compare(snapshot));
  if (args.includes("--check")) {
    const current = existsSync(REPORT) ? readFileSync(REPORT, "utf8").replace(/\r\n/gu, "\n") : "";
    if (current !== report) {
      console.error(
        "docs/API_COVERAGE.md 가 낡았다. `node scripts/api-coverage.mjs` 로 다시 만든다.",
      );
      process.exit(1);
    }
    console.log("API_COVERAGE.md 가 최신이다.");
    return;
  }
  writeFileSync(REPORT, report);
  console.log(`쓴 곳: ${relative(ROOT, REPORT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
