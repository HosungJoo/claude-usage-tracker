/**
 * 캐릭터 팔레트.
 *
 * Claude 브랜드의 코랄 계열을 기준으로, 픽셀 아트에서 형태가 읽히도록
 * 명도 차이를 넉넉히 벌린 5단계로 정리했다.
 */
export const PALETTE = {
  outline: '#4a2c20',
  shadow: '#b8563a',
  base: '#d97757',
  light: '#e89a7c',
  highlight: '#f5c4ad',

  eyeWhite: '#fff6f0',
  pupil: '#3a2018',
  mouth: '#7a2f22',
  tongue: '#e8657a',
  blush: '#f08a6e',

  /** 위험 단계에서 캐릭터 주변에 뜨는 강조색. */
  alert: '#ffd166',
  danger: '#e5484d',
} as const;

export type PaletteKey = keyof typeof PALETTE;
