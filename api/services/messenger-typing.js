import { setTimeout as sleep } from 'node:timers/promises';

// https://developers.facebook.com/docs/messenger-platform/send-messages/sender-actions/
export async function withTypingDelay(recipientId, text, send, { wait = sleep } = {}) {
  const configured = process.env.MESSENGER_TYPING_DELAY_MS;
  const delay = configured !== undefined && configured.trim() !== '' && Number.isFinite(Number(configured))
    ? Math.max(0, Math.min(5000, Number(configured)))
    : Math.min(3000, Math.max(1000, 800 + String(text).length * 10));
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
