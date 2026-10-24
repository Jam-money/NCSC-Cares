-- ===== 20260517145113_428b4bec-26b1-4bca-957a-60e38550325f.sql =====

-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'director', 'staff');
CREATE TYPE public.task_status AS ENUM ('pending', 'ongoing', 'completed');
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE public.event_type AS ENUM ('meeting', 'event', 'schedule');
CREATE TYPE public.app_unit AS ENUM ('SOCD', 'CRASD');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  position TEXT,
  unit public.app_unit,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1 $$;

-- Events / calendar
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_type event_type NOT NULL DEFAULT 'meeting',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  attachment_url TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Tasks
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'pending',
  priority task_priority NOT NULL DEFAULT 'medium',
  progress INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  due_date TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users,
  created_by UUID NOT NULL REFERENCES auth.users,
  attachment_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Comments
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- Audit log
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users,
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Auto profile + default role on signup. Default role = 'director', admins promote later.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  desired_role app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  );

  desired_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'role','')::app_role, 'director');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, desired_role)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS POLICIES ----------------------------------------------------------

-- profiles: all authenticated can read; user can update own; admin can update any
CREATE POLICY "profiles_read_all_auth" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- user_roles: read own and admin reads all; only admin writes
CREATE POLICY "roles_read_own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- events: all auth read; admin full write
CREATE POLICY "events_read" ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_admin_insert" ON public.events FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "events_admin_update" ON public.events FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "events_admin_delete" ON public.events FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- tasks: all read; admin full; directors update tasks assigned to them (progress/status)
CREATE POLICY "tasks_read" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_admin_insert" ON public.tasks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tasks_admin_update" ON public.tasks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tasks_assignee_update" ON public.tasks FOR UPDATE TO authenticated USING (auth.uid() = assigned_to);
CREATE POLICY "tasks_admin_delete" ON public.tasks FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- comments: all read; any auth user inserts as themselves; own update/delete or admin
CREATE POLICY "comments_read" ON public.task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON public.task_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_update_own" ON public.task_comments FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "comments_delete_own" ON public.task_comments FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- audit_logs: admin reads all; any user inserts their own
CREATE POLICY "audit_admin_read" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "audit_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);

-- notifications: owner only
CREATE POLICY "notif_read" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_insert_any_auth" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notif_delete_own" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ===== 20260517145138_e3f4e230-35c4-49fe-a41a-8dd53962e1b5.sql =====

-- Fix mutable search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Restrict execution of SECURITY DEFINER helpers
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Tighten notification insert: admins, or user inserting for self
DROP POLICY IF EXISTS "notif_insert_any_auth" ON public.notifications;
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- ===== 20260520000000_add_meeting_link.sql =====

-- Add meeting_link column to events table
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS meeting_link text NULL;

-- ===== 20260520000001_add_event_types.sql =====

-- Add new event_type enum values
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'staff_meeting';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'training';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'field_supervision';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'data_dissemination';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'press_conference';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'official_business';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'interagency_meeting';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'courtesy_visit';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'lcro_audit';
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'on_leave';

-- ===== 20260525000000_notify_role_fn.sql =====
-- Secure server-side function to notify all users of a given role.
-- SECURITY DEFINER bypasses RLS so any authenticated user can trigger it.
CREATE OR REPLACE FUNCTION public.notify_role(
  p_role  text,
  p_title text,
  p_body  text,
  p_link  text DEFAULT '/calendar'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, link, read)
  SELECT ur.user_id, p_title, p_body, p_link, false
  FROM   public.user_roles ur
  WHERE  ur.role::text = p_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_role TO authenticated;

-- ===== 20260601000000_event_reports.sql =====
CREATE TABLE IF NOT EXISTS public.event_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  deadline date NULL,
  progress_status text NOT NULL DEFAULT 'ongoing'
    CHECK (progress_status IN ('ongoing','for_review_css','endorsed_rd','approved_rd')),
  notes text NULL,
  updated_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_reports_read" ON public.event_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "event_reports_insert" ON public.event_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "event_reports_update" ON public.event_reports FOR UPDATE TO authenticated USING (true);

