import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { WindowCaptureInput, WindowCapturer } from "@photoshop-mcp/photoshop-tools";

/**
 * Photoshop 창 캡처의 Windows 구현. (ROADMAP §17.11, §17.17)
 *
 * ## 왜 UXP 가 아닌가
 *
 * UXP 샌드박스는 자기 창 밖을 볼 수 없다. 그런데 **서버가 Photoshop 과 같은 기계에
 * 있다** — Bridge 가 localhost WebSocket 이라 그럴 수밖에 없다. 그러니 서버가 직접
 * 찍으면 된다. 헬퍼 실행 파일을 따로 깔 이유가 없다.
 *
 * ## **창을 하나만 찍으면 안 된다**
 *
 * 처음에는 `MainWindowHandle` 하나만 찍었다. 그래서 **이 Tool 의 존재 이유인 경우를
 * 놓쳤다** — Camera Raw 같은 대화상자는 별도 최상위 창이라 메인 창을 찍어도 안 나온다.
 *
 * 실기에서 Photoshop 프로세스의 보이는 최상위 창은 둘이었다.
 *
 * ```text
 * 460952    _DSC0601.NEF @ 25% ...     메인 창
 * 2436682   Camera Raw 18.6            ← 놓치고 있던 것
 * ```
 *
 * 이제 `EnumWindows` 로 같은 프로세스의 창을 모두 찍는다. **대화상자를 먼저** 놓는다 —
 * 막힌 원인이 먼저 보여야 한다.
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
 * GPU 캔버스가 검게 나오지 않고, **가려져 있어도 그 창을 찍는다.** 진단 목적에는
 * 후자가 결정적이다.
 *
 * ## LLM 이 준 값은 스크립트에 섞이지 않는다
 *
 * 스크립트는 **고정 상수**다. 가변 값(`longEdge`)은 자식 프로세스의 **환경 변수**로만
 * 넘어간다. 문자열 조립이 한 군데도 없으므로 주입할 틈이 없다. (ARCHITECTURE §23)
 *
 * `-EncodedCommand` 로 보내는 것은 **인용 부호 때문**이지 감추려는 것이 아니다.
 * 실행 정책은 건드리지 않는다.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_LONG_EDGE = 1024;
const DEFAULT_QUALITY = 80;

/** 창 하나가 시작되는 표식. 뒤에 `<w>x<h>|<제목>` 이 붙는다. */
const MARKER = "##PSMCP##";

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public class PsMcpWindow {
  public delegate bool EnumCb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCb cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // **CharSet.Unicode 가 없으면 ANSI 로 마샬링되어** UTF-16 제목이 첫 글자에서
  // 잘린다. 실기에서 "_DSC0601.NEF @ 25% ..." 가 "_" 로 왔다.
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int id);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static string Title(IntPtr h) {
    StringBuilder sb = new StringBuilder(512);
    GetWindowTextW(h, sb, 512);
    return sb.ToString();
  }

  public static int Owner(IntPtr h) {
    int id = 0;
    GetWindowThreadProcessId(h, out id);
    return id;
  }

  // 같은 프로세스의, 보이고, 최소화되지 않았고, 제목이 있는 최상위 창.
  public static IntPtr[] Windows(int pid) {
    System.Collections.Generic.List<IntPtr> list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (Owner(h) == pid && IsWindowVisible(h) && !IsIconic(h) && Title(h).Length > 0) {
        list.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }

  public static Bitmap Capture(IntPtr h) {
    RECT r;
    // DWMWA_EXTENDED_FRAME_BOUNDS(9). GetWindowRect 는 그림자까지 포함해 더 크다.
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    int w = r.Right - r.Left, ht = r.Bottom - r.Top;
    if (w < 1 || ht < 1) throw new Exception("EMPTY_RECT");
    Bitmap b = new Bitmap(w, ht, PixelFormat.Format32bppArgb);
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

$main = $proc.MainWindowHandle
$all = [PsMcpWindow]::Windows($proc.Id)
if ($all.Length -eq 0) { throw 'MINIMIZED' }

# **대화상자를 먼저.** 막힌 원인이 먼저 보여야 한다.
$ordered = @()
foreach ($h in $all) { if ($h -ne $main) { $ordered += $h } }
foreach ($h in $all) { if ($h -eq $main) { $ordered += $h } }

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
  [System.Drawing.Imaging.Encoder]::Quality, [long]$quality)

foreach ($h in $ordered) {
  $shot = $null
  try { $shot = [PsMcpWindow]::Capture($h) } catch { continue }
  try {
    $scale = [Math]::Min(1.0, $longEdge / [Math]::Max($shot.Width, $shot.Height))
    $w = [Math]::Max(1, [int][Math]::Round($shot.Width * $scale))
    $ht = [Math]::Max(1, [int][Math]::Round($shot.Height * $scale))
    $small = New-Object System.Drawing.Bitmap $w, $ht
    try {
      $g = [System.Drawing.Graphics]::FromImage($small)
      $g.InterpolationMode = 'HighQualityBicubic'
      $g.DrawImage($shot, 0, 0, $w, $ht)
      $g.Dispose()
      $stream = New-Object System.IO.MemoryStream
      try {
        $small.Save($stream, $codec, $params)
        $kind = if ($h -eq $main) { 'main' } else { 'dialog' }
        $title = [PsMcpWindow]::Title($h) -replace '[\\r\\n|]', ' '
        [Console]::Out.WriteLine('${MARKER}' + $w + 'x' + $ht + '|' + $kind + '|' + $title)
        [Console]::Out.WriteLine([Convert]::ToBase64String($stream.ToArray()))
      } finally { $stream.Dispose() }
    } finally { $small.Dispose() }
  } finally { $shot.Dispose() }
}
`;

/**
 * PowerShell 이 남긴 실패를 사람이 고칠 수 있는 문장으로 옮긴다.
 *
 * 순수 함수로 떼어 둔 것은 테스트 때문이다.
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

export interface ParsedWindow {
  width: number;
  height: number;
  kind: "main" | "dialog";
  title: string;
  base64: string;
}

/**
 * 표준출력에서 창들을 꺼낸다.
 *
 * 표식을 앞에 두고 찾는 것은 PowerShell 이 경고 같은 것을 함께 낼 수 있기 때문이다.
 * 앞줄을 그냥 버리면 조용히 엉뚱한 줄을 base64 로 읽는다.
 */
export function parseCaptureOutput(stdout: string): ParsedWindow[] {
  const windows: ParsedWindow[] = [];
  const lines = stdout.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !line.startsWith(MARKER)) {
      continue;
    }
    const header = line.slice(MARKER.length).split("|");
    const size = /^(\d+)x(\d+)$/u.exec(header[0]?.trim() ?? "");
    const base64 = lines[index + 1]?.trim() ?? "";
    if (size === null || base64.length === 0) {
      continue;
    }
    windows.push({
      width: Number(size[1]),
      height: Number(size[2]),
      kind: header[1] === "dialog" ? "dialog" : "main",
      title: (header[2] ?? "").trim(),
      base64,
    });
  }
  return windows;
}

/**
 * Photoshop 의 **모든** 보이는 창을 찍는다. 대화상자가 먼저 온다.
 *
 * 현재 Windows 전용이다.
 */
export class PhotoshopWindowCapturer implements WindowCapturer {
  async capture(input: WindowCaptureInput): Promise<CapturedImage[]> {
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
          maxBuffer: 64 * 1024 * 1024,
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

    const windows = parseCaptureOutput(stdout);
    if (windows.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_FAILED,
        "창은 찍었지만 결과를 읽지 못했습니다. PowerShell 출력이 예상과 다릅니다.",
        { recoverable: true },
      );
    }

    return windows.map((entry) => ({
      kind: "image" as const,
      mimeType: "image/jpeg" as const,
      base64: entry.base64,
      width: entry.width,
      height: entry.height,
      // 무엇을 찍었는지 제목까지 담는다. 대화상자면 이름으로 원인을 알 수 있다.
      source: `window:${entry.kind}:${entry.title}`,
    }));
  }
}
