/**
 * `.ccx` 에 담을 산출물을 고른다. (ROADMAP §98)
 *
 * `dist/` 는 gitignore 대상이고 `tsc -b` 는 **소스가 사라져도 옛 산출물을 지우지 않는다.** 그래서 한동안
 * 쓰다 지운 탐침(`*-probe.tmp.ts`)과 이름이 바뀐 모듈의 컴파일 결과가 로컬 `dist` 에 남아 있었고, 패키징이
 * `dist` 의 모든 `.js` 를 복사해 그것까지 `.ccx` 에 실렸다. 사용자에게 배포되는 파일에 실기 탐침 코드가
 * 섞인 것이다.
 *
 * 그래서 **현재 소스에 대응하는 산출물만** 고른다 — `dist/a/b.js` 는 `src/a/b.ts` 가 있을 때만 담는다.
 * 짝이 없는 것은 `stale` 로 돌려줘 호출자가 이름을 보이게 한다. 조용히 빼면 `dist` 가 낡았다는 것을 아무도
 * 모른다.
 *
 * 부수 효과가 없는 순수 함수라 `tests/ccx-files.test.ts` 가 임시 폴더로 시험한다(패키징 스크립트는
 * 불러오는 순간 실행되어 import 할 수 없다).
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** `dir` 아래의 모든 파일을 `dir` 기준 상대 경로(`/` 구분)로 모은다. */
function walk(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full, base));
    } else {
      found.push(relative(base, full).split(sep).join("/"));
    }
  }
  return found;
}

/**
 * @param {string} distDir  컴파일 결과 폴더
 * @param {string} srcDir   소스 폴더
 * @returns {{ keep: string[], stale: string[] }}  둘 다 `distDir` 기준 상대 경로
 */
export function selectOutputs(distDir, srcDir) {
  const keep = [];
  const stale = [];
  // 실행에 필요한 `.js` 만 본다. 소스맵 · `.d.ts` · `.tsbuildinfo` 는 애초에 대상이 아니다.
  for (const path of walk(distDir)
    .filter((name) => name.endsWith(".js"))
    .sort()) {
    const source = join(srcDir, path.replace(/\.js$/u, ".ts"));
    (existsSync(source) ? keep : stale).push(path);
  }
  return { keep, stale };
}
