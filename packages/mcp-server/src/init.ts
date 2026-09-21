import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readOptionsFromEnv } from "./run.js";

/**
 * `photoshop-mcp init` — `capabilities.json` 을 만든다. (ROADMAP §18)
 *
 * ## 왜 필요한가
 *
 * `capabilities.json` 은 `.gitignore` 에 있다. 실행 파일 경로가 기기마다 달라서
 * 저장소에 넣을 수 없다. 그래서 **클론한 사람에게는 처음부터 없고**,
 * `capabilities.example.json` 을 복사해 경로를 손으로 고쳐야 한다.
 *
 * 경로가 틀려도 그 자리에서는 조용하다. `milky.remove_stars` 를 부를 때가
 * 되어서야 "쓸 수 없습니다" 가 나온다. 그래서 여기서 **실제로 있는 것만** 쓴다.
 *
 * ## 짐작해서 쓰지 않는다
 *
 * 알려진 설치 경로를 훑어 **파일이 있는 것만** 넣는다. 없는 처리기는
 * `example` 에서 가져다 넣지 않는다 — 있는 것처럼 보이는 설정은
 * `capability.list` 에 이름만 올리고 쓸 때 실패한다.
 *
 * ## 덮어쓰지 않는다
 *
 * 이미 있으면 거절한다. 사용자가 손으로 고친 경로가 들어 있을 수 있고,
 * 그것을 말없이 날리는 것은 이 프로젝트에서 가장 나쁜 실패다.
 */

/** 처리기별로 알려진 설치 위치. 여기 없는 곳에 깔았으면 손으로 적는다. */
interface Candidate {
  id: string;
  capability: string;
  label: string;
  /** 앞에서부터 찾아 처음 있는 것을 쓴다. */
  paths: string[];
  /** 찾았을 때 쓸 설정. `executable` 은 찾은 경로로 채운다. */
  config: Record<string, unknown>;
}

/**
 * 찾을 뿌리들.
 *
 * **전부 주입 가능해야 한다.** `C:/Program Files` 를 상수로 박으면 그 기계에
 * 실제로 깔린 것에 따라 테스트 결과가 달라진다 — 격리된 것처럼 보이지만
 * 아니다.
 */
export interface SearchRoots {
  home: string;
  programFiles: string;
}

