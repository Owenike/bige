export type CoachOrderItem = { id: string };

export type StoredCoachOrder = {
  coach_id: string;
  sort_order: number;
};

export function reorderCoachList<T extends CoachOrderItem>(
  coaches: readonly T[],
  activeCoachId: string,
  targetCoachId: string,
) {
  const sourceIndex = coaches.findIndex((coach) => coach.id === activeCoachId);
  const targetIndex = coaches.findIndex((coach) => coach.id === targetCoachId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return [...coaches];
  }

  const next = [...coaches];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function applyStoredCoachOrder<T extends CoachOrderItem>(
  coaches: readonly T[],
  storedOrder: readonly StoredCoachOrder[],
) {
  const positions = new Map(
    storedOrder.map((item) => [item.coach_id, item.sort_order] as const),
  );
  const originalPositions = new Map(
    coaches.map((coach, index) => [coach.id, index] as const),
  );

  return [...coaches].sort((left, right) => {
    const leftPosition = positions.get(left.id);
    const rightPosition = positions.get(right.id);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return (originalPositions.get(left.id) || 0) - (originalPositions.get(right.id) || 0);
  });
}

export function applyCoachIdOrder<T extends CoachOrderItem>(
  coaches: readonly T[],
  orderedCoachIds: readonly string[],
) {
  return applyStoredCoachOrder(
    coaches,
    orderedCoachIds.map((coachId, sortOrder) => ({
      coach_id: coachId,
      sort_order: sortOrder,
    })),
  );
}

export function synchronizeCoachOrderAcrossBoards<
  TCoach extends CoachOrderItem,
  TBoard extends { coaches: TCoach[] },
>(boards: Map<string, TBoard>, orderedCoachIds: readonly string[]) {
  for (const [date, board] of boards) {
    boards.set(date, {
      ...board,
      coaches: applyCoachIdOrder(board.coaches, orderedCoachIds),
    });
  }
}

export function hasExactCoachSet(
  expectedCoachIds: readonly string[],
  requestedCoachIds: readonly string[],
) {
  if (expectedCoachIds.length !== requestedCoachIds.length) return false;
  const expected = new Set(expectedCoachIds);
  const requested = new Set(requestedCoachIds);
  return requested.size === requestedCoachIds.length && requested.size === expected.size &&
    requestedCoachIds.every((coachId) => expected.has(coachId));
}
