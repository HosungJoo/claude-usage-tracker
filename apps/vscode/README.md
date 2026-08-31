# Claude Usage Tracker

Your Claude Code usage, shown to you — without you having to look.

This extension puts your five-hour and weekly usage in the sidebar next to the
Claude Code panel. When you cross a threshold, a small pixel character steps out
and says so. You don't hover, you don't run a command; it comes to you.

![The character greeting a new session](https://hosungjoo.github.io/claude-usage-tracker/greeting.png)

## What it does

- **Tells you first.** At 50 / 70 / 90 / 100% the character appears in the panel
  and reports. The rest of the time it stays a collapsed one-liner.
- **Reads the real numbers.** Utilization percentages and reset times come from
  Claude's own usage endpoint — not an estimate from token counts.
- **Stays quiet when it should.** One process polls even if you have several
  windows open, and the desktop app and this panel never double-alert.

## Requirements

You need [Claude Code](https://claude.com/claude-code) signed in on this machine.
The extension reads the OAuth token from `~/.claude/.credentials.json` to ask the
usage endpoint how much you've used. The token is used for that request and
nothing else — it is never logged, stored, or sent anywhere else.

The companion desktop app is optional. With it, the same alerts also appear over
your whole screen when VS Code isn't in front:
[claude-usage-tracker](https://github.com/HosungJoo/claude-usage-tracker).

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeUsage.pollIntervalSec` | `60` | How often to re-read usage, in seconds. |
| `claudeUsage.alertInPanel` | `character` | `character` shows the character, `quiet` changes only the header line, `off` says nothing. |
| `claudeUsage.language` | `auto` | `auto` follows VS Code's display language. English and Korean. |

Command: **Claude 사용량: 지금 확인** (`claudeUsage.refresh`) — read it right now
instead of waiting for the next poll.

---

# Claude Usage Tracker (한국어)

사용량을 **알아서 먼저** 알려줍니다.

Claude Code 패널 옆 사이드바에 5시간·주간 사용량이 뜹니다. 임계값을 넘으면 픽셀
캐릭터가 나와서 말해 줍니다. 마우스를 갖다 댈 필요도, 명령을 부를 필요도 없습니다.

## 하는 일

- **먼저 나선다.** 50 / 70 / 90 / 100%에서 캐릭터가 패널에 나와 보고합니다.
  평소에는 접힌 한 줄로 조용히 있습니다.
- **진짜 숫자를 읽는다.** 토큰 수로 추정하지 않고, Claude의 사용량 엔드포인트에서
  이용률과 초기화 시각을 그대로 받아옵니다.
- **소란 떨지 않는다.** 창을 여러 개 열어도 API를 두드리는 프로세스는 하나이고,
  데스크톱 앱과 이 패널이 같은 알림을 두 번 내지 않습니다.

## 필요한 것

이 컴퓨터에 로그인된 [Claude Code](https://claude.com/claude-code)가 필요합니다.
`~/.claude/.credentials.json` 의 OAuth 토큰으로 사용량만 조회합니다. 토큰은 그
요청에만 쓰이며 기록하거나 다른 곳으로 보내지 않습니다.

데스크톱 앱은 선택입니다. 함께 쓰면 VS Code가 앞에 없을 때도 화면 전체에 같은
알림이 뜹니다: [claude-usage-tracker](https://github.com/HosungJoo/claude-usage-tracker).

## 설정

| 설정 | 기본값 | 하는 일 |
| --- | --- | --- |
| `claudeUsage.pollIntervalSec` | `60` | 사용량을 다시 읽는 주기(초). |
| `claudeUsage.alertInPanel` | `character` | `character` 캐릭터가 나옴, `quiet` 머리줄 문구만, `off` 알리지 않음. |
| `claudeUsage.language` | `auto` | `auto`는 VS Code 표시 언어를 따릅니다. 한국어·영어. |

명령: **Claude 사용량: 지금 확인** (`claudeUsage.refresh`) — 다음 주기를 기다리지
않고 그 자리에서 읽습니다.

## License

MIT
