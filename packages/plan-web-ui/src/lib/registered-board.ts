const scopedBoard = /^\/board\/([0-9a-f-]{36})\/([0-9a-f-]{36})(?:\/|$)/;

export function registeredBoardScope() {
  if (typeof window === "undefined") return undefined;
  const match = scopedBoard.exec(window.location.pathname);
  if (!match) return undefined;
  const [, projectId, workspaceId] = match;
  return {
    route: `/board/${projectId}/${workspaceId}`,
    api: `/projects/${projectId}/workspaces/${workspaceId}`,
  };
}
