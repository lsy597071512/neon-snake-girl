/**
 * 开始页垫底静态图：与视频首帧严格同源（ffmpeg 抽帧导出），
 * 用于视频首帧真正渲染前的无缝垫底——视频 is-awaiting-play 隐藏期间露出它，
 * 而不是露出黑底。
 *
 * 历史 BUG：旧实现轮换 game-poster-v2-ridge / game-poster-v5-judgment 两张海报，
 * 但这两个文件在 tex/ 与发布产物里都不存在 → <img> 404 → 开始页/过场间隙全黑。
 */

export const TITLE_STILL_BOOT = './tex/poster-candidates/still_diyici.png';
export const TITLE_STILL_LOOP = './tex/poster-candidates/still_xunhuan.png';

/**
 * 渲染开始页 HTML 时的垫底图（默认循环首帧）。
 * 冷启动入场（diyici）的垫底由 titleVideoFx.mountStage 在同一次渲染内切换为
 * TITLE_STILL_BOOT——发生在浏览器绘制之前，不会闪帧。
 */
export function pickTitlePoster(): string {
  return TITLE_STILL_LOOP;
}
