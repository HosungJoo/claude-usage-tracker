/**
 * 문구표의 모양.
 *
 * 값이 함수인 항목은 어순이 언어마다 다른 것들이다. 조각을 이어 붙이는
 * 대신 각 언어가 문장을 통째로 만든다.
 */
export interface Catalog {
  /** 사용량 창 이름. 말풍선·트레이·CLI가 함께 쓴다. */
  window: {
    fiveHour: string;
    weekly: string;
  };

  /** 남은 시간·비율 표기. */
  format: {
    unknown: string;
    soon: string;
    days: (days: number, hours: number) => string;
    hours: (hours: number, mins: number) => string;
    minutes: (mins: number) => string;
    seconds: (sec: number) => string;
    minutesSeconds: (min: number, sec: number) => string;
  };

  /** 사용량 구간 이름. */
  severity: {
    normal: string;
    warning: string;
    critical: string;
  };

  /** 캐릭터 대사. title은 말풍선 첫 줄, detail은 둘째 줄. */
  line: {
    exhausted: (where: string) => string;
    exhaustedDetail: (left: string) => string;
    almost: (where: string, percent: string) => string;
    almostDetail: (left: string) => string;
    high: (where: string, percent: string) => string;
    highDetail: (left: string) => string;
    half: (where: string) => string;
    halfDetail: (percent: string, left: string) => string;
    greetSpare: (remaining: string) => string;
    greetTight: string;
    greetDetail: (five: string, week: string, left: string) => string;
    checkTitle: (five: string, week: string) => string;
    checkDetail: (left: string) => string;
    sessionEnd: (used: string) => string;
    sessionEndDetail: (five: string, left: string) => string;
  };

  /** 데스크톱 항목에 들어가는 한 줄 설명. */
  appComment: string;

  /** 트레이 아이콘과 메뉴. */
  tray: {
    notReadYet: string;
    fiveHourItem: (percent: string, left: string) => string;
    weeklyItem: (percent: string, left: string) => string;
    checkNow: string;
    settings: string;
    openLogs: string;
    quit: string;
    tooltipIdle: string;
    tooltip: (five: string, week: string) => string;
  };

  /** VS Code 확장의 사용량 뷰. 접혀 있을 때는 머리줄 한 줄이 전부다. */
  view: {
    /** 머리줄 오른쪽. 접힌 상태에서도 이것만은 보인다 — 짧게. */
    description: (five: string, week: string) => string;
    /** 조회 실패 시 머리줄. 숫자 자리에 들어가므로 한두 낱말. */
    descriptionError: string;
    fiveHourRow: (percent: string) => string;
    weeklyRow: (percent: string) => string;
    resetsIn: (left: string) => string;
  };

  /** 사용자에게 보이는 오류. 무엇을 하면 풀리는지까지 적는다. */
  error: {
    authRejected: string;
    rateLimited: string;
    serverDown: string;
    offline: string;
    badResponse: string;
    unknown: string;
    credentialsMissing: string;
    credentialsUnreadable: string;
    credentialsCorrupt: string;
    credentialsNoToken: string;
    credentialsExpired: string;
  };

  /** 배치 기준과 모서리 이름. 설정 창의 드롭다운. */
  anchorLabel: {
    center: string;
    screen: string;
    window: string;
  };
  cornerLabel: {
    'bottom-right': string;
    'bottom-left': string;
    'top-right': string;
    'top-left': string;
  };

  /** 설정 창. */
  settings: {
    windowTitle: string;
    heading: string;
    on: string;
    sectionAlerts: string;
    thresholds: string;
    thresholdsHint: string;
    thresholdsError: string;
    holdTime: string;
    holdHint: string;
    waitWhenAway: string;
    waitAwayHint: string;
    pollInterval: string;
    pollHint: string;
    sectionCharacter: string;
    showOnScreen: string;
    showHint: string;
    whichMonitor: string;
    anchor: string;
    corner: string;
    margin: string;
    preview: string;
    previewButton: string;
    previewHint: string;
    sectionSession: string;
    greetOnStart: string;
    greetHint: string;
    hooks: string;
    hooksHint: string;
    hookInstalled: string;
    hookMissing: string;
    hookInstall: string;
    hookRemove: string;
    hookFailed: string;
    sectionSystem: string;
    autostart: string;
    sectionDiagnostics: string;
    openLogFolder: string;
    resetDefaults: string;
    saved: string;
    language: string;
    languageAuto: string;
    displayAll: string;
    displayPrimary: string;
    displayCursor: string;
    displayHintAll: string;
    displayHintPrimary: string;
    displayHintCursor: string;
    displayHintSpecific: string;
    anchorHintWindow: string;
    anchorHintScreen: string;
    monitorTagPrimary: string;
    monitorTagCursor: string;
    orientationPortrait: string;
    orientationLandscape: string;
    planKnown: (plan: string) => string;
    planUnknown: string;
  };

  /** CLI 출력. */
  cli: {
    heading: string;
    notProvided: string;
    resetsIn: string;
    scopedHeading: string;
    otherModel: string;
    overall: (label: string) => string;
    badInterval: string;
    unknownOption: (option: string) => string;
    crossed: (where: string, threshold: number, percent: string) => string;
    watching: (seconds: number) => string;
    stopping: string;
    historyCleared: (path: string) => string;
    historyClearFailed: string;
    hooksRegistered: string;
    hooksAlreadyRegistered: string;
    hooksRemoved: string;
    hooksNotRegistered: string;
    settingsPath: (path: string) => string;
    scriptPath: (path: string) => string;
    hooksNextSession: string;
    hooksNeedApp: string;
    hookStatus: (yesNo: string, path: string) => string;
    appStatus: (yesNo: string, path: string) => string;
    yes: string;
    no: string;
    hooksButNoApp: string;
    errorPrefix: (message: string) => string;
  };

  /** 로그. 사용자가 남에게 보내며 도움을 청하는 파일이라 함께 번역한다. */
  log: {
    started: (thresholds: string, seconds: number) => string;
    quitting: string;
    placement: (where: string, screens: number, at: string) => string;
    placementCenter: string;
    placementWindowCorner: string;
    placementScreenCorner: string;
    windowNotFound: string;
    shown: (id: number, title: string) => string;
    held: (id: number) => string;
    released: (id: number, reason: string) => string;
    releaseTimeout: string;
    releaseReturned: (waitedSec: number) => string;
    releaseDismissed: string;
    thresholdCrossed: (threshold: number, where: string, percent: string) => string;
    pollSettingsChanged: (seconds: number, thresholds: string) => string;
    settingsSaveFailed: string;
    settingsReset: string;
    hookInstalled: (path: string) => string;
    hookInstallFailed: (message: string) => string;
    hookRemoved: string;
    hookRemoveFailed: (message: string) => string;
    willRetry: string;
    autostartOn: string;
    autostartOff: string;
    autostartFailed: string;
    spoolFailed: (message: string) => string;
    checkNowFailed: string;
  };
}
