# Claude Usage Tracker

픽셀 클로드 캐릭터가 Claude 사용량을 **먼저** 알려주는 데스크톱 앱.

기존 사용량 도구는 막대 그래프만 보여주거나 마우스를 갖다 대야 확인할 수 있습니다.
이 앱은 백그라운드에 상주하며, 임계값에 도달하면 캐릭터가 **알아서 나타나** 보고합니다.

## 현재 상태

M2 (Overlay & Character) 완료 — 캐릭터가 오버레이로 등장해 사용량을 보고합니다.
세션 시작 연동은 M3, 트레이·설정은 M4.

## 사용법

```bash
npm install

npm run dev                # 앱 실행 (실제 사용량 폴링)
npm run demo               # 임계값 50/70/90/100 연출을 8초 간격으로 재생

npm run cli -- --once      # 현재 사용량 출력
npm run cli -- --json      # JSON으로
npm run cli -- --watch     # 폴링하며 임계값 이벤트 관찰
npm run sprites            # 캐릭터 스프라이트 시트를 PNG로 뽑아 눈으로 확인
```

출력 예:

```
Claude 사용량

  5시간    █░░░░░░░░░░░░░░░░░░░     4% · 여유 · 리셋까지 3시간 51분
  주간     ██░░░░░░░░░░░░░░░░░░    10% · 여유 · 리셋까지 5일 22시간

  모델별 주간
    Fable      ██░░░░░░░░░░    14% · 리셋까지 5일 22시간

  종합: 여유
```

## 데이터 소스

Claude Code의 `/usage` 가 사용하는 것과 같은 엔드포인트를 씁니다.

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <token>
anthropic-beta: oauth-2025-04-20
```

토큰은 `~/.claude/.credentials.json` 의 `claudeAiOauth.accessToken` 을 읽습니다.
별도 설정이 필요 없고, 토큰 갱신은 Claude Code가 알아서 합니다.

> `~/.claude/projects/**/*.jsonl` 트랜스크립트에는 **토큰 수**만 있어서
> "한도 대비 몇 퍼센트"를 계산할 수 없습니다. 위 API가 유일한 정답 소스입니다.

**토큰은 로그·에러 메시지 어디에도 남기지 않습니다.**

## 캐릭터

클로드의 방사형 심볼에서 가져온 픽셀 마스코트입니다. 이미지 파일이 아니라
**코드로 그립니다** — 표정과 포즈가 매개변수라서, 프레임을 하나 더하는 데
그림을 다시 그릴 필요가 없습니다.

표정은 사용량 심각도에 붙습니다: `wave`(인사) · `happy`(여유) · `talk`(보고) ·
`worry`(주의, 70%) · `panic`(위험, 90%+). 서버가 내려주는 `severity` 값을
그대로 쓰므로 판정 규칙을 클라이언트에서 다시 만들지 않습니다.

`npm run sprites` 로 전체 프레임을 시트로 뽑아 볼 수 있습니다.

## 구조

```
src/core/                  헤드리스 코어 (UI 의존성 없음)
  types.ts                 API 응답 타입 + 내부 스냅샷 타입
  credentials.ts           ~/.claude/.credentials.json 로더
  usage-api.ts             API 호출 + 정규화
  thresholds.ts            50/70/90/100% 발화 판정 (순수 함수)
  state-store.ts           발화 이력 영속화 (원자적 쓰기)
  poller.ts                주기 폴링 + 지수 백오프
  format.ts                사람이 읽는 문자열

src/shared/
  pixel/grid.ts            픽셀 그리기 프리미티브 (원·삼각형·광선·윤곽선)
  pixel/png.ts             최소 PNG 인코더 (도구/아이콘용)
  character/palette.ts     팔레트
  character/sprites.ts     캐릭터를 코드로 그린다
  character/animator.ts    프레임 재생 + 눈 깜박임
  character/script.ts      표정과 대사
  ipc.ts                   메인 ↔ 렌더러 계약

src/main/                  Electron 메인
  overlay-window.ts        투명·클릭통과·항상위 창 + 멀티모니터 배치
  overlay-controller.ts    표시 큐 (겹침 방지, 심각도 우선순위)
src/preload/               contextBridge
src/renderer/              캔버스 캐릭터 + 말풍선
src/cli/                   헤드리스 검증 CLI
tools/                     스프라이트 미리보기
```

## 오버레이가 지키는 것

작업을 방해하지 않는 것이 이 앱의 전제입니다.

- 기본적으로 **클릭을 통과**시킵니다. 말풍선 위에 마우스가 올라왔을 때만 받습니다.
- **포커스를 훔치지 않습니다** (`showInactive` + `focusable: false`). 타이핑 중에 떠도 글자를 가로채지 않습니다.
- 작업표시줄에 뜨지 않고, 전체화면 앱 위에도 표시됩니다.
- 알림이 몰려도 **하나씩** 나옵니다. 더 심각한 소식이 먼저 나옵니다.

## 개발

```bash
npm test           # vitest
npm run typecheck
npm run lint
```

## 라이선스

Private.
