'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root,name), 'utf8');
function diagnostics() {
 const document = {readyState:'loading', addEventListener() {}};
 const window = {PORTAL_CONFIG:{site:'najm', passwordRequired:false}, navigator:{userAgent:'Android 5'}};
 vm.runInNewContext(read('js/portal.core.js'),{document,window,XMLHttpRequest:function(){}, setTimeout,clearTimeout});
 return window.PortalDiagnostics;
}
const diag = diagnostics();
test('all scripts are syntactically valid', () => {
 for (const file of ['js/portal.core.js','js/cam.najm.js']) assert.doesNotThrow(()=>new vm.Script(read(file)));
});
test('numbers and whitespace normalize without corrupting ID', () => {
 assert.equal(diag.normalize(' ١٢۳۴ ٥٦\u200b ',true),'123456');
 assert.equal(diag.normalize('١٢ ٣',false),'12 3');
});
const cases = [
 ['not enough credit','NO_CREDIT','انتهى رصيد الكرت'],
 ['transfer limit reached','DATA_LIMIT','انتهى رصيد الكرت'],
 ['reached the online time limit','TIME_LIMIT','انتهى وقت الكرت'],
 ['account has expired','EXPIRED','انتهت صلاحية الكرت'],
 ['no more sessions are allowed','SESSION_LIMIT','الكرت مستخدم على جهاز آخر'],
 ['not allowed to log in from this mac','DEVICE_RESTRICTION','هذا الكرت غير مسموح على هذا الجهاز'],
 ['account disabled','DISABLED','الكرت موقوف'],
 ['radius server no reply','AUTH_SERVER_UNAVAILABLE','خادم الشبكة لا يستجيب، حاول لاحقا'],
 ['no response from radius server','AUTH_SERVER_UNAVAILABLE','خادم الشبكة لا يستجيب، حاول لاحقا'],
 ['web browser did not send challenge response','AUTH_METHOD','خطأ في نظام الدخول، تواصل مع الدعم'],
 ['user not found','USER_NOT_FOUND','الكرت خطأ، حاول بكرت آخر'],
 ['no valid profile found','NO_VALID_PROFILE','الكرت خطأ، حاول بكرت آخر']
];
for (const [source,code,message] of cases) test('RouterOS error: '+source,()=>{
 const result=diag.classifyHotspotError(source,false);
 assert.equal(result.code,code);
 assert.equal(result.message,message);
});
test('encoded router errors decode before mapping',()=>{
 assert.equal(diag.classifyHotspotError('no+more+sessions+are+allowed',false).code,'SESSION_LIMIT');
 assert.equal(diag.classifyHotspotError('RADIUS%3A+no+reply',false).code,'AUTH_SERVER_UNAVAILABLE');
});
test('unknown messages never impersonate expired cards',()=>{
 const r=diag.classifyHotspotError('unknown radius condition x1',false);
 assert.equal(r.code,'UNKNOWN');
 assert.ok(!r.message.includes('انتهى'));
});
test('credentials and server errors have separate local blocker classification',()=>{
 assert.equal(diag.classifyHotspotError('invalid username or password',false).credentialFailure,true);
 assert.equal(diag.classifyHotspotError('radius server no reply',false).credentialFailure,false);
});
test('essential HTML, stylesheet and camera assets are present',()=>{
 const html=read('index.html');
 for (const fragment of ['name="login"','name="username"','class="login-submit','id="startCameraBtn"','id="previous-cards"','id="status"','id="error"','js/cam.najm.js','css/style.css','img/najm-logo.webp']) assert.ok(html.includes(fragment), fragment);
 for (const asset of ['js/cam.najm.js','css/style.css','img/najm-logo.webp','font/Almarai.woff2','font/fontello-used.woff']) assert.ok(fs.statSync(path.join(root,asset)).size>0);
 for (const htmlFile of ['login.html','flogin.html','status.html','logout.html','fstatus.html','alogin.html','flogout.html']) assert.ok(read(htmlFile).includes('$(if var == "")'),htmlFile);
});
test('legacy CSS has static color fallback and no :has selector',()=>{
 const css=read('css/style.css');
 assert.ok(/background:\s*#[0-9A-F]{6};background:var\(--page-bg\)/i.test(css));
 assert.ok(/background:\s*#[0-9A-F]{6};background:var\(--edge\)/i.test(css));
 assert.ok(!css.includes(':has('));
});
test('portal initializes even when captive browser denies cookie access',()=>{
 const handlers={};
 const d={readyState:'loading',forms:{},documentElement:{className:''},body:{className:''},
  addEventListener(name,cb){handlers[name]=cb;}, getElementById(){return null;},
  querySelector(){return null;}, querySelectorAll(){return [];}};
 Object.defineProperty(d,'cookie',{get(){throw Error('Access is denied');},set(){throw Error('Access is denied');}});
 const w={PORTAL_CONFIG:{site:'najm',passwordRequired:false},navigator:{userAgent:'Android 5'},location:{search:''}};
 function XHR(){this.open=()=>{};this.send=()=>{};this.setRequestHeader=()=>{};this.abort=()=>{};}
 vm.runInNewContext(read('js/portal.core.js'),{document:d,window:w,XMLHttpRequest:XHR,setTimeout:()=>1,clearTimeout:()=>{}});
 assert.equal(typeof handlers.DOMContentLoaded,'function');
 assert.doesNotThrow(()=>handlers.DOMContentLoaded());
});


test('generic RADIUS rejection is not reported as an invalid or expired card', () => {
 const rejected=diag.classifyHotspotError('RADIUS: Access-Reject',false);
 assert.equal(rejected.code,'AUTH_REJECTED');
 assert.equal(rejected.credentialFailure,false);
 assert.match(rejected.message,/رفض الخادم/);
 assert.equal(diag.classifyHotspotError('authentication failed',false).code,'AUTH_REJECTED');
 assert.equal(diag.classifyHotspotError('invalid username or password',false).code,'INVALID_CREDENTIALS');
});
test('missing usage statistics are not misrepresented as unlimited', () => {
 assert.equal(diag.formatBytes(''),'غير متاح');
 assert.equal(diag.formatTime(''),'غير متاح');
 assert.equal(diag.formatBytes('---'),'غير متاح');
 assert.equal(diag.formatTime('unlimited'),'غير محدود');
 assert.equal(diag.formatBytes('0'),'0 بايت');
});
test('standalone HotSpot pages keep native status and safe errors', () => {
 const status=read('status.html');
 assert.ok(status.includes('$(link-logout)?erase-cookie=true'));
 assert.ok(status.includes('$(link-status)'));
 assert.ok(read('alogin.html').includes('url=$(link-status)'));
 for(const name of ['login.html','flogin.html']) {
  const source=read(name);
  assert.ok(source.includes('تعذر تسجيل الدخول. تحقق من الكرت'));
  assert.ok(!source.includes('الكرت خطأ، حاول بكرت آخر</p>'));
 }
 assert.equal(read('js/cam.najm.js'),fs.readFileSync(path.join(root,'js/cam.najm.js'),'utf8'));
});
function simulation(AjaxClass) {
 const handlers={};
 const error={className:'',textContent:'',setAttribute(){}};
 const input={value:' ١٢٣٤  ',addEventListener(){}};
 const form={username:input,addEventListener(type,fn){handlers['form:'+type]=fn;}};
 const submit={className:'',disabled:false};
 const document={readyState:'complete',forms:{login:form},body:{className:''},documentElement:{className:''},hidden:false,
  getElementById(id){if(id==='error')return error; if(id==='login')return {className:'',style:{}}; return null;},
  querySelector(sel){if(sel==='.login-submit')return submit; return null;},querySelectorAll(){return [];},addEventListener(){},cookie:''};
 const store={}; const storage={getItem(k){return store[k]||null;},setItem(k,v){store[k]=v;},removeItem(k){delete store[k];}};
 const window={PORTAL_CONFIG:{site:'najm',passwordRequired:false},navigator:{userAgent:'Android 5'},location:{search:''},sessionStorage:storage,localStorage:storage};
 const env={document,window,setTimeout,clearTimeout};
 if(AjaxClass)env.XMLHttpRequest=AjaxClass;
 vm.runInNewContext(read('js/portal.core.js'),env);
 return {handlers,form,input,error,store,window,submit};
}
test('older browser without XMLHttpRequest keeps native form submission available', () => {
 const ui=simulation(null);
 let prevented=false;
 ui.handlers['form:submit']({preventDefault(){prevented=true;}});
 assert.equal(prevented,false);
 assert.equal(ui.input.value,'1234');
});
test('HTTP 403 with structured HotSpot rejection displays true server reason', () => {
 function XHR(){this.readyState=0;this.status=200;this.responseText='';}
 XHR.prototype.open=function(method,url){this.url=url;};
 XHR.prototype.send=function(){
  this.status=this.url.indexOf('/login')===0?403:200;
  this.responseText=this.status===403?JSON.stringify({action:'onLoginError',logged_in:'no',error_orig:'RADIUS: Access-Reject'}):JSON.stringify({action:'onStatusQuery',logged_in:'no'});
  this.readyState=4; if(this.onreadystatechange)this.onreadystatechange();
 };
 XHR.prototype.setRequestHeader=function(){};
 const ui=simulation(XHR);
 let prevented=false;
 ui.handlers['form:submit']({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);
 assert.match(ui.error.textContent,/رفض الخادم/);
 assert.ok(!ui.error.textContent.includes('الاتصال بالراوتر'));
 assert.equal(ui.submit.disabled,false);
});
