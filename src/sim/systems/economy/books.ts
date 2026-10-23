/** The day's revenue and cost per business, cleared at the start of each economy phase (feeds `profit30`). */
export const dailyRevenue = new Map<number, number>();
export const dailyCost = new Map<number, number>();

export function addRev(id: number, v: number): void { dailyRevenue.set(id, (dailyRevenue.get(id) ?? 0) + v); }
export function addCost(id: number, v: number): void { dailyCost.set(id, (dailyCost.get(id) ?? 0) + v); }
