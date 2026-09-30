function findAdIdRecursively(obj, depth = 0) {
  if (depth > 10) return null; // Prevent infinite loops
  if (!obj || typeof obj !== 'object') return null;
  
  try {
    if (obj.ad_id) return obj.ad_id;
    if (obj.ads_context_data?.ad_id) return obj.ads_context_data.ad_id;
    
    for (const key of Object.keys(obj)) {
      const found = findAdIdRecursively(obj[key], depth + 1);
      if (found) return found;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

export function getAdReferral(webhookEvent) {
  const locations = [
    ['event.referral', webhookEvent?.referral],
    ['message.referral', webhookEvent?.message?.referral],
    ['postback.referral', webhookEvent?.postback?.referral],
    ['optin.referral', webhookEvent?.optin?.referral]
  ];

  const referrals = locations.filter(([, referral]) => referral && typeof referral === 'object');
  for (const [location, referral] of referrals) {
    const adId = referral.ad_id ?? referral.ads_context_data?.ad_id;
    if (adId != null && String(adId).trim()) {
      return { adId: String(adId).trim(), location, source: referral.source || null, raw: referral };
    }
  }

  // Deep search fallback
  const deepAdId = findAdIdRecursively(webhookEvent);
  if (deepAdId) {
    return { adId: String(deepAdId).trim(), location: 'deep_search', source: 'deep_search', raw: webhookEvent };
  }

  const [loc, ref] = referrals[0] || [];
  return { adId: null, location: loc || null, source: ref?.source || null, raw: webhookEvent || null };
}
