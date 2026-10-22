-- 0002_search_support: accent-insensitive product search (Vietnamese).
-- Forward: enables the trusted contrib extension `unaccent`. Rollback: DROP EXTENSION unaccent.
-- Validation: SELECT unaccent('Nón Đẹp'); -- 'Non Dep'
CREATE EXTENSION IF NOT EXISTS unaccent;
