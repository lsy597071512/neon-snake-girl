/**
 * 【市场版 · 功能已下线】原「约束姿势」描述表。
 *
 * 市场版不包含该玩法的任何文本与资源；此处仅保留导出签名，全部返回空。
 * 本地成人版实现见 _adult-local/src/ai/disciplinePoseNotes.ts。
 */

export const DISCIPLINE_POSE_NOTES: Record<string, Record<number, string>> = {};

export function getDisciplinePoseCount(_characterId: string): number {
  return 0;
}

export function getDisciplinePoseNote(_characterId: string, _poseIndex: number | null): string {
  return '';
}

export function buildDisciplinePosePlayerMessage(
  _characterId: string,
  _poseIndex: number,
): string {
  return '';
}

export function buildDisciplineIdlePlayerMessage(_characterId: string): string {
  return '';
}
