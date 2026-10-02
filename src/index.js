import webpush from 'web-push';
import { CHABURAS, CURRENT_ZMAN } from './chaburas.js';

const SESSION_COOKIE='scp_ann_session';
const SESSION_DAYS=30;
const OTP_MINUTES=10;
const CHABURA_KEYS=new Set(CHABURAS.map(item=>item.region+'\u0000'+item.name));
let schemaReady=false;

function text(value,max=500){const s=String(value??'').trim();return s?s.slice(0,max):null}
function email(value){const s=String(value??'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:null}
function json(data,init={}){const headers=new Headers(init.headers||{});headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');return new Response(JSON.stringify(data),{...init,headers})}
function html(body,init={}){const headers=new Headers(init.headers||{});headers.set('Content-Type','text/html; charset=utf-8');headers.set('Cache-Control','no-store');return new Response(body,{...init,headers})}
function nowIso(){return new Date().toISOString()}
function randomToken(bytes=32){const values=new Uint8Array(bytes);crypto.getRandomValues(values);return btoa(String.fromCharCode(...values)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function randomCode(){const values=new Uint32Array(1);crypto.getRandomValues(values);return String(values[0]%1000000).padStart(6,'0')}
async function sha256(value){const bytes=new TextEncoder().encode(String(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function hmacHex(key,value){const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(value));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function cookies(request){const out={};for(const part of (request.headers.get('Cookie')||'').split(';')){const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim())}return out}
function cookieHeader(token,maxAge){return SESSION_COOKIE+'='+encodeURIComponent(token||'')+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge}
function sameOrigin(request){const origin=request.headers.get('Origin');return !origin||origin===new URL(request.url).origin}
function emailConfigStatus(env){
  const bootstrapConfigured=!!email(env.BOOTSTRAP_ADMIN_EMAIL);
  const emailFromConfigured=!!text(env.EMAIL_FROM,320);
  const resendConfigured=!!text(env.RESEND_API_KEY,500);
  const emailBindingConfigured=!!(env.EMAIL&&typeof env.EMAIL.send==='function');
  const provider=emailBindingConfigured?'cloudflare-email':(resendConfigured?'resend':null);
  const missing=[];
  if(!emailFromConfigured)missing.push('EMAIL_FROM');
  if(!provider)missing.push('RESEND_API_KEY or EMAIL binding');
  return{bootstrapConfigured,emailFromConfigured,resendConfigured,emailBindingConfigured,provider,emailConfigured:emailFromConfigured&&!!provider,missing};
}
function resendErrorMessage(raw,status){
  try{
    const parsed=JSON.parse(raw);
    return text(parsed?.message||parsed?.error||parsed?.name,500)||('HTTP '+status);
  }catch(_){return text(raw,500)||('HTTP '+status)}
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function safeHttpUrl(value){try{const u=new URL(String(value));return ['http:','https:'].includes(u.protocol)?u.href:null}catch(_){return null}}

function sanitizeRichHtml(value){
  const source=String(value??'').slice(0,50000),tokens=source.match(/<[^>]*>|[^<]+|</g)||[],allowed=new Set(['p','br','strong','b','em','i','u','ul','ol','li','a']);
  let out='';
  for(const token of tokens){
    if(!token.startsWith('<')){out+=escapeHtml(token);continue}
    if(token==='<' ){out+='&lt;';continue}
    const close=token.match(/^<\s*\/\s*([a-z0-9]+)[^>]*>$/i);
    if(close){let tag=close[1].toLowerCase();if(tag==='div')tag='p';if(allowed.has(tag)&&tag!=='br')out+='</'+tag+'>';continue}
    const open=token.match(/^<\s*([a-z0-9]+)([^>]*)>$/i);if(!open)continue;
    let tag=open[1].toLowerCase();if(tag==='div')tag='p';if(!allowed.has(tag))continue;
    if(tag==='br'){out+='<br>';continue}
    if(tag==='a'){
      const hrefMatch=open[2].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),href=safeHttpUrl(hrefMatch?.[1]||hrefMatch?.[2]||hrefMatch?.[3]||'');
      if(href)out+='<a href="'+escapeHtml(href)+'" target="_blank" rel="noopener">';else out+='<span>';
      continue;
    }
    out+='<'+tag+'>';
  }
  return out.slice(0,45000);
}
function richToPlain(value){
  return String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p\s*>/gi,'\n').replace(/<li\b[^>]*>/gi,'• ').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\n{3,}/g,'\n\n').trim();
}

async function runBatch(env,statements,size=60){for(let i=0;i<statements.length;i+=size)await env.DB.batch(statements.slice(i,i+size))}
async function ensureSchema(env){
  if(schemaReady)return;
  const sql=[
    "CREATE TABLE IF NOT EXISTS announcement_config (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS announcement_users (email TEXT PRIMARY KEY COLLATE NOCASE,display_name TEXT,role TEXT NOT NULL DEFAULT 'sender',allow_chabura_announcements INTEGER NOT NULL DEFAULT 0,allow_chabura_polls INTEGER NOT NULL DEFAULT 0,allow_broadcasts INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login_at TEXT)",
    "CREATE TABLE IF NOT EXISTS announcement_user_chaburos (email TEXT NOT NULL COLLATE NOCASE,zman TEXT NOT NULL,region TEXT NOT NULL,chabura TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(email,zman,region,chabura))",
    "CREATE TABLE IF NOT EXISTS announcement_otp_codes (email TEXT PRIMARY KEY COLLATE NOCASE,code_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,requested_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS announcement_sessions (token_hash TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,last_seen_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_announcement_sessions_email ON announcement_sessions(email,expires_at)",
    "CREATE TABLE IF NOT EXISTS announcement_messages (id TEXT PRIMARY KEY,created_by_email TEXT NOT NULL,kind TEXT NOT NULL,audience_type TEXT NOT NULL,zman TEXT,region TEXT,chabura TEXT,title TEXT NOT NULL,body_text TEXT NOT NULL,body_html TEXT, poll_id TEXT,recipient_count INTEGER NOT NULL DEFAULT 0,push_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_announcement_messages_created ON announcement_messages(created_at DESC)",
    "CREATE TABLE IF NOT EXISTS announcement_polls (id TEXT PRIMARY KEY,message_id TEXT NOT NULL,title TEXT NOT NULL,body_html TEXT,created_by_email TEXT NOT NULL,created_at TEXT NOT NULL,closes_at TEXT)",
    "CREATE TABLE IF NOT EXISTS announcement_poll_options (poll_id TEXT NOT NULL,option_id TEXT NOT NULL,label TEXT NOT NULL,sort_order INTEGER NOT NULL,PRIMARY KEY(poll_id,option_id))",
    "CREATE TABLE IF NOT EXISTS announcement_poll_invites (token_hash TEXT PRIMARY KEY,poll_id TEXT NOT NULL,installation_hash TEXT NOT NULL,created_at TEXT NOT NULL,voted_at TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_poll_invites_poll ON announcement_poll_invites(poll_id)",
    "CREATE TABLE IF NOT EXISTS announcement_poll_votes (poll_id TEXT NOT NULL,invite_hash TEXT NOT NULL,option_id TEXT NOT NULL,voted_at TEXT NOT NULL,PRIMARY KEY(poll_id,invite_hash))",
    "CREATE TABLE IF NOT EXISTS announcement_feedback_invites (token_hash TEXT PRIMARY KEY,message_id TEXT NOT NULL,installation_hash TEXT NOT NULL,created_at TEXT NOT NULL,responded_at TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_feedback_invites_message ON announcement_feedback_invites(message_id)",
    "CREATE TABLE IF NOT EXISTS announcement_feedback_responses (id TEXT PRIMARY KEY,message_id TEXT NOT NULL,invite_hash TEXT NOT NULL UNIQUE,body_text TEXT NOT NULL,body_html TEXT NOT NULL,created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_feedback_responses_message ON announcement_feedback_responses(message_id,created_at)",
    "CREATE TABLE IF NOT EXISTS announcement_feedback_attachments (id TEXT PRIMARY KEY,response_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,filename TEXT NOT NULL,content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_feedback_attachments_response ON announcement_feedback_attachments(response_id)",
    "CREATE TABLE IF NOT EXISTS notification_state (notification_id TEXT NOT NULL,installation_id TEXT NOT NULL,read_at TEXT,archived_at TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(notification_id,installation_id))",
    "CREATE TABLE IF NOT EXISTS app_notifications (id TEXT PRIMARY KEY,kind TEXT NOT NULL,zman TEXT,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT,target_installation_id TEXT,content_type TEXT,content_id TEXT,body_html TEXT,action_json TEXT,dedupe_key TEXT UNIQUE)",
    "CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL,subject TEXT NOT NULL,created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY,installation_id TEXT NOT NULL,zman TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,timezone TEXT NOT NULL,reminder_enabled INTEGER NOT NULL DEFAULT 0,reminder_time TEXT,israel_calendar INTEGER NOT NULL DEFAULT 0,last_reminder_local_date TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)"
  ];
  for(const statement of sql)await env.DB.prepare(statement).run();
  try{await env.DB.prepare("ALTER TABLE app_notifications ADD COLUMN body_html TEXT").run()}catch(error){if(!/duplicate column/i.test(String(error?.message||error)))throw error}
  schemaReady=true;
}
async function configSecret(env,key){
  await ensureSchema(env);let row=await env.DB.prepare("SELECT value FROM announcement_config WHERE key=?").bind(key).first();if(row?.value)return row.value;
  const value=randomToken(32);await env.DB.prepare("INSERT OR IGNORE INTO announcement_config(key,value,updated_at) VALUES(?,?,?)").bind(key,value,nowIso()).run();
  row=await env.DB.prepare("SELECT value FROM announcement_config WHERE key=?").bind(key).first();return row.value;
}
async function bootstrapAdmin(env){
  const bootstrap=email(env.BOOTSTRAP_ADMIN_EMAIL);if(!bootstrap)return;
  const count=await env.DB.prepare("SELECT COUNT(*) n FROM announcement_users").first();if(Number(count?.n||0)>0)return;
  const now=nowIso();await env.DB.prepare("INSERT OR IGNORE INTO announcement_users(email,display_name,role,allow_chabura_announcements,allow_chabura_polls,allow_broadcasts,active,created_at,updated_at) VALUES(?,?, 'admin',1,1,1,1,?,?)").bind(bootstrap,bootstrap,now,now).run();
}
async function setup(env){await ensureSchema(env);await bootstrapAdmin(env)}

async function sessionUser(request,env){
  const token=cookies(request)[SESSION_COOKIE];if(!token)return null;const hash=await sha256(token),now=nowIso();
  const row=await env.DB.prepare("SELECT u.*,s.expires_at FROM announcement_sessions s JOIN announcement_users u ON u.email=s.email WHERE s.token_hash=? AND s.expires_at>? AND u.active=1").bind(hash,now).first();
  if(!row)return null;
  env.DB.prepare("UPDATE announcement_sessions SET last_seen_at=? WHERE token_hash=?").bind(now,hash).run().catch(()=>{});
  const assignments=(await env.DB.prepare("SELECT region,chabura FROM announcement_user_chaburos WHERE email=? AND zman=? ORDER BY region,chabura").bind(row.email,CURRENT_ZMAN).all()).results||[];
  return{email:row.email,displayName:row.display_name||row.email,isAdmin:row.role==='admin',allowChaburaAnnouncements:!!row.allow_chabura_announcements,allowChaburaPolls:!!row.allow_chabura_polls,allowBroadcasts:!!row.allow_broadcasts,chaburas:assignments};
}
function publicUser(user){return user}
async function requireUser(request,env){const user=await sessionUser(request,env);if(!user)throw Object.assign(new Error('Sign in required'),{status:401});return user}
async function requireAdmin(request,env){const user=await requireUser(request,env);if(!user.isAdmin)throw Object.assign(new Error('Administrator access required'),{status:403});return user}

async function sendEmail(env,{to,subject,textBody,htmlBody}){
  const config=emailConfigStatus(env),from=text(env.EMAIL_FROM,320);
  if(!config.emailConfigured)throw new Error('Email delivery is not configured: missing '+config.missing.join(', '));
  if(config.emailBindingConfigured){
    try{await env.EMAIL.send({to,from,subject,text:textBody,html:htmlBody});return}
    catch(error){console.error('Cloudflare Email Service send failed',{message:String(error?.message||error)});throw error}
  }
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,text:textBody,html:htmlBody})});
  if(!response.ok){
    const raw=await response.text(),detail=resendErrorMessage(raw,response.status);
    console.error('Resend send failed',{status:response.status,detail});
    throw new Error('Resend rejected the email ('+response.status+'): '+detail);
  }
}
async function sendOtp(env,to,code){await sendEmail(env,{to,subject:'Your SCP Announcements sign-in code',textBody:'Your verification code is '+code+'. It expires in '+OTP_MINUTES+' minutes.',htmlBody:'<p>Your SCP Announcements verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">'+code+'</p><p>It expires in '+OTP_MINUTES+' minutes.</p>'})}
async function sendInvite(env,to,origin){await sendEmail(env,{to,subject:'You can now send SCP Study messages',textBody:'Your SCP Study Announcements account is ready. Sign in at '+origin+' using the verification code sent to your email.',htmlBody:'<p>Your SCP Study Announcements account is ready.</p><p><a href="'+escapeHtml(origin)+'">Open SCP Announcements</a> and sign in with the verification code sent to your email.</p>'})}

async function requestCode(request,env){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});let body;try{body=await request.json()}catch(_){return json({error:'Invalid JSON'},{status:400})}
  const config=emailConfigStatus(env);
  if(!config.emailConfigured)return json({error:'Email delivery is not configured: missing '+config.missing.join(', ')},{status:503});
  const addr=email(body?.email);if(!addr)return json({ok:true});
  const user=await env.DB.prepare("SELECT active FROM announcement_users WHERE email=?").bind(addr).first();if(!user?.active)return json({ok:true});
  const existing=await env.DB.prepare("SELECT requested_at FROM announcement_otp_codes WHERE email=?").bind(addr).first();
  if(existing?.requested_at&&Date.now()-Date.parse(existing.requested_at)<60000)return json({error:'Please wait a minute before requesting another code.'},{status:429});
  const code=randomCode(),pepper=await configSecret(env,'otp_pepper'),hash=await hmacHex(pepper,addr+'|'+code),now=new Date(),expires=new Date(now.getTime()+OTP_MINUTES*60000).toISOString();
  await env.DB.prepare("INSERT INTO announcement_otp_codes(email,code_hash,expires_at,attempts,requested_at) VALUES(?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,requested_at=excluded.requested_at").bind(addr,hash,expires,now.toISOString()).run();
  try{await sendOtp(env,addr,code)}catch(error){await env.DB.prepare("DELETE FROM announcement_otp_codes WHERE email=?").bind(addr).run();return json({error:error.message},{status:503})}
  return json({ok:true});
}
async function verifyCode(request,env){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});let body;try{body=await request.json()}catch(_){return json({error:'Invalid JSON'},{status:400})}
  const addr=email(body?.email),code=String(body?.code||'').trim();if(!addr||!/^[0-9]{6}$/.test(code))return json({error:'Invalid verification code'},{status:400});
  const row=await env.DB.prepare("SELECT * FROM announcement_otp_codes WHERE email=?").bind(addr).first();if(!row||Date.parse(row.expires_at)<=Date.now()||Number(row.attempts)>=5)return json({error:'That code is invalid or expired.'},{status:400});
  const pepper=await configSecret(env,'otp_pepper'),hash=await hmacHex(pepper,addr+'|'+code);
  if(hash!==row.code_hash){await env.DB.prepare("UPDATE announcement_otp_codes SET attempts=attempts+1 WHERE email=?").bind(addr).run();return json({error:'That code is invalid or expired.'},{status:400})}
  const user=await env.DB.prepare("SELECT active FROM announcement_users WHERE email=?").bind(addr).first();if(!user?.active)return json({error:'Account is disabled.'},{status:403});
  await env.DB.prepare("DELETE FROM announcement_otp_codes WHERE email=?").bind(addr).run();
  const token=randomToken(32),tokenHash=await sha256(token),now=new Date(),expires=new Date(now.getTime()+SESSION_DAYS*86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO announcement_sessions(token_hash,email,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?)").bind(tokenHash,addr,expires,now.toISOString(),now.toISOString()),
    env.DB.prepare("UPDATE announcement_users SET last_login_at=?,updated_at=? WHERE email=?").bind(now.toISOString(),now.toISOString(),addr)
  ]);
  return json({ok:true},{headers:{'Set-Cookie':cookieHeader(token,SESSION_DAYS*86400)}});
}
async function logout(request,env){
  const token=cookies(request)[SESSION_COOKIE];if(token){const hash=await sha256(token);await env.DB.prepare("DELETE FROM announcement_sessions WHERE token_hash=?").bind(hash).run()}
  return json({ok:true},{headers:{'Set-Cookie':cookieHeader('',0)}});
}

