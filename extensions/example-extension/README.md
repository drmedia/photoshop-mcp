# example-extension

`@photoshop-mcp/extension-api` 사용법을 보여주는 예제 확장입니다. (ROADMAP §9.5)

## Tool

| Tool                       | 설명                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `example.hello`            | 적재 확인용. Photoshop 연결이 없어도 동작합니다.                     |
| `example.document_summary` | `DOCUMENT_GET` + `LAYER_LIST` 를 조합해 문서와 보이는 레이어를 요약합니다. |

## 보여주는 것

- Tool 은 자신의 namespace(`example.*`)로만 등록할 수 있습니다. 다른 이름을 쓰면 적재가 거부됩니다.
- Photoshop 은 **Core Command 를 통해서만** 건드립니다. Extension 은 Bridge 에 직접 닿지 않습니다.
- `toolContext.requestId` 를 Command 로 넘겨야 Tool 호출부터 Bridge 까지 추적이 이어집니다. (ARCHITECTURE §31)
- Command 의 결과 모양은 같은 이름의 Tool 결과와 다를 수 있습니다.
  `photoshop.layer.list` Tool 은 `{ layers }` 로 감싸지만 `LAYER_LIST` Command 는 배열을 그대로 줍니다.

## 실행

```bash
npm run build
npm start
```

서버가 기동할 때 `extensions/` 를 훑어 이 확장을 적재합니다. 시작 로그에 다음이 찍힙니다.

```text
[photoshop-mcp] Extension 1개: Example Extension(example)
```

`main` 이 `dist/index.js` 를 가리키므로 **빌드가 필요합니다.** 빌드 산출물이 없으면
적재에 실패하고 그 사실이 stderr 로 기록되지만, 서버와 Core Tool 은 정상 기동합니다.