function candidates(roots: SearchRoots): Candidate[] {
  return [
    {
      id: "graxpert",
      capability: "gradientRemoval",
      label: "GraXpert",
      paths: [
        join(roots.home, "AppData/Local/Programs/GraXpert/GraXpert.exe"),
        join(roots.programFiles, "GraXpert/GraXpert.exe"),
      ],
      config: {
        args: [
          "-cmd",
          "background-extraction",
          "{{input}}",
          "-cli",
          "-gpu",
          "{{gpu}}",
          "-correction",
          "{{correction}}",
          "-smoothing",
          "{{smoothing}}",
          "-output",
          "{{output}}",
        ],
        params: {
          correction: {
            type: "enum",
            values: ["Subtraction", "Division"],
            default: "Subtraction",
          },
          smoothing: { type: "number", min: 0, max: 1, default: 0.5 },
          gpu: { type: "boolean", default: true },
        },
        // GraXpert 3.0.2 는 -output out.tif 를 줘도 out.tif.fits 를 만든다.
        outputSuffix: ".fits",
        convert: "fitsToTiff",
        timeoutMs: 1_800_000,
        priority: 10,
      },
    },
    {
      id: "starnet2",
      capability: "starRemoval",
      label: "StarNet++ v2",
      paths: [join(roots.programFiles, "StarNet2/bin/starnet2.exe")],
      config: {
        args: [
          "--input",
          "{{input}}",
          "--output",
          "{{output}}",
          "--unscreen",
          "{{output.stars}}",
          "--machine-progress",
        ],
        outputs: { stars: { description: "별만 남긴 이미지. restore_stars 에 쓴다." } },
        timeoutMs: 1_800_000,
        priority: 10,
      },
    },
    {
      id: "bxt",
      capability: "deconvolution",
      label: "BlurXTerminator (RC-Astro CLI)",
      paths: [join(roots.programFiles, "RC-Astro/CLI/rc-astro.exe")],
      config: {
        args: [
          "bxt",
          "{{input}}",
          "--sharpen-nonstellar",
          "{{nonstellar}}",
          "--output",
          "{{output}}",
          "--overwrite",
        ],
        params: { nonstellar: { type: "number", min: 0, max: 1, default: 0.5 } },
        timeoutMs: 1_800_000,
        priority: 10,
      },
    },
  ];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface InitResult {
  path: string;
  written: boolean;
  found: { id: string; executable: string }[];
  missing: string[];
  /** 쓰지 않았으면 그 이유. */
  reason: string;
}

export function defaultRoots(env: Record<string, string | undefined> = process.env): SearchRoots {
  return {
    home: homedir(),
    programFiles: env["ProgramFiles"] ?? "C:/Program Files",
  };
}

export async function runInit(
  env: Record<string, string | undefined> = process.env,
  roots: SearchRoots = defaultRoots(env),
): Promise<InitResult> {
  const path = readOptionsFromEnv(env).capabilityConfig;

  const found: { id: string; executable: string }[] = [];
  const missing: string[] = [];
  const providers: Record<string, unknown>[] = [];

  for (const candidate of candidates(roots)) {
    let executable: string | null = null;
    for (const location of candidate.paths) {
      if (await exists(location)) {
        executable = location;
        break;
      }
    }
    if (executable === null) {
      missing.push(candidate.label);
      continue;
    }
    found.push({ id: candidate.id, executable });
    providers.push({
      id: candidate.id,
      capability: candidate.capability,
      label: candidate.label,
      // 경로 구분자를 `/` 로 통일한다. JSON 에 `\` 가 들어가면 이스케이프가 필요하고,
      // 손으로 고칠 때 틀리기 쉽다. Node 는 Windows 에서도 `/` 를 받는다.
      executable: executable.replace(/\\/gu, "/"),
      ...candidate.config,
    });
  }

  if (await exists(path)) {
    return {
      path,
      written: false,
      found,
      missing,
      reason:
        "이미 있습니다. 덮어쓰지 않습니다 — 손으로 고친 경로가 들어 있을 수 있습니다. " +
        "다시 만들려면 먼저 옮기거나 지우세요.",
    };
  }

  if (providers.length === 0) {
    return {
      path,
      written: false,
      found,
      missing,
      reason:
        "알려진 위치에서 처리기를 하나도 찾지 못했습니다. 다른 곳에 설치했다면 " +
        "capabilities.example.json 을 복사해 경로를 직접 적으세요.",
    };
  }

  await writeFile(path, `${JSON.stringify({ providers }, null, 2)}\n`, "utf8");
  return { path, written: true, found, missing, reason: "" };
}

/** CLI 진입점. */
export async function main(): Promise<void> {
  const result = await runInit();

  for (const item of result.found) {
    console.error(`[찾음] ${item.id.padEnd(10)} ${item.executable}`);
  }
  for (const label of result.missing) {
    console.error(`[없음] ${label} — 알려진 위치에 없습니다`);
  }

  if (result.written) {
    console.error(`\n${result.path} 를 만들었습니다.`);
    console.error("photoshop-mcp doctor 로 확인하세요.");
    process.exitCode = 0;
    return;
  }

  console.error(`\n${result.path} 를 만들지 않았습니다: ${result.reason}`);
  // 이미 있는 것은 정상이다. 찾지 못한 것은 사용자가 손을 대야 한다.
  process.exitCode = result.found.length > 0 ? 0 : 1;
}

/** 설정 파일을 읽어 선언된 처리기 수를 센다. `doctor` 와 테스트가 쓴다. */
export async function countProviders(path: string): Promise<number> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as { providers?: unknown[] };
  return parsed.providers?.length ?? 0;
}