function assignmentAllowed(user,region,chabura){return user.isAdmin||user.chaburas.some(item=>item.region===region&&item.chabura===chabura)}
function permissionAllowed(user,kind,audienceType,region,chabura){
  if(user.isAdmin)return true;
  if(audienceType==='broadcast')return user.allowBroadcasts;
  if(audienceType!=='chabura'||!assignmentAllowed(user,region,chabura))return false;
  return kind==='poll'?user.allowChaburaPolls:user.allowChaburaAnnouncements;
}
function stripProfileId(value){const s=String(value||''),i=s.indexOf('::');return i>=0?s.slice(i+2):s}
async function recipientIds(env,audienceType,region,chabura,zman){
  const ids=new Set();
  if(audienceType==='chabura'){
    const [profiles,events]=await Promise.all([
      env.DB.prepare("SELECT installation_id FROM learner_profiles WHERE cohort=? AND chabura_region=? AND chabura=?").bind(zman,region,chabura).all(),
      env.DB.prepare("SELECT DISTINCT installation_id FROM events WHERE cohort=? AND chabura_region=? AND chabura=?").bind(zman,region,chabura).all()
    ]);
    for(const row of profiles.results||[])if(stripProfileId(row.installation_id))ids.add(stripProfileId(row.installation_id));
    for(const row of events.results||[])if(row.installation_id)ids.add(String(row.installation_id));
    return [...ids];
  }
  const queries=[
    env.DB.prepare("SELECT DISTINCT installation_id FROM push_subscriptions").all(),
    env.DB.prepare("SELECT DISTINCT installation_id FROM events").all(),
    env.DB.prepare("SELECT DISTINCT installation_id FROM learner_profiles").all()
  ];
  const rows=await Promise.all(queries);
  for(const result of rows)for(const row of result.results||[]){const id=stripProfileId(row.installation_id);if(id)ids.add(id)}
  return [...ids];
}
async function pushRows(env,ids=null,zman=null){
  let rows=(await env.DB.prepare("SELECT endpoint,installation_id,zman,p256dh,auth FROM push_subscriptions").all()).results||[];
  if(zman)rows=rows.filter(row=>row.zman===zman);
  if(ids){const set=new Set(ids);rows=rows.filter(row=>set.has(String(row.installation_id)))}
  return rows;
}
async function audienceCount(env,audienceType,region,chabura,zman){
  const ids=await recipientIds(env,audienceType,region,chabura,zman),push=await pushRows(env,audienceType==='broadcast'?null:ids,audienceType==='broadcast'?null:zman),enabled=new Set(push.map(row=>String(row.installation_id)));
  return{ids,push,students:ids.length,pushEnabled:enabled.size};
}
async function vapid(env){
  let row=await env.DB.prepare("SELECT public_key,private_key,subject FROM push_config WHERE id=1").first();
  if(!row){const keys=webpush.generateVAPIDKeys(),subject='https://scp-study.ksariash.workers.dev';await env.DB.prepare("INSERT OR IGNORE INTO push_config(id,public_key,private_key,subject,created_at) VALUES(1,?,?,?,?)").bind(keys.publicKey,keys.privateKey,subject,nowIso()).run();row=await env.DB.prepare("SELECT public_key,private_key,subject FROM push_config WHERE id=1").first()}
  return row;
}
async function sendPush(env,row,payload){
  const config=await vapid(env);webpush.setVapidDetails(config.subject,config.public_key,config.private_key);
  try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload),{TTL:86400});return true}
  catch(error){const status=error instanceof webpush.WebPushError?error.statusCode:Number(error?.statusCode||0);if(status===404||status===410)await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").bind(row.endpoint).run();return false}
}
async function pushMany(env,rows,payloadFor){
  for(let i=0;i<rows.length;i+=40)await Promise.allSettled(rows.slice(i,i+40).map(row=>sendPush(env,row,payloadFor(row))));
}
function pushBody(textValue){const s=String(textValue||'').replace(/\s+/g,' ').trim();return s.length>180?s.slice(0,177)+'…':s}

