import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { WindowCaptureInput, WindowCapturer } from "@photoshop-mcp/photoshop-tools";

/**
 * Photoshop 창 캡처의 Windows 구현. (ROADMAP §17.11)
 *
 * ## 왜 UXP 가 아닌가
 *
 * UXP 샌드박스는 자기 창 밖을 볼 수 없다. 그런데 **서버가 Photoshop 과 같은 기계에
 * 있다** — Bridge 가 localhost WebSocket 이라 그럴 수밖에 없다. 그러니 서버가 직접
 * 찍으면 된다. 헬퍼 실행 파일을 따로 깔 이유가 없다.
 *
 * ## `PrintWindow` 를 쓴다. 화면 복사가 아니다
 *
 * 실기에서 셋을 재고 골랐다 (Photoshop 27.8, 3862×2099).
 *
 * ```text
 * PrintWindow flags=0              검정  1.2%  색 4341    창 내용이 나온다
 * PrintWindow RENDERFULLCONTENT=2  검정  2.6%  색 5000+   창 내용이 나온다
 * CopyFromScreen (화면 복사)        검정  1.0%  색  345    ← 위에 있던 딴 창이 찍혔다
 * ```
 *
 * 둘이 갈린다.
 *
 * 첫째, **GPU 캔버스가 검게 나오지 않는다.** 이것이 가장 걱정한 부분이었다.
 * `PW_RENDERFULLCONTENT`(2) 쪽이 색이 더 풍부해 그걸 쓴다.
 *
 * 둘째, **가려져 있어도 그 창을 찍는다.** 화면 복사는 위에 있는 창을 찍는다 —
 * 위 표의 "색 345" 가 그것이다. 진단 목적에는 이 차이가 결정적이다. Photoshop 이
 * 뒤에 있어도 대화상자를 볼 수 있어야 한다.
 *
 * ## LLM 이 준 값은 스크립트에 섞이지 않는다
 *
 * 스크립트는 **고정 상수**다. 가변 값(`longEdge`)은 자식 프로세스의 **환경 변수**로만
 * 넘어간다. 문자열 조립이 한 군데도 없으므로 주입할 틈이 없다. 호출자가 batchPlay
 * descriptor 를 넘기지 못하게 한 것과 같은 규칙이다. (ARCHITECTURE §23)
 *
 * `-EncodedCommand` 로 보내는 것은 **인용 부호 때문**이지 감추려는 것이 아니다.
 * 아래 C# 조각에 따옴표가 많아 Windows argv 인용 규칙을 그대로 태우면 깨지기 쉽다.
 * 실행 정책은 건드리지 않는다 — `-ExecutionPolicy Bypass` 는 `-File` 에만 해당하고
 * 여기서는 필요 없다.
 *
 * ## 최소화된 창은 실패로 돌려준다
 *
 * 최소화 상태에서 `PrintWindow` 를 부르면 예전 내용이나 빈 화면이 나온다. 오류는
 * 나지 않는다. 그대로 돌려주면 호출자는 그것이 현재 화면이라고 믿는다 —
 * 틀린 것을 맞다고 주는 것이 조용한 실패 중 가장 나쁘다.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_LONG_EDGE = 1024;
const DEFAULT_QUALITY = 80;

/** 출력에서 이미지 앞에 붙는 표식. 다른 출력이 섞여도 찾을 수 있게 한다. */
const MARKER = "##PSMCP##";

/**
 * 창을 찍어 base64 JPEG 를 표준출력으로 내보내는 PowerShell 스크립트.
 *
 * `[Console]::Out.WriteLine` 을 쓴다. `Write-Output` 은 서식 파이프라인을 거쳐
 * 콘솔 폭에서 줄바꿈될 수 있고, 그러면 base64 가 조용히 깨진다.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class PsMcpWindow {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static Bitmap Capture(IntPtr h) {
    RECT r;
    // DWMWA_EXTENDED_FRAME_BOUNDS(9). GetWindowRect 는 그림자까지 포함해 더 크다.
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    Bitmap b = new Bitmap(r.Right - r.Left, r.Bottom - r.Top, PixelFormat.Format32bppArgb);
    Graphics g = Graphics.FromImage(b);
    IntPtr hdc = g.GetHdc();
    // 2 = PW_RENDERFULLCONTENT. GPU 로 그리는 캔버스를 위해 필요하다.
    bool ok = PrintWindow(h, hdc, 2);
    g.ReleaseHdc(hdc);
    g.Dispose();
    if (!ok) { b.Dispose(); throw new Exception("PRINTWINDOW_FAILED"); }
    return b;
  }
}
"@

[PsMcpWindow]::SetProcessDPIAware() | Out-Null

$longEdge = [int]$env:PSMCP_LONG_EDGE
$quality = [int]$env:PSMCP_QUALITY

$proc = Get-Process -Name 'Photoshop' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if (-not $proc) { throw 'NOT_RUNNING' }

$handle = $proc.MainWindowHandle
if ([PsMcpWindow]::IsIconic($handle)) { throw 'MINIMIZED' }

$shot = [PsMcpWindow]::Capture($handle)
try {
  $scale = [Math]::Min(1.0, $longEdge / [Math]::Max($shot.Width, $shot.Height))
  $w = [Math]::Max(1, [int][Math]::Round($shot.Width * $scale))
  $h = [Math]::Max(1, [int][Math]::Round($shot.Height * $scale))

  $small = New-Object System.Drawing.Bitmap $w, $h
  try {
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.DrawImage($shot, 0, 0, $w, $h)
    $g.Dispose()

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
      Where-Object { $_.MimeType -eq 'image/jpeg' }
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
      [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)

    $stream = New-Object System.IO.MemoryStream
    try {
      $small.Save($stream, $codec, $params)
      [Console]::Out.WriteLine('${MARKER}' + $w + 'x' + $h)
      [Console]::Out.WriteLine([Convert]::ToBase64String($stream.ToArray()))
    } finally { $stream.Dispose() }
  } finally { $small.Dispose() }
} finally { $shot.Dispose() }
`;

/**
 * PowerShell 이 남긴 실패를 사람이 고칠 수 있는 문장으로 옮긴다.
 *
 * 순수 함수로 떼어 둔 것은 테스트 때문이다. 실제 캡처는 Windows 와 실행 중인
 * Photoshop 이 있어야 하지만, 실패 해석은 그것 없이도 고정할 수 있다.
 */
