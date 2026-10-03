import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFacebookProfile } from '../server/facebook-profile.js';

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
