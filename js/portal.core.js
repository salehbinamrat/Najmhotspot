(function (w, d) {
'use strict';
var cfg = w.PORTAL_CONFIG || {};
var $login, $status, $form, $submit, $logout, $error;
var signedIn = false, loginPending = false, logoutPending = false;
var attemptUser = '', attemptPass = '';
var statusTimer = 0, errorTimer = 0, welcomeTimer = 0, blockTimer = 0;
var statusRequest = null, statusFailures = 0, epoch = 0;
var loginTimestamp = 0, earlyNegativeCount = 0;
var loginConfirmTimer = 0, loginConfirmCount = 0;
var recentCards = [];
var STORE = cfg.storageKey || 'hotspot_saved_cards_v3';
var BLOCK_STORE = cfg.blockKey || 'hotspot_browser_attempts_v3';
var HISTORY_TTL = 30 * 24 * 60 * 60 * 1000;
function el(id) { return d.getElementById(id); }
function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function hasClass(node, name) { return !!node && (' ' + node.className + ' ').indexOf(' ' + name + ' ') !== -1; }
function addClass(node, name) { if (node && !hasClass(node, name)) node.className += (node.className ? ' ' : '') + name; }
function removeClass(node, name) {
if (node) node.className = trim((' ' + node.className + ' ').replace(' ' + name + ' ', ' '));
}
function setText(node, value) { if (node) node.textContent = String(value == null ? '' : value); }
function ready(callback) {
if (d.readyState === 'complete' || d.readyState === 'interactive') callback();
else d.addEventListener('DOMContentLoaded', callback, false);
}
function now() { return (new Date()).getTime(); }
function storageGet(storage, key) { try { return storage && storage.getItem(key); } catch (ignore) { return null; } }
function storageSet(storage, key, val) { try { if (storage) { storage.setItem(key, val); return true; } } catch (ignore) {} return false; }
function storageRemove(storage, key) { try { if (storage) storage.removeItem(key); } catch (ignore) {} }
function safeLocal() { try { return w.localStorage; } catch (ignore) { return null; } }
function safeSession() { try { return w.sessionStorage; } catch (ignore) { return null; } }
function normalize(value, isUsername) {
var str = String(value == null ? '' : value).replace(/[٠-٩۰-۹]/g, function (c) {
var n = c.charCodeAt(0); return String(n >= 1776 ? n - 1776 : n - 1632);
});
return isUsername ? str.replace(/[\s\u200B-\u200D\uFEFF]/g, '') : str;
}
function safeDecode(v) {
var s = String(v == null ? '' : v);
try { return decodeURIComponent(s.replace(/\+/g, '%20')); } catch (ignore) { return s; }
}
function isLoggedIn(v) { return v === true || v === 1 || /^(yes|true|1)$/i.test(String(v)); }
/* Read the URL-escaped value sent by RouterOS. In -esc variables, + can
   represent a space even when the value contains no %XX sequence. */
function decodeHotspotError(raw) {
var text = String(raw == null ? '' : raw);
text = text.replace(/&quot;/gi, '"').replace(/&#(?:0*39|x0*27);|&apos;/gi, "'")
.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
try { text = decodeURIComponent(text.replace(/\+/g, '%20')); }
catch (ignore) { text = text.replace(/\+/g, ' '); }
return trim(text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' '));
}
/* Short Arabic notifications. If RouterOS returns a generic RADIUS rejection,
   it cannot prove which condition caused the rejection. For card-only entry,
   use the requested retry-another-card UX rather than claiming quota expiry.
   Specific reported limits, expiration, sessions and server errors take priority. */
var BAD_CARD_MESSAGE = 'الكرت خطأ، حاول بكرت آخر';
function classifyHotspotError(raw, hasPassword) {
var text = decodeHotspotError(raw), t = text.toLowerCase();
var code = 'UNKNOWN', message = '';
/* Important: specific account/quota/server failures must precede generic
   credential failure and unspecified rejection matches. */
if (/\b(?:not enough credit|insufficient (?:credit|balance)|out of credit|no credit|balance exhausted|credit limit reached|zero balance|credit exhausted)\b|(?:نفد|انتهى|نفاد) الرصيد|الرصيد غير كاف/.test(t)) {
code = 'NO_CREDIT'; message = 'انتهى رصيد الكرت';
} else if (/\b(?:transfer limit|traffic limit|download limit|upload limit|byte(?:s)? limit|data quota|data limit|no more traffic|quota of data|bytes quota|data allowance exhausted|maximum transfer reached|total bytes limit)\b|\b(?:reached|exceeded|exhausted) (?:the |its |his )?(?:transfer|traffic|data|bytes) (?:limit|quota)\b|(?:نفدت|انتهت) (?:البيانات|سعة البيانات)|(?:حد|حصة) (?:البيانات|التحميل)/.test(t)) {
code = 'DATA_LIMIT'; message = 'انتهى رصيد الكرت';
} else if (/\b(?:no more online time|uptime limit|online time limit|time quota|time limit reached|used all uptime|no more uptime|session time limit|total uptime limit)\b|\b(?:reached|exceeded) (?:the |its )?(?:uptime|online time|time) limit\b|(?:انتهى|نفد) وقت (?:الاستخدام|الاتصال)|حد (?:الوقت|الزمن)/.test(t)) {
code = 'TIME_LIMIT'; message = 'انتهى وقت الكرت';
} else if (/\b(?:account expired|user expired|expired account|profile expired|validity expired|user validity expired|validity period expired|card expired|account has expired)\b|(?:انتهت|انتهاء) صلاحية (?:الكرت|الحساب|الباقة)|(?:كرت|حساب|بطاقة) منته(?:ية|ي) الصلاحية/.test(t)) {
code = 'EXPIRED'; message = 'انتهت صلاحية الكرت';
} else if (/\b(?:no more sessions|no more sessions are allowed|simultaneous session(?:s)?|session limit (?:reached|exceeded)|too many (?:active |concurrent )?sessions|maximum (?:active )?sessions|already logged in|already active|user already logged|user is online|already in use|only one login per user)\b|(?:مستخدم|يستخدم) (?:على|من) جهاز آخر|(?:الكرت|الحساب) قيد الاستخدام|(?:عدد|حد) الجلسات/.test(t)) {
code = 'SESSION_LIMIT'; message = 'الكرت مستخدم على جهاز آخر';
} else if (/\b(?:invalid calling.station.id|not allowed to log in from this mac|mac address (?:not allowed|mismatch)|mac mismatch|device binding|mac binding|not allowed from this mac|not allowed from this device)\b|(?:الجهاز غير مسموح|عنوان الجهاز غير مسموح|هذا الجهاز غير مصرح)/.test(t)) {
code = 'DEVICE_RESTRICTION'; message = 'هذا الكرت غير مسموح على هذا الجهاز';
} else if (/\b(?:account disabled|user disabled|user is disabled|disabled user|account inactive|user is inactive)\b|(?:الحساب|المستخدم) معطل/.test(t)) {
code = 'DISABLED'; message = 'الكرت موقوف';
} else if (/\b(?:radius[^\n]{0,75}(?:timed? out|not responding|no (?:response|reply)|not answering|unreachable|unavailable)|no (?:response|reply) from (?:the )?radius|(?:unable to contact|cannot contact) (?:the )?radius|authentication server[^\n]{0,55}(?:timed? out|not responding|unreachable)|server (?:is )?not responding|server (?:is )?unavailable|radius timeout|server unreachable|service unavailable|connection refused|connection timed out|timeout waiting for (?:a |the )?server)\b|خادم المصادقة لا يستجيب|تعذر الاتصال بالخادم|الراوتر لا يستجيب/.test(t)) {
code = 'AUTH_SERVER_UNAVAILABLE'; message = 'خادم الشبكة لا يستجيب، حاول لاحقا';
} else if (/\b(?:already authorizing|authorization in progress|authentication in progress)\b/.test(t)) {
code = 'AUTH_IN_PROGRESS'; message = 'جاري التحقق من الكرت، حاول مجددا';
} else if (/\b(?:web browser did not send|chap challenge|invalid chap|challenge response)\b/.test(t)) {
code = 'AUTH_METHOD'; message = 'خطأ في نظام الدخول، تواصل مع الدعم';
} else if (/\b(?:no more ip addresses|ip pool is empty|no available ip|ip address unavailable|cannot assign ip address)\b/.test(t)) {
code = 'IP_UNAVAILABLE'; message = 'تعذر تخصيص عنوان للجهاز';
} else if (/\b(?:too many attempts|temporarily locked|too many login attempts)\b/.test(t)) {
code = 'TEMP_LOCK'; message = 'محاولات كثيرة، حاول لاحقا';
} else if (/\b(?:quota exceeded|usage limit reached|limit reached)\b|تم تجاوز حد الاستخدام/.test(t)) {
code = 'UNSPECIFIED_LIMIT'; message = 'بلغ الكرت حد الاستخدام';
} else if (/\b(?:no valid profile(?: found)?|no profile available|no active profile)\b|لا توجد باقة صالحة/.test(t)) {
/* No valid profile does not reveal whether the user is unknown, inactive, or
   has no usable plan. Follow the requested generic bad-card UX here. */
code = 'NO_VALID_PROFILE'; message = BAD_CARD_MESSAGE;
} else if (/\b(?:user(?:name)?\s+(?:does not exist|not found|unknown)|unknown user(?:name)?|no such user|user not found|account not found|no such account)\b|(?:رقم الكرت|اسم المستخدم|الحساب) غير موجود|لا يوجد (?:حساب|مستخدم) بهذا/.test(t)) {
code = 'USER_NOT_FOUND'; message = BAD_CARD_MESSAGE;
} else if (/\b(?:invalid username|invalid user name|invalid user)(?!\s+(?:or|and|&)\s+password)\b/.test(t)) {
code = 'INVALID_USERNAME'; message = BAD_CARD_MESSAGE;
} else if (/\b(?:invalid (?:username|user name|user) (?:or|and|&) password|wrong (?:username|user name) or password|invalid credentials|incorrect (?:username|user name) or password|authentication failed|access.reject|radius reject|bad credentials)\b|(?:بيانات الدخول|بيانات الحساب) غير صحيحة/.test(t)) {
code = 'INVALID_CREDENTIALS'; message = hasPassword ? 'اسم المستخدم أو كلمة المرور خطأ' : BAD_CARD_MESSAGE;
} else if (/\b(?:invalid password|wrong password|bad password|incorrect password)\b|كلمة المرور غير صحيحة/.test(t)) {
code = 'INVALID_PASSWORD'; message = hasPassword ? 'كلمة المرور خطأ' : BAD_CARD_MESSAGE;
} else if (/\b(?:login denied|access denied|authorization denied|login not allowed|login rejected|not allowed to login)\b|تم رفض تسجيل الدخول/.test(t)) {
code = 'REJECTED'; message = hasPassword ? 'تعذر الدخول، تحقق من بيانات الكرت' : BAD_CARD_MESSAGE;
} else if (/[\u0600-\u06FF]/.test(text) && !/[A-Za-z]/.test(text)) {
code = 'SERVER_ARABIC'; message = 'تعذر تسجيل الدخول، تواصل مع الدعم';
} else {
/* A generic unknown Hotspot rejection is not proof of any specific limit.
   Do not replace known network errors with a bad-card message. */
message = 'تعذر تحديد سبب الرفض، تحقق من الكرت أو تواصل مع الدعم';
}
return { code:code, message:message,
confirmed:code !== 'UNKNOWN' && code !== 'REJECTED' && code !== 'NO_VALID_PROFILE' && code !== 'SERVER_ARABIC',
credentialFailure: code === 'USER_NOT_FOUND' || code === 'INVALID_USERNAME' || code === 'INVALID_CREDENTIALS' || code === 'INVALID_PASSWORD' };
}
function readableError(raw) { return classifyHotspotError(raw, !!cfg.passwordRequired).message; }
function showError(message) {
clearTimeout(errorTimer);
setText($error, message);
addClass($error, 'show');
if ($error) $error.setAttribute('role', 'alert');
errorTimer = setTimeout(function () { removeClass($error, 'show'); }, 8500);
}
function clearError() { clearTimeout(errorTimer); setText($error, ''); removeClass($error, 'show'); }
function showRedirectedLoginError() {
/* In normal captive-portal navigation, MikroTik may show the full-page login
   response rather than the AJAX response. Restore its original reason once. */
var key = 'najm_login_error_v1', store = safeSession(), saved = storageGet(store, key);
if (saved) storageRemove(store, key);
var query = w.location && w.location.search || '';
var match = /(?:^|[?&])hotspot_error=([^&]{1,1024})/.exec(query);
if (!saved && match) saved = match[1];
if (saved) showError(readableError(saved));
}
function loginOpen() {
if ($status) { $status.style.display = 'none'; removeClass($status, 'active'); }
if ($login) { $login.style.display = 'block'; removeClass($login, 'inactive'); }
}
function statusOpen() {
if ($status) { $status.style.display = 'block'; addClass($status, 'active'); }
if ($login) { $login.style.display = 'none'; addClass($login, 'inactive'); }
}
function finishLogin() {
clearTimeout(loginConfirmTimer); loginConfirmTimer = 0; loginConfirmCount = 0;
loginPending = false;
if ($submit) { $submit.disabled = false; removeClass($submit, 'processing'); }
}
function finishLogout() { logoutPending = false; if ($logout) $logout.disabled = false; }
function blockState() {
var raw = storageGet(safeSession(), BLOCK_STORE), state;
try { state = raw ? JSON.parse(raw) : {}; } catch (ignore) { state = {}; }
return { count: Math.max(0, Number(state.count) || 0), until: Math.max(0, Number(state.until) || 0) };
}
function storeBlock(state) { storageSet(safeSession(), BLOCK_STORE, JSON.stringify(state)); }
function unblock() {
var popup = el('block'); clearTimeout(blockTimer);
if (popup) { popup.style.display = 'none'; removeClass(popup, 'active'); }
if (!signedIn) loginOpen();
}
function blockTick() {
var state = blockState(), remaining = state.until - now(), popup = el('block');
clearTimeout(blockTimer);
if (remaining <= 0) { storeBlock({count:0,until:0}); unblock(); return; }
if (popup) { popup.style.display = 'block'; addClass(popup, 'active'); }
if ($login) $login.style.display = 'none';
var counter = d.querySelector('[count-down-span]'), seconds = Math.ceil(remaining / 1000);
setText(counter, Math.floor(seconds / 60) + ' دقيقة و ' + (seconds % 60) + ' ثانية');
blockTimer = setTimeout(blockTick, 1000);
}
function isBlocked() {
if (blockState().until > now()) { blockTick(); return true; }
return false;
}
function recordBadCredentials(raw) {
if (!classifyHotspotError(raw, !!cfg.passwordRequired).credentialFailure) return;
var state = blockState();
if (state.until <= now()) state.until = 0;
state.count++;
var blocker = d.querySelector('script[enable-hot-blocker]');
var limit = Math.max(1, parseInt(blocker && blocker.getAttribute('try-count'), 10) || 10);
var minutes = Math.max(1, parseInt(blocker && blocker.getAttribute('block-time'), 10) || 1);
if (state.count >= limit) state.until = now() + minutes * 60000;
storeBlock(state);
if (state.until > now()) blockTick();
}
function resetBadCredentials() { storeBlock({count:0,until:0}); unblock(); }
function parseCards(text) {
var list; try { list = JSON.parse(text); } catch (ignore) { return []; }
if (!list || Object.prototype.toString.call(list) !== '[object Array]') return [];
var out = [], seen = {};
for (var i = 0; i < list.length && out.length < 2; i++) {
var item = list[i], user = typeof item === 'string' ? item : item && item.username;
var pass = item && typeof item.password === 'string' ? item.password : '';
if (typeof user !== 'string' || !user || user.length > 64 || pass.length > 128 || seen['#'+user]) continue;
seen['#'+user] = true;
out.push({username:user,password:cfg.passwordRequired?pass:''});
}
return out;
}
function cookieValue(key) {
var rawCookie = '';
try { rawCookie = d.cookie || ''; } catch (ignore) { return null; }
var cookies = rawCookie ? rawCookie.split(';') : [], prefix = key + '=';
for (var i = 0; i < cookies.length; i++) {
var c = trim(cookies[i]); if (c.indexOf(prefix) !== 0) continue;
try { return decodeURIComponent(c.substring(prefix.length)); } catch (ignore) { return c.substring(prefix.length); }
}
return null;
}
function deleteLegacyCookie(key) { try { d.cookie = key + '=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax'; } catch (ignore) {} }
function saveCards() {
return storageSet(safeLocal(), STORE, JSON.stringify({savedAt:now(),cards:recentCards}));
}
function migrateCards() {
var migrated = parseCards(cookieValue('storedValues') || '[]');
migrated.reverse(); /* Old Najm cookie ordered oldest first. */
if (migrated.length) {
recentCards = migrated;
if (saveCards()) {
deleteLegacyCookie('storedValues');
deleteLegacyCookie('username');
}
}
}
function loadCards() {
var raw = storageGet(safeLocal(), STORE), stored;
try { stored = raw ? JSON.parse(raw) : null; } catch (ignore) { stored = null; }
if (stored && typeof stored.savedAt === 'number' && stored.savedAt <= now() && now() - stored.savedAt < HISTORY_TTL) {
recentCards = parseCards(JSON.stringify(stored.cards));
return;
}
if (raw) storageRemove(safeLocal(), STORE);
recentCards = []; migrateCards();
}
function rememberCard(user, pass) {
if (!user || user.length > 64) return;
loadCards();
var saved = [{username:user,password:cfg.passwordRequired ? pass : ''}];
for (var i = 0; i < recentCards.length && saved.length < 2; i++) {
if (recentCards[i].username !== user) saved.push(recentCards[i]);
}
recentCards = saved; saveCards();
}
function hidePopup(popup) {
if (popup) { removeClass(popup, 'active'); popup.style.display = 'none'; }
removeClass(d.body, 'previous-cards-visible');
if (signedIn) statusOpen(); else if (!isBlocked()) loginOpen();
}
function renderCards() {
loadCards();
var list = el('previousCardsList'), empty = el('previousCardsEmpty');
if (!list) return;
while (list.firstChild) list.removeChild(list.firstChild);
if (empty) {
empty.style.display = recentCards.length ? 'none' : 'block';
if (recentCards.length) removeClass(empty, 'show'); else addClass(empty, 'show');
}
for (var i = 0; i < recentCards.length; i++) (function (card) {
var button = d.createElement('button'); button.type = 'button';
button.className = 'previous-card-item';
setText(button, card.username);
button.addEventListener('click', function () {
if ($form) $form.username.value = card.username;
hidePopup(el('previous-cards'));
if ($form && $form.username && $form.username.focus) $form.username.focus();
}, false);
list.appendChild(button);
})(recentCards[i]);
}
function clearCards() {
recentCards = []; storageRemove(safeLocal(), STORE);
deleteLegacyCookie('storedValues'); deleteLegacyCookie('username');
renderCards();
}
function formatBytes(v) {
var s = trim(v);
if (!s || s === '---' || s.toLowerCase() === 'unlimited') return 'غير محدود';
var value = Number(s);
if (!isFinite(value) || value < 0) return 'غير متاح';
if (value < 1024) return value + ' بايت';
if (value < 1048576) return (value / 1024).toFixed(1) + ' كيلوبايت';
if (value < 1073741824) return (value / 1048576).toFixed(1) + ' ميجابايت';
return (value / 1073741824).toFixed(2) + ' جيجابايت';
}
function formatTime(v) {
var s = trim(v), parts, units = {w:'أسبوع', d:'يوم', h:'ساعة', m:'دقيقة', s:'ثانية'};
if (!s || s === '---' || s.toLowerCase() === 'unlimited') return 'غير محدود';
if (/^\d+(?::\d{1,2}){1,2}$/.test(s)) {
var a = s.split(':');
return a.length === 2 ? a[0] + ' دقيقة ' + a[1] + ' ثانية' : a[0] + ' ساعة ' + a[1] + ' دقيقة ' + a[2] + ' ثانية';
}
parts = []; var re = /(\d+)\s*([wdhms])/g, match;
while ((match = re.exec(s)) !== null) parts.push(match[1] + ' ' + units[match[2]]);
return parts.length ? parts.join(' ') : s;
}
function resetStatus() {
var ids = ['username','remain_bytes_total','session_time_left','uptime','bytes_in','bytes_out'];
for (var i = 0; i < ids.length; i++) setText(el(ids[i]), i === 0 || ids[i] === 'uptime' ? '---' : 'غير متاح');
}
function stopStatus() {
clearTimeout(statusTimer); statusTimer = 0;
if (statusRequest && statusRequest.abort && !statusRequest._portalComplete) { try { statusRequest.abort(); } catch (ignore) {} }
statusRequest = null;
}
function scheduleStatus() {
clearTimeout(statusTimer);
if (!signedIn || logoutPending) return;
var delay = earlyNegativeCount && now() - loginTimestamp < 15000 ? 1500 : (d.hidden ? 20000 : 8000);
statusTimer = setTimeout(function () {
if (!signedIn || logoutPending) return;
statusRequest = request('/status?var=callBack&t=' + now(), {kind:'status', next:scheduleStatus});
}, delay);
}
function startStatus() {
stopStatus();
if (signedIn && !logoutPending) statusRequest = request('/status?var=callBack&t=' + now(), {kind:'status', next:scheduleStatus});
}
function statusReply(response) {
statusFailures = 0;
if (!isLoggedIn(response.logged_in)) {
if (signedIn && loginTimestamp && now() - loginTimestamp < 15000 && ++earlyNegativeCount < 3) return;
var was = signedIn;
signedIn = false; stopStatus(); finishLogin(); finishLogout(); loginOpen(); resetStatus();
if (was) showError('انتهت الجلسة، سجل الدخول مجددا');
return;
}
signedIn = true; earlyNegativeCount = 0;
finishLogin(); finishLogout(); statusOpen();
var fields = ['username','remain_bytes_total','session_time_left','uptime','bytes_in','bytes_out'];
for (var i = 0; i < fields.length; i++) {
var key = fields[i], value = response[key]; if (value == null) continue;
if (key === 'username') setText(el(key), safeDecode(value));
else if (key === 'remain_bytes_total' || key === 'bytes_in' || key === 'bytes_out') setText(el(key), formatBytes(value));
else if (key === 'session_time_left' || key === 'uptime') setText(el(key), formatTime(value));
}
}
function loggedInReply(response) {
if (!isLoggedIn(response.logged_in)) { finishLogin(); showError('تعذر تأكيد الدخول، حاول مجددا'); return; }
var user = attemptUser, pass = attemptPass;
signedIn = true; loginTimestamp = now(); earlyNegativeCount = 0;
finishLogin(); finishLogout(); clearError(); resetBadCredentials();
if (user) rememberCard(user, pass);
attemptUser = ''; attemptPass = '';
statusOpen(); if (user) setText(el('username'), user);
startStatus();
}
function loginErrorReply(response) {
finishLogin(); loginOpen();
/* Prefer RouterOS' unmodified reason. errors.txt translations are only
   a fallback, since they can collapse multiple errors into one message. */
var original = trim(response.error_orig || '') || trim(response.error || '');
showError(readableError(original));
recordBadCredentials(original);
attemptUser = ''; attemptPass = '';
}
/* RouterOS can acknowledge /login before /status reflects an active session.
   Never falsely mark a card as rejected while the router is confirming it. */
function confirmLogin() {
if (!loginPending) return;
clearTimeout(loginConfirmTimer);
if (loginConfirmCount >= 4) {
finishLogin(); attemptUser = ''; attemptPass = '';
showError('لم يتم تأكيد الدخول من الراوتر، تحقق من حالة الكرت ثم حاول مجددا');
return;
}
loginConfirmCount++;
loginConfirmTimer = setTimeout(function () {
if (loginPending) request('/status?var=callBack&t=' + now(), {kind:'confirm'});
}, loginConfirmCount === 1 ? 400 : 950);
}
function loginStartReply(response) {
if (isLoggedIn(response.logged_in)) loggedInReply(response);
else if (loginPending) confirmLogin();
}
function loggedOutReply(response) {
if (isLoggedIn(response.logged_in)) { finishLogout(); showError('تعذر تسجيل الخروج، حاول مجددا'); startStatus(); return; }
signedIn = false; epoch++; stopStatus();
finishLogout(); finishLogin(); resetStatus(); loginOpen();
}
function dispatchByKind(kind, response) {
if (!response || typeof response !== 'object') return false;
if (kind === 'boot' || kind === 'status') {
if (response.action !== 'onStatusQuery') return false;
statusReply(response);
if (kind === 'boot' && signedIn && !logoutPending) scheduleStatus();
return true;
}
if (kind === 'confirm') {
if (response.action !== 'onStatusQuery') return false;
if (isLoggedIn(response.logged_in)) loggedInReply(response);
else confirmLogin();
return true;
}
if (kind === 'login') {
if (response.action === 'onLoggedIn') loggedInReply(response);
else if (response.action === 'onLoginError') loginErrorReply(response);
else if (response.action === 'onLoginStart') loginStartReply(response);
else return false;
return true;
}
if (kind === 'logout' && response.action === 'onLoggedOut') { loggedOutReply(response); return true; }
return false;
}
function request(url, options) {
options = options || {};
var xhr = new XMLHttpRequest(), completed = false, watchdog, requestEpoch = epoch;
function done(problem) {
if (completed) return;
completed = true; clearTimeout(watchdog);
try { xhr.onreadystatechange = null; xhr.onerror = null; } catch (ignore) {}
if (requestEpoch !== epoch) return;
if (problem) {
if (options.kind === 'login') {
finishLogin(); attemptUser = ''; attemptPass = '';
showError(problem === 'TIMEOUT' ? 'تأخر رد الراوتر، حاول مجددا' :
problem === 'NETWORK' ? 'انقطع الاتصال بالراوتر، حاول مجددا' :
problem === 'HTTP' ? 'تعذر الاتصال بالراوتر، حاول مجددا' :
'خطأ في استجابة الراوتر، تواصل مع الدعم');
} else if (options.kind === 'confirm') {
confirmLogin();
} else if (options.kind === 'logout') {
finishLogout(); showError('تعذر تسجيل الخروج، حاول مجددا');
} else if (options.kind === 'status') {
statusFailures++;
if (statusFailures === 3) showError('تعذر تحديث حالة الاتصال');
}
}
if (typeof options.next === 'function') options.next();
}
try {
xhr.open(options.method || 'GET', url, true);
if (options.method === 'POST') xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
watchdog = setTimeout(function () { if (completed) return; try { xhr.abort(); } catch (ignore) {} done('TIMEOUT'); }, 10000);
xhr.onreadystatechange = function () {
if (xhr.readyState !== 4 || completed || requestEpoch !== epoch) return;
if (xhr.status < 200 || xhr.status >= 300) { done('HTTP'); return; }
var data; try { data = JSON.parse(xhr.responseText.replace(/^\uFEFF/, '')); } catch (ignore) { done('INVALID_REPLY'); return; }
xhr._portalComplete = true;
try { if (!dispatchByKind(options.kind, data)) { done('INVALID_REPLY'); return; } } catch (ignore) { done('INVALID_REPLY'); return; }
done(false);
};
xhr.onerror = function () { done('NETWORK'); };
xhr.send(options.body || null);
} catch (ignore) { done('NETWORK'); }
return xhr;
}
function submit() {
if (loginPending || logoutPending || signedIn || isBlocked() || !$form) return false;
var userField = $form.username, passField = $form.password;
if (!userField) return false;
var user = normalize(userField.value, true), pass = cfg.passwordRequired ? normalize(passField && passField.value, false) : '';
userField.value = user;
if (passField && cfg.passwordRequired) passField.value = pass;
if (!user || user.length > 64 || (cfg.passwordRequired && (!pass || pass.length > 128)) || /[\x00-\x1F\x7F]/.test(user + pass)) {
showError(cfg.passwordRequired ? 'أدخل اسم المستخدم وكلمة المرور' : 'أدخل رقم الكرت أولا');
return false;
}
clearTimeout(loginConfirmTimer); loginConfirmCount = 0;
attemptUser = user; attemptPass = pass; loginPending = true;
epoch++;
if ($submit) { $submit.disabled = true; addClass($submit, 'processing'); }
clearError();
var body = 'username=' + encodeURIComponent(user);
if (cfg.passwordRequired) body += '&password=' + encodeURIComponent(pass);
request('/login?var=callBack', {kind:'login',method:'POST',body:body});
return false;
}
function logout() {
if (!signedIn || logoutPending) return;
logoutPending = true; epoch++; stopStatus();
if ($logout) $logout.disabled = true;
request('/logout?erase-cookie=true&var=callBack', {kind:'logout'});
}
function openPopup(target) {
if (!target) return;
if (target.id === 'previous-cards') renderCards();
target.style.display = 'block'; addClass(target, 'active');
if (target.id === 'previous-cards') addClass(d.body, 'previous-cards-visible');
if ($login) { $login.style.display = 'none'; addClass($login, 'inactive'); }
}
function setupPopups() {
var buttons = d.querySelectorAll('button[parent-id]');
for (var i = 0; i < buttons.length; i++) (function (button) {
var target = el(button.getAttribute('parent-id'));
if (!target) return;
button.addEventListener('click', function () { openPopup(target); }, false);
var backs = target.querySelectorAll('.app-logout');
for (var j = 0; j < backs.length; j++) backs[j].addEventListener('click', function () { hidePopup(target); }, false);
})(buttons[i]);
}
function renderDates() {
var date = new Date(), g = el('gregorianDate'), h = el('hijriDate');
function two(n) { return n < 10 ? '0' + n : String(n); }
setText(g, two(date.getDate()) + '/' + two(date.getMonth() + 1) + '/' + date.getFullYear());
try { if (w.Intl && w.Intl.DateTimeFormat) {
setText(h, new w.Intl.DateTimeFormat('ar-SA-u-ca-islamic', {day:'numeric',month:'numeric',year:'numeric'}).format(date));
}} catch (ignore) { setText(h, ''); }
}
function notice(id, show) {
var popup = el(id); if (!popup) return;
if (show) { addClass(popup, 'active'); popup.setAttribute('aria-hidden', 'false'); }
else { removeClass(popup, 'active'); popup.setAttribute('aria-hidden', 'true'); }
}
function friday() {
if (cfg.site !== 'najm' || (new Date()).getDay() !== 5) return;
var key = 'najm_friday_' + (new Date()).toDateString();
if (storageGet(safeSession(), key) === '1') return;
storageSet(safeSession(), key, '1'); notice('fridayNotice', true);
}
function closeWelcome() { clearTimeout(welcomeTimer); notice('welcomeNotice', false); friday(); }
function initWelcome() {
if (cfg.site !== 'najm') return;
var wbtn = el('welcomeContinueBtn'), fbtn = el('fridayContinueBtn');
if (wbtn) wbtn.addEventListener('click', closeWelcome, false);
if (fbtn) fbtn.addEventListener('click', function () { notice('fridayNotice', false); }, false);
d.addEventListener('keydown', function (e) {
if (e.key === 'Escape' || e.keyCode === 27) { closeWelcome(); notice('fridayNotice', false); }
}, false);
if (storageGet(safeSession(), 'najm_welcome_seen') === '1') { friday(); return; }
storageSet(safeSession(), 'najm_welcome_seen', '1');
welcomeTimer = setTimeout(function () { notice('welcomeNotice', true); welcomeTimer = setTimeout(closeWelcome, 2500); }, 500);
}
function simplifyOnOldDevices() {
var ua = (w.navigator && w.navigator.userAgent || ''), slow = /Android [23456](?:\.|;)/i.test(ua);
if (w.navigator && typeof w.navigator.hardwareConcurrency === 'number' && w.navigator.hardwareConcurrency <= 2) slow = true;
if (slow) addClass(d.documentElement, 'low-performance');
}
function initInput() {
var fields = $form ? [$form.username, cfg.passwordRequired ? $form.password : null] : [];
for (var i = 0; i < fields.length; i++) (function (input, isUsername) {
if (!input) return;
function normalise() { var val = normalize(input.value, isUsername); if (input.value !== val) input.value = val; }
input.addEventListener('input', normalise, false);
input.addEventListener('compositionend', normalise, false);
})(fields[i], i === 0);
}
function init() {
$login = el('login'); $status = el('status'); $form = d.forms.login;
$submit = d.querySelector('.login-submit'); $logout = d.querySelector('.logout-submit'); $error = el('error');
simplifyOnOldDevices(); renderDates(); resetStatus();
setupPopups(); initInput(); renderCards(); initWelcome();
showRedirectedLoginError();
if ($form) $form.addEventListener('submit', function (event) {
if (event.preventDefault) event.preventDefault(); else event.returnValue = false;
submit();
}, false);
if ($logout) $logout.addEventListener('click', logout, false);
var clearHistory = el('clearPreviousCards');
if (clearHistory) clearHistory.addEventListener('click', clearCards, false);
d.addEventListener('visibilitychange', function () { if (signedIn && !logoutPending) scheduleStatus(); }, false);
isBlocked();
request('/status?var=callBack&t=' + now(), {kind:'boot'});
}
w.PortalDiagnostics = { isLoggedIn:isLoggedIn, normalize:normalize, readableError:readableError, classifyHotspotError:classifyHotspotError };
ready(init);
})(window, document);
