
CREATE TABLE public.report_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly',
  is_active boolean DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  trends_date_range_days integer DEFAULT 30,
  analysis_date_range_days integer DEFAULT 30,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything with report_schedules"
ON public.report_schedules FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "Client users can view their report_schedules"
ON public.report_schedules FOR SELECT
USING (is_client_member(client_id));

CREATE TRIGGER update_report_schedules_updated_at
BEFORE UPDATE ON public.report_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
