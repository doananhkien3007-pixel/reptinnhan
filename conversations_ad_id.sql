-- Run once in the Supabase SQL Editor before deploying the Ads ID feature.
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ad_id text;
