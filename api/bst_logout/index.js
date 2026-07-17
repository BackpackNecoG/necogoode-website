/* /api/bst/logout — clear the trainee session cookie. */
const bst = require('../shared/bst');
module.exports = async function (context) {
  context.res = { status: 200, headers: { 'content-type': 'application/json', 'Set-Cookie': bst.clearCookieHeader() }, body: { ok: true } };
};
