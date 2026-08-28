/**
 * Claude Code 훅이 실행하는 셸 스크립트.
 *
 * 세션 시작 경로에 끼어드는 코드라 지켜야 할 것이 분명하다.
 *  - 절대 실패하지 않는다. 무슨 일이 있어도 0으로 끝난다.
 *  - 절대 기다리지 않는다. 파일 하나 쓰고 즉시 끝난다.
 *  - 앱이 꺼져 있으면 아무 일도 하지 않는다.
 *
 * node나 socat 같은 것에 의존하지 않는 이유도 같다. 사용자의 세션 시작이
 * 이 앱 때문에 느려지거나 깨지면 안 된다.
 */
export const HOOK_SCRIPT = `#!/bin/sh
# claude-usage-tracker — 세션 이벤트를 앱에 알린다.
# 이 파일은 앱이 생성한다. 직접 고치면 재설치 때 덮어쓰인다.

if [ -n "$XDG_RUNTIME_DIR" ]; then
  base="$XDG_RUNTIME_DIR/claude-usage-tracker"
else
  base="\${TMPDIR:-/tmp}/claude-usage-tracker-$(id -u 2>/dev/null || echo 0)"
fi
dir="$base/events"

# 앱이 떠 있지 않으면 스풀 디렉터리가 없다. 조용히 물러난다.
[ -d "$dir" ] || exit 0

# 파일명이 겹치지 않게 PID와 나노초를 함께 쓴다.
stamp=$(date +%s%N 2>/dev/null || date +%s)
tmp="$dir/.$$-$stamp.tmp"

# 부분적으로 쓰인 파일을 앱이 읽지 않도록 임시 이름으로 쓴 뒤 옮긴다.
if cat > "$tmp" 2>/dev/null; then
  mv "$tmp" "$dir/$$-$stamp.json" 2>/dev/null || rm -f "$tmp" 2>/dev/null
else
  rm -f "$tmp" 2>/dev/null
fi

exit 0
`;

/** 훅이 담아 보내는 이벤트. Claude Code가 stdin으로 주는 JSON. */
export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  /** SessionStart에서 'startup' | 'resume' | 'clear' | 'compact'. */
  source?: string;
  transcript_path?: string;
  cwd?: string;
  /** SessionEnd에서 종료 사유. */
  reason?: string;
}
