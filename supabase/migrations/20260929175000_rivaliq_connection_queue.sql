-- All Socialytics requests share one provider account: serialize across edge
-- invocations and n8n executions, with a rolling hourly budget and crash leases.
CREATE TABLE IF NOT EXISTS public.rivaliq_connection_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  lease_token uuid,
  lease_until timestamptz,
  blocked_until timestamptz
);
INSERT INTO public.rivaliq_connection_state(id) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.rivaliq_request_log (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS rivaliq_request_log_started_idx ON public.rivaliq_request_log(started_at);
ALTER TABLE public.rivaliq_connection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rivaliq_request_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rivaliq_connection_state, public.rivaliq_request_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_rivaliq_request(request_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.rivaliq_connection_state; t timestamptz; oldest timestamptz; used integer;
BEGIN
  SELECT * INTO s FROM public.rivaliq_connection_state WHERE id = true FOR UPDATE;
  t := clock_timestamp();
  IF s.blocked_until > t THEN
    RETURN jsonb_build_object('acquired',false,'retry_after',ceil(extract(epoch FROM s.blocked_until-t)),'reason','hourly_budget');
  END IF;
  IF s.lease_until > t THEN
    RETURN jsonb_build_object('acquired',false,'retry_after',2,'reason','active_request');
  END IF;
  SELECT count(*), min(started_at) INTO used, oldest FROM public.rivaliq_request_log WHERE started_at > t - interval '1 hour';
  IF used >= 95 THEN
    RETURN jsonb_build_object('acquired',false,'retry_after',greatest(1,ceil(extract(epoch FROM oldest+interval '1 hour'-t))),'reason','hourly_budget');
  END IF;
  DELETE FROM public.rivaliq_request_log WHERE started_at < t - interval '2 hours';
  INSERT INTO public.rivaliq_request_log(id,started_at) VALUES(request_token,t);
  UPDATE public.rivaliq_connection_state SET lease_token=request_token,lease_until=t+interval '100 seconds' WHERE id=true;
  RETURN jsonb_build_object('acquired',true,'remaining',94-used);
END $$;
CREATE OR REPLACE FUNCTION public.release_rivaliq_request(request_token uuid, cooldown_seconds integer DEFAULT 0)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.rivaliq_connection_state
  SET lease_token=null,lease_until=null,
      blocked_until=CASE WHEN cooldown_seconds>0 THEN clock_timestamp()+make_interval(secs=>least(cooldown_seconds,3600)) ELSE blocked_until END
  WHERE id=true AND lease_token=request_token;
$$;
REVOKE ALL ON FUNCTION public.claim_rivaliq_request(uuid), public.release_rivaliq_request(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rivaliq_request(uuid), public.release_rivaliq_request(uuid,integer) TO service_role;
