-- DOM-RT Seed Data
-- Default password for all users: Password123!
-- bcrypt hash of "Password123!" with 12 rounds

INSERT INTO users (id, username, email, password_hash, role_id, region) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin',    'admin@domrt.local',    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNORozXKufiGFvJKzPVFNXsn4i', 1, 'HQ'),
  ('a0000000-0000-0000-0000-000000000002', 'manager1', 'manager1@domrt.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNORozXKufiGFvJKzPVFNXsn4i', 2, 'East'),
  ('a0000000-0000-0000-0000-000000000003', 'auditor1', 'auditor1@domrt.local', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNORozXKufiGFvJKzPVFNXsn4i', 3, 'HQ'),
  ('a0000000-0000-0000-0000-000000000004', 'viewer1',  'viewer1@domrt.local',  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGNORozXKufiGFvJKzPVFNXsn4i', 4, 'West');

INSERT INTO sites (id, name, domain_type, location, region, scheduled_open, scheduled_close, status, responsible_user_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Downtown Branch',    'branch', 'New York, NY',     'East', '09:00', '17:00', 'inactive', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000002', 'Midtown Store',      'store',  'New York, NY',     'East', '08:00', '20:00', 'inactive', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000003', 'West Depot',         'depot',  'Los Angeles, CA',  'West', '06:00', '22:00', 'inactive', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000004', 'North Clinic',       'clinic', 'Boston, MA',       'East', '07:00', '19:00', 'inactive', 'a0000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-000000000005', 'Production Cell A',  'cell',   'Detroit, MI',      'Central', '00:00', '23:59', 'inactive', 'a0000000-0000-0000-0000-000000000002');
