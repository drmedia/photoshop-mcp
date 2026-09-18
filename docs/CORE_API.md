# Photoshop MCP Core API

## 0. 이 문서의 위치

**Core API 목록이다.** `photoshop.*` namespace 에 무엇이 있고, 무엇이 아직 후보이며,
무엇을 의도적으로 넣지 않는지를 한 곳에서 본다.

기준이 되는 문서는 따로 있다.

| 무엇 | 어느 문서가 기준인가 |
|---|---|
| Phase 번호 · 범위 · 완료 여부 | `docs/ROADMAP.md` |
| 계층 구조 · 안전 원칙 | `docs/ARCHITECTURE.md` |
| **API 목록 · Permission · 이름** | 이 문서 |

**이 문서에 Phase 열을 두지 않는다.** 예전에는 API 마다 Phase 번호를 적어 두었는데,
ROADMAP 의 Phase 5 이후가 Extension SDK · Capability · Job 같은 인프라로 채워지면서
여기 적힌 "Phase 5 = Advanced Core" 가 통째로 틀린 값이 되었다. 두 문서가 같은 낱말에
다른 뜻을 담으면 둘 다 믿을 수 없게 된다. Phase 는 ROADMAP 이 혼자 관리한다.

대신 **구현 여부**를 적는다. 그것은 이 문서가 스스로 확인할 수 있는 사실이다.

§4 의 목록은 서버에 실제로 등록된 것이다. **`tests/core-api-doc.test.ts` 가 이 문서를
읽어 레지스트리와 대조한다** — 이름과 Permission 이 어긋나면 테스트가 깨진다.

그 테스트가 없는 동안 이 문서가 실제로 썩었다. Tool 이 13개 늘고 Permission 이 세 개
바뀌었는데 문서는 그대로였다. `docs/` 는 `.prettierignore` 에 있어 형식 검사도 지나가므로
사람이 읽기 전까지 알려주는 장치가 하나도 없었다.

---

## 1. 원칙

Core API 는 다음을 따른다.

- Photoshop 일반 기능만 포함한다
- 특정 사진 장르나 도메인 기능은 제외한다 (§7)
- 도메인 기능은 Extension 으로 구현한다 — `milky.*` · `portrait.*`
- 모든 API 는 `photoshop.*` namespace 를 쓴다
- 모든 API 는 Permission Level 을 **필수로** 선언한다

Extension 은 `photoshop.*` 에 Tool 을 등록할 수 없다. 이름이 겹치면 적재가 거부된다.

---

## 2. Permission

네 단계다. Tool 과 Command 양쪽에서 **필수 필드**다. 선택 필드로 두면 새로 추가한
것이 조용히 관대한 값을 갖는다.

| Level | 의미 |
|---|---|
| `READ` | Photoshop 상태 조회. 아무것도 바꾸지 않는다 |
| `EDIT` | 비파괴 편집. Photoshop 안에서만 일어난다 |
| `EXTERNAL` | Photoshop 밖으로 나간다 — 파일 쓰기·읽기, 외부 프로세스 |
| `DESTRUCTIVE` | 덮어쓰기·삭제·병합. 되돌릴 수 없다 |

기본 허용은 `READ` · `EDIT` 뿐이다. `PHOTOSHOP_MCP_ALLOW` 로 바꾸며, 값을 주면 그것이
전체 목록이다 — 기본값에 더하지 않는다.

**강제 지점은 Command Engine 이다.** Extension 은 Tool 을 거치지 않고 Command 를 직접
호출하기 때문이다. Tool 의 Level 은 `tools/list` 메타데이터이자 빠른 실패용이다.

### EXTERNAL 과 EDIT 의 경계

처음에는 `save_as` · `export` 를 EDIT 으로 적어 두었다. 파일을 쓰는 것뿐이니
파괴적이지 않다고 본 것이다. 그러나 **경계를 넘는지**가 기준이어야 했다.

- `save_as` · `export` — 승인된 폴더로 나간다 → `EXTERNAL`
- `layer.place` — 승인된 폴더에서 들어온다 → `EXTERNAL` (읽기여도 경계를 넘는다)
- `save` — 원본을 덮어쓴다 → `DESTRUCTIVE`

