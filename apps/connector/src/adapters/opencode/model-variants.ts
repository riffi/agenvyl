export type OpenCodeCatalogModel = {
  id: string;
  name: string;
  variants?: Record<string, unknown>;
};

const knownOrder = new Map(
  ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    .map((name, index) => [name, index]),
);

export const enabledModelVariants = (model: OpenCodeCatalogModel) =>
  Object.entries(model.variants ?? {})
    .filter(([name, options]) =>
      name.length > 0
      && name.length <= 40
      && name === name.trim()
      && isRecord(options)
      && options.disabled !== true)
    .map(([name]) => name)
    .sort(compareVariants);

const compareVariants = (left: string, right: string) => {
  const leftRank = knownOrder.get(left);
  const rightRank = knownOrder.get(right);
  if (leftRank !== undefined || rightRank !== undefined) {
    return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
  }
  return left.localeCompare(right);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
