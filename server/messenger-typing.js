import { setTimeout as sleep } from 'node:timers/promises';

// https://developers.facebook.com/docs/messenger-platform/send-messages/sender-actions/
export async function withTypingDelay(recipientId, _text, send, { wait = sleep } = {}) {
  const configured = process.env.MESSENGER_TYPING_DELAY_MS;
  const delay = configured !== undefined && configured.trim() !== '' && Number.isFinite(Number(configured))
    ? Math.max(0, Math.min(5000, Number(configured)))
    : 0;
  // Reply immediately by default. Besides the artificial pause, each typing
  // action is another Graph API round trip and can add up to two seconds when
  // Meta is slow. Shops that prefer the typing effect can opt back in with
  // MESSENGER_TYPING_DELAY_MS.
  if (!delay) return send();
  const action = async (senderAction) => {
    try {
      const version = process.env.GRAPH_API_VERSION || 'v26.0';
      const response = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.PAGE_ACCESS_TOKEN}` },
        body: JSON.stringify({ recipient: { id: recipientId }, sender_action: senderAction }),
        signal: AbortSignal.timeout(2000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      // Hiệu ứng lỗi không được làm mất tin tư vấn hay gửi lại tin đã thành công.
      console.warn(`Không thể gửi trạng thái Messenger ${senderAction}.`);
    }
  };
  await action('typing_on');
  try {
    await wait(delay);
    return await send();
  } finally {
    await action('typing_off');
  }
}