ALTER TABLE public.event_reports ADD COLUMN IF NOT EXISTS assignees jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE POLICY "event_reports_delete" ON public.event_reports FOR DELETE TO authenticated USING (true);

-- ===== 20260602000000_event_other_type.sql =====
ALTER TYPE public.event_type ADD VALUE IF NOT EXISTS 'other';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS custom_type text NULL;

-- ===== 20260603000000_event_reports_progress.sql =====
ALTER TABLE public.event_reports ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ===== 20260604000000_notify_users_fn.sql =====
-- Lets any authenticated user notify specific users (RLS only allows self/admin inserts).
CREATE OR REPLACE FUNCTION public.notify_users(
  p_user_ids uuid[],
  p_title    text,
  p_body     text,
  p_link     text DEFAULT '/reports'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, link, read)
  SELECT u, p_title, p_body, p_link, false FROM unnest(p_user_ids) AS u;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_users TO authenticated;

-- ===== 20260605000000_profiles_unit_ord.sql =====
-- unit is an app_unit enum — add ORD as a valid value
ALTER TYPE public.app_unit ADD VALUE IF NOT EXISTS 'ORD';

-- position may have been added directly in the DB; make sure it exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position text NULL;

-- Not needed on an enum column; drop if a previous attempt created it
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_unit_check;

-- ===== 20260606000000_event_reports_category.sql =====
ALTER TABLE public.event_reports ADD COLUMN IF NOT EXISTS category text NULL
  CHECK (category IS NULL OR category IN ('pl','info_dissemination'));

-- ===== 20260607000000_profiles_employment_type.sql =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'regular'
  CHECK (employment_type IN ('regular','cosw','jo'));

-- ===== 20260608000000_fix_enrolled_roles.sql =====
-- Enrolled COSW/JO/regular users were given the default 'director' role by the signup trigger.
-- Demote COSW/JO users to staff.
UPDATE public.user_roles ur
SET role = 'staff'
FROM public.profiles p
WHERE p.id = ur.user_id
  AND p.employment_type IN ('cosw','jo')
  AND ur.role = 'director';

-- ===== 20260609000000_employment_type_lgu_gip.sql =====
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%employment_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_type_check
  CHECK (employment_type IN ('regular','cosw','jo','lgu_gip'));

-- ===== 20260610000000_employment_type_lgu_gip_split.sql =====
-- LGU and GIP are separate employment types (replaces the combined 'lgu_gip').
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%employment_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

UPDATE public.profiles SET employment_type = 'lgu' WHERE employment_type = 'lgu_gip';

ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_type_check
  CHECK (employment_type IN ('regular','cosw','jo','lgu','gip'));

-- ===== 20260611000000_event_rsvp_fn.sql =====
-- Lets management (RD, JBT, SBB) save their own RSVP / note on an event they are invited to,
-- regardless of the events UPDATE policy. Each key is only writable by its matching person.
CREATE OR REPLACE FUNCTION public.set_event_rsvp(
  p_event_id uuid,
  p_key text,
  p_status text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_set_note boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_key NOT IN ('RD', 'JBT', 'SBB') THEN RAISE EXCEPTION 'Invalid RSVP key'; END IF;

  SELECT lower(coalesce(full_name, '')) INTO v_name FROM public.profiles WHERE id = auth.uid();

  IF NOT (
    (p_key = 'RD'  AND public.has_role(auth.uid(), 'director')) OR
    (p_key = 'JBT' AND v_name LIKE '%tuason%') OR
    (p_key = 'SBB' AND v_name LIKE '%balagbis%')
  ) THEN
    RAISE EXCEPTION 'You cannot respond on behalf of %', p_key;
  END IF;

  IF p_set_note THEN
    UPDATE public.events
       SET rsvp_notes = coalesce(rsvp_notes, '{}'::jsonb) || jsonb_build_object(p_key, p_note)
     WHERE id = p_event_id;
  ELSE
    UPDATE public.events
       SET rsvp_responses = coalesce(rsvp_responses, '{}'::jsonb) || jsonb_build_object(p_key, p_status)
     WHERE id = p_event_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_event_rsvp(uuid, text, text, text, boolean) TO authenticated;