export function describeCaptureFailure(stderr: string): { message: string; recoverable: boolean } {
  if (stderr.includes("NOT_RUNNING")) {
    return {
      message:
        "Photoshop 이 실행 중이 아니거나 창이 없습니다. Photoshop 을 띄우고 다시 시도하세요.",
      recoverable: true,
    };
  }
  if (stderr.includes("MINIMIZED")) {
    return {
      message:
        "Photoshop 창이 최소화되어 있어 찍을 내용이 없습니다. 창을 복원하고 다시 시도하세요.",
      recoverable: true,
    };
  }
  if (stderr.includes("PRINTWINDOW_FAILED")) {
    return {
      message:
        "Windows 가 창 그리기를 거부했습니다. 잠긴 화면이나 원격 데스크톱 세션에서는 " +
        "실패할 수 있습니다.",
      recoverable: true,
    };
  }
  return {
    message: `창을 찍지 못했습니다: ${stderr.trim().split("\n")[0] ?? "알 수 없는 실패"}`,
    recoverable: true,
  };
}

/**
 * 표준출력에서 크기와 base64 를 꺼낸다.
 *
 * 표식을 앞에 두고 찾는 것은 PowerShell 이 경고 같은 것을 함께 낼 수 있기 때문이다.
 * 앞줄을 그냥 버리면 조용히 엉뚱한 줄을 base64 로 읽는다.
 */
export function parseCaptureOutput(
  stdout: string,
): { width: number; height: number; base64: string } | null {
  const index = stdout.indexOf(MARKER);
  if (index === -1) {
    return null;
  }
  const lines = stdout.slice(index + MARKER.length).split(/\r?\n/u);
  const size = /^(\d+)x(\d+)$/u.exec(lines[0]?.trim() ?? "");
  const base64 = lines[1]?.trim() ?? "";
  if (size === null || base64.length === 0) {
    return null;
  }
  return { width: Number(size[1]), height: Number(size[2]), base64 };
}

/** Photoshop 메인 창을 찍는다. 현재 Windows 전용이다. */
export class PhotoshopWindowCapturer implements WindowCapturer {
  async capture(input: WindowCaptureInput): Promise<CapturedImage> {
    if (process.platform !== "win32") {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `창 캡처는 현재 Windows 에서만 동작합니다 (지금은 ${process.platform}). ` +
          "문서 픽셀만 보면 되는 경우에는 photoshop.document.capture 를 쓰세요.",
        // 플랫폼은 다시 불러도 바뀌지 않는다.
        { recoverable: false, details: { platform: process.platform } },
      );
    }

    const longEdge = input.longEdge ?? DEFAULT_LONG_EDGE;

    let stdout: string;
    try {
      const result = await execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(SCRIPT, "utf16le").toString("base64"),
        ],
        {
          // C# 컴파일이 한 번 일어나므로 첫 호출이 몇 초 걸린다.
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          env: {
            ...process.env,
            PSMCP_LONG_EDGE: String(longEdge),
            PSMCP_QUALITY: String(DEFAULT_QUALITY),
          },
        },
      );
      stdout = result.stdout;
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? "");
      const { message, recoverable } = describeCaptureFailure(
        stderr.length > 0 ? stderr : String((error as { message?: unknown }).message ?? error),
      );
      throw new PhotoshopMcpError(ErrorCode.COMMAND_FAILED, message, {
        recoverable,
        cause: error,
      });
    }

    const parsed = parseCaptureOutput(stdout);
    if (parsed === null) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_FAILED,
        "창은 찍었지만 결과를 읽지 못했습니다. PowerShell 출력이 예상과 다릅니다.",
        { recoverable: true },
      );
    }

    return {
      kind: "image",
      mimeType: "image/jpeg",
      base64: parsed.base64,
      width: parsed.width,
      height: parsed.height,
      source: "window:Photoshop",
    };
  }
}
