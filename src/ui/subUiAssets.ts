import { texUrl } from '../utils/texUrl';

const SUB = './tex/sub-ui';

/** 子页面 UI · 从 UI01.png 切出，布局参考 UI02.png */
export const SUB_UI = {
  headerBar: `${SUB}/headerBar.png`,
  backBtn: `${SUB}/backBtn.png`,
  sectionBar: `${SUB}/sectionBar.png`,
  panelBanner: `${SUB}/panelBanner.png`,
  panelMain: `${SUB}/panelMain.png`,
  panelMain2: `${SUB}/panelMain2.png`,
  panelLower: `${SUB}/panelLower.png`,
  panelFooter: `${SUB}/panelFooter.png`,
  btnPrimary: `${SUB}/btnPrimary.png`,
  btnSecondary: `${SUB}/btnSecondary.png`,
  btnRowLeft: `${SUB}/btnRowLeft.png`,
  btnRowRight: `${SUB}/btnRowRight.png`,
  btnAdWide: `${SUB}/btnAdWide.png`,
  btnAdSmall: `${SUB}/btnAdSmall.png`,
  btnTinyAd: `${SUB}/btnTinyAd.png`,
  btnTinyBox: `${SUB}/btnTinyBox.png`,
  crtMonitor: `${SUB}/crtMonitor.png`,
  subBg: './tex/beijing01.png',
} as const;

export function subUi(src: string): string {
  return texUrl(src);
}
