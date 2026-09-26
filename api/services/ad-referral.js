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
      return { adId: String(adId).trim(), location, source: referral.source || null };
    }
  }

  const [location, referral] = referrals[0] || [];
  return { adId: null, location: location || null, source: referral?.source || null };
}