덮어쓰지 않는 것과 덮어쓰는 것을 나눠 놓았기 때문에 `save_as` 와 `export` 를
`EXTERNAL` 로 둘 수 있다. 덮어쓰기는 `save` 하나에 모았다.

---

## 3. 우선순위

후보 API 에만 붙인다. 구현된 것에는 의미가 없다.

```text
P0  MVP 핵심
P1  실사용 필수
P2  고급 편집
P3  확장 기능
```

권장 구현 순서는 `P0 → P1 → P2 → 실사용 검증 → P3` 다. P3 까지 한 번에 구현하지 않는다.

---

## 4. 구현된 Core API (40개)

서버에 등록되어 있고 `tools/list` 에 나온다.

### 4.1 조회

| API | Permission | 비고 |
|---|---|---|
| `photoshop.ping` | READ | 서버 상태와 Bridge 연결 여부 |
| `photoshop.document.get` | READ | 활성 문서 정보 |
| `photoshop.layer.list` | READ | 활성 문서의 레이어 목록 |

### 4.2 레이어

| API | Permission | 비고 |
|---|---|---|
| `photoshop.layer.create` | EDIT | 픽셀 레이어 |
| `photoshop.layer.duplicate` | EDIT | |
| `photoshop.layer.rename` | EDIT | |
| `photoshop.layer.select` | EDIT | 활성 레이어 지정 |
| `photoshop.layer.set_visibility` | EDIT | |
| `photoshop.layer.set_opacity` | EDIT | 0–100 |
| `photoshop.layer.set_blend_mode` | EDIT | normal · multiply · screen · overlay · softLight 등 |

`layerId` 를 생략하면 활성 레이어를 대상으로 한다.

### 4.3 그룹

| API | Permission | 비고 |
|---|---|---|
| `photoshop.group.create` | EDIT | `layerIds` 를 주면 그 레이어들을 넣는다 |
| `photoshop.group.move_layer` | EDIT | `groupId: null` 이면 그룹에서 꺼낸다 |

### 4.4 조정 레이어

| API | Permission | 비고 |
|---|---|---|
| `photoshop.adjustment.curves` | EDIT | `{input, output}` 제어점 |
| `photoshop.adjustment.levels` | EDIT | 입력/출력 검은점·흰점, 감마 |
| `photoshop.adjustment.brightness_contrast` | EDIT | −150~150 / −50~100 |
| `photoshop.adjustment.hue_saturation` | EDIT | hue −180~180 |
| `photoshop.adjustment.vibrance` | EDIT | vibrance · saturation −100~100 |

**전부 조정 레이어로 만든다.** 픽셀을 직접 고치지 않는다. 그래서 EDIT 이다.

### 4.5 마스크 · 선택

| API | Permission | 비고 |
|---|---|---|
| `photoshop.mask.create` | EDIT | `from`: revealAll · hideAll · **fromSelection** |
| `photoshop.mask.enable` | EDIT | |
| `photoshop.mask.disable` | EDIT | 마스크를 지우지 않고 해제만 한다 |
| `photoshop.selection.set` | EDIT | `shape`: rectangle · ellipse · **canvas** |
| `photoshop.selection.clear` | EDIT | |
| `photoshop.selection.invert` | EDIT | 선택이 없으면 실패한다 |

### 4.6 필터

| API | Permission | 비고 |
|---|---|---|
| `photoshop.filter.gaussian_blur` | EDIT | 기본은 스마트 필터. radius 0.1–1000 |

### 4.7 History

| API | Permission | 비고 |
|---|---|---|
| `photoshop.history.undo` | EDIT | |

History **조회**는 Tool 이 아니라 `photoshop://history` Resource 다. (§6)

### 4.8 파일

| API | Permission | 비고 |
|---|---|---|
| `photoshop.workspace.status` | READ | 작업 폴더 승인 여부 |
| `photoshop.workspace.usage` | READ | 파일과 총 용량을 큰 것부터 |
| `photoshop.document.save_as` | EXTERNAL | psd · psb. 레이어 유지. **덮어쓰지 않는다** |
| `photoshop.document.export` | EXTERNAL | png · jpg · tiff. 평탄화. tiff 는 16비트 유지 |
| `photoshop.layer.place` | EXTERNAL | 승인 폴더의 파일을 스마트 오브젝트로 |
| `photoshop.document.save` | DESTRUCTIVE | 원본 덮어쓰기 |
| `photoshop.workspace.delete` | DESTRUCTIVE | **이름을 명시한** 파일만. 패턴을 받지 않는다 |

