# Claude Usage Tracker

픽셀 클로드 캐릭터가 Claude 사용량을 **먼저** 알려주는 데스크톱 앱.

기존 사용량 도구는 막대 그래프만 보여주거나 마우스를 갖다 대야 확인할 수 있습니다.
이 앱은 백그라운드에 상주하며, 임계값에 도달하면 캐릭터가 **알아서 나타나** 보고합니다.

## 현재 상태

M1 (Usage Core) 진행 중 — 헤드리스 코어가 동작합니다. UI는 M2부터.

## 사용법

```bash
npm install
npm run cli -- --once      # 현재 사용량 출력
npm run cli -- --json      # JSON으로
npm run cli -- --watch     # 폴링하며 임계값 이벤트 관찰
npm run cli -- --help
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

## 구조

```
src/core/
  types.ts         API 응답 타입 + 내부 스냅샷 타입
  credentials.ts   ~/.claude/.credentials.json 로더
  usage-api.ts     API 호출 + 정규화
  thresholds.ts    50/70/90/100% 발화 판정 (순수 함수)
  state-store.ts   발화 이력 영속화 (원자적 쓰기)
  poller.ts        주기 폴링 + 지수 백오프
  format.ts        사람이 읽는 문자열
src/cli/           헤드리스 검증 CLI
```

## 개발

```bash
npm test           # vitest
npm run typecheck
npm run lint
```

## 라이선스

Private.
