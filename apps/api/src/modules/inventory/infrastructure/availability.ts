/**
 * Single definition of "how many can be sold right now":
 *   ledger sum (append-only movements)  -  quantity held by ACTIVE, unexpired reservations.
 * Every read path (catalog, cart, checkout) uses these fragments so they cannot drift apart.
 * `v` is the SQL alias of the product_variants row.
 */
export const ledgerQtySql = (v = 'v') =>
  `COALESCE((SELECT SUM(m.delta) FROM inventory_movements m WHERE m.variant_id = ${v}.id), 0)`;
export const reservedQtySql = (v = 'v') =>
  `COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id = ${v}.id AND r.status = 'ACTIVE' AND r.expires_at > now()), 0)`;
export const availableQtySql = (v = 'v') => `(${ledgerQtySql(v)} - ${reservedQtySql(v)})::int`;
