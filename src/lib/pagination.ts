export type Paginated<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export function offsetOf(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function paginate<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