async function audienceCountRoute(request,env,user){
  const url=new URL(request.url),audienceType=url.searchParams.get('audienceType')||'',kind=url.searchParams.get('type')==='poll'?'poll':'announcement',region=text(url.searchParams.get('region'),120),chabura=text(url.searchParams.get('chabura'),180),zman=env.CURRENT_ZMAN||CURRENT_ZMAN;
  if(!permissionAllowed(user,kind,audienceType,region,chabura))return json({error:'You do not have permission for that audience.'},{status:403});
  const count=await audienceCount(env,audienceType,region,chabura,zman);return json({students:count.students,pushEnabled:count.pushEnabled});
}

async function createMessage(request,env,user){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});let body;try{body=await request.json()}catch(_){return json({error:'Invalid JSON'},{status:400})}
  const requestedKind=String(body?.kind||'announcement'),kind=['poll','feedback_request'].includes(requestedKind)?requestedKind:'announcement',audienceType=body?.audienceType==='broadcast'?'broadcast':'chabura',region=text(body?.region,120),chabura=text(body?.chabura,180),title=text(body?.title,120),zman=env.CURRENT_ZMAN||CURRENT_ZMAN;
  if(!title)return json({error:'Title is required.'},{status:400});
  if(!permissionAllowed(user,kind,audienceType,region,chabura))return json({error:'You do not have permission for that audience.'},{status:403});
  if(audienceType==='chabura'&&!CHABURA_KEYS.has(String(region)+'\u0000'+String(chabura)))return json({error:'Unknown chabura.'},{status:400});
  const bodyHtml=sanitizeRichHtml(body?.bodyHtml),bodyText=text(richToPlain(bodyHtml),5000);if(!bodyText)return json({error:'Message body is required.'},{status:400});
  const pollOptions=Array.isArray(body?.pollOptions)?[...new Set(body.pollOptions.map(item=>text(item,180)).filter(Boolean))].slice(0,8):[];
  if(kind==='poll'&&pollOptions.length<2)return json({error:'Polls need at least two options.'},{status:400});
  const count=await audienceCount(env,audienceType,region,chabura,zman),messageId=crypto.randomUUID(),pollId=kind==='poll'?crypto.randomUUID():null,created=nowIso();
  const audienceLabel=audienceType==='broadcast'?'All SCP students':chabura+' · '+region;
  const messageStmt=env.DB.prepare("INSERT INTO announcement_messages(id,created_by_email,kind,audience_type,zman,region,chabura,title,body_text,body_html,poll_id,recipient_count,push_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(messageId,user.email,kind,audienceType,audienceType==='broadcast'?null:zman,region,chabura,title,bodyText,bodyHtml,pollId,count.students,count.pushEnabled,created);
  const statements=[messageStmt];
  if(pollId){
    statements.push(env.DB.prepare("INSERT INTO announcement_polls(id,message_id,title,body_html,created_by_email,created_at) VALUES(?,?,?,?,?,?)").bind(pollId,messageId,title,bodyHtml,user.email,created));
    pollOptions.forEach((label,index)=>statements.push(env.DB.prepare("INSERT INTO announcement_poll_options(poll_id,option_id,label,sort_order) VALUES(?,?,?,?)").bind(pollId,crypto.randomUUID(),label,index)));
  }
  await runBatch(env,statements);

  const studyUrl=text(env.STUDY_APP_URL,500)||'https://scp-study.ksariash.workers.dev';
  if(kind==='announcement'&&audienceType==='broadcast'){
    const notificationId=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO app_notifications(id,kind,zman,title,body,body_html,created_at,target_installation_id,action_json,dedupe_key) VALUES(?, 'announcement',NULL,?,?,?,?,NULL,NULL,?)").bind(notificationId,title,bodyText,bodyHtml,created,'message:'+messageId).run();
    await pushMany(env,count.push,()=>({title,body:pushBody(bodyText),tag:'scp-'+notificationId,data:{notificationId,kind:'announcement',zman:null,url:studyUrl+'/?notifications=1'}}));
  }else{
    const pushByInstall=new Map();for(const row of count.push){const id=String(row.installation_id);if(!pushByInstall.has(id))pushByInstall.set(id,[]);pushByInstall.get(id).push(row)}
    for(const installationId of count.ids){
      const notificationId=crypto.randomUUID();let actionJson=null,actionUrl=studyUrl+'/?notifications=1';
      if(pollId){
        const invite=randomToken(24),inviteHash=await sha256(invite),installationHash=await sha256(installationId),pollUrl=new URL('/poll/'+pollId,new URL(request.url).origin);pollUrl.searchParams.set('t',invite);actionUrl=pollUrl.href;actionJson=JSON.stringify({type:'poll',label:'Vote',url:actionUrl,pollId});
        await env.DB.prepare("INSERT INTO announcement_poll_invites(token_hash,poll_id,installation_hash,created_at) VALUES(?,?,?,?)").bind(inviteHash,pollId,installationHash,created).run();
      }
      else if(kind==='feedback_request'){
        const invite=randomToken(24),inviteHash=await sha256(invite),installationHash=await sha256(installationId),feedbackUrl=new URL('/feedback/'+messageId,new URL(request.url).origin);
        feedbackUrl.searchParams.set('t',invite);actionUrl=feedbackUrl.href;actionJson=JSON.stringify({type:'feedback_request',label:'Reply',url:actionUrl});
        await env.DB.prepare("INSERT INTO announcement_feedback_invites(token_hash,message_id,installation_hash,created_at) VALUES(?,?,?,?)").bind(inviteHash,messageId,installationHash,created).run();
      }
      await env.DB.prepare("INSERT INTO app_notifications(id,kind,zman,title,body,body_html,created_at,target_installation_id,action_json,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(notificationId,kind,zman,title,bodyText,bodyHtml,created,installationId,actionJson,'message:'+messageId+':'+installationId).run();
      const rows=pushByInstall.get(installationId)||[];
      await pushMany(env,rows,()=>({title,body:pushBody(bodyText),tag:'scp-'+notificationId,data:{notificationId,kind,zman,url:actionUrl}}));
    }
  }
  return json({ok:true,messageId,pollId,students:count.students,pushEnabled:count.pushEnabled,audienceLabel});
}

async function listMessages(env,user){
  const base=`SELECT m.*,
    COALESCE((SELECT COUNT(DISTINCT s.installation_id)
      FROM app_notifications n JOIN notification_state s ON s.notification_id=n.id
      WHERE (n.dedupe_key='message:'||m.id OR n.dedupe_key LIKE 'message:'||m.id||':%') AND s.read_at IS NOT NULL),0) read_count,
    COALESCE((SELECT COUNT(*) FROM announcement_feedback_responses r WHERE r.message_id=m.id),0) response_count
    FROM announcement_messages m`;
  const sql=user.isAdmin?base+" ORDER BY m.created_at DESC LIMIT 100":base+" WHERE m.created_by_email=? ORDER BY m.created_at DESC LIMIT 100";
  const result=user.isAdmin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(user.email).all();
  return json({messages:(result.results||[]).map(row=>({
    id:row.id,kind:row.kind,title:row.title,audienceType:row.audience_type,
    audienceLabel:row.audience_type==='broadcast'?'All SCP students':(row.chabura+' · '+row.region),
    recipientCount:Number(row.recipient_count)||0,receivedCount:Number(row.recipient_count)||0,
    readCount:Number(row.read_count)||0,responseCount:Number(row.response_count)||0,
    pushCount:Number(row.push_count)||0,pollId:row.poll_id||null,createdAt:row.created_at,createdBy:row.created_by_email
  }))});
}

async function pollResults(env,user,pollId){
  const poll=await env.DB.prepare("SELECT p.*,m.created_by_email FROM announcement_polls p JOIN announcement_messages m ON m.id=p.message_id WHERE p.id=?").bind(pollId).first();
  if(!poll)return json({error:'Poll not found'},{status:404});if(!user.isAdmin&&poll.created_by_email!==user.email)return json({error:'Not permitted'},{status:403});
  const rows=await env.DB.prepare("SELECT o.option_id,o.label,o.sort_order,COUNT(v.option_id) votes FROM announcement_poll_options o LEFT JOIN announcement_poll_votes v ON v.poll_id=o.poll_id AND v.option_id=o.option_id WHERE o.poll_id=? GROUP BY o.option_id,o.label,o.sort_order ORDER BY o.sort_order").bind(pollId).all();
  const total=await env.DB.prepare("SELECT COUNT(*) n FROM announcement_poll_votes WHERE poll_id=?").bind(pollId).first();
  return json({pollId,title:poll.title,totalVotes:Number(total?.n)||0,options:(rows.results||[]).map(row=>({id:row.option_id,label:row.label,votes:Number(row.votes)||0}))});
}

async function pollView(env,pollId,token){
  const tokenHash=await sha256(token||''),invite=await env.DB.prepare("SELECT i.*,p.title,p.body_html,p.closes_at FROM announcement_poll_invites i JOIN announcement_polls p ON p.id=i.poll_id WHERE i.token_hash=? AND i.poll_id=?").bind(tokenHash,pollId).first();
  if(!invite)return null;
  const options=(await env.DB.prepare("SELECT option_id,label FROM announcement_poll_options WHERE poll_id=? ORDER BY sort_order").bind(pollId).all()).results||[];
  const vote=await env.DB.prepare("SELECT option_id FROM announcement_poll_votes WHERE poll_id=? AND invite_hash=?").bind(pollId,tokenHash).first();
  return{invite,options,vote:vote?.option_id||null,tokenHash};
}
function pollPage(pollId,token,data){
  if(!data)return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poll unavailable</title><style>body{font-family:system-ui;padding:30px;color:#17243c}</style><h1>Poll unavailable</h1><p>This poll link is invalid or no longer available.</p>';
  const options=data.options.map(option=>'<label style="display:flex;gap:9px;padding:11px;border:1px solid #dbe4f0;border-radius:11px"><input type="radio" name="option" value="'+escapeHtml(option.option_id)+'" '+(data.vote===option.option_id?'checked':'')+' '+(data.vote?'disabled':'')+'><span>'+escapeHtml(option.label)+'</span></label>').join('');
  const voted=data.vote?'<p id="status" style="color:#24643b;font-weight:700">Vote recorded.</p>':'<p id="status"></p><button id="vote" style="border:0;border-radius:10px;padding:11px 15px;background:#275bd6;color:white;font-weight:800">Submit vote</button>';
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHtml(data.invite.title)+'</title></head><body style="margin:0;background:#eef3fb;color:#14213d;font-family:system-ui"><main style="width:min(620px,calc(100% - 24px));margin:30px auto;background:white;border-radius:18px;padding:20px;box-shadow:0 20px 50px rgba(22,37,84,.1)"><h1 style="margin-top:0">'+escapeHtml(data.invite.title)+'</h1><div style="line-height:1.5;color:#4d5b70">'+(data.invite.body_html||'')+'</div><form id="pollForm" style="display:grid;gap:8px;margin-top:18px">'+options+'</form><div style="margin-top:14px">'+voted+'</div></main><script>const btn=document.getElementById("vote");if(btn)btn.addEventListener("click",async()=>{const choice=document.querySelector("input[name=option]:checked");const status=document.getElementById("status");if(!choice){status.textContent="Choose an option.";return}btn.disabled=true;const r=await fetch("/api/polls/'+encodeURIComponent(pollId)+'/vote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:'+JSON.stringify(token)+',optionId:choice.value})});const d=await r.json();if(!r.ok){status.textContent=d.error||"Could not save vote.";btn.disabled=false;return}status.textContent="Vote recorded.";document.querySelectorAll("input[name=option]").forEach(x=>x.disabled=true);btn.remove()});</script></body></html>';
}
async function votePoll(request,env,pollId){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});let body;try{body=await request.json()}catch(_){return json({error:'Invalid JSON'},{status:400})}
  const token=String(body?.token||''),optionId=text(body?.optionId,100),tokenHash=await sha256(token),invite=await env.DB.prepare("SELECT * FROM announcement_poll_invites WHERE token_hash=? AND poll_id=?").bind(tokenHash,pollId).first();
  if(!invite)return json({error:'Invalid poll invitation'},{status:403});const option=await env.DB.prepare("SELECT option_id FROM announcement_poll_options WHERE poll_id=? AND option_id=?").bind(pollId,optionId).first();if(!option)return json({error:'Invalid option'},{status:400});
  const existing=await env.DB.prepare("SELECT option_id FROM announcement_poll_votes WHERE poll_id=? AND invite_hash=?").bind(pollId,tokenHash).first();if(existing)return json({ok:true,alreadyVoted:true});
  const now=nowIso();await env.DB.batch([env.DB.prepare("INSERT INTO announcement_poll_votes(poll_id,invite_hash,option_id,voted_at) VALUES(?,?,?,?)").bind(pollId,tokenHash,optionId,now),env.DB.prepare("UPDATE announcement_poll_invites SET voted_at=? WHERE token_hash=?").bind(now,tokenHash)]);
  return json({ok:true});
}


