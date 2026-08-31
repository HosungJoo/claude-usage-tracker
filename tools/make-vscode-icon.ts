import { writeFile } from 'node:fs/promises';
import { renderTrayIcon } from '../src/main/tray-icon.js';

/**
 * VS Code 확장 아이콘을 캐릭터에서 뽑는다.
 *
 * 트레이·앱 아이콘과 같은 이유로 파일을 리포에 두지 않는다 — 캐릭터가
 * 바뀌면 아이콘도 같이 바뀌어야 하는데, 커밋된 PNG는 그 동기화를 사람이
 * 기억해야 한다. 패키징 직전에 매번 새로 그린다.
 */

const SIZE = 128;
const MARGIN = 10;

await writeFile('apps/vscode/icon.png', renderTrayIcon('idle', SIZE, MARGIN));
console.log(`아이콘 생성 — apps/vscode/icon.png (${SIZE}px)`);
