/** Keeps only the latest in-flight dialogue request for each character. */
const activeRequests = new Map<string, { generation: number; controller: AbortController }>();

export type DialogueRequestLease = {
  characterId: string;
  generation: number;
  controller: AbortController;
};

export function beginDialogueRequest(characterId: string): DialogueRequestLease {
  const previous = activeRequests.get(characterId);
  previous?.controller.abort();
  const lease = {
    characterId,
    generation: (previous?.generation ?? 0) + 1,
    controller: new AbortController(),
  };
  activeRequests.set(characterId, lease);
  return lease;
}

export function isCurrentDialogueRequest(lease: DialogueRequestLease): boolean {
  const current = activeRequests.get(lease.characterId);
  return current?.generation === lease.generation && current.controller === lease.controller;
}

export function finishDialogueRequest(lease: DialogueRequestLease): void {
  if (isCurrentDialogueRequest(lease)) activeRequests.delete(lease.characterId);
}
