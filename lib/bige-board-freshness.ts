export type BigeBoardRevisionMap = Map<string, number>;

export function readBigeBoardRevision(revisions: BigeBoardRevisionMap, businessDate: string) {
  return revisions.get(businessDate) || 0;
}

export function bumpBigeBoardRevision(revisions: BigeBoardRevisionMap, businessDate: string) {
  const nextRevision = readBigeBoardRevision(revisions, businessDate) + 1;
  revisions.set(businessDate, nextRevision);
  return nextRevision;
}

export function isBigeBoardRevisionCurrent(
  revisions: BigeBoardRevisionMap,
  businessDate: string,
  requestedRevision: number,
) {
  return readBigeBoardRevision(revisions, businessDate) === requestedRevision;
}
