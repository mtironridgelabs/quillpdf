/** Where a dragged block lands, as arguments to a page move that keeps the block together. */
export function pageMove(
  count: number,
  moving: number[],
  insertAt: number,
): { indices: number[]; dest: number } | null {
  if (count < 2) return null;
  const block = [...new Set(moving)].filter((index) => index >= 0 && index < count).sort((a, b) => a - b);
  if (block.length === 0 || block.length >= count) return null;
  const at = Math.min(Math.max(0, insertAt), count);
  const movingSet = new Set(block);
  let dest = 0;
  for (let index = 0; index < at; index++) {
    if (!movingSet.has(index)) dest += 1;
  }
  const stay: number[] = [];
  for (let index = 0; index < count; index++) {
    if (!movingSet.has(index)) stay.push(index);
  }
  const final = [...stay.slice(0, dest), ...block, ...stay.slice(dest)];
  if (final.every((page, index) => page === index)) return null;
  return { indices: block, dest };
}
