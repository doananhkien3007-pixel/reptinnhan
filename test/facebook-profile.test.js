import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFacebookProfile, syncFacebookProfile } from '../server/facebook-profile.js';

test('lấy tên và avatar Facebook bằng PSID với Page token ở server', async () => {
  const previousToken = process.env.PAGE_ACCESS_TOKEN;
  process.env.PAGE_ACCESS_TOKEN = 'page-secret';
  try {
    const fetchImpl = async (input, init) => {
      const url = new URL(input);
      assert.equal(url.pathname, '/v26.0/28763097236660294');
      assert.equal(url.searchParams.get('fields'), 'first_name,last_name,name,profile_pic');
      assert.equal(url.searchParams.has('access_token'), false);
      assert.equal(init.headers.Authorization, 'Bearer page-secret');
      return Response.json({
        first_name: 'Lan', last_name: 'Nguyễn', name: 'Lan Nguyễn',
        profile_pic: 'https://img.example/lan.jpg'
      });
    };
    const profile = await fetchFacebookProfile('28763097236660294', { fetchImpl });
    assert.equal(profile.facebook_name, 'Lan Nguyễn');
    assert.equal(profile.facebook_first_name, 'Lan');
    assert.equal(profile.facebook_last_name, 'Nguyễn');
    assert.equal(profile.facebook_profile_pic, 'https://img.example/lan.jpg');
    assert.ok(profile.profile_updated_at);
  } finally {
    if (previousToken === undefined) delete process.env.PAGE_ACCESS_TOKEN;
    else process.env.PAGE_ACCESS_TOKEN = previousToken;
  }
});

test('không chấp nhận PSID không hợp lệ và không làm lộ Page token trong URL', async () => {
  const previousToken = process.env.PAGE_ACCESS_TOKEN;
  process.env.PAGE_ACCESS_TOKEN = 'page-secret';
  try {
    await assert.rejects(fetchFacebookProfile('../me', { fetchImpl: async () => Response.json({}) }), /PSID/);
  } finally {
    if (previousToken === undefined) delete process.env.PAGE_ACCESS_TOKEN;
    else process.env.PAGE_ACCESS_TOKEN = previousToken;
  }
});

test('không cache phản hồi rỗng từ Facebook thành một hồ sơ hợp lệ', async () => {
  const previousToken = process.env.PAGE_ACCESS_TOKEN;
  process.env.PAGE_ACCESS_TOKEN = 'page-secret';
  try {
    await assert.rejects(fetchFacebookProfile('28763097236660294', {
      fetchImpl: async () => Response.json({})
    }), /không trả về tên hoặc ảnh đại diện/);
  } finally {
    if (previousToken === undefined) delete process.env.PAGE_ACCESS_TOKEN;
    else process.env.PAGE_ACCESS_TOKEN = previousToken;
  }
});

test('webhook lưu tên và URL avatar; lỗi không khóa lần thử tiếp theo', async () => {
  const previousToken = process.env.PAGE_ACCESS_TOKEN;
  process.env.PAGE_ACCESS_TOKEN = 'page-secret';
  const updates = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'conversations');
      return { update(value) { updates.push(value); return { eq: async () => ({ error: null }) }; } };
    }
  };
  const conversation = {
    id: 'conversation-1', external_user_id: '28763097236660294',
    facebook_name: null, facebook_profile_pic: null,
    profile_updated_at: new Date().toISOString()
  };
  try {
    let calls = 0;
    const synced = await syncFacebookProfile(conversation, {
      supabase,
      fetchImpl: async () => {
        calls++;
        return Response.json({ name: 'Nguyễn Lan', profile_pic: 'https://img.example/lan.jpg' });
      }
    });
    assert.equal(calls, 1, 'hồ sơ rỗng phải thử lại dù profile_updated_at còn mới');
    assert.equal(synced.facebook_name, 'Nguyễn Lan');
    assert.equal(synced.facebook_profile_pic, 'https://img.example/lan.jpg');
    assert.equal(updates.length, 1);

    let reportedError;
    const failed = await syncFacebookProfile(conversation, {
      supabase,
      fetchImpl: async () => Response.json({ error: { message: 'rate limited' } }, { status: 429 }),
      onError: (error) => { reportedError = error; }
    });
    assert.equal(failed, conversation);
    assert.match(reportedError.message, /rate limited/);
    assert.equal(updates.length, 1, 'không ghi timestamp giả khi Facebook lỗi');
  } finally {
    if (previousToken === undefined) delete process.env.PAGE_ACCESS_TOKEN;
    else process.env.PAGE_ACCESS_TOKEN = previousToken;
  }
});