작업 폴더는 **사용자가 플러그인 패널 버튼으로 승인한다.** UXP 의 `getFolder()` 가 사용자
제스처를 요구해서 서버가 대신할 수 없다. 제약이자 안전장치다 — LLM 은 폴더를 고를 수
없고 파일 이름만 준다. 경로 구분자와 `..` 는 스키마가 거부한다.

### 4.9 외부 처리기 · 긴 작업 · 워크플로

| API | Permission | 비고 |
|---|---|---|
| `photoshop.capability.list` | READ | 설정된 외부 처리기와 사용 가능 여부 |
| `photoshop.job.status` | READ | 즉시 반환한다. 완료를 기다리지 않는다 |
| `photoshop.job.list` | READ | 최신순 |
| `photoshop.job.cancel` | EDIT | 외부 프로세스를 실제로 종료한다 |
| `photoshop.workflow.list` | READ | 선언된 Tool 순서 |
| `photoshop.workflow.run` | EXTERNAL | **즉시 jobId 를 반환한다** |

Capability **실행** Tool 은 만들지 않는다. 외부 처리기 실행은 `내보내기 → 처리 →
가져오기` 흐름의 가운데 토막이고, 그 흐름을 아는 것은 Extension 이다. LLM 이 가운데만
직접 부르면 앞뒤가 빠진다.

MCP 기본 요청 타임아웃은 60초다. 외부 처리기는 그보다 오래 걸린다 — 실측에서
StarNet2 가 67초였다. 그래서 오래 걸리는 Tool 은 **짧게 끝나도** jobId 를 돌려준다.
반환 타입이 상황에 따라 달라지면 호출자가 매번 판단해야 한다.

### 4.10 진단 · 이벤트

| API | Permission | 비고 |
|---|---|---|
| `photoshop.diagnostics` | READ | 막힌 이유와 **고치는 방법**을 함께 준다 |
| `photoshop.event.recent` | READ | `command.*` 는 신뢰할 수 있다. `photoshop.*` 는 §6 참조 |

무언가 안 되면 `photoshop.diagnostics` 를 먼저 부른다.

---

## 5. 후보 API

아직 구현하지 않았다. **여기 있다고 만들기로 한 것은 아니다** — 필요가 확인되면
ROADMAP 에 Phase 를 잡고 옮긴다.

Permission 은 구현 시점의 예정값이며, §2 의 경계 규칙이 최종 판단이다.

### 5.1 Document

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.document.list` | P1 | READ | 열린 문서 전체 |
| `photoshop.document.create` | P1 | EDIT | |
| `photoshop.document.open` | P1 | EXTERNAL | 파일을 읽는다 |
| `photoshop.document.duplicate` | P2 | EDIT | |
| `photoshop.document.mode_convert` | P2 | EDIT | RGB · CMYK · Lab |
| `photoshop.document.bit_depth_convert` | P2 | EDIT | 8 · 16 · 32 |
| `photoshop.document.close` | P2 | DESTRUCTIVE | 저장하지 않은 변경이 사라진다 |
| `photoshop.document.flatten` | P3 | DESTRUCTIVE | |

### 5.2 Layer

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.layer.get` | P1 | READ | 한 레이어의 상세 |
| `photoshop.layer.get_active` | P0 | READ | **P0 인데 유일하게 없다.** §8 참조 |
| `photoshop.layer.select_multiple` | P1 | EDIT | |
| `photoshop.layer.set_fill_opacity` | P1 | EDIT | |
| `photoshop.layer.move` | P1 | EDIT | 순서 변경 |
| `photoshop.layer.move_above` | P1 | EDIT | |
| `photoshop.layer.move_below` | P1 | EDIT | |
| `photoshop.layer.move_top` | P2 | EDIT | |
| `photoshop.layer.move_bottom` | P2 | EDIT | |
| `photoshop.layer.lock` | P2 | EDIT | |
| `photoshop.layer.unlock` | P2 | EDIT | |
| `photoshop.layer.place_linked` | P3 | EXTERNAL | 연결된 스마트 오브젝트 |
| `photoshop.layer.delete` | P2 | DESTRUCTIVE | |
| `photoshop.layer.merge` | P2 | DESTRUCTIVE | |
| `photoshop.group.ungroup` | P2 | DESTRUCTIVE | 그룹이 사라진다 |