async function feedbackInviteView(env,messageId,token){
  const tokenHash=await sha256(token||'');
  const invite=await env.DB.prepare(`SELECT i.token_hash,i.message_id,i.responded_at,m.title,m.body_html,m.body_text
    FROM announcement_feedback_invites i JOIN announcement_messages m ON m.id=i.message_id
    WHERE i.token_hash=? AND i.message_id=?`).bind(tokenHash,messageId).first();
  if(!invite)return null;
  return{invite,tokenHash};
}
function feedbackResponsePage(messageId,token,data){
  if(!data)return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feedback unavailable</title><style>body{font-family:system-ui;padding:30px;color:#17243c}</style><h1>Feedback unavailable</h1><p>This feedback link is invalid or no longer available.</p>';
  const already=!!data.invite.responded_at;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.invite.title)}</title>
  <style>body{margin:0;background:#eef3fb;color:#14213d;font-family:system-ui}.card{width:min(680px,calc(100% - 24px));margin:28px auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 20px 50px rgba(22,37,84,.1)}h1{margin:0 0 10px;font-size:1.35rem}.prompt{color:#4d5b70;line-height:1.55}.toolbar{display:flex;gap:5px;flex-wrap:wrap;padding:7px;border:1px solid #dbe4f0;border-bottom:0;border-radius:12px 12px 0 0;background:#f7f9fc}.toolbar button{border:1px solid #dbe4f0;border-radius:8px;background:#fff;padding:6px 9px}.editor{min-height:160px;border:1px solid #dbe4f0;border-radius:0 0 12px 12px;padding:12px;outline:none;line-height:1.5}.editor:empty:before{content:'Write your feedback…';color:#98a5b7}.files{margin-top:12px;padding:11px;border:1px solid #dbe4f0;border-radius:12px}.files small{display:block;color:#6f7e95;margin-top:5px}.send{margin-top:13px;border:0;border-radius:10px;padding:11px 16px;background:#275bd6;color:#fff;font-weight:800}.status{margin-top:10px;color:#58667c;font-size:.86rem}</style></head>
  <body><main class="card"><h1>${escapeHtml(data.invite.title)}</h1><div class="prompt">${data.invite.body_html||escapeHtml(data.invite.body_text||'')}</div>
  ${already?'<p class="status"><strong>Your feedback was submitted.</strong></p>':`
  <div style="margin-top:18px"><div class="toolbar"><button type="button" data-cmd="bold"><b>B</b></button><button type="button" data-cmd="italic"><i>I</i></button><button type="button" data-cmd="underline"><u>U</u></button><button type="button" data-cmd="insertUnorderedList">• List</button><button type="button" data-cmd="insertOrderedList">1. List</button><button type="button" id="replyLink">Link</button></div><div id="replyEditor" class="editor" contenteditable="true"></div></div>
  <label class="files">Media attachments <input id="replyFiles" type="file" accept="image/*,audio/*,video/*" multiple><small>Up to 3 files, 10 MB each.</small></label>
  <button id="replySend" class="send" type="button">Send feedback</button><div id="replyStatus" class="status"></div>
  <script>
  document.querySelectorAll('[data-cmd]').forEach(b=>b.addEventListener('click',()=>{document.execCommand(b.dataset.cmd,false,null);document.getElementById('replyEditor').focus()}));
  document.getElementById('replyLink').addEventListener('click',()=>{const u=prompt('Link URL');if(!u)return;try{const x=new URL(u);if(!['http:','https:'].includes(x.protocol))throw 0;document.execCommand('createLink',false,x.href)}catch(_){alert('Use a valid http or https URL.')}});
  document.getElementById('replySend').addEventListener('click',async()=>{const editor=document.getElementById('replyEditor'),status=document.getElementById('replyStatus'),button=document.getElementById('replySend'),files=[...document.getElementById('replyFiles').files];if(!editor.textContent.trim()){status.textContent='Write a response.';return}if(files.length>3){status.textContent='Choose up to 3 files.';return}const fd=new FormData();fd.append('token',${JSON.stringify(token)});fd.append('bodyHtml',editor.innerHTML);files.forEach(f=>fd.append('media',f));button.disabled=true;status.textContent='Sending…';try{const r=await fetch('/api/feedback-requests/${encodeURIComponent(messageId)}/respond',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not send');status.textContent='Feedback sent.';editor.contentEditable='false';button.remove();document.getElementById('replyFiles').disabled=true}catch(e){status.textContent=e.message;button.disabled=false}});
  </script>`}</main></body></html>`;
}
function cleanFilename(value){return String(value||'attachment').replace(/[\r\n"]/g,'').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,160)||'attachment'}
async function submitFeedbackResponse(request,env,messageId){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});
  const form=await request.formData(),token=String(form.get('token')||''),view=await feedbackInviteView(env,messageId,token);
  if(!view)return json({error:'Invalid feedback invitation'},{status:403});
  if(view.invite.responded_at)return json({error:'Feedback was already submitted.'},{status:409});
  const bodyHtml=sanitizeRichHtml(form.get('bodyHtml')),bodyText=text(richToPlain(bodyHtml),10000);
  if(!bodyText)return json({error:'Feedback message is required.'},{status:400});
  const media=form.getAll('media').filter(value=>value&&typeof value==='object'&&typeof value.arrayBuffer==='function');
  if(media.length>3)return json({error:'Choose up to 3 media files.'},{status:400});
  let total=0;
  for(const file of media){
    const type=String(file.type||'').toLowerCase();
    if(!/^(image|audio|video)\//.test(type))return json({error:'Attachments must be images, audio, or video.'},{status:400});
    if(Number(file.size)>10*1024*1024)return json({error:'Each attachment must be 10 MB or smaller.'},{status:400});
    total+=Number(file.size)||0;
  }
  if(total>20*1024*1024)return json({error:'Total attachments must be 20 MB or smaller.'},{status:400});
  if(media.length&&!env.MEDIA)return json({error:'Media storage is not configured.'},{status:503});
  const responseId=crypto.randomUUID(),created=nowIso(),attachmentRows=[];
  for(const file of media){
    const attachmentId=crypto.randomUUID(),objectKey='feedback-media/'+CURRENT_ZMAN+'/'+messageId+'/'+responseId+'/'+attachmentId;
    await env.MEDIA.put(objectKey,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});
    attachmentRows.push({id:attachmentId,objectKey,filename:cleanFilename(file.name),contentType:file.type||'application/octet-stream',size:Number(file.size)||0});
  }
  const statements=[
    env.DB.prepare("INSERT INTO announcement_feedback_responses(id,message_id,invite_hash,body_text,body_html,created_at) VALUES(?,?,?,?,?,?)").bind(responseId,messageId,view.tokenHash,bodyText,bodyHtml,created),
    env.DB.prepare("UPDATE announcement_feedback_invites SET responded_at=? WHERE token_hash=?").bind(created,view.tokenHash),
    ...attachmentRows.map(item=>env.DB.prepare("INSERT INTO announcement_feedback_attachments(id,response_id,object_key,filename,content_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?)").bind(item.id,responseId,item.objectKey,item.filename,item.contentType,item.size,created))
  ];
  await runBatch(env,statements);
  return json({ok:true,responseId});
}
async function feedbackResponses(env,user,messageId){
  const message=await env.DB.prepare("SELECT id,title,created_by_email FROM announcement_messages WHERE id=? AND kind='feedback_request'").bind(messageId).first();
  if(!message)return json({error:'Feedback request not found'},{status:404});
  if(!user.isAdmin&&message.created_by_email!==user.email)return json({error:'Not permitted'},{status:403});
  const rows=(await env.DB.prepare("SELECT id,body_html,body_text,created_at FROM announcement_feedback_responses WHERE message_id=? ORDER BY created_at DESC").bind(messageId).all()).results||[];
  const result=[];
  for(const row of rows){
    const attachments=(await env.DB.prepare("SELECT id,filename,content_type,size_bytes FROM announcement_feedback_attachments WHERE response_id=? ORDER BY created_at").bind(row.id).all()).results||[];
    result.push({id:row.id,bodyHtml:row.body_html,bodyText:row.body_text,createdAt:row.created_at,attachments:attachments.map(a=>({id:a.id,filename:a.filename,contentType:a.content_type,sizeBytes:Number(a.size_bytes)||0,url:'/api/feedback-media/'+a.id}))});
  }
  return json({messageId,title:message.title,responses:result});
}
async function feedbackMedia(request,env,user,attachmentId){
  const row=await env.DB.prepare(`SELECT a.object_key,a.filename,a.content_type,m.created_by_email
    FROM announcement_feedback_attachments a
    JOIN announcement_feedback_responses r ON r.id=a.response_id
    JOIN announcement_messages m ON m.id=r.message_id
    WHERE a.id=?`).bind(attachmentId).first();
  if(!row)return new Response('Not found',{status:404});
  if(!user.isAdmin&&row.created_by_email!==user.email)return new Response('Forbidden',{status:403});
  const object=await env.MEDIA?.get(row.object_key);
  if(!object)return new Response('Not found',{status:404});
  const headers=new Headers();headers.set('Content-Type',row.content_type||'application/octet-stream');headers.set('Content-Disposition','inline; filename="'+cleanFilename(row.filename)+'"');headers.set('Cache-Control','private, max-age=60');
  return new Response(object.body,{headers});
}

async function listUsers(env){
  const userRows=(await env.DB.prepare("SELECT * FROM announcement_users ORDER BY display_name,email").all()).results||[],assignRows=(await env.DB.prepare("SELECT email,region,chabura FROM announcement_user_chaburos WHERE zman=? ORDER BY region,chabura").bind(CURRENT_ZMAN).all()).results||[],byEmail=new Map();
  for(const row of assignRows){if(!byEmail.has(row.email))byEmail.set(row.email,[]);byEmail.get(row.email).push({region:row.region,chabura:row.chabura})}
  return userRows.map(row=>({email:row.email,displayName:row.display_name||'',isAdmin:row.role==='admin',allowChaburaAnnouncements:!!row.allow_chabura_announcements,allowChaburaPolls:!!row.allow_chabura_polls,allowBroadcasts:!!row.allow_broadcasts,active:!!row.active,lastLoginAt:row.last_login_at||null,chaburas:byEmail.get(row.email)||[]}));
}
async function saveUser(request,env,admin){
  if(!sameOrigin(request))return json({error:'Invalid origin'},{status:403});let body;try{body=await request.json()}catch(_){return json({error:'Invalid JSON'},{status:400})}
  const addr=email(body?.email);if(!addr)return json({error:'Valid email required'},{status:400});
  const display=text(body?.displayName,120),role=body?.isAdmin?'admin':'sender',active=body?.active===false?0:1,ann=body?.allowChaburaAnnouncements?1:0,polls=body?.allowChaburaPolls?1:0,broadcasts=body?.allowBroadcasts?1:0,assignments=Array.isArray(body?.chaburas)?body.chaburas:[];
  const valid=[];for(const item of assignments){const region=text(item?.region,120),chabura=text(item?.chabura,180);if(region&&chabura&&CHABURA_KEYS.has(region+'\u0000'+chabura))valid.push({region,chabura})}
  const now=nowIso();await env.DB.prepare("INSERT INTO announcement_users(email,display_name,role,allow_chabura_announcements,allow_chabura_polls,allow_broadcasts,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,allow_chabura_announcements=excluded.allow_chabura_announcements,allow_chabura_polls=excluded.allow_chabura_polls,allow_broadcasts=excluded.allow_broadcasts,active=excluded.active,updated_at=excluded.updated_at").bind(addr,display,role,ann,polls,broadcasts,active,now,now).run();
  await env.DB.prepare("DELETE FROM announcement_user_chaburos WHERE email=? AND zman=?").bind(addr,CURRENT_ZMAN).run();
  const statements=valid.map(item=>env.DB.prepare("INSERT INTO announcement_user_chaburos(email,zman,region,chabura,created_at) VALUES(?,?,?,?,?)").bind(addr,CURRENT_ZMAN,item.region,item.chabura,now));if(statements.length)await runBatch(env,statements);
  if(!active)await env.DB.prepare("DELETE FROM announcement_sessions WHERE email=?").bind(addr).run();
  let warning=null;if(body?.sendInvite){try{await sendInvite(env,addr,new URL(request.url).origin)}catch(error){warning='Account saved, but invite email was not sent: '+error.message}}
  return json({ok:true,warning});
}

async function route(request,env){
  await setup(env);const url=new URL(request.url),path=url.pathname;
  if(path==='/health')return json({ok:true,service:'scp-study-announcements',version:3,zman:env.CURRENT_ZMAN||CURRENT_ZMAN});
  if(path==='/api/meta'){
    const count=await env.DB.prepare("SELECT COUNT(*) n FROM announcement_users").first();
    const config=emailConfigStatus(env),adminCount=Number(count?.n||0);
    return json({
      setupRequired:adminCount===0&&!config.bootstrapConfigured,
      bootstrapConfigured:config.bootstrapConfigured,
      adminAccountExists:adminCount>0,
      emailFromConfigured:config.emailFromConfigured,
      resendConfigured:config.resendConfigured,
      emailBindingConfigured:config.emailBindingConfigured,
      emailConfigured:config.emailConfigured,
      provider:config.provider,
      missing:config.missing,
      zman:env.CURRENT_ZMAN||CURRENT_ZMAN
    });
  }
  if(path==='/api/auth/request-code'&&request.method==='POST')return requestCode(request,env);
  if(path==='/api/auth/verify'&&request.method==='POST')return verifyCode(request,env);
  if(path==='/api/auth/logout'&&request.method==='POST')return logout(request,env);
  if(path.startsWith('/poll/')&&request.method==='GET'){const pollId=path.split('/')[2]||'',token=url.searchParams.get('t')||'',data=await pollView(env,pollId,token);return html(pollPage(pollId,token,data))}
  const voteMatch=path.match(/^\/api\/polls\/([^/]+)\/vote$/);if(voteMatch&&request.method==='POST')return votePoll(request,env,decodeURIComponent(voteMatch[1]));
  if(path.startsWith('/feedback/')&&request.method==='GET'){const messageId=path.split('/')[2]||'',token=url.searchParams.get('t')||'',data=await feedbackInviteView(env,messageId,token);return html(feedbackResponsePage(messageId,token,data))}
  const feedbackSubmit=path.match(/^\/api\/feedback-requests\/([^/]+)\/respond$/);if(feedbackSubmit&&request.method==='POST')return submitFeedbackResponse(request,env,decodeURIComponent(feedbackSubmit[1]));
  const user=await requireUser(request,env);
  if(path==='/api/me'&&request.method==='GET')return json(publicUser(user));
  if(path==='/api/chaburas'&&request.method==='GET'){const list=(url.searchParams.get('all')==='1'&&user.isAdmin)?CHABURAS:CHABURAS.filter(item=>user.isAdmin||user.chaburas.some(a=>a.region===item.region&&a.chabura===item.name));return json({zman:env.CURRENT_ZMAN||CURRENT_ZMAN,chaburas:list})}
  if(path==='/api/audience-count'&&request.method==='GET')return audienceCountRoute(request,env,user);
  if(path==='/api/messages'&&request.method==='GET')return listMessages(env,user);
  if(path==='/api/messages'&&request.method==='POST')return createMessage(request,env,user);
  const resultsMatch=path.match(/^\/api\/polls\/([^/]+)\/results$/);if(resultsMatch&&request.method==='GET')return pollResults(env,user,decodeURIComponent(resultsMatch[1]));
  const feedbackResponsesMatch=path.match(/^\/api\/feedback-requests\/([^/]+)\/responses$/);if(feedbackResponsesMatch&&request.method==='GET')return feedbackResponses(env,user,decodeURIComponent(feedbackResponsesMatch[1]));
  const feedbackMediaMatch=path.match(/^\/api\/feedback-media\/([^/]+)$/);if(feedbackMediaMatch&&request.method==='GET')return feedbackMedia(request,env,user,decodeURIComponent(feedbackMediaMatch[1]));
  if(path==='/api/admin/users'&&request.method==='GET'){await requireAdmin(request,env);return json({users:await listUsers(env)})}
  if(path==='/api/admin/users'&&request.method==='POST'){const admin=await requireAdmin(request,env);return saveUser(request,env,admin)}
  return json({error:'Not found'},{status:404});
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/poll/')||url.pathname==='/health'){
      try{return await route(request,env)}catch(error){return json({error:error?.message||'Server error'},{status:Number(error?.status)||500})}
    }
    return env.ASSETS.fetch(request);
  }
};