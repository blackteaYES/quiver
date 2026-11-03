export function favoritesFirst<T extends { isFavorite?: boolean }>(
  items: readonly T[],
  compare?: (left: T, right: T) => number,
): T[] {
  return [...items].sort((left, right) => {
    const favorite =
      Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
    if (favorite !== 0) return favorite;
    return compare ? compare(left, right) : 0;
  });
}