### 5.3 Mask

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.mask.invert` | P1 | EDIT | |
| `photoshop.mask.select` | P1 | EDIT | 마스크를 편집 대상으로 |
| `photoshop.mask.link` | P2 | EDIT | |
| `photoshop.mask.unlink` | P2 | EDIT | |
| `photoshop.mask.apply` | P2 | DESTRUCTIVE | 픽셀에 굽는다 |
| `photoshop.mask.delete` | P2 | DESTRUCTIVE | |

### 5.4 Selection

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.selection.feather` | P2 | EDIT | |
| `photoshop.selection.expand` | P2 | EDIT | |
| `photoshop.selection.contract` | P2 | EDIT | |
| `photoshop.selection.from_layer` | P2 | EDIT | 레이어 투명도에서 |
| `photoshop.selection.load_channel` | P2 | EDIT | |
| `photoshop.selection.save_channel` | P2 | EDIT | |

### 5.5 Adjustment

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.adjustment.color_balance` | P1 | EDIT | |
| `photoshop.adjustment.exposure` | P2 | EDIT | |
| `photoshop.adjustment.black_white` | P2 | EDIT | |
| `photoshop.adjustment.photo_filter` | P2 | EDIT | |
| `photoshop.adjustment.channel_mixer` | P2 | EDIT | |

모두 조정 레이어로 만든다. 픽셀 직접 수정은 하지 않는다.

### 5.6 Filter

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.filter.sharpen` | P2 | EDIT | |
| `photoshop.filter.smart_sharpen` | P2 | EDIT | |
| `photoshop.filter.high_pass` | P2 | EDIT | |
| `photoshop.filter.motion_blur` | P2 | EDIT | |
| `photoshop.filter.surface_blur` | P2 | EDIT | |
| `photoshop.filter.noise_reduce` | P2 | EDIT | |
| `photoshop.filter.noise_add` | P3 | EDIT | |
| `photoshop.filter.dust_scratches` | P3 | EDIT | |
| `photoshop.filter.minimum_maximum` | P3 | EDIT | |

### 5.7 Transform · Geometry

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.image.resize` | P1 | EDIT | |
| `photoshop.canvas.resize` | P2 | EDIT | |
| `photoshop.crop` | P2 | EDIT | |
| `photoshop.transform.scale` | P2 | EDIT | |
| `photoshop.transform.rotate` | P2 | EDIT | |
| `photoshop.transform.flip_horizontal` | P2 | EDIT | |
| `photoshop.transform.flip_vertical` | P2 | EDIT | |
| `photoshop.transform.free_transform` | P2 | EDIT | |
| `photoshop.transform.perspective` | P3 | EDIT | |
| `photoshop.transform.skew` | P3 | EDIT | |

### 5.8 Smart Object

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.smart_object.get_info` | P2 | READ | |
| `photoshop.smart_object.convert` | P2 | EDIT | |
| `photoshop.smart_object.replace_contents` | P2 | EXTERNAL | 파일을 읽는다 |
| `photoshop.smart_object.open_contents` | P2 | EDIT | |
| `photoshop.smart_object.relink` | P3 | EXTERNAL | |
| `photoshop.smart_object.update` | P3 | EDIT | |
| `photoshop.smart_object.new_via_copy` | P3 | EDIT | |
| `photoshop.smart_object.rasterize` | P2 | DESTRUCTIVE | |

