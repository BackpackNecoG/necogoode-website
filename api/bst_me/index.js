/* /api/bst/me — who is signed in? */
const bst = require('../shared/bst');
module.exports = async function (context, req) {
  const email = bst.sessionEmail(req.headers.cookie);
  context.res = email
    ? { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: { email } }
    : { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: {} };
};