### 5.9 Channel

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.channel.list` | P2 | READ | |
| `photoshop.channel.get` | P2 | READ | |
| `photoshop.channel.create` | P2 | EDIT | |
| `photoshop.channel.select` | P2 | EDIT | |
| `photoshop.channel.load_as_selection` | P2 | EDIT | |
| `photoshop.channel.duplicate` | P3 | EDIT | |
| `photoshop.channel.delete` | P3 | DESTRUCTIVE | |

### 5.10 History

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.history.redo` | P1 | EDIT | |
| `photoshop.history.create_snapshot` | P3 | EDIT | |
| `photoshop.history.restore_snapshot` | P3 | EDIT | |

### 5.11 Host · 환경

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.host.get` | P1 | READ | Photoshop 버전 + 지원 기능. §8 참조 |
| `photoshop.preferences.get` | P3 | READ | |
| `photoshop.units.get` | P3 | READ | |
| `photoshop.color.get_foreground_background` | P3 | READ | |

### 5.12 Text · Shape · Path · Guide · Metadata

전부 P3 다. 실제 요구가 확인된 뒤에 연다. 지금은 이름만 잡아 둔다.

```text
photoshop.text.create · get · set_content · set_font · set_size
                        set_color · set_alignment · set_tracking

photoshop.shape.rectangle · ellipse · line · set_fill · set_stroke
                            set_stroke_width · convert_to_path

photoshop.path.list · get · create · select · to_selection · delete(DESTRUCTIVE)

photoshop.guide.list · create · delete(DESTRUCTIVE)
photoshop.ruler.get_units · set_units

photoshop.metadata.get · set
photoshop.file.reveal
```

---

## 6. Tool 이 아닌 것 — Resource

Tool 은 **행동**이고 Resource 는 **맥락**이다. 다음은 Tool 로 만들지 않았다.
클라이언트가 미리 읽어 대화에 붙일 수 있고, LLM 이 매번 Tool 을 부르지 않아도 된다.

```text
photoshop://document/current
photoshop://layers
photoshop://selection
photoshop://history
photoshop://capabilities
photoshop://extensions
```

읽을 때마다 실제 상태를 조회하며 캐시하지 않는다. 문서를 바꾸는 Command 가 끝나면
`notifications/resources/updated` 로 구독자에게 알린다.

그래서 후보 목록에 `selection.get` · `history.get` 이 없다. **이미 있고, Resource 다.**

Photoshop 쪽 변경 알림(`photoshop.*` 이벤트)은 이 환경에서 동작하지 않는다. API 는
있고 등록도 성공하는데 알림이 오지 않는다. 원인을 찾지 못했고 추측으로 코드를
더 넣지 않았다. `command.*` 만 신뢰할 수 있다.

---

## 7. Core 에 넣지 않는 것

도메인 기능은 Extension 이다. Core 는 Photoshop 을 알고, Extension 은 작업 도메인을 안다.

```text
은하수 보정 · 별 분리 · 그래디언트 제거 · 하늘/전경 분리
인물 피부 보정 · 주파수 분리 · 제품 배경 정리 · 풍경 하늘 강조
```

Extension namespace 예: `milky.*` · `portrait.*` · `landscape.*` · `product.*`

다음은 Core API 가 아니라 고수준 워크플로 또는 Extension 으로 본다.

```text
Select Sky · Select Subject · Remove Background
Generative Fill · Neural Filters · Camera Raw · Auto Retouch · Auto Color Grade
```

Core 에서는 가능한 한 저수준 기능만 제공한다.

### 실제로 그렇게 됐는가

됐다. `extensions/milkyscape` 가 별 분리·그래디언트 제거·선명화를 Core Tool 과
Capability 만 조합해 구현한다. Core 에 천체사진 코드가 한 줄도 없다.

반대로 `create_sky_mask` 는 **범위에서 뺐다.** 기존 패널이 하늘 마스크를 만들지 않고
사용자가 만든 것을 소비한다는 것을 확인했기 때문이다. 짐작으로 알고리즘을 만들지 않는다.

---

## 8. 이름 규칙과 정리 기록

기본 형식은 `photoshop.<domain>.<action>` 이다. 권장 verb:

```text
get · list · create · delete · set_* · select · duplicate · move · enable · disable · apply
```

이 문서를 정리하면서 아래 충돌을 해결했다. 남겨 두면 같은 기능에 이름이 둘이 되고,
나중에 어느 쪽이 맞는지 알 수 없게 된다.

| 예전 이름 | 결론 | 이유 |
|---|---|---|
| `file.place_embedded` | → `layer.place` | 구현된 이름을 쓴다. 결과가 레이어이므로 도메인도 layer 가 맞다 |
| `file.place_linked` | → `layer.place_linked` | 위와 같은 도메인으로 맞춘다 |
| `active_layer.get` | 삭제 | `layer.get_active` 와 같은 기능. `active_layer` 는 도메인이 아니다 |
| `active_document.get` | 삭제 | `document.get` 이 이미 활성 문서를 반환한다 |
| `capabilities.get` | → `host.get` | `capability.list`(외부 처리기)와 뜻이 다른데 이름이 거의 같았다 |
| `version.get` | → `host.get` 에 흡수 | 버전과 지원 기능을 따로 물을 이유가 없다 |
| `mask.from_selection` | 삭제 | `mask.create` 의 `from: fromSelection` 이 한다 |
| `selection.select_all` | 삭제 | `selection.set` 의 `shape: canvas` 가 한다 |
| `selection.get` | → Resource | `photoshop://selection` |
| `history.get` | → Resource | `photoshop://history` |
| `state.get` | → `photoshop.diagnostics` | 상태에 더해 **막힌 이유와 고치는 방법**까지 준다 |

### 남은 공백

`photoshop.layer.get_active` 는 **P0 로 분류해 놓고 유일하게 구현되지 않았다.**
지금은 `layer.list` 가 활성 여부를 함께 주고, 편집 Tool 이 `layerId` 를 생략하면
활성 레이어를 쓰기 때문에 실무에서 막히지 않았다. 그래서 늦어졌다.

없어도 도는 것과 P0 인 것은 다르다. 분류를 내리든 구현하든 한쪽으로 정해야 한다.

---

## 9. Destructive 정책

다음은 반드시 `DESTRUCTIVE` 로 분류한다.

```text
document.save · document.close · document.flatten
layer.delete · layer.merge · group.ungroup
mask.apply · mask.delete
smart_object.rasterize
channel.delete · path.delete · guide.delete
workspace.delete
```

기본 허용에 들어 있지 않다. 쓰려면 `PHOTOSHOP_MCP_ALLOW` 에 명시해야 한다.

**대화형 승인은 하지 않는다.** 서버가 stdio 를 전송에 쓰므로 프롬프트를 띄울 수 없고,
elicitation 은 클라이언트가 무시하면 보장이 사라진다. 대화형 승인은 MCP 클라이언트의
역할이다.

지금 구현된 DESTRUCTIVE 는 `document.save` 와 `workspace.delete` 둘뿐이다. 나머지는
분류 체계만 서 있고 구현이 없다. 분류가 있다고 있는 척하지 않는다.

---

## 10. 규모

| 구간 | 개수 |
|---|---|
| 구현됨 | **40** |
| 후보 (P0–P1) | 약 20 |
| 후보 (P2) | 약 45 |
| 후보 (P3) | 약 45 |
| 합계 후보 풀 | 약 150 |

Core 1.0 목표는 70–100개 수준이고 나머지는 요구에 따라 추가한다.

---

## 11. 최종 원칙

Photoshop MCP Core 는 Photoshop 의 모든 기능을 복제하는 API 가 아니다. 목표는
LLM 이 Photoshop 을 **안전하고 예측 가능하며 구조화된 방식으로** 제어하는 것이다.

따라서 API 개수보다 다음이 중요하다.

```text
일관된 namespace
명확한 permission
예측 가능한 command
비파괴 우선
Extension 과의 명확한 경계
```

그리고 세 가지는 API 로 열지 않는다. (ARCHITECTURE §23)

```text
임의 JavaScript 실행
임의 batchPlay descriptor 실행
Command 를 거치지 않는 Photoshop 수정
```

`batchPlay` 는 DOM 에 API 가 없는 경우(조정·마스크·선택·필터)에만 쓰고, descriptor 는
반드시 플러그인이 **검증된 파라미터로 조립한다.** 호출자가 descriptor 를 넘기는 통로를
만들지 않는다.
